import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import * as Location from "expo-location";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import apiClient, { API_BASE_URL } from "../../api/client";
import { DriverMyRouteResponse, DriverStop } from "../../api/types";
import RouteMap from "../../components/RouteMap";
import { useAuth } from "../../hooks/useAuth";
import socketService from "../../sockets/socketService";

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

type StopMarker = {
  latitude: number;
  longitude: number;
  name: string;
  sequenceOrder?: number;
  distanceFromCurrentText?: string;
  etaFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  etaFromCurrentSeconds?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
  isPassed?: boolean;
};

type LastSentPayload = {
  latitude: number;
  longitude: number;
  source: "initial" | "watch" | "heartbeat";
  timestamp: string;
};

type ProgressStop = {
  id?: string;
  name: string;
  sequenceOrder?: number;
  distanceFromCurrentText?: string;
  etaFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  etaFromCurrentSeconds?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
  isPassed?: boolean;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const formatEtaFromSeconds = (seconds?: number): string | null => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  if (seconds < 60) {
    return "<1 min";
  }

  return `${Math.round(seconds / 60)} min`;
};

const formatDistanceFromMeters = (meters?: number): string | null => {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
    return null;
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }

  return `${Math.round(meters)} m`;
};

const getLocationErrorMessage = (err: unknown): string => {
  const error = err as { code?: number; message?: string };
  const message = (error?.message || "").toLowerCase();

  if (error?.code === 1 || message.includes("denied")) {
    return "Location access is denied. Enable location permission in browser/app settings and tap START TRACKING.";
  }

  if (error?.code === 2 || message.includes("unavailable")) {
    return "Location is currently unavailable. Turn on GPS/location services and try again.";
  }

  if (error?.code === 3 || message.includes("timeout")) {
    return "Location request timed out. Move to an open area and tap START TRACKING again.";
  }

  return "Unable to fetch location right now. Please try again.";
};

const parseStopCoordinate = (stop: {
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  location?: {
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  };
}): MapCoordinate | null => {
  const latitude =
    stop.lat ?? stop.latitude ?? stop.location?.lat ?? stop.location?.latitude;
  const longitude =
    stop.lng ??
    stop.longitude ??
    stop.location?.lng ??
    stop.location?.longitude;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  return { latitude, longitude };
};

export default function DriverTrackingScreen() {
  const { isAuthenticated, isHydrated, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [routeData, setRouteData] = useState<DriverMyRouteResponse | null>(
    null,
  );
  const [mapPath, setMapPath] = useState<MapCoordinate[]>([]);
  const [currentLocation, setCurrentLocation] = useState<MapCoordinate | null>(
    null,
  );
  const [stopPoints, setStopPoints] = useState<StopMarker[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [sendCount, setSendCount] = useState(0);
  const [lastSentPayload, setLastSentPayload] =
    useState<LastSentPayload | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const sendCountRef = useRef(0);
  const latestLocationRef = useRef<MapCoordinate | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketConnectHandlerRef = useRef<(() => void) | null>(null);
  const socketDisconnectHandlerRef = useRef<(() => void) | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );

  const progressStops = useMemo<ProgressStop[]>(() => {
    const stops = (routeData?.stops ?? []) as DriverStop[];

    return stops
      .map((stop, index) => {
        const sequenceOrder =
          toNumber(stop?.sequenceOrder) ??
          toNumber((stop as any)?.sequence) ??
          index + 1;

        return {
          id: stop?.id,
          name: stop?.name || `Stop ${index + 1}`,
          sequenceOrder,
          distanceFromCurrentText: stop?.distanceFromCurrentText,
          etaFromCurrentText: stop?.etaFromCurrentText,
          distanceFromCurrentMeters: toNumber(stop?.distanceFromCurrentMeters),
          etaFromCurrentSeconds: toNumber(stop?.etaFromCurrentSeconds),
          segmentDistanceText: stop?.segmentDistanceText,
          segmentEtaText: stop?.segmentEtaText,
          isPassed: stop?.isPassed,
        };
      })
      .sort((a, b) => {
        const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
  }, [routeData?.stops]);

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const stopLiveTracking = useCallback(async () => {
    clearHeartbeatTimer();

    if (socketConnectHandlerRef.current) {
      socketService.off("connect", socketConnectHandlerRef.current as any);
      socketConnectHandlerRef.current = null;
    }

    if (socketDisconnectHandlerRef.current) {
      socketService.off(
        "disconnect",
        socketDisconnectHandlerRef.current as any,
      );
      socketDisconnectHandlerRef.current = null;
    }

    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    latestLocationRef.current = null;
    socketService.disconnect();
    setSocketConnected(false);
    setIsLiveTracking(false);
  }, [clearHeartbeatTimer]);

  const sendLocationUpdate = useCallback(
    async (
      latitude: number,
      longitude: number,
      busId: string,
      source: "initial" | "watch" | "heartbeat" = "watch",
    ) => {
      const sequence = sendCountRef.current + 1;
      sendCountRef.current = sequence;
      const timestamp = new Date().toISOString();

      console.log("[TRACKING][SEND][START]", {
        sequence,
        timestamp,
        busId,
        latitude,
        longitude,
        source,
      });

      socketService.connect(API_BASE_URL, token ?? undefined);
      const socketReady = await socketService.waitUntilConnected(4000);
      setSocketConnected(socketReady);

      let socketSent = false;
      let restSent = false;
      let socketError: unknown;
      let restError: unknown;

      try {
        if (socketReady) {
          socketService.emit("driverLocationUpdate", {
            busId,
            latitude,
            longitude,
          });
          socketSent = true;
        } else {
          throw new Error("Socket not connected before emit");
        }
      } catch (err) {
        socketError = err;
      }

      try {
        await apiClient.post("/api/tracking/me/location", {
          latitude,
          longitude,
        });
        restSent = true;
      } catch (err) {
        restError = err;
      }

      if (!socketSent && !restSent) {
        console.error("[TRACKING][SEND][FAILED]", {
          sequence,
          timestamp,
          busId,
          latitude,
          longitude,
          source,
          socketError,
          restError,
        });
        throw socketError || restError || new Error("Location send failed");
      }

      console.log("[TRACKING][SEND][RESULT]", {
        sequence,
        timestamp,
        busId,
        latitude,
        longitude,
        source,
        socketSent,
        restSent,
      });

      setSendCount(sequence);
      setLastSentPayload({
        latitude,
        longitude,
        source,
        timestamp,
      });

      if (socketSent && !restSent) {
        console.warn("REST location update failed; websocket update sent");
      }

      if (!socketSent && restSent) {
        console.warn("Websocket update failed; REST location update sent");
      }
    },
    [token],
  );

  const startHeartbeatTimer = useCallback(
    (busId: string) => {
      clearHeartbeatTimer();

      heartbeatTimerRef.current = setInterval(async () => {
        if (!socketService.isConnected()) {
          return;
        }

        const latest = latestLocationRef.current;
        if (!latest) {
          return;
        }

        try {
          await sendLocationUpdate(
            latest.latitude,
            latest.longitude,
            busId,
            "heartbeat",
          );
          setUpdatedAt(new Date());
        } catch (heartbeatError) {
          console.error("Heartbeat location update failed:", heartbeatError);
        }
      }, 5000);
    },
    [clearHeartbeatTimer, sendLocationUpdate],
  );

  const startLiveTracking = useCallback(
    async (busId: string) => {
      setLocationError(null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError(
          "Location permission denied. Enable location access and tap START TRACKING.",
        );
        setIsLiveTracking(false);
        return;
      }

      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationError(
          "Location services are off. Turn on device GPS/location services and tap START TRACKING.",
        );
        setIsLiveTracking(false);
        return;
      }

      if (socketConnectHandlerRef.current) {
        socketService.off("connect", socketConnectHandlerRef.current as any);
      }

      if (socketDisconnectHandlerRef.current) {
        socketService.off(
          "disconnect",
          socketDisconnectHandlerRef.current as any,
        );
      }

      socketConnectHandlerRef.current = () => {
        setSocketConnected(true);
        startHeartbeatTimer(busId);
      };

      socketDisconnectHandlerRef.current = () => {
        setSocketConnected(false);
        clearHeartbeatTimer();
      };

      socketService.on("connect", socketConnectHandlerRef.current as any);
      socketService.on(
        "disconnect",
        socketDisconnectHandlerRef.current as any,
      );

      socketService.connect(API_BASE_URL, token ?? undefined);
      const socketReady = await socketService.waitUntilConnected(4000);
      setSocketConnected(socketReady);
      if (socketReady) {
        startHeartbeatTimer(busId);
      }

      try {
        try {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          latestLocationRef.current = {
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
          };
          setCurrentLocation(latestLocationRef.current);

          try {
            await sendLocationUpdate(
              current.coords.latitude,
              current.coords.longitude,
              busId,
              "initial",
            );
            setUpdatedAt(new Date());
          } catch (updateError) {
            console.error("Initial location update failed:", updateError);
          }
        } catch (initialLocationErr) {
          const message = getLocationErrorMessage(initialLocationErr);
          setLocationError(message);
          const error = initialLocationErr as {
            code?: number;
            message?: string;
          };
          if (error?.code !== 1) {
            console.warn(
              "Initial location read failed, waiting for watch updates",
            );
          }
        }

        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          async (position) => {
            try {
              await sendLocationUpdate(
                position.coords.latitude,
                position.coords.longitude,
                busId,
                "watch",
              );
              latestLocationRef.current = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              };
              setCurrentLocation(latestLocationRef.current);
              setUpdatedAt(new Date());
              setLocationError(null);
            } catch (updateError) {
              console.error("Location update failed:", updateError);
            }
          },
        );

        setIsLiveTracking(true);
      } catch (locationErr) {
        setLocationError(getLocationErrorMessage(locationErr));
        setIsLiveTracking(false);
        const error = locationErr as { code?: number; message?: string };
        if (error?.code !== 1) {
          console.error("Live tracking start failed:", locationErr);
        }
      }
    },
    [clearHeartbeatTimer, sendLocationUpdate, startHeartbeatTimer, token],
  );

  const loadTracking = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      try {
        await apiClient.post("/api/driver/tracking/start", {});
      } catch {
        // Keep going even if tracking is already active
      }

      const response = await apiClient.get<
        DriverMyRouteResponse | { data?: DriverMyRouteResponse }
      >("/api/driver/my-route");

      const payload =
        (response.data as { data?: DriverMyRouteResponse }).data ??
        (response.data as DriverMyRouteResponse);

      if (!payload?.route || !payload?.bus) {
        throw new Error("Tracking details not available");
      }

      setRouteData(payload);

      const decodedRoute = payload.route.encodedPolyline
        ? (
          polyline.decode(payload.route.encodedPolyline) as [number, number][]
        ).map(([latitude, longitude]) => ({ latitude, longitude }))
        : [];

      const stops: StopMarker[] = (payload.stops || [])
        .map((stop, index) => {
          const point = parseStopCoordinate(stop as any);
          if (!point) {
            return null;
          }
          const stopData = stop as any;
          return {
            ...point,
            name: stopData?.name || `Stop ${index + 1}`,
            sequenceOrder:
              toNumber(stopData?.sequenceOrder) ??
              toNumber(stopData?.sequence) ??
              index + 1,
            distanceFromCurrentText: stopData?.distanceFromCurrentText,
            etaFromCurrentText: stopData?.etaFromCurrentText,
            distanceFromCurrentMeters: stopData?.distanceFromCurrentMeters,
            etaFromCurrentSeconds: stopData?.etaFromCurrentSeconds,
            segmentDistanceText: stopData?.segmentDistanceText,
            segmentEtaText: stopData?.segmentEtaText,
            isPassed: stopData?.isPassed,
          } as StopMarker;
        })
        .filter((point): point is StopMarker => point !== null);

      const start = decodedRoute[0];
      const end = decodedRoute[decodedRoute.length - 1];

      const stitchedPath: MapCoordinate[] = [];
      if (start) {
        stitchedPath.push(start);
      }
      stitchedPath.push(
        ...stops.map((stop) => ({
          latitude: stop.latitude,
          longitude: stop.longitude,
        })),
      );
      if (end) {
        const last = stitchedPath[stitchedPath.length - 1];
        if (
          !last ||
          last.latitude !== end.latitude ||
          last.longitude !== end.longitude
        ) {
          stitchedPath.push(end);
        }
      }

      setStopPoints(stops);
      setMapPath(stitchedPath.length >= 2 ? stitchedPath : decodedRoute);
      setUpdatedAt(new Date());

      if (Platform.OS !== "web") {
        await startLiveTracking(payload.bus.id);
      } else {
        setLocationError(
          "Tap START TRACKING to begin live location sharing in browser.",
        );
      }
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        "Failed to load tracking data",
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, startLiveTracking]);

  useEffect(() => {
    if (isHydrated) {
      loadTracking();
    }
  }, [isHydrated, loadTracking]);

  useEffect(() => {
    return () => {
      stopLiveTracking();
    };
  }, [stopLiveTracking]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSocketConnected(socketService.isConnected());
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  const etaDisplayText =
    routeData?.route?.etaToDestinationText ??
    routeData?.route?.estimatedDurationText ??
    formatEtaFromSeconds(
      routeData?.route?.etaToDestinationSeconds ??
        routeData?.route?.estimatedDurationSeconds,
    ) ??
    "-";

  const remainingDistanceText =
    routeData?.route?.distanceToDestinationText ??
    formatDistanceFromMeters(routeData?.route?.distanceToDestinationMeters) ??
    "-";

  const totalDistanceText =
    routeData?.route?.totalDistanceText ??
    formatDistanceFromMeters(routeData?.route?.totalDistanceMeters) ??
    "-";

  const estimatedDurationText =
    routeData?.route?.estimatedDurationText ??
    formatEtaFromSeconds(routeData?.route?.estimatedDurationSeconds) ??
    "-";

  const progress = useMemo(() => {
    if (!routeData?.route) {
      return 0;
    }
    return routeData.route.isActive ? 65 : 0;
  }, [routeData]);

  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-100">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(driver)/login" />;
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-100">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-100 px-6">
        <Text className="text-center text-lg font-semibold text-red-700">
          {error}
        </Text>
        <Pressable
          className="mt-4 rounded-xl bg-blue-700 px-5 py-3"
          onPress={() => router.replace("/(driver)/home")}
        >
          <Text className="font-semibold text-white">Back to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <View className="h-[34%] bg-slate-200">
        {mapPath.length > 0 ? (
          <RouteMap
            coordinates={mapPath}
            stops={stopPoints}
            currentLocation={currentLocation ?? undefined}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-sm text-slate-600">Map not available</Text>
          </View>
        )}

        <View className="absolute left-4 right-4 top-4 flex-row items-start justify-between">
          <View className="w-[62%] flex-row items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
            <View className="h-10 w-10 items-center justify-center rounded-lg bg-blue-700">
              <Ionicons name="navigate" size={20} color="white" />
            </View>
            <View>
              <Text className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Route ID
              </Text>
              <Text className="text-xl font-extrabold text-slate-900">
                {routeData?.route?.id?.slice(-8).toUpperCase() || "-"}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-2">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
              <Ionicons name="settings" size={22} color="#334155" />
            </View>
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
              <Feather name="help-circle" size={22} color="#334155" />
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        className="-mt-6 flex-1 rounded-t-[36px] bg-slate-100"
        contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
      >
        <View className="items-center">
          <View className="h-2 w-16 rounded-full bg-slate-300" />
        </View>

        <View className="mt-4 flex-row items-center justify-between">
          <View className="rounded-full bg-emerald-100 px-4 py-2">
            <Text className="text-sm font-extrabold text-emerald-700">
              ● ACTIVE SESSION ●{" "}
              {isLiveTracking ? "ACTIVE SESSION" : "STARTING SESSION"}
            </Text>
          </View>

          <Text className="text-sm text-slate-500">
            Updated {updatedAt.getHours().toString().padStart(2, "0")}:
            {updatedAt.getMinutes().toString().padStart(2, "0")}:
            {updatedAt.getSeconds().toString().padStart(2, "0")}
          </Text>

          <View className="items-end">
            <Text className="text-mid font-bold text-slate-500">
              TOTAL PROGRESS
            </Text>
            <Text className="text-mid font-extrabold text-blue-700">
              {progress}%
            </Text>
          </View>
        </View>

        <View className="mt-4 rounded-2xl bg-slate-200 px-3 py-3">
          <View className="flex-row items-center gap-3">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-slate-300">
              <Ionicons name="location" size={26} color="#1d4ed8" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold uppercase text-slate-500">
                Current Goal
              </Text>
              <Text className="text-2xl font-extrabold text-slate-900">
                {routeData?.route?.name || "Current Route"}
              </Text>
              <Text className="text-base text-slate-500">
                Bus {routeData?.bus?.numberPlate || "-"}
              </Text>
            </View>
          </View>
        </View>

        <View className="mt-4 rounded-2xl bg-blue-800 px-4 py-4 shadow-md">
          <View className="flex-row items-center justify-between">
            <Ionicons name="time-outline" size={24} color="white" />
            <View className="rounded-lg bg-white/20 px-2 py-1">
              <Text className="text-sm font-extrabold text-white">ON TIME</Text>
              <Text className="text-sm font-extrabold text-white">
                {isLiveTracking ? "TRACKING LIVE" : "STARTING"}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row items-end">
            <Text className="text-5xl font-extrabold text-white">
              {etaDisplayText}
            </Text>
          </View>
          <Text className="mt-1 text-lg text-blue-100">
            Remaining {remainingDistanceText} • Route {totalDistanceText} • Plan{" "}
            {estimatedDurationText}
          </Text>
        </View>

        <View className="mt-5 flex-row gap-3">
          <Pressable className="flex-1 items-center rounded-2xl bg-blue-800 px-3 py-4">
            <Ionicons name="checkmark-circle-outline" size={28} color="white" />
            <Text className="mt-1 text-center text-xl font-extrabold text-white">
              ARRIVE AT STOP
            </Text>
          </Pressable>
          {isLiveTracking ? (
            <Pressable
              className="flex-1 items-center rounded-2xl border border-slate-300 bg-slate-200 px-3 py-4"
              onPress={async () => {
                await stopLiveTracking();
                router.replace("/(driver)/home");
              }}
            >
              <MaterialCommunityIcons
                name="stop-circle-outline"
                size={28}
                color="#dc2626"
              />
              <Text className="mt-1 text-center text-xl font-extrabold text-red-600">
                STOP TRACKING
              </Text>
            </Pressable>
          ) : (
            <Pressable
              className="flex-1 items-center rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-4"
              onPress={async () => {
                const busId = routeData?.bus?.id;
                if (!busId) {
                  return;
                }
                await startLiveTracking(busId);
              }}
            >
              <MaterialCommunityIcons
                name="play-circle-outline"
                size={28}
                color="#059669"
              />
              <Text className="mt-1 text-center text-xl font-extrabold text-emerald-700">
                START TRACKING
              </Text>
            </Pressable>
          )}
        </View>

        {locationError ? (
          <View className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-800">
              {locationError}
            </Text>
          </View>
        ) : null}

        <View className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Live Debug
          </Text>
          <Text className="mt-1 text-xs text-slate-700">
            Socket: {socketConnected ? "CONNECTED" : "DISCONNECTED"}
          </Text>
          <Text className="text-xs text-slate-700">Sends: {sendCount}</Text>
          <Text className="text-xs text-slate-700">
            Last: {lastSentPayload?.timestamp || "-"}
          </Text>
          <Text className="text-xs text-slate-700">
            Source: {lastSentPayload?.source || "-"}
          </Text>
          <Text className="text-xs text-slate-700">
            Lat/Lng:
            {lastSentPayload
              ? ` ${lastSentPayload.latitude.toFixed(6)}, ${lastSentPayload.longitude.toFixed(6)}`
              : " -"}
          </Text>
        </View>

        <View className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <Text className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Current Progress
          </Text>

          {!progressStops.length ? (
            <Text className="mt-3 text-sm text-slate-500">
              No stops available
            </Text>
          ) : (
            <View className="mt-3">
              {progressStops.map((stop, index) => {
                const isPassed = stop.isPassed === true;
                const isNext =
                  !isPassed &&
                  progressStops
                    .slice(0, index)
                    .every((item) => item.isPassed === true);
                const stopDistance =
                  stop.distanceFromCurrentText ??
                  formatDistanceFromMeters(stop.distanceFromCurrentMeters) ??
                  "distance --";
                const stopEta =
                  stop.etaFromCurrentText ??
                  formatEtaFromSeconds(stop.etaFromCurrentSeconds) ??
                  "ETA --";
                const segmentDetail =
                  stop.segmentDistanceText || stop.segmentEtaText
                    ? `From previous stop: ${stop.segmentDistanceText ?? "-"}${
                        stop.segmentDistanceText && stop.segmentEtaText
                          ? " • "
                          : ""
                      }${stop.segmentEtaText ?? "-"}`
                    : null;

                return (
                  <View
                    key={stop.id ?? `${stop.name}-${index}`}
                    className="mb-3 flex-row items-start gap-3"
                  >
                    <View
                      className={`mt-1 h-3 w-3 rounded-full border-2 ${
                        isNext
                          ? "border-blue-700 bg-blue-700"
                          : isPassed
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-slate-300 bg-white"
                      }`}
                    />
                    <View className="flex-1">
                      <Text
                        className={`text-base ${
                          isNext
                            ? "font-extrabold text-slate-900"
                            : "font-semibold text-slate-600"
                        }`}
                      >
                        {(stop.sequenceOrder != null
                          ? `${stop.sequenceOrder}. `
                          : "") + stop.name}
                      </Text>
                      <Text
                        className={`text-xs ${
                          isNext
                            ? "font-semibold text-blue-700"
                            : isPassed
                              ? "text-slate-400"
                              : "text-slate-500"
                        }`}
                      >
                        {isNext
                          ? "Current stop"
                          : isPassed
                            ? "Passed"
                            : "Upcoming"}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-600">
                        {`From bus: ${stopDistance} • ${stopEta}`}
                      </Text>
                      {segmentDetail ? (
                        <Text className="text-[11px] text-slate-500">
                          {segmentDetail}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

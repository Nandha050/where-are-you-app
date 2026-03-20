import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import * as Location from "expo-location";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "../../api/client";
import {
  DriverMeSnapshot,
  getActiveTrip,
  getDriverMe,
  getDriverMyRoute,
  postMyLocation,
  startTrip,
  stopTrip,
} from "../../api/driver";
import { ActiveTrip } from "../../api/types";
import RouteMap from "../../components/RouteMap";
import { useAuth } from "../../hooks/useAuth";
import { backgroundLocationService } from "../../sockets/backgroundLocationTask";
import socketService from "../../sockets/socketService";

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

type DriverUIState = {
  trip: ActiveTrip | null;
  connection: "connected" | "reconnecting" | "offline";
  sending: boolean;
  lastSentAt?: string;
};

type CoordinateWithSpeed = {
  latitude: number;
  longitude: number;
  speed: number | null;
};

const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 120;

const isAccurateEnough = (accuracy?: number | null): boolean => {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) {
    return true;
  }

  return accuracy <= MAX_ACCEPTABLE_GPS_ACCURACY_METERS;
};

type StopMarker = {
  id?: string;
  latitude: number;
  longitude: number;
  name?: string;
  sequenceOrder?: number;
  isPassed?: boolean;
  etaFromCurrentText?: string;
  etaFromCurrentSeconds?: number;
  distanceFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
};

type StopStatus = "passed" | "next" | "upcoming";

type StopWithStatus = StopMarker & {
  status: StopStatus;
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Ready to start",
  STARTED: "Trip started",
  RUNNING: "Bus moving",
  STOPPED: "Bus stopped",
  COMPLETED: "Trip completed",
  CANCELLED: "Trip cancelled",
};

const ACTIVE_TRIP_STATUSES = new Set(["STARTED", "RUNNING", "STOPPED"]);

const toTripStatus = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length ? normalized : null;
};

const getTripStatusLabel = (value: unknown): string => {
  const status = toTripStatus(value);
  if (!status) {
    return "Ready to start";
  }

  return TRIP_STATUS_LABELS[status] ?? status;
};

const isAlreadyActiveTripError = (error: unknown): boolean => {
  const e = error as {
    response?: {
      status?: number;
      data?: {
        message?: string;
        code?: string;
      };
    };
  };

  if (e?.response?.status === 409) {
    return true;
  }

  const message = (e?.response?.data?.message ?? "").toLowerCase();
  const code = (e?.response?.data?.code ?? "").toLowerCase();

  return (
    message.includes("active trip") ||
    message.includes("already") ||
    code.includes("active_trip")
  );
};

const isNoActiveTripError = (error: unknown): boolean => {
  const e = error as {
    response?: {
      status?: number;
      data?: {
        message?: string;
        code?: string;
      };
    };
  };

  if (e?.response?.status === 404) {
    return true;
  }

  const message = (e?.response?.data?.message ?? "").toLowerCase();
  const code = (e?.response?.data?.code ?? "").toLowerCase();

  return message.includes("no active trip") || code.includes("no_active_trip");
};

const decodeRoute = (encodedPolyline?: string): MapCoordinate[] => {
  if (!encodedPolyline) {
    return [];
  }

  try {
    const points = polyline.decode(encodedPolyline) as [number, number][];
    return points.map(([latitude, longitude]) => ({ latitude, longitude }));
  } catch {
    return [];
  }
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

const buildPathFromAssignment = (
  assignment: DriverMeSnapshot,
): {
  mapPath: MapCoordinate[];
  stops: StopMarker[];
} => {
  const routePath = decodeRoute(assignment.route?.encodedPolyline);

  const mappedStops: (StopMarker | null)[] = assignment.stops.map(
    (stop, index) => {
      const latitude =
        typeof stop.lat === "number"
          ? stop.lat
          : typeof stop.latitude === "number"
            ? stop.latitude
            : undefined;
      const longitude =
        typeof stop.lng === "number"
          ? stop.lng
          : typeof stop.longitude === "number"
            ? stop.longitude
            : undefined;

      if (latitude == null || longitude == null) {
        return null;
      }

      return {
        id: stop.id,
        latitude,
        longitude,
        name: stop.name,
        sequenceOrder: stop.sequenceOrder ?? index + 1,
        isPassed: stop.isPassed,
        etaFromCurrentText: stop.etaFromCurrentText,
        etaFromCurrentSeconds: stop.etaFromCurrentSeconds,
        distanceFromCurrentText: stop.distanceFromCurrentText,
        distanceFromCurrentMeters: stop.distanceFromCurrentMeters,
        segmentDistanceText: stop.segmentDistanceText,
        segmentEtaText: stop.segmentEtaText,
      };
    },
  );

  const stops: StopMarker[] = mappedStops
    .filter((stop): stop is StopMarker => Boolean(stop))
    .sort((a, b) => {
      const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });

  if (!routePath.length) {
    return {
      mapPath: stops.map((stop) => ({
        latitude: stop.latitude,
        longitude: stop.longitude,
      })),
      stops,
    };
  }

  const stitched: MapCoordinate[] = [routePath[0]];
  stops.forEach((stop) => {
    stitched.push({ latitude: stop.latitude, longitude: stop.longitude });
  });
  if (routePath.length > 1) {
    stitched.push(routePath[routePath.length - 1]);
  }

  return {
    mapPath: stitched.length >= 2 ? stitched : routePath,
    stops,
  };
};

export default function DriverTrackingScreen() {
  const { isAuthenticated, isHydrated, token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<DriverMeSnapshot>({
    driver: null,
    bus: null,
    route: null,
    stops: [],
  });
  const [mapPath, setMapPath] = useState<MapCoordinate[]>([]);
  const [routeEncodedPolyline, setRouteEncodedPolyline] = useState("");
  const [stopMarkers, setStopMarkers] = useState<StopMarker[]>([]);
  const [currentLocation, setCurrentLocation] = useState<MapCoordinate | null>(
    null,
  );
  const [clock, setClock] = useState(Date.now());
  const [uiState, setUiState] = useState<DriverUIState>({
    trip: null,
    connection: socketService.isConnected() ? "connected" : "offline",
    sending: false,
  });

  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const latestLocationRef = useRef<CoordinateWithSpeed | null>(null);
  const sendingRef = useRef(false);

  const assignedBusId = assignment.bus?.id;
  const hasAssignment = Boolean(assignment.bus?.id && assignment.route?.id);
  const isTripActive = Boolean(
    uiState.trip?.status &&
    ACTIVE_TRIP_STATUSES.has(uiState.trip.status.toUpperCase()),
  );

  const refreshScreenData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [activeTrip, routeSnapshot] = await Promise.all([
        getActiveTrip(),
        getDriverMyRoute().catch((routeErr) => {
          console.warn("[DriverTracking][getDriverMyRoute]", routeErr);
          return null;
        }),
      ]);

      let trackingAssignment: DriverMeSnapshot;

      if (
        routeSnapshot &&
        (routeSnapshot.route?.id || routeSnapshot.stops.length > 0)
      ) {
        trackingAssignment = {
          driver: null,
          bus: routeSnapshot.bus,
          route: routeSnapshot.route,
          stops: routeSnapshot.stops,
        };
      } else {
        trackingAssignment = await getDriverMe();
      }

      setAssignment(trackingAssignment);
      const map = buildPathFromAssignment(trackingAssignment);
      setMapPath(map.mapPath);
      setStopMarkers(map.stops);
      setRouteEncodedPolyline(trackingAssignment.route?.encodedPolyline ?? "");

      setUiState((previous) => ({
        ...previous,
        trip: activeTrip,
      }));
    } catch (err: any) {
      console.error("[DriverTracking][refreshScreenData]", err);
      setError(
        err?.response?.data?.message ??
          err?.message ??
          "Failed to load tracking",
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const stopLocationFlow = useCallback(() => {
    if (sendTimerRef.current) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }

    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }

    latestLocationRef.current = null;
    sendingRef.current = false;
    setUiState((previous) => ({
      ...previous,
      sending: false,
    }));
  }, []);

  const sendCurrentLocation = useCallback(async () => {
    if (!assignedBusId || sendingRef.current || !isTripActive) {
      return;
    }

    sendingRef.current = true;
    setUiState((previous) => ({
      ...previous,
      sending: true,
    }));

    let location = latestLocationRef.current;

    if (!location) {
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: true,
        });

        if (!isAccurateEnough(current.coords.accuracy ?? null)) {
          sendingRef.current = false;
          setUiState((previous) => ({
            ...previous,
            sending: false,
          }));
          setSendNote("Waiting for stronger GPS signal...");
          return;
        }

        location = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          speed: current.coords.speed ?? null,
        };

        latestLocationRef.current = location;
        setCurrentLocation({
          latitude: location.latitude,
          longitude: location.longitude,
        });
      } catch (locationErr) {
        console.warn(
          "[DriverTracking][sendCurrentLocation][getCurrentPosition]",
          locationErr,
        );
        location = null;
      }
    }

    if (!location) {
      sendingRef.current = false;
      setUiState((previous) => ({
        ...previous,
        sending: false,
      }));
      return;
    }

    const timestamp = new Date().toISOString();

    try {
      const result = await postMyLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed ?? 0,
        timestamp,
      });

      setUiState((previous) => ({
        ...previous,
        sending: false,
        lastSentAt: timestamp,
      }));

      // Also emit location via socket for real-time updates (if connected)
      if (socketService.isConnected()) {
        try {
          const socket = socketService.getSocket();
          if (socket) {
            socket.emit("driverLocationUpdate", {
              latitude: location.latitude,
              longitude: location.longitude,
              speed: location.speed ?? 0,
              timestamp,
            });
            console.log("[DriverTracking] Location emitted via socket");
          }
        } catch (socketErr) {
          // Non-critical - HTTP POST already succeeded
          console.warn("[DriverTracking] Socket emit failed:", socketErr);
        }
      }

      setSendNote(
        result.skipped
          ? "Server throttled this update. Telemetry is still active."
          : null,
      );
    } catch (err) {
      if (isNoActiveTripError(err)) {
        stopLocationFlow();
        setUiState((previous) => ({
          ...previous,
          trip: null,
          sending: false,
        }));
        setSendNote("No active trip found on server. Start trip again.");
        return;
      }

      console.error(
        "[DriverTracking][sendCurrentLocation][postMyLocation]",
        err,
      );
      setUiState((previous) => ({
        ...previous,
        sending: false,
      }));
    } finally {
      sendingRef.current = false;
    }
  }, [assignedBusId, isTripActive, stopLocationFlow]);

  const startLocationFlow = useCallback(async () => {
    if (!isTripActive || !assignedBusId || sendTimerRef.current) {
      return;
    }

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setSendNote("Location permission is required to send live telemetry.");
        return;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setSendNote("Enable GPS/location services to continue telemetry.");
        return;
      }
    } catch (permissionErr) {
      console.error(
        "[DriverTracking][startLocationFlow][permissions]",
        permissionErr,
      );
      setSendNote("Unable to verify location permissions. Please retry.");
      return;
    }

    socketService.connect(API_BASE_URL, token ?? undefined);

    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      });

      if (!isAccurateEnough(current.coords.accuracy ?? null)) {
        setSendNote(
          "GPS signal is weak. Move to open sky for accurate live location.",
        );
      }

      latestLocationRef.current = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        speed: current.coords.speed ?? null,
      };

      setCurrentLocation({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
    } catch (initialReadErr) {
      console.warn(
        "[DriverTracking][startLocationFlow][initialLocation]",
        initialReadErr,
      );
      // Keep interval sender active even if initial read fails.
    }

    try {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 1,
          mayShowUserSettingsDialog: true,
        },
        (position) => {
          if (!isAccurateEnough(position.coords.accuracy ?? null)) {
            return;
          }

          latestLocationRef.current = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed ?? null,
          };

          setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
      );
    } catch (watchErr) {
      console.warn(
        "[DriverTracking][startLocationFlow][watchPosition]",
        watchErr,
      );
      // Fallback to periodic getCurrentPosition in sender.
    }

    await sendCurrentLocation();

    sendTimerRef.current = setInterval(() => {
      void sendCurrentLocation();
    }, 5000);
  }, [assignedBusId, isTripActive, sendCurrentLocation, token]);

  const handleTripAction = useCallback(async () => {
    if (actionLoading) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      if (isTripActive) {
        // Stop trip
        await stopTrip();
        const latest = await getActiveTrip();
        setUiState((previous) => ({
          ...previous,
          trip: latest,
        }));
        stopLocationFlow();

        // Stop background location tracking
        await backgroundLocationService.stopBackgroundTracking();
        console.log("[DriverTracking] Background location tracking stopped");
      } else {
        // Start trip
        if (!hasAssignment) {
          return;
        }

        try {
          const started = await startTrip();
          setUiState((previous) => ({
            ...previous,
            trip: started ?? previous.trip,
          }));

          // Start background location tracking
          if (token && assignedBusId) {
            const success =
              await backgroundLocationService.startBackgroundTracking(
                token,
                String(assignedBusId),
              );
            if (success) {
              console.log(
                "[DriverTracking] Background location tracking started",
              );
              setSendNote("Background location tracking enabled");
            } else {
              console.warn(
                "[DriverTracking] Failed to start background tracking",
              );
              setSendNote("Warning: Could not enable background tracking");
            }
          }
        } catch (err) {
          if (isAlreadyActiveTripError(err)) {
            const active = await getActiveTrip();
            setUiState((previous) => ({
              ...previous,
              trip: active,
            }));

            // Start background location tracking for existing trip
            if (token && assignedBusId) {
              await backgroundLocationService.startBackgroundTracking(
                token,
                String(assignedBusId),
              );
            }
          } else {
            throw err;
          }
        }
      }
    } catch (err: any) {
      console.error("[DriverTracking][handleTripAction]", err);
      setError(
        err?.response?.data?.message ?? err?.message ?? "Unable to update trip",
      );
    } finally {
      setActionLoading(false);
    }
  }, [
    actionLoading,
    assignedBusId,
    hasAssignment,
    isTripActive,
    stopLocationFlow,
    token,
  ]);

  // Cleanup background tracking when logging out or leaving screen
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        void backgroundLocationService.stopBackgroundTracking();
      }
    }, [isAuthenticated]),
  );

  useFocusEffect(
    useCallback(() => {
      void refreshScreenData();
    }, [refreshScreenData]),
  );

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        setClock(Date.now());
      }, 1000);

      return () => clearInterval(timer);
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated || !assignedBusId) {
        return;
      }

      socketService.connect(API_BASE_URL, token ?? undefined);

      const onConnect = () => {
        setUiState((previous) => ({
          ...previous,
          connection: "connected",
        }));
        socketService.joinBusRoom(String(assignedBusId));
      };

      const onDisconnect = () => {
        setUiState((previous) => ({
          ...previous,
          connection: "offline",
        }));
      };

      const onReconnectAttempt = () => {
        setUiState((previous) => ({
          ...previous,
          connection: "reconnecting",
        }));
      };

      const onBusLocationUpdate = (payload: unknown) => {
        const event = payload as {
          busId?: string | number;
          bus?: { id?: string | number; _id?: string | number };
          latitude?: number;
          longitude?: number;
          lat?: number;
          lng?: number;
          location?: {
            latitude?: number;
            longitude?: number;
            lat?: number;
            lng?: number;
          };
          trip?: { id?: string; status?: string };
          tripStatus?: string;
        };

        const eventBusId = event.busId ?? event.bus?.id ?? event.bus?._id;
        if (
          eventBusId != null &&
          String(eventBusId) !== String(assignedBusId)
        ) {
          return;
        }

        const latitude =
          event.latitude ??
          event.lat ??
          event.location?.latitude ??
          event.location?.lat;
        const longitude =
          event.longitude ??
          event.lng ??
          event.location?.longitude ??
          event.location?.lng;

        console.log("[WS][driver][busLocationUpdate]", {
          assignedBusId: String(assignedBusId),
          eventBusId: eventBusId == null ? null : String(eventBusId),
          latitude,
          longitude,
          tripStatus: event.trip?.status ?? event.tripStatus ?? null,
          receivedAt: new Date().toISOString(),
        });

        // Keep the driver marker on device GPS coordinates for accuracy.
        // Socket coordinates can be delayed or filtered by backend.
        void latitude;
        void longitude;

        const incomingStatus = toTripStatus(
          event.trip?.status ?? event.tripStatus,
        );
        if (incomingStatus) {
          setUiState((previous) => ({
            ...previous,
            trip: previous.trip
              ? {
                  ...previous.trip,
                  status: incomingStatus,
                  id: event.trip?.id ?? previous.trip.id,
                }
              : {
                  id: event.trip?.id ?? "",
                  status: incomingStatus,
                  busId: String(assignedBusId),
                },
          }));
        }
      };

      // Listen for driver location updates via socket (real-time location from this driver)
      const onDriverLocationUpdate = (location: unknown) => {
        const event = location as {
          latitude?: number;
          longitude?: number;
          speed?: number;
          timestamp?: string;
        };

        console.log("[WS][driver][locationUpdate]", {
          latitude: event.latitude,
          longitude: event.longitude,
          speed: event.speed,
          timestamp: event.timestamp,
        });

        // Update current location if received via socket
        if (event.latitude != null && event.longitude != null) {
          setCurrentLocation({
            latitude: event.latitude,
            longitude: event.longitude,
          });
        }
      };

      socketService.on("connect", onConnect);
      socketService.on("disconnect", onDisconnect);
      socketService.onReconnectAttempt(onReconnectAttempt);
      socketService.on("busLocationUpdate", onBusLocationUpdate);
      socketService.on("driverLocationUpdate", onDriverLocationUpdate);

      if (socketService.isConnected()) {
        onConnect();
      }

      return () => {
        socketService.off("connect", onConnect);
        socketService.off("disconnect", onDisconnect);
        socketService.offReconnectAttempt(onReconnectAttempt);
        socketService.off("busLocationUpdate", onBusLocationUpdate);
        socketService.off("driverLocationUpdate", onDriverLocationUpdate);
        socketService.leaveBusRoom(String(assignedBusId));
      };
    }, [assignedBusId, isAuthenticated, token]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated || !isTripActive) {
        stopLocationFlow();
        return;
      }

      void startLocationFlow();

      return () => {
        stopLocationFlow();
      };
    }, [isAuthenticated, isTripActive, startLocationFlow, stopLocationFlow]),
  );

  const tripStatusLabel = getTripStatusLabel(uiState.trip?.status);

  const connectionLabel =
    uiState.connection === "connected"
      ? "Connected"
      : uiState.connection === "reconnecting"
        ? "Reconnecting"
        : "Offline";

  const actionLabel = isTripActive ? "Stop Trip" : "Start Trip";
  const actionDisabled = actionLoading || (!isTripActive && !hasAssignment);

  const lastUpdatedSeconds = uiState.lastSentAt
    ? Math.max(
        0,
        Math.floor((clock - new Date(uiState.lastSentAt).getTime()) / 1000),
      )
    : null;

  const locationStatus = uiState.sending
    ? "Sending..."
    : lastUpdatedSeconds == null
      ? isTripActive
        ? "Waiting for first update"
        : "Telemetry idle"
      : `Last updated ${lastUpdatedSeconds} sec ago`;

  const stopsWithStatus = useMemo<StopWithStatus[]>(() => {
    if (!stopMarkers.length) {
      return [];
    }

    const hasPassState = stopMarkers.some(
      (stop) => typeof stop.isPassed === "boolean",
    );

    if (hasPassState) {
      const firstNotPassed = stopMarkers.findIndex(
        (stop) => stop.isPassed !== true,
      );
      const nextIndex = firstNotPassed < 0 ? 0 : firstNotPassed;

      return stopMarkers.map((stop, index) => ({
        ...stop,
        status:
          stop.isPassed === true
            ? "passed"
            : index === nextIndex
              ? "next"
              : "upcoming",
      }));
    }

    if (!currentLocation) {
      return stopMarkers.map((stop, index) => ({
        ...stop,
        status: index === 0 ? "next" : "upcoming",
      }));
    }

    let nearestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    stopMarkers.forEach((stop, index) => {
      const dLat = stop.latitude - currentLocation.latitude;
      const dLng = stop.longitude - currentLocation.longitude;
      const distanceScore = dLat * dLat + dLng * dLng;

      if (distanceScore < bestDistance) {
        bestDistance = distanceScore;
        nearestIndex = index;
      }
    });

    return stopMarkers.map((stop, index) => ({
      ...stop,
      status:
        index < nearestIndex
          ? "passed"
          : index === nearestIndex
            ? "next"
            : "upcoming",
    }));
  }, [currentLocation, stopMarkers]);

  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(driver)/login" />;
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 26 }}
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            className="h-12 w-12 items-center justify-center rounded-xl bg-white"
            onPress={() => router.replace("/(driver)/home")}
          >
            <Ionicons name="arrow-back" size={20} color="#0f172a" />
          </Pressable>

          <Text className="text-lg font-extrabold text-slate-900">
            Live Map
          </Text>

          <View className="rounded-full bg-white px-3 py-1.5">
            <Text className="text-xs font-bold text-slate-700">
              {connectionLabel}
            </Text>
          </View>
        </View>

        <View className="mt-4 rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Trip Status
              </Text>
              <Text className="mt-1 text-lg font-extrabold text-slate-900">
                {tripStatusLabel}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="bus-clock"
              size={28}
              color="#1d4ed8"
            />
          </View>

          <Text className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Telemetry
          </Text>
          <Text className="mt-1 text-sm text-slate-700">{locationStatus}</Text>

          {sendNote ? (
            <Text className="mt-2 text-sm text-amber-700">{sendNote}</Text>
          ) : null}

          {error ? (
            <View className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          ) : null}

          {!isTripActive && !hasAssignment ? (
            <Text className="mt-3 text-sm text-amber-700">
              Assign a bus and route before starting a trip.
            </Text>
          ) : null}
        </View>

        <View className="mt-4 h-72 overflow-hidden rounded-2xl bg-slate-200">
          {mapPath.length > 0 ? (
            <RouteMap
              coordinates={mapPath}
              encodedPolyline={routeEncodedPolyline || undefined}
              currentLocation={currentLocation ?? undefined}
              stops={stopsWithStatus.map((stop) => ({
                latitude: stop.latitude,
                longitude: stop.longitude,
                name: stop.name,
                sequenceOrder: stop.sequenceOrder,
                status: stop.status,
              }))}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-sm text-slate-600">
                Route map unavailable
              </Text>
            </View>
          )}
        </View>

        <View className="mt-4 rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Route Summary
            </Text>
            <Text className="text-sm font-bold text-slate-900">
              {assignment.route?.name || "Route"}
            </Text>
          </View>

          <View className="flex-row gap-3 mb-3">
            <View className="flex-1 rounded-xl bg-slate-100 p-3">
              <Text className="text-xs font-semibold text-slate-500">
                Total Distance
              </Text>
              <Text className="mt-1 text-base font-bold text-slate-900">
                {formatDistanceFromMeters(
                  assignment.route?.totalDistanceMeters,
                ) ??
                  assignment.route?.totalDistanceText ??
                  "-"}
              </Text>
            </View>
            <View className="flex-1 rounded-xl bg-slate-100 p-3">
              <Text className="text-xs font-semibold text-slate-500">
                Est. Duration
              </Text>
              <Text className="mt-1 text-base font-bold text-slate-900">
                {formatEtaFromSeconds(
                  assignment.route?.estimatedDurationSeconds,
                ) ??
                  assignment.route?.estimatedDurationText ??
                  "-"}
              </Text>
            </View>
          </View>

          <View className="rounded-xl bg-blue-50 p-3">
            <Text className="text-xs font-semibold text-slate-500">
              ETA to Destination
            </Text>
            <Text className="mt-1 text-xl font-bold text-blue-700">
              {formatEtaFromSeconds(
                assignment.route?.etaToDestinationSeconds,
              ) ??
                assignment.route?.etaToDestinationText ??
                "-"}
            </Text>
            <Text className="mt-1 text-sm font-semibold text-slate-600">
              Remaining:{" "}
              {formatDistanceFromMeters(
                assignment.route?.distanceToDestinationMeters,
              ) ??
                assignment.route?.distanceToDestinationText ??
                "-"}
            </Text>
          </View>
        </View>

        {stopsWithStatus.length > 0 ? (
          <View className="mt-4 rounded-2xl bg-white p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Current Progress
            </Text>
            <View>
              {stopsWithStatus.map((stop, index) => (
                <View
                  key={stop.id ?? `${stop.name}-${index}`}
                  className="mb-3 flex-row"
                >
                  <View className="mr-3 items-center" style={{ width: 18 }}>
                    <View
                      className={`h-3.5 w-3.5 rounded-full ${
                        stop.status === "passed"
                          ? "bg-emerald-500"
                          : stop.status === "next"
                            ? "bg-blue-600"
                            : "bg-amber-400"
                      }`}
                    />
                    {index < stopsWithStatus.length - 1 ? (
                      <View className="mt-1 h-8 w-0.5 bg-slate-200" />
                    ) : null}
                  </View>

                  <View className="flex-1 rounded-xl bg-slate-50 px-3 py-2">
                    <Text
                      className="text-sm font-semibold text-slate-900"
                      numberOfLines={1}
                    >
                      {(stop.sequenceOrder ?? index + 1) +
                        ". " +
                        (stop.name || "Stop")}
                    </Text>
                    <Text
                      className={`mt-0.5 text-xs font-semibold ${
                        stop.status === "passed"
                          ? "text-emerald-600"
                          : stop.status === "next"
                            ? "text-blue-700"
                            : "text-amber-700"
                      }`}
                    >
                      {stop.status === "passed"
                        ? "Passed"
                        : stop.status === "next"
                          ? "Next Stop"
                          : "Upcoming"}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-600">
                      {`From bus: ${
                        stop.distanceFromCurrentText ??
                        formatDistanceFromMeters(
                          stop.distanceFromCurrentMeters,
                        ) ??
                        "distance --"
                      } • ${
                        stop.etaFromCurrentText ??
                        formatEtaFromSeconds(stop.etaFromCurrentSeconds) ??
                        "ETA --"
                      }`}
                    </Text>
                    {stop.segmentDistanceText || stop.segmentEtaText ? (
                      <Text className="mt-0.5 text-[11px] text-slate-500">
                        {`From previous: ${stop.segmentDistanceText ?? "-"}${
                          stop.segmentDistanceText && stop.segmentEtaText
                            ? " • "
                            : ""
                        }${stop.segmentEtaText ?? "-"}`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Pressable
          className={`mt-5 items-center rounded-2xl py-4 ${
            actionDisabled
              ? "bg-slate-300"
              : isTripActive
                ? "bg-red-600"
                : "bg-blue-700"
          }`}
          disabled={actionDisabled}
          onPress={handleTripAction}
        >
          <Text className="text-lg font-extrabold text-white">
            {actionLoading ? "Please wait..." : actionLabel}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "../../api/client";
import { BusLiveStatus, DriverStop } from "../../api/types";
import {
  createUserSubscription,
  getUserBusLive,
  getUserSubscriptions,
} from "../../api/user";
import RouteMap from "../../components/RouteMap";
import { useLocation } from "../../hooks/useLocation";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import {
  addSentryBreadcrumb,
  captureSentryException,
} from "../../monitoring/sentry";
import socketService from "../../sockets/socketService";
import authStore from "../../store/auth";

type Coord = {
  latitude: number;
  longitude: number;
};

type OrderedStop = {
  id?: string;
  name?: string;
  latitude: number;
  longitude: number;
  sequenceOrder?: number;
  isPassed?: boolean;
  distanceFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  etaFromCurrentText?: string;
  etaFromCurrentSeconds?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
};

type StopStatus = "passed" | "next" | "upcoming";

type StopWithStatus = OrderedStop & {
  status: StopStatus;
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Start soon",
  STARTED: "Trip started",
  RUNNING: "Bus moving",
  STOPPED: "Bus stopped",
  COMPLETED: "Trip ended",
  CANCELLED: "Trip cancelled",
};

const toStopCoord = (stop: DriverStop): OrderedStop | null => {
  const latitude =
    typeof stop.lat === "number"
      ? stop.lat
      : typeof stop.latitude === "number"
        ? stop.latitude
        : null;
  const longitude =
    typeof stop.lng === "number"
      ? stop.lng
      : typeof stop.longitude === "number"
        ? stop.longitude
        : null;

  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    id: stop.id,
    name: stop.name,
    latitude,
    longitude,
    sequenceOrder: stop.sequenceOrder,
    isPassed: stop.isPassed,
    distanceFromCurrentText: stop.distanceFromCurrentText,
    distanceFromCurrentMeters: stop.distanceFromCurrentMeters,
    etaFromCurrentText: stop.etaFromCurrentText,
    etaFromCurrentSeconds: stop.etaFromCurrentSeconds,
    segmentDistanceText: stop.segmentDistanceText,
    segmentEtaText: stop.segmentEtaText,
  };
};

const sameCoord = (a: Coord, b: Coord) =>
  Math.abs(a.latitude - b.latitude) < 1e-6 &&
  Math.abs(a.longitude - b.longitude) < 1e-6;

const buildFallbackPath = (
  start: Coord | null,
  orderedStops: OrderedStop[],
  end: Coord | null,
): Coord[] => {
  const points: Coord[] = [];

  if (start) {
    points.push(start);
  }

  orderedStops.forEach((stop) => {
    points.push({ latitude: stop.latitude, longitude: stop.longitude });
  });

  if (end) {
    points.push(end);
  }

  const deduped: Coord[] = [];
  points.forEach((point) => {
    const previous = deduped[deduped.length - 1];
    if (!previous || !sameCoord(previous, point)) {
      deduped.push(point);
    }
  });

  return deduped;
};

const normalizeTripStatus = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
};

const getTripStatusLabel = (status: unknown): string => {
  const normalized = normalizeTripStatus(status);
  if (!normalized) {
    return "Ready to start";
  }

  return TRIP_STATUS_LABELS[normalized] ?? normalized;
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

const getFreshnessLabel = (lastUpdated?: string | null): string => {
  if (!lastUpdated) {
    return "No recent update";
  }

  const parsed = new Date(lastUpdated).getTime();
  if (!Number.isFinite(parsed)) {
    return "No recent update";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (elapsedSeconds < 60) {
    return `Updated ${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `Updated ${elapsedMinutes}m ago`;
};

export default function UserTrackingScreen() {
  useSentryScreen("user/tracking");

  const { requestForegroundPermission, getCurrentPosition } = useLocation();

  const params = useLocalSearchParams<{
    busId: string | string[];
    plate?: string;
    route?: string;
  }>();

  const busId = Array.isArray(params.busId) ? params.busId[0] : params.busId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<BusLiveStatus | null>(null);
  const [path, setPath] = useState<Coord[]>([]);
  const [routeEncodedPolyline, setRouteEncodedPolyline] = useState("");
  const [currentLocation, setCurrentLocation] = useState<Coord | null>(null);
  const [connection, setConnection] = useState<"live" | "offline">(
    socketService.isConnected() ? "live" : "offline",
  );
  const [submittingSubscription, setSubmittingSubscription] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const orderedStops = useMemo<OrderedStop[]>(() => {
    return (live?.stops ?? [])
      .map((stop) => toStopCoord(stop))
      .filter((stop): stop is OrderedStop => Boolean(stop))
      .sort((a, b) => {
        const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
  }, [live?.stops]);

  useEffect(() => {
    if (!busId) {
      setLoading(false);
      setError("Bus id is missing");
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [liveData, subscriptions] = await Promise.all([
          getUserBusLive(String(busId)),
          getUserSubscriptions(),
        ]);

        setLive(liveData);
        setIsSubscribed(
          subscriptions.some(
            (subscription) => String(subscription.busId) === String(busId),
          ),
        );

        if (liveData.currentLat != null && liveData.currentLng != null) {
          setCurrentLocation({
            latitude: liveData.currentLat,
            longitude: liveData.currentLng,
          });
        }

        const sortedStops = (liveData.stops ?? [])
          .map((stop) => toStopCoord(stop))
          .filter((stop): stop is OrderedStop => Boolean(stop))
          .sort((a, b) => {
            const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
          });

        if (liveData.encodedPolyline) {
          setRouteEncodedPolyline(liveData.encodedPolyline);
          try {
            const decoded = polyline.decode(liveData.encodedPolyline) as [
              number,
              number,
            ][];
            setPath(
              decoded.map(([latitude, longitude]) => ({ latitude, longitude })),
            );
          } catch (polylineErr) {
            console.warn("[UserTracking][decodePolyline]", {
              busId,
              error: polylineErr,
            });
            captureSentryException(polylineErr, {
              tags: {
                area: "user_tracking",
                operation: "decode_polyline",
              },
              extra: {
                busId,
              },
              level: "warning",
            });
            setRouteEncodedPolyline("");
            setPath([]);
          }
        } else {
          setRouteEncodedPolyline("");

          const start =
            liveData.routeStartLat != null && liveData.routeStartLng != null
              ? {
                  latitude: liveData.routeStartLat,
                  longitude: liveData.routeStartLng,
                }
              : null;

          const end =
            liveData.routeEndLat != null && liveData.routeEndLng != null
              ? {
                  latitude: liveData.routeEndLat,
                  longitude: liveData.routeEndLng,
                }
              : null;

          setPath(buildFallbackPath(start, sortedStops, end));
        }
      } catch (err: any) {
        console.error("[UserTracking][load]", {
          busId,
          error: err,
        });
        captureSentryException(err, {
          tags: {
            area: "user_tracking",
            operation: "load",
          },
          extra: {
            busId,
          },
        });
        setError(
          err?.response?.data?.message ??
            err?.message ??
            "Failed to load live bus",
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [busId]);

  useEffect(() => {
    if (!busId) {
      return;
    }

    socketService.connect(API_BASE_URL, authStore.token ?? undefined);

    const onConnect = () => {
      setConnection("live");
      socketService.joinBusRoom(String(busId));
    };

    const onDisconnect = () => {
      setConnection("offline");
    };

    const onBusLocationUpdate = (payload: unknown) => {
      const event = payload as {
        busId?: string | number;
        bus?: { id?: string | number; _id?: string | number };
        trip?: { status?: string };
        tripStatus?: string;
        nextStop?: string;
        nextStopEta?: string;
        estimatedArrival?: string;
        etaToDestinationText?: string;
        timestamp?: string;
        location?: {
          latitude?: number;
          longitude?: number;
          lat?: number;
          lng?: number;
        };
        latitude?: number;
        longitude?: number;
        lat?: number;
        lng?: number;
      };

      const eventBusId =
        event.busId ?? event.bus?.id ?? event.bus?._id ?? undefined;

      if (eventBusId != null && String(eventBusId) !== String(busId)) {
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

      if (typeof latitude === "number" && typeof longitude === "number") {
        setCurrentLocation({ latitude, longitude });
      }

      setLive((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          currentLat:
            typeof latitude === "number" ? latitude : previous.currentLat,
          currentLng:
            typeof longitude === "number" ? longitude : previous.currentLng,
          tripStatus:
            normalizeTripStatus(event.trip?.status ?? event.tripStatus) ??
            previous.tripStatus,
          nextStop: event.nextStop ?? previous.nextStop,
          estimatedArrival:
            event.nextStopEta ??
            event.estimatedArrival ??
            previous.estimatedArrival,
          etaToDestinationText:
            event.etaToDestinationText ?? previous.etaToDestinationText,
          lastUpdated: event.timestamp ?? previous.lastUpdated,
        };
      });
    };

    socketService.on("connect", onConnect);
    socketService.on("disconnect", onDisconnect);
    socketService.on("busLocationUpdate", onBusLocationUpdate);

    if (socketService.isConnected()) {
      onConnect();
    } else {
      setConnection("offline");
    }

    return () => {
      socketService.off("connect", onConnect);
      socketService.off("disconnect", onDisconnect);
      socketService.off("busLocationUpdate", onBusLocationUpdate);
      socketService.leaveBusRoom(String(busId));
    };
  }, [busId]);

  const subscribeForAlerts = async () => {
    if (!busId || submittingSubscription || isSubscribed) {
      return;
    }

    setSubmittingSubscription(true);
    try {
      addSentryBreadcrumb({
        category: "user_tracking",
        message: "Subscribe for alerts requested",
        level: "info",
        data: {
          busId,
        },
      });

      const permission = await requestForegroundPermission(
        "user_tracking_subscribe_alerts",
      );

      let userLatitude: number | undefined;
      let userLongitude: number | undefined;

      if (permission.granted) {
        const current = await getCurrentPosition(
          "user_tracking_subscribe_alerts",
          {},
        );
        userLatitude = current.coords.latitude;
        userLongitude = current.coords.longitude;
      }

      await createUserSubscription({
        busId,
        notifyOnBusStart: true,
        notifyOnNearStop: true,
        userLatitude: userLatitude ?? 17.4012,
        userLongitude: userLongitude ?? 78.5123,
        nearRadiusMeters: 120,
      });

      setIsSubscribed(true);
    } catch (subscriptionErr) {
      console.error("[UserTracking][subscribeForAlerts]", {
        busId,
        error: subscriptionErr,
      });
      captureSentryException(subscriptionErr, {
        tags: {
          area: "user_tracking",
          operation: "subscribe_for_alerts",
        },
        extra: {
          busId,
        },
        level: "warning",
      });
      // Keep tracking view usable if subscription request fails.
    } finally {
      setSubmittingSubscription(false);
    }
  };

  const eta =
    live?.etaToDestinationText ??
    live?.estimatedArrival ??
    formatEtaFromSeconds(live?.etaToDestinationSeconds) ??
    formatEtaFromSeconds(live?.estimatedDurationSeconds) ??
    "-";

  const tripStatusLabel = getTripStatusLabel(
    live?.trip?.status ?? live?.tripStatus,
  );
  const connectionLabel = connection === "live" ? "Live" : "Offline";
  const freshnessLabel = getFreshnessLabel(live?.lastUpdated);
  const routeStartLabel = live?.routeStartName ?? orderedStops[0]?.name ?? "-";
  const routeEndLabel =
    live?.routeEndName ?? orderedStops[orderedStops.length - 1]?.name ?? "-";

  const nextStopName =
    live?.nextStop ??
    orderedStops.find((stop) => typeof stop.etaFromCurrentSeconds === "number")
      ?.name ??
    orderedStops[0]?.name ??
    "-";

  const nextStopEta =
    orderedStops.find((stop) => stop.name === nextStopName)
      ?.etaFromCurrentText ??
    formatEtaFromSeconds(
      orderedStops.find((stop) => stop.name === nextStopName)
        ?.etaFromCurrentSeconds,
    ) ??
    live?.estimatedArrival ??
    "-";

  const stopsWithStatus = useMemo<StopWithStatus[]>(() => {
    if (!orderedStops.length) {
      return [];
    }

    const hasPassState = orderedStops.some(
      (stop) => typeof stop.isPassed === "boolean",
    );

    if (hasPassState) {
      const firstNotPassed = orderedStops.findIndex(
        (stop) => stop.isPassed !== true,
      );
      const nextIndex = firstNotPassed < 0 ? 0 : firstNotPassed;

      return orderedStops.map((stop, index) => ({
        ...stop,
        status:
          stop.isPassed === true
            ? "passed"
            : index === nextIndex
              ? "next"
              : "upcoming",
      }));
    }

    const normalizedNextStop = live?.nextStop?.trim().toLowerCase();
    const nextByName = normalizedNextStop
      ? orderedStops.findIndex(
          (stop) => stop.name?.trim().toLowerCase() === normalizedNextStop,
        )
      : -1;

    if (nextByName >= 0) {
      return orderedStops.map((stop, index) => ({
        ...stop,
        status:
          index < nextByName
            ? "passed"
            : index === nextByName
              ? "next"
              : "upcoming",
      }));
    }

    if (!currentLocation) {
      return orderedStops.map((stop, index) => ({
        ...stop,
        status: index === 0 ? "next" : "upcoming",
      }));
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    orderedStops.forEach((stop, index) => {
      const dLat = stop.latitude - currentLocation.latitude;
      const dLng = stop.longitude - currentLocation.longitude;
      const distanceScore = dLat * dLat + dLng * dLng;

      if (distanceScore < nearestDistance) {
        nearestDistance = distanceScore;
        nearestIndex = index;
      }
    });

    return orderedStops.map((stop, index) => ({
      ...stop,
      status:
        index < nearestIndex
          ? "passed"
          : index === nearestIndex
            ? "next"
            : "upcoming",
    }));
  }, [currentLocation, live?.nextStop, orderedStops]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 px-8">
        <MaterialCommunityIcons name="bus-alert" size={56} color="#ef4444" />
        <Text className="mt-4 text-center text-lg font-semibold text-red-600">
          {error}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <View className="flex-row items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-xl bg-slate-100"
        >
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </Pressable>

        <Text
          className="flex-1 px-2 text-center text-base font-extrabold text-slate-900"
          numberOfLines={1}
        >
          Bus {live?.numberPlate || params.plate || "-"}
        </Text>

        <View
          className={`rounded-full px-3 py-1 ${connection === "live" ? "bg-emerald-100" : "bg-slate-200"}`}
        >
          <Text
            className={`text-xs font-bold ${connection === "live" ? "text-emerald-700" : "text-slate-600"}`}
          >
            {connectionLabel}
          </Text>
        </View>
      </View>

      <View className="h-[300px] w-full bg-slate-200">
        {path.length > 1 ? (
          <RouteMap
            coordinates={path}
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
              Live route unavailable
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
      >
        <View className="rounded-2xl bg-white p-4">
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

          <Text className="mt-2 text-xs text-slate-500">{freshnessLabel}</Text>

          <View className="mt-4 flex-row items-center justify-between rounded-xl bg-slate-100 px-3 py-3">
            <View>
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                ETA to destination
              </Text>
              <Text className="mt-1 text-base font-bold text-slate-900">
                {eta}
              </Text>
            </View>
            <View>
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Route
              </Text>
              <Text
                className="mt-1 text-base font-bold text-slate-900"
                numberOfLines={1}
              >
                {live?.routeName || params.route || "-"}
              </Text>
            </View>
          </View>

          <View className="mt-3 rounded-xl bg-slate-100 px-3 py-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Route Points
            </Text>
            <Text className="mt-1 text-sm text-slate-700" numberOfLines={1}>
              Start: {routeStartLabel}
            </Text>
            <Text className="mt-1 text-sm text-slate-700" numberOfLines={1}>
              Destination: {routeEndLabel}
            </Text>
          </View>

          <View className="mt-3 rounded-xl bg-blue-50 px-3 py-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Next Stop
            </Text>
            <Text className="mt-1 text-base font-bold text-slate-900">
              {nextStopName}
            </Text>
            <Text className="mt-1 text-sm text-slate-600">
              ETA: {nextStopEta}
            </Text>
          </View>

          <Pressable
            className={`mt-4 flex-row items-center justify-center rounded-xl px-4 py-3 ${
              isSubscribed ? "bg-emerald-100" : "bg-blue-700"
            }`}
            onPress={subscribeForAlerts}
            disabled={submittingSubscription || isSubscribed}
          >
            {submittingSubscription ? (
              <ActivityIndicator size="small" color="#1d4ed8" />
            ) : (
              <>
                <Ionicons
                  name={
                    isSubscribed ? "notifications" : "notifications-outline"
                  }
                  size={18}
                  color={isSubscribed ? "#047857" : "white"}
                />
                <Text
                  className={`ml-2 text-sm font-bold ${isSubscribed ? "text-emerald-700" : "text-white"}`}
                >
                  {isSubscribed ? "Subscribed" : "Subscribe for alerts"}
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <View className="mt-3 rounded-2xl bg-white p-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Current Progress
          </Text>

          {stopsWithStatus.length === 0 ? (
            <Text className="text-sm text-slate-500">No stops available.</Text>
          ) : (
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
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

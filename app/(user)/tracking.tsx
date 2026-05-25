import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  UIManager,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BusLiveStatus, DriverStop } from "../../api/types";
import {
  createUserSubscription,
  getUserBusLive,
  getUserSubscriptions,
} from "../../api/user";
import { BottomSheet, type BottomSheetState } from "../../components/BottomSheet";
import { BottomSheetContent } from "../../components/BottomSheetContent";
import RouteMap from "../../components/RouteMap";
import type { TimelineStop } from "../../components/StopsTimeline";
import { useLocation } from "../../hooks/useLocation";
import useRouteTracking from "../../hooks/useRouteTracking";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import {
  addSentryBreadcrumb,
  captureSentryException,
} from "../../monitoring/sentry";

type Coord = { latitude: number; longitude: number };
type OrderedStop = {
  id?: string;
  name?: string;
  latitude: number;
  longitude: number;
  sequenceOrder?: number;
  status?: "passed" | "current" | "upcoming" | "next";
  isPassed?: boolean;
  leftSubLabel?: string;
  rightPrimaryLabel?: string;
  rightSecondaryLabel?: string;
  arrivalClockTimeText?: string;
  departedClockTimeText?: string;
  distanceFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  etaFromCurrentText?: string;
  etaFromCurrentSeconds?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
  segmentEtaSeconds?: number;
};
type StopStatus = "passed" | "next" | "upcoming";
type StopWithStatus = OrderedStop & { status: StopStatus };

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
  if (latitude == null || longitude == null) return null;
  return {
    id: stop.id,
    name: stop.name,
    latitude,
    longitude,
    sequenceOrder: stop.sequenceOrder,
    status: stop.status,
    isPassed: stop.isPassed,
    leftSubLabel: stop.leftSubLabel,
    rightPrimaryLabel: stop.rightPrimaryLabel,
    rightSecondaryLabel: stop.rightSecondaryLabel,
    arrivalClockTimeText: stop.arrivalClockTimeText,
    departedClockTimeText: stop.departedClockTimeText,
    distanceFromCurrentText: stop.distanceFromCurrentText,
    distanceFromCurrentMeters: stop.distanceFromCurrentMeters,
    etaFromCurrentText: stop.etaFromCurrentText,
    etaFromCurrentSeconds: stop.etaFromCurrentSeconds,
    segmentDistanceText: stop.segmentDistanceText,
    segmentEtaText: stop.segmentEtaText,
    segmentEtaSeconds: stop.segmentEtaSeconds,
  };
};

const sameCoord = (a: Coord, b: Coord) =>
  Math.abs(a.latitude - b.latitude) < 1e-6 &&
  Math.abs(a.longitude - b.longitude) < 1e-6;

const isValidCoord = (value?: Partial<Coord> | null): value is Coord =>
  !!value &&
  typeof value.latitude === "number" &&
  Number.isFinite(value.latitude) &&
  typeof value.longitude === "number" &&
  Number.isFinite(value.longitude);

const buildFallbackPath = (start: Coord | null, orderedStops: OrderedStop[], end: Coord | null): Coord[] => {
  const points: Coord[] = [];
  if (start) points.push(start);
  orderedStops.forEach((stop) => points.push({ latitude: stop.latitude, longitude: stop.longitude }));
  if (end) points.push(end);
  const deduped: Coord[] = [];
  points.forEach((point) => {
    const previous = deduped[deduped.length - 1];
    if (!previous || !sameCoord(previous, point)) deduped.push(point);
  });
  return deduped;
};

const formatEtaFromSeconds = (seconds?: number): string | null => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return "<1 min";
  return `${Math.round(seconds / 60)} min`;
};

const formatDistanceFromMeters = (meters?: number): string | null => {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return null;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
};

const formatClockTimeFromOffset = (secondsOffset?: number, baseMs = Date.now()): string | null => {
  if (typeof secondsOffset !== "number" || !Number.isFinite(secondsOffset)) return null;
  const target = new Date(baseMs + secondsOffset * 1000);
  return target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const getFreshnessLabel = (lastUpdated?: string | null): string => {
  if (!lastUpdated) return "No recent update";
  const parsed = new Date(lastUpdated).getTime();
  if (!Number.isFinite(parsed)) return "No recent update";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (elapsedSeconds < 60) return `Updated ${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `Updated ${elapsedMinutes}m ago`;
};

const getTripStatusLabel = (status: unknown): string => {
  if (typeof status !== "string") return "Ready to start";
  const normalized = status.trim().toUpperCase();
  return TRIP_STATUS_LABELS[normalized] ?? normalized;
};

export default function UserTrackingScreen() {
  useSentryScreen("user/tracking");

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const { ensureForegroundAccess, getCurrentPositionSafe } = useLocation();
  const params = useLocalSearchParams<{
    busId: string | string[];
    routeId?: string | string[];
    plate?: string;
    route?: string;
  }>();

  const busId = Array.isArray(params.busId) ? params.busId[0] : params.busId;
  const routeIdParam = Array.isArray(params.routeId) ? params.routeId[0] : params.routeId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<BusLiveStatus | null>(null);
  const [path, setPath] = useState<Coord[]>([]);
  const [routeEncodedPolyline, setRouteEncodedPolyline] = useState("");
  const [currentLocation, setCurrentLocation] = useState<Coord | null>(null);
  const [submittingSubscription, setSubmittingSubscription] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [sheetPosition, setSheetPosition] = useState<BottomSheetState>("half");
  const bottomSheetRef = useRef<{ snapToPosition: (state: BottomSheetState) => void }>(null);
  const previousCurrentStopIdRef = useRef<string | null>(null);
  const lastAppliedRefreshNonceRef = useRef(0);

  const orderedStops = useMemo<OrderedStop[]>(() => {
    return (live?.stops ?? [])
      .map(toStopCoord)
      .filter((stop): stop is OrderedStop => Boolean(stop))
      .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER));
  }, [live?.stops]);

  const selectedRouteId = live?.routeId ?? routeIdParam ?? null;
  const tracking = useRouteTracking(selectedRouteId);

  const loadLiveSnapshot = useCallback(async (showLoader: boolean) => {
    if (!busId) {
      setLoading(false);
      setError("Bus id is missing");
      return false;
    }

    if (showLoader) {
      setLoading(true);
    }

    setError(null);
    try {
      const [liveData, subscriptions] = await Promise.all([
        getUserBusLive(String(busId)),
        getUserSubscriptions(),
      ]);

      setLive(liveData);
      setIsSubscribed(subscriptions.some((subscription) => String(subscription.busId) === String(busId)));

      const liveCoord = liveData.currentLat != null && liveData.currentLng != null
        ? { latitude: liveData.currentLat, longitude: liveData.currentLng }
        : null;

      if (isValidCoord(liveCoord)) {
        setCurrentLocation(liveCoord);
      } else {
        setCurrentLocation(null);
      }

      const sortedStops = (liveData.stops ?? [])
        .map(toStopCoord)
        .filter((stop): stop is OrderedStop => Boolean(stop))
        .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER));

      if (liveData.encodedPolyline) {
        setRouteEncodedPolyline(liveData.encodedPolyline);
        try {
          const decoded = polyline.decode(liveData.encodedPolyline) as [number, number][];
          setPath(decoded.map(([latitude, longitude]) => ({ latitude, longitude })));
        } catch (polylineErr) {
          console.warn("[UserTracking][decodePolyline]", { busId, error: polylineErr });
          captureSentryException(polylineErr, {
            tags: { area: "user_tracking", operation: "decode_polyline" },
            extra: { busId },
            level: "warning",
          });
          setRouteEncodedPolyline("");

          const start = liveData.routeStartLat != null && liveData.routeStartLng != null
            ? { latitude: liveData.routeStartLat, longitude: liveData.routeStartLng }
            : null;
          const end = liveData.routeEndLat != null && liveData.routeEndLng != null
            ? { latitude: liveData.routeEndLat, longitude: liveData.routeEndLng }
            : null;

          setPath(buildFallbackPath(start, sortedStops, end));
        }
      } else {
        setRouteEncodedPolyline("");
        const start = liveData.routeStartLat != null && liveData.routeStartLng != null
          ? { latitude: liveData.routeStartLat, longitude: liveData.routeStartLng }
          : null;
        const end = liveData.routeEndLat != null && liveData.routeEndLng != null
          ? { latitude: liveData.routeEndLat, longitude: liveData.routeEndLng }
          : null;
        setPath(buildFallbackPath(start, sortedStops, end));
      }

      return true;
    } catch (err: any) {
      console.error("[UserTracking][load]", { busId, error: err });
      captureSentryException(err, {
        tags: { area: "user_tracking", operation: "load" },
        extra: { busId },
      });
      setError(err?.response?.data?.message ?? err?.message ?? "Failed to load live bus");
      return false;
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [busId]);

  useEffect(() => {
    void loadLiveSnapshot(true);
  }, [loadLiveSnapshot]);

  useEffect(() => {
    if (tracking.refreshSnapshotNonce <= lastAppliedRefreshNonceRef.current) {
      return;
    }

    lastAppliedRefreshNonceRef.current = tracking.refreshSnapshotNonce;
    void loadLiveSnapshot(false);
  }, [loadLiveSnapshot, tracking.refreshSnapshotNonce]);

  useEffect(() => {
    if (tracking.busLocation) {
      setCurrentLocation({
        latitude: tracking.busLocation.lat,
        longitude: tracking.busLocation.lng,
      });
    }
  }, [tracking.busLocation]);

  useEffect(() => {
    const previous = previousCurrentStopIdRef.current;
    if (tracking.currentStopId && previous && tracking.currentStopId !== previous) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    previousCurrentStopIdRef.current = tracking.currentStopId;
  }, [tracking.currentStopId]);

  const subscribeForAlerts = async () => {
    if (!busId || submittingSubscription || isSubscribed) return;

    setSubmittingSubscription(true);
    try {
      addSentryBreadcrumb({
        category: "user_tracking",
        message: "Subscribe for alerts requested",
        level: "info",
        data: { busId },
      });

      const readiness = await ensureForegroundAccess("user_tracking_subscribe_alerts", {
        showAlerts: true,
      });

      if (!readiness.ok) return;

      let userLatitude: number | undefined;
      let userLongitude: number | undefined;

      if (readiness.permission?.granted) {
        const current = await getCurrentPositionSafe("user_tracking_subscribe_alerts", {});
        if (current) {
          userLatitude = current.coords.latitude;
          userLongitude = current.coords.longitude;
        }
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
      console.error("[UserTracking][subscribeForAlerts]", { busId, error: subscriptionErr });
      captureSentryException(subscriptionErr, {
        tags: { area: "user_tracking", operation: "subscribe_for_alerts" },
        extra: { busId },
        level: "warning",
      });
    } finally {
      setSubmittingSubscription(false);
    }
  };

  const eta =
    tracking.routeEtaSummary?.etaToDestinationText ??
    formatEtaFromSeconds(tracking.routeEtaSummary?.etaToDestinationSeconds) ??
    live?.etaToDestinationText ??
    live?.estimatedArrival ??
    formatEtaFromSeconds(live?.etaToDestinationSeconds) ??
    formatEtaFromSeconds(live?.estimatedDurationSeconds) ??
    "-";

  const tripStatusLabel = getTripStatusLabel(live?.trip?.status ?? live?.tripStatus);
  const connectionLabel = tracking.connectionStatus === "connected" ? "Live" : tracking.connectionStatus === "reconnecting" ? "Reconnecting" : "Offline";
  const freshnessBase = tracking.lastUpdatedTimestamp != null
    ? getFreshnessLabel(new Date(tracking.lastUpdatedTimestamp).toISOString())
    : getFreshnessLabel(live?.lastUpdated);
  const freshnessLabel = tracking.isStale ? `${freshnessBase} • Stale` : freshnessBase;

  const mergedTimelineStops = useMemo<OrderedStop[]>(() => {
    if (!tracking.timelineStops.length) {
      return orderedStops;
    }

    const realtimeById = new Map(
      tracking.timelineStops
        .filter((stop) => typeof stop.id === "string" && stop.id.trim().length > 0)
        .map((stop) => [String(stop.id), stop]),
    );

    return orderedStops.map((stop) => {
      const realtime = stop.id ? realtimeById.get(stop.id) : undefined;
      if (!realtime) {
        return stop;
      }

      return {
        ...stop,
        status: realtime.status ?? stop.status,
        isPassed: typeof realtime.isPassed === "boolean" ? realtime.isPassed : stop.isPassed,
        etaFromCurrentSeconds: realtime.etaFromCurrentSeconds ?? stop.etaFromCurrentSeconds,
        etaFromCurrentText: realtime.etaFromCurrentText ?? stop.etaFromCurrentText,
        segmentEtaSeconds: realtime.segmentEtaSeconds ?? stop.segmentEtaSeconds,
        segmentEtaText: realtime.segmentEtaText ?? stop.segmentEtaText,
        arrivalClockTimeText: realtime.arrivalClockTimeText ?? stop.arrivalClockTimeText,
        departedClockTimeText: realtime.departedClockTimeText ?? stop.departedClockTimeText,
        leftSubLabel: realtime.leftSubLabel ?? stop.leftSubLabel,
        rightPrimaryLabel: realtime.rightPrimaryLabel ?? stop.rightPrimaryLabel,
        rightSecondaryLabel: realtime.rightSecondaryLabel ?? stop.rightSecondaryLabel,
      };
    });
  }, [orderedStops, tracking.timelineStops]);

  const routeStartLabel = live?.routeStartName ?? mergedTimelineStops[0]?.name ?? "-";
  const routeEndLabel = live?.routeEndName ?? mergedTimelineStops[mergedTimelineStops.length - 1]?.name ?? "-";

  const destinationDistance = live?.distanceToDestinationText
    ?? formatDistanceFromMeters(live?.distanceToDestinationMeters)
    ?? live?.totalDistanceText
    ?? "-";

  const trackingStatusLabel = String(
    live?.trackingStatus
    ?? live?.fleetStatus
    ?? live?.status
    ?? tracking.connectionStatus,
  )
    .replace(/_/g, " ")
    .toUpperCase();

  const normalizedTripStatus = String(live?.trip?.status ?? live?.tripStatus ?? "PENDING").trim().toUpperCase();
  const tripStatusBadge = tracking.connectionStatus !== "connected"
    ? "OFFLINE"
    : normalizedTripStatus.includes("STOPPED")
      ? "STOPPED"
      : normalizedTripStatus.includes("RUNNING") || normalizedTripStatus.includes("STARTED")
        ? "RUNNING"
        : normalizedTripStatus.includes("PENDING")
          ? "PENDING"
          : normalizedTripStatus.includes("COMPLETED")
            ? "COMPLETED"
            : normalizedTripStatus.includes("CANCEL")
              ? "CANCELLED"
              : normalizedTripStatus;

  const stopsWithStatus = useMemo<StopWithStatus[]>(() => {
    if (!mergedTimelineStops.length) return [];

    const hasBackendStatus = mergedTimelineStops.some((stop) => stop.status != null);
    if (hasBackendStatus) {
      return mergedTimelineStops.map((stop) => ({
        ...stop,
        status: stop.status === "current"
          ? "next"
          : stop.status === "passed"
            ? "passed"
            : "upcoming",
      }));
    }

    const hasPassState = mergedTimelineStops.some((stop) => typeof stop.isPassed === "boolean");
    if (hasPassState) {
      const firstNotPassed = mergedTimelineStops.findIndex((stop) => stop.isPassed !== true);
      const currentIndex = firstNotPassed < 0 ? mergedTimelineStops.length - 1 : firstNotPassed;
      return mergedTimelineStops.map((stop, index) => ({
        ...stop,
        status: stop.isPassed === true ? "passed" : index === currentIndex ? "next" : "upcoming",
      }));
    }

    const currentStopById = tracking.currentStopId ? mergedTimelineStops.findIndex((stop) => stop.id === tracking.currentStopId) : -1;
    const nextStopById = tracking.nextStopId ? mergedTimelineStops.findIndex((stop) => stop.id === tracking.nextStopId) : -1;

    if (currentStopById >= 0) {
      return mergedTimelineStops.map((stop, index) => ({
        ...stop,
        status: index < currentStopById ? "passed" : index === currentStopById ? "next" : "upcoming",
      }));
    }

    if (nextStopById >= 0) {
      return mergedTimelineStops.map((stop, index) => ({
        ...stop,
        status: index < nextStopById ? "passed" : index === nextStopById ? "next" : "upcoming",
      }));
    }

    return mergedTimelineStops.map((stop, index) => ({
      ...stop,
      status: index === 0 ? "next" : "upcoming",
    }));
  }, [mergedTimelineStops, tracking.currentStopId, tracking.nextStopId]);

  const timelineStopsForSheet = useMemo<TimelineStop[]>(() => {
    return stopsWithStatus.map((stop, index) => {
      const uiStatus: "passed" | "current" | "upcoming" =
        stop.status === "next" ? "current" : stop.status;
      const etaSecondsFromSocket = stop.id ? tracking.etaMap[stop.id] : undefined;
      const etaSeconds = typeof etaSecondsFromSocket === "number"
        ? etaSecondsFromSocket
        : stop.etaFromCurrentSeconds;
      const labelFromBackend = stop.leftSubLabel ?? stop.rightPrimaryLabel;
      const arrivalClock = stop.arrivalClockTimeText;
      const departedClock = stop.departedClockTimeText;

      if (labelFromBackend) {
        return {
          id: stop.id,
          name: stop.name || `Stop ${index + 1}`,
          status: uiStatus,
          sequence: stop.sequenceOrder ?? index + 1,
          leftSubLabel: stop.leftSubLabel,
          rightPrimaryLabel: stop.rightPrimaryLabel,
          rightSecondaryLabel:
            stop.rightSecondaryLabel?.toUpperCase() === "CURRENT"
              ? "CURRENT"
              : undefined,
        };
      }

      if (uiStatus === "passed") {
        return {
          id: stop.id,
          name: stop.name || `Stop ${index + 1}`,
          status: uiStatus,
          sequence: stop.sequenceOrder ?? index + 1,
          leftSubLabel: departedClock ? `Departed ${departedClock}` : "Passed",
          rightPrimaryLabel: "Passed",
        };
      }

      if (uiStatus === "current") {
        return {
          id: stop.id,
          name: stop.name || `Stop ${index + 1}`,
          status: uiStatus,
          sequence: stop.sequenceOrder ?? index + 1,
          leftSubLabel: "Arriving Now",
          rightPrimaryLabel: arrivalClock ?? "Now",
          rightSecondaryLabel: "CURRENT",
        };
      }

      return {
        id: stop.id,
        name: stop.name || `Stop ${index + 1}`,
        status: uiStatus,
        sequence: stop.sequenceOrder ?? index + 1,
        leftSubLabel: stop.etaFromCurrentText
          ?? (typeof etaSeconds === "number" ? `In ${Math.max(1, Math.round(etaSeconds / 60))} mins` : undefined)
          ?? stop.distanceFromCurrentText
          ?? "Upcoming",
        rightPrimaryLabel: arrivalClock
          ?? formatClockTimeFromOffset(etaSeconds)
          ?? formatEtaFromSeconds(etaSeconds)
          ?? "-",
      };
    });
  }, [stopsWithStatus, tracking.etaMap]);

  const nextTimelineStop = timelineStopsForSheet.find((stop) => stop.status === "current")
    ?? timelineStopsForSheet.find((stop) => stop.status === "upcoming")
    ?? timelineStopsForSheet[0];

  const nextStopName = nextTimelineStop?.name ?? live?.nextStop ?? mergedTimelineStops[0]?.name ?? "-";
  const nextStopEta = nextTimelineStop?.leftSubLabel
    ?? mergedTimelineStops.find((stop) => stop.id === nextTimelineStop?.id)?.etaFromCurrentText
    ?? live?.estimatedArrival
    ?? "-";
  const nextStopEtaSecondsFromSocket = nextTimelineStop?.id ? tracking.etaMap[nextTimelineStop.id] : undefined;
  const busApproachingNextStop = typeof nextStopEtaSecondsFromSocket === "number" && nextStopEtaSecondsFromSocket <= 90;

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
        <Text className="mt-4 text-center text-lg font-semibold text-red-600">{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <View className="relative flex-1 bg-slate-900">
      {/* Full-screen map */}
      <View className="absolute inset-0">
        <RouteMap
          coordinates={path ?? []}
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
      </View>

      {/* Top overlay - floating header */}
      <SafeAreaView className="absolute left-0 right-0 top-0 z-10 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg"
          >
            <Ionicons name="arrow-back" size={20} color="#0f172a" />
          </Pressable>

          <Text className="flex-1 px-3 text-center text-[15px] font-semibold text-white drop-shadow-lg">
            Bus {live?.numberPlate || params.plate || "-"}
          </Text>

          <View className={`rounded-full px-3 py-1.5 shadow-lg ${tracking.connectionStatus === "connected" ? "bg-emerald-500" : tracking.connectionStatus === "reconnecting" ? "bg-amber-500" : "bg-slate-600"}`}>
            <Text className="text-xs font-semibold text-white">{connectionLabel}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Draggable bottom sheet */}
      <BottomSheet ref={bottomSheetRef} collapsedHeight={180} initialState="half" onStateChange={setSheetPosition}>
        <BottomSheetContent
          state={sheetPosition}
          tripStatusBadge={tripStatusBadge}
          tripStatusLabel={tripStatusLabel}
          trackingStatusLabel={trackingStatusLabel}
          nextStop={nextStopName}
          nextStopEta={nextStopEta}
          tripEtaToDestination={eta}
          destinationDistance={destinationDistance}
          routeName={live?.routeName || params.route || "-"}
          routeStart={routeStartLabel}
          routeEnd={routeEndLabel}
          stops={timelineStopsForSheet}
          currentStopId={tracking.currentStopId}
          nextStopId={tracking.nextStopId}
          busApproaching={busApproachingNextStop}
          isSubscribed={isSubscribed}
          onSubscribePress={subscribeForAlerts}
          submittingSubscription={submittingSubscription}
          freshnessLabel={freshnessLabel}
        />
      </BottomSheet>
    </View>
  );
}

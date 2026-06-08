import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  getUserSubscriptions,
} from "../../api/user";
import { BottomSheet, type BottomSheetState } from "../../components/BottomSheet";
import { BottomSheetContent } from "../../components/BottomSheetContent";
import RouteMap from "../../components/RouteMap";
import type { TimelineStop } from "../../components/StopsTimeline";
import { useLocation } from "../../hooks/useLocation";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import useTrackingData from "../../hooks/useTrackingData";
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

const formatEtaFromSeconds = (seconds?: number | null): string | null => {
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

  const { busId, tripId } = useLocalSearchParams<{ busId?: string; tripId?: string }>();

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const { ensureForegroundAccess, getCurrentPositionSafe } = useLocation();
  const trackingData = useTrackingData(busId, tripId);
  const [submittingSubscription, setSubmittingSubscription] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [sheetPosition, setSheetPosition] = useState<BottomSheetState>("half");
  const bottomSheetRef = useRef<{ snapToPosition: (state: BottomSheetState) => void }>(null);
  const previousCurrentStopIdRef = useRef<string | null>(null);

  const loading = trackingData.loading;
  const error = trackingData.error;
  const currentLocation = trackingData.currentLocation;
  const routeEncodedPolyline = trackingData.route?.encodedPolyline ?? "";

  const orderedStops = useMemo<OrderedStop[]>(() => {
    return (trackingData.stops ?? [])
      .map((stop) => ({
        id: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        sequenceOrder: stop.sequenceOrder,
        status:
          stop.status === "passed"
            ? "passed"
            : stop.status === "current"
              ? "next"
              : stop.status === "upcoming"
                ? "upcoming"
                : undefined,
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
      } as OrderedStop))
      .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER));
  }, [trackingData.stops]);

  const routeStart = trackingData.route?.startName ?? orderedStops[0]?.name ?? "-";
  const routeEnd = trackingData.route?.endName ?? orderedStops[orderedStops.length - 1]?.name ?? "-";

  const path = useMemo<Coord[]>(() => {
    const start = trackingData.route?.startLat != null && trackingData.route?.startLng != null
      ? { latitude: trackingData.route.startLat, longitude: trackingData.route.startLng }
      : null;
    const end = trackingData.route?.endLat != null && trackingData.route?.endLng != null
      ? { latitude: trackingData.route.endLat, longitude: trackingData.route.endLng }
      : null;

    if (routeEncodedPolyline) {
      try {
        const decoded = polyline.decode(routeEncodedPolyline) as [number, number][];
        const points = decoded.map(([latitude, longitude]) => ({ latitude, longitude }));
        if (points.length > 0) {
          return points;
        }
      } catch (polylineErr) {
        console.warn("[UserTracking][decodePolyline]", { error: polylineErr });
        captureSentryException(polylineErr, {
          tags: { area: "user_tracking", operation: "decode_polyline" },
          level: "warning",
        });
      }
    }

    return buildFallbackPath(start, orderedStops, end);
  }, [orderedStops, routeEncodedPolyline, trackingData.route]);

  const live = useMemo<BusLiveStatus | null>(() => {
    if (!trackingData.route && !trackingData.trip && !trackingData.bus) {
      return null;
    }

    const routeEtaText = trackingData.route
      ? formatEtaFromSeconds(trackingData.route.estimatedDurationSeconds)
      : null;
    const etaToDestinationText =
      trackingData.etaToDestinationText ??
      formatEtaFromSeconds(trackingData.etaToDestinationSeconds) ??
      routeEtaText;

    return {
      busId: trackingData.bus?.id ?? "",
      numberPlate: trackingData.bus?.numberPlate ?? "",
      routeName: trackingData.route?.name ?? "Route",
      routeId: trackingData.route?.id,
      trip: trackingData.trip
        ? {
          id: trackingData.trip.id,
          status: trackingData.trip.status,
        }
        : undefined,
      encodedPolyline: trackingData.route?.encodedPolyline ?? "",
      routeStartLat: trackingData.route?.startLat ?? null,
      routeStartLng: trackingData.route?.startLng ?? null,
      routeStartName: trackingData.route?.startName ?? null,
      routeEndLat: trackingData.route?.endLat ?? null,
      routeEndLng: trackingData.route?.endLng ?? null,
      routeEndName: trackingData.route?.endName ?? null,
      stops: trackingData.stops
        ? trackingData.stops.map((stop) => ({
          id: stop.id,
          name: stop.name,
          lat: stop.latitude,
          lng: stop.longitude,
          latitude: stop.latitude,
          longitude: stop.longitude,
          sequenceOrder: stop.sequenceOrder,
          radiusMeters: stop.radiusMeters ?? undefined,
        }))
        : [],
      currentLat: trackingData.currentLocation?.latitude ?? null,
      currentLng: trackingData.currentLocation?.longitude ?? null,
      nextStop:
        orderedStops.find((stop) => stop.id === trackingData.currentStopId)?.name ??
        orderedStops.find((stop) => stop.id === trackingData.nextStopId)?.name ??
        null,
      estimatedArrival: trackingData.etaToDestinationText ?? null,
      fleetStatus: trackingData.bus?.status ?? null,
      tripStatus: trackingData.trip?.status ?? null,
      status: trackingData.trip?.status ?? trackingData.bus?.status ?? null,
      trackingStatus: trackingData.connectionStatus,
      lastUpdated: trackingData.lastUpdatedAt,
      totalDistanceMeters: trackingData.route?.totalDistanceMeters,
      estimatedDurationSeconds: trackingData.route?.estimatedDurationSeconds,
      totalDistanceText: trackingData.route?.totalDistanceMeters != null
        ? formatDistanceFromMeters(trackingData.route.totalDistanceMeters) ?? undefined
        : undefined,
      estimatedDurationText: trackingData.route?.estimatedDurationSeconds != null
        ? formatEtaFromSeconds(trackingData.route.estimatedDurationSeconds) ?? undefined
        : undefined,
      etaToDestinationSeconds: trackingData.etaToDestinationSeconds ?? undefined,
      etaToDestinationText: trackingData.etaToDestinationText ?? undefined,
      distanceToDestinationMeters: undefined,
      distanceToDestinationText: undefined,
      isActive: Boolean(trackingData.trip),
    } as BusLiveStatus;
  }, [orderedStops, trackingData]);

  const connectionLabel = trackingData.connectionStatus === "connected"
    ? "Live"
    : trackingData.connectionStatus === "reconnecting"
      ? "Reconnecting"
      : "Offline";

  const freshnessLabel = trackingData.lastUpdatedAt
    ? getFreshnessLabel(trackingData.lastUpdatedAt)
    : "No recent update";

  const tripStatusLabel = getTripStatusLabel(trackingData.trip?.status);
  const trackingStatusLabel = connectionLabel;
  const normalizedTripStatus = String(trackingData.trip?.status ?? "PENDING").trim().toUpperCase();
  const tripStatusBadge = trackingData.connectionStatus !== "connected"
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
    if (!orderedStops.length) {
      return [];
    }

    const currentIndex = trackingData.currentStopId
      ? orderedStops.findIndex((stop) => stop.id === trackingData.currentStopId)
      : -1;
    const nextIndex = trackingData.nextStopId
      ? orderedStops.findIndex((stop) => stop.id === trackingData.nextStopId)
      : -1;

    return orderedStops.map((stop, index): StopWithStatus => {
      if (stop.status === "passed" || stop.status === "next" || stop.status === "upcoming") {
        return {
          ...stop,
          status: stop.status,
        };
      }

      if (currentIndex >= 0) {
        return {
          ...stop,
          status: index < currentIndex ? "passed" : index === currentIndex ? "next" : "upcoming",
        };
      }

      if (nextIndex >= 0) {
        return {
          ...stop,
          status: index < nextIndex ? "passed" : index === nextIndex ? "next" : "upcoming",
        };
      }

      return {
        ...stop,
        status: index === 0 ? "next" : "upcoming",
      };
    });
  }, [orderedStops, trackingData.currentStopId, trackingData.nextStopId]);

  const timelineStopsForSheet = useMemo<TimelineStop[]>(() => {
    return stopsWithStatus.map((stop, index) => {
      const uiStatus: "passed" | "current" | "upcoming" =
        stop.status === "next" ? "current" : stop.status;
      return {
        id: stop.id,
        name: stop.name || `Stop ${index + 1}`,
        status: uiStatus,
        sequence: stop.sequenceOrder ?? index + 1,
        leftSubLabel:
          stop.leftSubLabel ??
          (uiStatus === "passed"
            ? "Passed"
            : uiStatus === "current"
              ? "Arriving Now"
              : stop.etaFromCurrentText ?? "Upcoming"),
        rightPrimaryLabel:
          stop.rightPrimaryLabel ??
          (uiStatus === "passed"
            ? "Passed"
            : uiStatus === "current"
              ? "Now"
              : formatEtaFromSeconds(stop.etaFromCurrentSeconds) ?? "-"),
        rightSecondaryLabel: stop.rightSecondaryLabel ?? (uiStatus === "current" ? "CURRENT" : undefined),
      };
    });
  }, [stopsWithStatus]);

  const nextTimelineStop = timelineStopsForSheet.find((stop) => stop.status === "current")
    ?? timelineStopsForSheet.find((stop) => stop.status === "upcoming")
    ?? timelineStopsForSheet[0];

  const nextStopName = nextTimelineStop?.name ?? live?.nextStop ?? orderedStops[0]?.name ?? "-";
  const nextStopEta = nextTimelineStop?.leftSubLabel
    ?? live?.estimatedArrival
    ?? "-";
  const busApproachingNextStop =
    typeof trackingData.etaToDestinationSeconds === "number" && trackingData.etaToDestinationSeconds <= 90;

  useEffect(() => {
    const previous = previousCurrentStopIdRef.current;
    if (trackingData.currentStopId && previous && trackingData.currentStopId !== previous) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    previousCurrentStopIdRef.current = trackingData.currentStopId;
  }, [trackingData.currentStopId]);

  useEffect(() => {
    if (!trackingData.bus?.id) {
      setIsSubscribed(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const subscriptions = await getUserSubscriptions();
        if (cancelled) {
          return;
        }

        setIsSubscribed(subscriptions.some((subscription) => String(subscription.busId) === String(trackingData.bus?.id)));
      } catch (subscriptionErr) {
        console.error("[UserTracking][loadSubscriptions]", { error: subscriptionErr });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trackingData.bus?.id]);

  const subscribeForAlerts = async () => {
    if (!trackingData.bus?.id || submittingSubscription || isSubscribed) return;

    setSubmittingSubscription(true);
    try {
      addSentryBreadcrumb({
        category: "user_tracking",
        message: "Subscribe for alerts requested",
        level: "info",
        data: { busId: trackingData.bus.id },
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
        busId: trackingData.bus.id,
        notifyOnBusStart: true,
        notifyOnNearStop: true,
        userLatitude: userLatitude ?? 17.4012,
        userLongitude: userLongitude ?? 78.5123,
        nearRadiusMeters: 120,
      });

      setIsSubscribed(true);
    } catch (subscriptionErr) {
      console.error("[UserTracking][subscribeForAlerts]", { error: subscriptionErr });
      captureSentryException(subscriptionErr, {
        tags: { area: "user_tracking", operation: "subscribe_for_alerts" },
        level: "warning",
      });
    } finally {
      setSubmittingSubscription(false);
    }
  };

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
        <Pressable
          className="mt-5 rounded-full bg-blue-600 px-5 py-3"
          onPress={trackingData.refresh}
        >
          <Text className="text-sm font-semibold text-white">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!trackingData.route) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 px-8">
        <MaterialCommunityIcons name="map-marker-question" size={56} color="#0f172a" />
        <Text className="mt-4 text-center text-lg font-semibold text-slate-900">
          No route assigned
        </Text>
        <Text className="mt-2 text-center text-sm text-slate-600">
          Your passenger profile does not have an active route yet.
        </Text>
        <Pressable
          className="mt-5 rounded-full bg-blue-600 px-5 py-3"
          onPress={trackingData.refresh}
        >
          <Text className="text-sm font-semibold text-white">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const routeStartLabel = trackingData.route.startName ?? orderedStops[0]?.name ?? "-";
  const routeEndLabel = trackingData.route.endName ?? orderedStops[orderedStops.length - 1]?.name ?? "-";
  const destinationDistance = trackingData.route.totalDistanceMeters != null
    ? formatDistanceFromMeters(trackingData.route.totalDistanceMeters) ?? "-"
    : "-";
  const eta = trackingData.etaToDestinationText
    ?? formatEtaFromSeconds(trackingData.etaToDestinationSeconds)
    ?? formatEtaFromSeconds(trackingData.route.estimatedDurationSeconds)
    ?? "-";

  return (
    <View className="relative flex-1 bg-slate-900">
      <View className="absolute inset-0">
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
      </View>

      <SafeAreaView className="absolute left-0 right-0 top-0 z-10 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg"
          >
            <Ionicons name="arrow-back" size={20} color="#0f172a" />
          </Pressable>

          <Text className="flex-1 px-3 text-center text-[15px] font-semibold text-white drop-shadow-lg">
            Bus {trackingData.bus?.numberPlate || "-"}
          </Text>

          <View className={`rounded-full px-3 py-1.5 shadow-lg ${trackingData.connectionStatus === "connected" ? "bg-emerald-500" : trackingData.connectionStatus === "reconnecting" ? "bg-amber-500" : "bg-slate-600"}`}>
            <Text className="text-xs font-semibold text-white">{connectionLabel}</Text>
          </View>
        </View>
      </SafeAreaView>

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
          routeName={live?.routeName || "-"}
          routeStart={routeStartLabel}
          routeEnd={routeEndLabel}
          stops={timelineStopsForSheet}
          currentStopId={trackingData.currentStopId}
          nextStopId={trackingData.nextStopId}
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

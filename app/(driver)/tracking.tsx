import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  startTrip,
  stopTrip
} from "../../api/driver";
import { ActiveTrip } from "../../api/types";
import RouteMap from "../../components/RouteMap";
import { useAuth } from "../../hooks/useAuth";
import { useLocation } from "../../hooks/useLocation";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import {
  addSentryBreadcrumb,
  captureSentryException,
} from "../../monitoring/sentry";
import { useDriverTracking } from "../../src/driver/hooks/useDriverTracking";

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

type DriverUIState = {
  trip: ActiveTrip | null;
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
  useSentryScreen("driver/tracking");

  const { isAuthenticated, isHydrated, token, user } = useAuth();
  const {
    getCurrentPosition,
    watchPosition,
    requestForegroundPermission,
    hasServicesEnabled,
  } = useLocation();

  // New HTTP-based tracking (no WebSocket)
  const driverTracking = useDriverTracking(API_BASE_URL);

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
    sending: false,
  });

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
          captureSentryException(routeErr, {
            tags: {
              area: "driver_tracking",
              operation: "get_driver_my_route",
            },
            level: "warning",
          });
          return null;
        }),
      ]);

      console.log('📍 [refreshScreenData] ACTIVE TRIP FETCHED:', {
        hasActiveTrip: !!activeTrip,
        tripId: activeTrip?.id,
        tripStatus: activeTrip?.status,
        tripStartedAt: activeTrip?.startedAt,
        tripEndedAt: activeTrip?.endedAt,
      });

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

      // AUTO-START TRACKING if trip is active
      if (activeTrip && activeTrip.status === "STARTED" && trackingAssignment.bus?.id) {
        const driverId = user?.id;
        const busId = trackingAssignment.bus?.id;
        const tripId = activeTrip.id;

        console.log('🚀 [refreshScreenData] AUTO-STARTING TRACKING for existing trip:', {
          driverId,
          busId,
          tripId,
        });

        if (driverId && busId && tripId) {
          try {
            await driverTracking.startTracking(driverId, busId, tripId);
            console.log('✅ [refreshScreenData] AUTO-START SUCCESS');
          } catch (trackingErr) {
            console.error('❌ [refreshScreenData] AUTO-START FAILED:', trackingErr);
          }
        }
      }
    } catch (err: any) {
      console.error("[DriverTracking][refreshScreenData]", err);
      captureSentryException(err, {
        tags: {
          area: "driver_tracking",
          operation: "refresh_screen_data",
        },
      });
      setError(
        err?.response?.data?.message ??
        err?.message ??
        "Failed to load tracking",
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const handleTripAction = useCallback(async () => {
    console.log('🔵 [handleTripAction] CALLED', { isTripActive });

    if (actionLoading) {
      console.log('🟡 [handleTripAction] ACTION ALREADY LOADING, RETURNING');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      if (isTripActive) {
        addSentryBreadcrumb({
          category: "driver_tracking",
          message: "Stop trip requested",
          level: "info",
          data: {
            tripId: uiState.trip?.id ?? null,
          },
        });

        await stopTrip();
        const latest = await getActiveTrip();
        setUiState((previous) => ({
          ...previous,
          trip: latest,
        }));

        // Stop tracking
        await driverTracking.stopTracking();
      } else {
        // Start trip
        console.log('🟢 [handleTripAction] STARTING TRIP FLOW', { hasAssignment });

        if (!hasAssignment) {
          console.error('❌ [handleTripAction] NO ASSIGNMENT, RETURNING');
          return;
        }

        try {
          addSentryBreadcrumb({
            category: "driver_tracking",
            message: "Start trip requested",
            level: "info",
            data: {
              busId: assignment.bus?.id ?? null,
              routeId: assignment.route?.id ?? null,
            },
          });

          const started = await startTrip();
          const tripId = started?.id;

          console.log('✅ [Tracking] Trip started:', {
            tripIdExists: !!tripId,
            tripId: tripId || 'UNDEFINED',
            started,
          });

          setUiState((previous) => ({
            ...previous,
            trip: started ?? previous.trip,
          }));

          // Start background + foreground HTTP-based tracking with identifiers
          if (tripId) {
            const userId = user?.id;
            const busId = assignment.bus?.id;

            console.log('🚀 [Tracking] IDENTIFIERS CHECK:', {
              hasUserId: !!userId,
              userId: userId || 'UNDEFINED',
              hasBusId: !!busId,
              busId: busId || 'UNDEFINED',
              hasTripId: !!tripId,
              tripId: tripId || 'UNDEFINED',
            });

            if (!userId || !busId || !tripId) {
              console.error('❌ [Tracking] IDENTIFIERS INCOMPLETE - BLOCKING startTracking', {
                userId: userId || 'MISSING',
                busId: busId || 'MISSING',
                tripId: tripId || 'MISSING',
              });
            }

            console.log('🔴 [Tracking] ABOUT TO CALL startTracking WITH:', {
              userId,
              busId,
              tripId,
            });

            await driverTracking.startTracking(
              userId,
              busId,
              tripId
            );
            setSendNote("Background location tracking enabled");
          } else {
            console.error('❌ [Tracking] BLOCKED: tripId is falsy!', { tripId });
          }
        } catch (err) {
          console.error('❌ [handleTripAction] CATCH BLOCK TRIGGERED', { err });
          if (isAlreadyActiveTripError(err)) {
            console.log('🟡 [handleTripAction] Already active trip detected, resuming...');
            const active = await getActiveTrip();
            setUiState((previous) => ({
              ...previous,
              trip: active,
            }));

            // Resume tracking for existing trip with identifiers
            await driverTracking.startTracking(
              user?.id,
              assignment.bus?.id,
              active?.id
            );
          } else {
            throw err;
          }
        }
      }
    } catch (err: any) {
      console.error("[DriverTracking][handleTripAction] OUTER CATCH", err);
      captureSentryException(err, {
        tags: {
          area: "driver_tracking",
          operation: "handle_trip_action",
        },
      });
      setError(
        err?.response?.data?.message ?? err?.message ?? "Unable to update trip",
      );
    } finally {
      console.log('ℹ️ [handleTripAction] FINALLY - Setting actionLoading to false');
      setActionLoading(false);
    }
  }, [
    actionLoading,
    assignment.bus?.id,
    assignment.route?.id,
    driverTracking,
    hasAssignment,
    isTripActive,
    uiState.trip?.id,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !isTripActive || !token || !assignedBusId) {
      return;
    }

    // Tracking is already managed by the driverTracking hook
  }, [assignedBusId, isAuthenticated, isTripActive, token, uiState.trip?.id]);

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

  const tripStatusLabel = getTripStatusLabel(uiState.trip?.status);

  const syncStatus =
    driverTracking.isTracking && driverTracking.isSyncing
      ? "Syncing..."
      : driverTracking.isTracking
        ? "Tracking"
        : "Idle";

  const trackingBanner = driverTracking.isTracking
    ? driverTracking.isSyncing
      ? "Background tracking is active and syncing location updates."
      : "Background tracking is active. The driver notification stays pinned while tracking runs."
    : "Background tracking is idle.";

  const actionLabel = isTripActive ? "Stop Trip" : "Start Trip";
  const actionDisabled = actionLoading || (!isTripActive && !hasAssignment);

  const lastUpdatedSeconds = driverTracking.syncStats.lastSyncTime
    ? Math.max(
      0,
      Math.floor(
        (clock - new Date(driverTracking.syncStats.lastSyncTime).getTime()) /
        1000
      )
    )
    : null;

  const locationStatus = driverTracking.isTracking
    ? driverTracking.isSyncing
      ? "Syncing locations..."
      : lastUpdatedSeconds == null
        ? "Waiting for first sync"
        : `Last synced ${lastUpdatedSeconds} sec ago`
    : "Tracking idle";

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
              {syncStatus}
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

          <View
            className={`mt-3 flex-row items-start gap-3 rounded-xl px-3 py-3 ${driverTracking.isTracking ? "bg-emerald-50" : "bg-slate-50"}`}
          >
            <MaterialCommunityIcons
              name={driverTracking.isTracking ? "shield-check" : "shield-off"}
              size={20}
              color={driverTracking.isTracking ? "#059669" : "#64748b"}
            />
            <View className="flex-1">
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Background Tracking
              </Text>
              <Text className="mt-1 text-sm font-medium text-slate-800">
                {trackingBanner}
              </Text>
            </View>
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
              Queue Status
            </Text>
            <Text className="mt-1 text-lg font-bold text-blue-700">
              {driverTracking.queueStats.totalItems} locations queued
            </Text>
            <Text className="mt-1 text-sm font-semibold text-slate-600">
              Uploaded: {driverTracking.syncStats.totalItemsUploaded}
            </Text>
            {driverTracking.queueStats.oldestItemAge !== null && (
              <Text className="mt-0.5 text-xs text-slate-500">
                Oldest: {Math.round(driverTracking.queueStats.oldestItemAge / 1000)}s ago
              </Text>
            )}
            {driverTracking.error && (
              <Text className="mt-1 text-xs text-red-600">{driverTracking.error}</Text>
            )}
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
                      className={`h-3.5 w-3.5 rounded-full ${stop.status === "passed"
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
                      className={`mt-0.5 text-xs font-semibold ${stop.status === "passed"
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
                      {`From bus: ${stop.distanceFromCurrentText ??
                        formatDistanceFromMeters(
                          stop.distanceFromCurrentMeters,
                        ) ??
                        "distance --"
                        } • ${stop.etaFromCurrentText ??
                        formatEtaFromSeconds(stop.etaFromCurrentSeconds) ??
                        "ETA --"
                        }`}
                    </Text>
                    {stop.segmentDistanceText || stop.segmentEtaText ? (
                      <Text className="mt-0.5 text-[11px] text-slate-500">
                        {`From previous: ${stop.segmentDistanceText ?? "-"}${stop.segmentDistanceText && stop.segmentEtaText
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
          className={`mt-5 items-center rounded-2xl py-4 ${actionDisabled
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

import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import * as Location from "expo-location";
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
import StatusBadge from "../../components/StatusBadge";
import socketService from "../../sockets/socketService";
import authStore from "../../store/auth";
import {
  createBusStatusStateFromRestSnapshot,
  mergeBusStatusFromSocketUpdate,
  type BusStatusState,
} from "../../store/busStatus";

type Coord = {
  latitude: number;
  longitude: number;
};

type StopStatus = "passed" | "next" | "upcoming";

type OrderedStop = {
  id?: string;
  name?: string;
  latitude: number;
  longitude: number;
  sequenceOrder?: number;
  distanceFromCurrentText?: string;
  etaFromCurrentText?: string;
  distanceFromCurrentMeters?: number;
  etaFromCurrentSeconds?: number;
  segmentDistanceText?: string;
  segmentEtaText?: string;
  isPassed?: boolean;
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
    distanceFromCurrentText: stop.distanceFromCurrentText,
    etaFromCurrentText: stop.etaFromCurrentText,
    distanceFromCurrentMeters: stop.distanceFromCurrentMeters,
    etaFromCurrentSeconds: stop.etaFromCurrentSeconds,
    segmentDistanceText: stop.segmentDistanceText,
    segmentEtaText: stop.segmentEtaText,
    isPassed: stop.isPassed,
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
    const prev = deduped[deduped.length - 1];
    if (!prev || !sameCoord(prev, point)) {
      deduped.push(point);
    }
  });

  return deduped;
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

export default function UserTrackingScreen() {
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
  const [submittingSubscription, setSubmittingSubscription] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [statusState, setStatusState] = useState<BusStatusState>(() =>
    createBusStatusStateFromRestSnapshot({}),
  );

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

  const stopsWithStatus = useMemo<
    (OrderedStop & { status: StopStatus })[]
  >(() => {
    if (!orderedStops.length) return [];

    const hasBackendPassState = orderedStops.some(
      (stop) => typeof stop.isPassed === "boolean",
    );

    if (hasBackendPassState) {
      const firstNotPassedIndex = orderedStops.findIndex(
        (stop) => stop.isPassed !== true,
      );

      return orderedStops.map((stop, index) => ({
        ...stop,
        status:
          stop.isPassed === true
            ? "passed"
            : index === (firstNotPassedIndex < 0 ? 0 : firstNotPassedIndex)
              ? "next"
              : "upcoming",
      }));
    }

    const normalizedNextStop = live?.nextStop?.trim().toLowerCase();
    let nextStopIndex = normalizedNextStop
      ? orderedStops.findIndex(
          (stop) => stop.name?.trim().toLowerCase() === normalizedNextStop,
        )
      : -1;

    if (nextStopIndex < 0 && currentLocation) {
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestIndex = 0;

      orderedStops.forEach((stop, index) => {
        const dLat = stop.latitude - currentLocation.latitude;
        const dLng = stop.longitude - currentLocation.longitude;
        const distanceSq = dLat * dLat + dLng * dLng;

        if (distanceSq < bestDistance) {
          bestDistance = distanceSq;
          bestIndex = index;
        }
      });

      nextStopIndex = bestIndex;
    }

    if (nextStopIndex < 0) {
      nextStopIndex = 0;
    }

    return orderedStops.map((stop, index) => ({
      ...stop,
      status:
        index < nextStopIndex
          ? "passed"
          : index === nextStopIndex
            ? "next"
            : "upcoming",
    }));
  }, [orderedStops, live?.nextStop, currentLocation]);

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
        setStatusState(
          createBusStatusStateFromRestSnapshot({
            fleetStatus: liveData.fleetStatus,
            tripStatus: liveData.tripStatus,
            trackingStatus: liveData.trackingStatus,
            status: liveData.status,
            lastUpdated: liveData.lastUpdated,
          }),
        );
        setIsSubscribed(
          subscriptions.some((s) => String(s.busId) === String(busId)),
        );

        if (liveData.currentLat != null && liveData.currentLng != null) {
          setCurrentLocation({
            latitude: liveData.currentLat,
            longitude: liveData.currentLng,
          });
        }

        let encodedPolyline = liveData.encodedPolyline;

        const orderedStopsFromLive = (liveData.stops ?? [])
          .map((stop) => toStopCoord(stop))
          .filter((stop): stop is OrderedStop => Boolean(stop))
          .sort((a, b) => {
            const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
          });

        if (encodedPolyline) {
          setRouteEncodedPolyline(encodedPolyline);
          const decoded = polyline.decode(encodedPolyline) as [
            number,
            number,
          ][];
          setPath(
            decoded.map(([latitude, longitude]) => ({ latitude, longitude })),
          );
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

          setPath(buildFallbackPath(start, orderedStopsFromLive, end));
        }
      } catch (err: any) {
        setError(
          err?.response?.data?.message ??
            err?.message ??
            "Failed to load live bus",
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [busId]);

  useEffect(() => {
    if (!busId) return;

    const token = authStore.token ?? undefined;
    socketService.connect(API_BASE_URL, token);

    socketService
      .waitUntilConnected(5000)
      .then((ok) => {
        if (!ok) return;
        socketService.emit("joinBusRoom", String(busId));
      })
      .catch(() => {
        // no-op
      });

    const onBusLocationUpdate = (payload: unknown) => {
      const event = payload as {
        busId?: string;
        bus?: { id?: string; _id?: string };
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
        nextStop?: string;
        estimatedArrival?: string;
        trackingStatus?: string;
        tripStatus?: string;
        status?: string;
        timestamp?: string;
        skipped?: boolean;
      };

      const eventBusId =
        event.busId ?? event.bus?.id ?? event.bus?._id ?? undefined;

      if (eventBusId && String(eventBusId) !== String(busId)) return;

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

      setStatusState((previous) =>
        mergeBusStatusFromSocketUpdate(previous, {
          trackingStatus: event.trackingStatus,
          tripStatus: event.tripStatus,
          status: event.status,
          timestamp: event.timestamp,
          skipped: event.skipped,
        }),
      );

      setLive((prev) =>
        prev
          ? {
            ...prev,
            currentLat: latitude ?? prev.currentLat,
            currentLng: longitude ?? prev.currentLng,
            nextStop: event.nextStop ?? prev.nextStop,
            estimatedArrival: event.estimatedArrival ?? prev.estimatedArrival,
            trackingStatus:
              event.skipped || event.trackingStatus == null
                ? prev.trackingStatus
                : event.trackingStatus,
            tripStatus:
              event.skipped || event.tripStatus == null
                ? prev.tripStatus
                : event.tripStatus,
            status:
              event.skipped || event.status == null
                ? prev.status
                : event.status,
            lastUpdated:
              event.skipped || event.timestamp == null
                ? prev.lastUpdated
                : event.timestamp,
          }
          : prev,
      );
    };

    socketService.on("busLocationUpdate", onBusLocationUpdate);

    return () => {
      socketService.off("busLocationUpdate");
    };
  }, [busId]);

  const subscribeForAlerts = async () => {
    if (!busId || submittingSubscription || isSubscribed) return;

    setSubmittingSubscription(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      let userLatitude: number | undefined;
      let userLongitude: number | undefined;

      if (permission.granted) {
        const current = await Location.getCurrentPositionAsync({});
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
    } catch {
      // keep view usable even if subscription fails
    } finally {
      setSubmittingSubscription(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-[#F2F4F8]">
        <ActivityIndicator size="large" color="#1847BA" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-[#F2F4F8] px-8">
        <MaterialCommunityIcons name="bus-alert" size={56} color="#EF4444" />
        <Text className="mt-4 text-center text-[20px] font-semibold text-red-600">
          {error}
        </Text>
      </SafeAreaView>
    );
  }

  const nextStop =
    live?.nextStop ??
    stopsWithStatus.find((stop) => stop.status === "next")?.name ??
    "-";
  const eta =
    live?.etaToDestinationText ??
    live?.estimatedArrival ??
    formatEtaFromSeconds(live?.etaToDestinationSeconds) ??
    formatEtaFromSeconds(live?.estimatedDurationSeconds) ??
    "-";
  const scheduled =
    live?.distanceToDestinationText ??
    formatDistanceFromMeters(live?.distanceToDestinationMeters) ??
    "-";
  const totalDistanceText =
    live?.totalDistanceText ??
    formatDistanceFromMeters(live?.totalDistanceMeters) ??
    "-";
  const estimatedDurationText =
    live?.estimatedDurationText ??
    formatEtaFromSeconds(live?.estimatedDurationSeconds) ??
    "-";

  return (
    <SafeAreaView className="flex-1 bg-[#F2F4F8]">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-slate-200">
        <Pressable onPress={() => router.back()} className="mr-3 p-1">
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </Pressable>
        <Text
          className="flex-1 text-base font-extrabold text-slate-900"
          numberOfLines={1}
        >
          {params.plate
            ? `Bus ${params.plate} Live Tracking`
            : "Bus Live Tracking"}
        </Text>
        <Pressable
          onPress={() => router.push("/(user)/alerts" as any)}
          className="mr-2"
        >
          <Ionicons name="notifications-outline" size={22} color="#1847BA" />
        </Pressable>
        <Pressable>
          <Ionicons
            name="information-circle-outline"
            size={24}
            color="#334155"
          />
        </Pressable>
      </View>

      {/* Map */}
      <View className="h-[280px] w-full">
        {path.length > 1 ? (
          <RouteMap
            coordinates={path}
            encodedPolyline={routeEncodedPolyline || undefined}
            currentLocation={currentLocation ?? undefined}
            stops={stopsWithStatus.map((stop) => ({
              latitude: stop.latitude,
              longitude: stop.longitude,
              name: stop.name,
              status: stop.status,
              sequenceOrder: stop.sequenceOrder,
            }))}
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-slate-200">
            <Text className="text-sm text-slate-500">
              Route unavailable for this bus
            </Text>
          </View>
        )}

        <View className="absolute right-3 top-20 gap-2">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
            <Feather name="crosshair" size={18} color="#334155" />
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
            <Ionicons name="add" size={20} color="#334155" />
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
            <Ionicons name="remove" size={20} color="#334155" />
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        {/* ETA card */}
        <View className="rounded-2xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-center">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
              <Ionicons name="time" size={22} color="#1847BA" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-slate-500">Next Stop Arrival</Text>
              <Text className="mt-0.5 text-lg font-extrabold text-[#1847BA]">
                {eta}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs text-slate-500">Remaining</Text>
              <Text className="text-base font-bold text-slate-900">
                {scheduled}
              </Text>
            </View>
          </View>
          <View className="mt-3 border-t border-slate-200 pt-3">
            <Text className="text-xs font-semibold text-slate-600">
              Route Summary
            </Text>
            <View className="mt-2 flex-row justify-between gap-3">
              <View className="flex-1">
                <Text className="text-xs text-slate-500">Total Distance</Text>
                <Text className="text-sm font-bold text-slate-900">
                  {totalDistanceText}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-slate-500">Est. Duration</Text>
                <Text className="text-sm font-bold text-slate-900">
                  {estimatedDurationText}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-slate-500">Remaining</Text>
                <Text className="text-sm font-bold text-slate-900">
                  {live?.distanceToDestinationText ||
                    (live?.distanceToDestinationMeters
                      ? `${(live.distanceToDestinationMeters / 1000).toFixed(1)} km`
                      : "-")}
                </Text>
              </View>
            </View>
          </View>
          <View className="mt-3 flex-row items-center justify-between border-t border-slate-200 pt-3">
            <Text className="text-xs text-slate-600">Next: {nextStop}</Text>
            <Pressable
              className={`rounded-full px-3 py-1.5 flex-row items-center gap-1.5 ${
                isSubscribed ? "bg-emerald-100" : "bg-[#E3EBFF]"
              }`}
              onPress={subscribeForAlerts}
              disabled={submittingSubscription || isSubscribed}
            >
              {submittingSubscription ? (
                <ActivityIndicator size="small" color="#1847BA" />
              ) : (
                <>
                  <Ionicons
                    name={
                      isSubscribed ? "notifications" : "notifications-outline"
                    }
                    size={14}
                    color={isSubscribed ? "#15803D" : "#1847BA"}
                  />
                  <Text
                    className={`text-[11px] font-bold ${
                      isSubscribed ? "text-emerald-700" : "text-[#1847BA]"
                    }`}
                  >
                    {isSubscribed ? "Subscribed" : "Subscribe"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <StatusBadge
              statusType="trackingStatus"
              statusCode={statusState.trackingStatus.code}
              size="md"
            />
            <StatusBadge
              statusType="tripStatus"
              statusCode={statusState.tripStatus.code}
              size="md"
            />
            <StatusBadge
              statusType="fleetStatus"
              statusCode={statusState.fleetStatus.code}
              size="md"
            />
          </View>
        </View>

        {/* Stop progress */}
        <View className="mt-3 rounded-2xl border border-slate-200 bg-white">
          <Text className="px-4 py-3 text-xs font-extrabold tracking-widest text-slate-900 border-b border-slate-200">
            CURRENT PROGRESS
          </Text>

          <View className="px-4 py-4">
            {stopsWithStatus.length === 0 ? (
              <Text className="text-sm text-slate-500">
                No stop data available
              </Text>
            ) : (
              stopsWithStatus.map((stop, index) => {
                const isNext = stop.status === "next";
                const isPassed = stop.status === "passed";
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
                    key={
                      stop.id ??
                      `${stop.name ?? "stop"}-${index}-${stop.sequenceOrder ?? "na"}`
                    }
                    className="flex-row mb-3"
                  >
                    <View className="mr-3 items-center" style={{ width: 16 }}>
                      <View
                        className={`h-3.5 w-3.5 rounded-full border-2 ${
                          isNext
                            ? "border-[#1847BA] bg-[#1847BA]"
                            : isPassed
                              ? "border-emerald-500 bg-emerald-500"
                              : "border-slate-300 bg-white"
                        }`}
                      />
                      {index < stopsWithStatus.length - 1 && (
                        <View className="mt-1 w-0.5 h-10 bg-slate-200" />
                      )}
                    </View>

                    <View className="flex-1">
                      <Text
                        className={`text-sm ${
                          isNext
                            ? "font-extrabold text-slate-900"
                            : "text-slate-600"
                        }`}
                      >
                        {(stop.sequenceOrder != null
                          ? `${stop.sequenceOrder}. `
                          : "") + (stop.name ?? `Stop ${index + 1}`)}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-600">
                        {`From bus: ${stopDistance} • ${stopEta}`}
                      </Text>
                      {segmentDetail ? (
                        <Text className="text-[11px] text-slate-500">
                          {segmentDetail}
                        </Text>
                      ) : null}
                      <Text
                        className={`text-xs mt-1 ${
                          isNext
                            ? "font-semibold text-[#1847BA]"
                            : isPassed
                              ? "text-slate-400"
                              : "text-slate-500"
                        }`}
                      >
                        {isNext
                          ? "Next Stop"
                          : isPassed
                            ? "Passed"
                            : "Upcoming"}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* Bottom navigation */}
      <View className="flex-row items-center justify-around border-t border-slate-200 bg-white py-2.5">
        <Pressable
          className="items-center"
          onPress={() => router.replace("/(user)/home" as any)}
        >
          <Ionicons name="home-outline" size={22} color="#94A3B8" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-slate-400">
            HOME
          </Text>
        </Pressable>
        <Pressable
          className="items-center"
          onPress={() => router.push("/(user)/alerts" as any)}
        >
          <Ionicons name="notifications-outline" size={22} color="#94A3B8" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-slate-400">
            ALERTS
          </Text>
        </Pressable>
        <Pressable
          className="items-center"
          onPress={() => router.push("/(user)/profile" as any)}
        >
          <Ionicons name="person-outline" size={22} color="#94A3B8" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-slate-400">
            PROFILE
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

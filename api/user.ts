import apiClient from "./client";
import {
  AdminRoute,
  BusLiveStatus,
  BusSearchResult,
  DriverStop,
  UserNotification,
  UserSubscription,
  UserSubscriptionRequest,
} from "./types";

const unwrap = <T>(data: T | { data?: T } | { result?: T }): T => {
  if (
    data &&
    typeof data === "object" &&
    "data" in (data as Record<string, unknown>)
  ) {
    return ((data as { data?: T }).data ?? data) as T;
  }

  if (
    data &&
    typeof data === "object" &&
    "result" in (data as Record<string, unknown>)
  ) {
    return ((data as { result?: T }).result ?? data) as T;
  }

  return data as T;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeStop = (stop: any): DriverStop | null => {
  const lat = toNumber(stop?.lat) ?? toNumber(stop?.latitude);
  const lng = toNumber(stop?.lng) ?? toNumber(stop?.longitude);

  if (lat == null || lng == null) {
    return null;
  }

  const sequence = toNumber(stop?.sequenceOrder) ?? toNumber(stop?.sequence);

  return {
    id: stop?.id ?? stop?._id,
    name: stop?.name,
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    sequenceOrder: sequence == null ? undefined : sequence,
  };
};

const normalizeSearchItem = (item: any): BusSearchResult | null => {
  const busId =
    item?.busId ??
    item?.id ??
    item?._id ??
    item?.bus?._id ??
    item?.bus?.id ??
    null;

  const numberPlate =
    item?.numberPlate ?? item?.plateNumber ?? item?.bus?.numberPlate ?? null;

  if (!busId || !numberPlate) {
    return null;
  }

  return {
    busId: String(busId),
    numberPlate: String(numberPlate),
    routeName: String(
      item?.routeName ?? item?.route?.name ?? item?.bus?.routeName ?? "Route",
    ),
    routeId: item?.routeId ?? item?.route?.id ?? item?.route?._id ?? undefined,
    isActive: Boolean(item?.isActive ?? item?.active ?? item?.isLive),
  };
};

const normalizeLive = (payload: any): BusLiveStatus => {
  const bus = payload?.bus ?? payload;
  const route = payload?.route ?? bus?.route ?? payload?.routeInfo ?? {};

  const currentLat =
    toNumber(payload?.currentLat) ??
    toNumber(bus?.currentLat) ??
    toNumber(payload?.lat) ??
    toNumber(bus?.lat) ??
    toNumber(payload?.currentLocation?.lat) ??
    toNumber(bus?.currentLocation?.lat) ??
    toNumber(payload?.currentLocation?.latitude) ??
    toNumber(bus?.currentLocation?.latitude) ??
    null;

  const currentLng =
    toNumber(payload?.currentLng) ??
    toNumber(bus?.currentLng) ??
    toNumber(payload?.lng) ??
    toNumber(bus?.lng) ??
    toNumber(payload?.currentLocation?.lng) ??
    toNumber(bus?.currentLocation?.lng) ??
    toNumber(payload?.currentLocation?.longitude) ??
    toNumber(bus?.currentLocation?.longitude) ??
    null;

  const routeStartLat =
    toNumber(route?.startLat) ??
    toNumber(route?.start?.lat) ??
    toNumber(route?.start?.latitude) ??
    null;

  const routeStartLng =
    toNumber(route?.startLng) ??
    toNumber(route?.start?.lng) ??
    toNumber(route?.start?.longitude) ??
    null;

  const routeEndLat =
    toNumber(route?.endLat) ??
    toNumber(route?.end?.lat) ??
    toNumber(route?.end?.latitude) ??
    null;

  const routeEndLng =
    toNumber(route?.endLng) ??
    toNumber(route?.end?.lng) ??
    toNumber(route?.end?.longitude) ??
    null;

  const rawRouteId =
    payload?.routeId ??
    route?.id ??
    route?._id ??
    payload?.route?.id ??
    payload?.route?._id ??
    payload?.bus?.routeId ??
    payload?.bus?.route?.id ??
    payload?.bus?.route?._id ??
    payload?.routeInfo?.id ??
    undefined;

  const rawStops = Array.isArray(payload?.stops)
    ? payload.stops
    : Array.isArray(route?.stops)
      ? route.stops
      : Array.isArray(payload?.routeStops)
        ? payload.routeStops
        : [];

  const normalizedStops = rawStops
    .map((stop: any) => normalizeStop(stop))
    .filter((stop: DriverStop | null): stop is DriverStop => Boolean(stop))
    .sort((a: DriverStop, b: DriverStop) => {
      const aOrder = a.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });

  return {
    busId: String(
      payload?.busId ?? bus?.id ?? bus?._id ?? payload?.id ?? payload?._id ?? "",
    ),
    numberPlate: String(
      bus?.numberPlate ??
      payload?.numberPlate ??
      payload?.plateNumber ??
      payload?.bus?.numberPlate ??
      "",
    ),
    routeName: String(
      route?.name ??
      payload?.routeName ??
      payload?.route?.name ??
      payload?.bus?.routeName ??
      "Route",
    ),
    routeId: rawRouteId ? String(rawRouteId) : undefined,
    // Prefer the stored route polyline (admin-authored, passes through all stops)
    // over any top-level field that may have been recomputed with traffic avoidance.
    encodedPolyline: String(
      route?.encodedPolyline ?? payload?.route?.encodedPolyline ?? payload?.encodedPolyline ?? "",
    ),
    routeStartLat,
    routeStartLng,
    routeEndLat,
    routeEndLng,
    stops: normalizedStops,
    currentLat,
    currentLng,
    nextStop: payload?.nextStop ?? payload?.nextStopName ?? null,
    estimatedArrival: payload?.estimatedArrival ?? payload?.eta ?? null,
    trackingStatus: bus?.trackingStatus ?? payload?.trackingStatus ?? null,
    lastUpdated: bus?.lastUpdated ?? payload?.lastUpdated ?? null,
    isActive: Boolean(payload?.isActive ?? payload?.active ?? true),
  };
};

const pickArray = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const directKeys = ["buses", "items", "docs", "rows", "results", "list"];
  for (const key of directKeys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
  }

  const nested = payload?.data ?? payload?.result ?? payload?.payload;
  if (nested && nested !== payload) {
    return pickArray(nested);
  }

  return [];
};

export const searchUserBuses = async (numberPlate: string) => {
  const normalized = numberPlate.trim().toUpperCase();

  const response = await apiClient.get<
    BusSearchResult[] | { data?: BusSearchResult[] }
  >("/api/user/buses/search", {
    params: {
      numberPlate: normalized,
      q: normalized,
      plate: normalized,
    },
  });

  const raw = response.data as any;
  const payload = unwrap<any>(raw);
  const list = pickArray(payload);

  const normalizedResults = list
    .map((item: any) => normalizeSearchItem(item))
    .filter((item: BusSearchResult | null): item is BusSearchResult =>
      Boolean(item),
    );

  return normalizedResults;
};

export const getUserBusLive = async (busId: string) => {
  const response = await apiClient.get<
    BusLiveStatus | { data?: BusLiveStatus }
  >(`/api/user/buses/${busId}/live`);

  const raw = response.data as any;
  const payload = unwrap<any>(raw);
  return normalizeLive(payload);
};

export const getAdminRouteById = async (routeId: string) => {
  const response = await apiClient.get<AdminRoute | { route?: AdminRoute }>(
    `/api/admin/routes/${routeId}`,
  );

  const raw = response.data as any;
  const payload = unwrap<any>(raw);
  const route = payload?.route ?? payload;

  return {
    id: String(route?.id ?? route?._id ?? routeId),
    name: String(route?.name ?? "Route"),
    encodedPolyline: String(route?.encodedPolyline ?? ""),
    totalDistanceMeters: Number(route?.totalDistanceMeters ?? 0),
    estimatedDurationSeconds: Number(route?.estimatedDurationSeconds ?? 0),
    isActive: Boolean(route?.isActive ?? true),
    createdAt: route?.createdAt,
    updatedAt: route?.updatedAt,
  } as AdminRoute;
};

export const createUserSubscription = async (
  payload: UserSubscriptionRequest,
) => {
  const response = await apiClient.post<
    UserSubscription | { data?: UserSubscription }
  >("/api/user/subscriptions", payload);
  return unwrap<UserSubscription>(response.data as any);
};

export const getUserSubscriptions = async () => {
  const response = await apiClient.get<
    UserSubscription[] | { data?: UserSubscription[] }
  >("/api/user/subscriptions");
  const payload = unwrap<UserSubscription[]>(response.data as any);
  return Array.isArray(payload) ? payload : [];
};

export const deleteUserSubscription = async (subscriptionId: string) => {
  return apiClient.delete(`/api/user/subscriptions/${subscriptionId}`);
};

export const patchUserFcmToken = async (fcmToken: string) => {
  return apiClient.patch("/api/user/profile/fcm-token", { fcmToken });
};

export const getUserNotifications = async () => {
  const response = await apiClient.get<
    UserNotification[] | { data?: UserNotification[] }
  >("/api/user/notifications");
  const payload = unwrap<UserNotification[]>(response.data as any);
  return Array.isArray(payload) ? payload : [];
};

export const markUserNotificationRead = async (notificationId: string) => {
  return apiClient.patch(`/api/user/notifications/${notificationId}/read`);
};

import apiClient, { assertAxiosSuccess, logApiError } from "./client";
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
    distanceFromCurrentMeters:
      toNumber(stop?.distanceFromCurrentMeters) ??
      toNumber(stop?.distanceMeters) ??
      undefined,
    distanceFromCurrentText:
      stop?.distanceFromCurrentText ?? stop?.distanceText ?? undefined,
    etaFromCurrentSeconds:
      toNumber(stop?.etaFromCurrentSeconds) ??
      toNumber(stop?.etaSeconds) ??
      undefined,
    etaFromCurrentText: stop?.etaFromCurrentText ?? stop?.etaText ?? undefined,
    segmentDistanceMeters:
      toNumber(stop?.segmentDistanceMeters) ??
      toNumber(stop?.segmentMeters) ??
      undefined,
    segmentDistanceText:
      stop?.segmentDistanceText ?? stop?.segmentDistance ?? undefined,
    segmentEtaSeconds:
      toNumber(stop?.segmentEtaSeconds) ??
      toNumber(stop?.segmentSeconds) ??
      undefined,
    segmentEtaText: stop?.segmentEtaText ?? stop?.segmentEta ?? undefined,
    isPassed:
      typeof stop?.isPassed === "boolean"
        ? stop.isPassed
        : typeof stop?.passed === "boolean"
          ? stop.passed
          : undefined,
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

  const rawTripStatus =
    item?.trip?.status ??
    item?.tripStatus ??
    item?.bus?.tripStatus ??
    null;

  const normalizedTripStatus =
    typeof rawTripStatus === "string" && rawTripStatus.trim().length
      ? rawTripStatus.trim().toUpperCase()
      : null;

  const lastUpdatedRaw =
    item?.lastUpdated ??
    item?.updatedAt ??
    item?.trip?.updatedAt ??
    item?.trip?.lastUpdated ??
    item?.bus?.lastUpdated ??
    null;

  return {
    busId: String(busId),
    numberPlate: String(numberPlate),
    routeName: String(
      item?.routeName ?? item?.route?.name ?? item?.bus?.routeName ?? "Route",
    ),
    routeId: item?.routeId ?? item?.route?.id ?? item?.route?._id ?? undefined,
    tripStatus: normalizedTripStatus,
    lastUpdated:
      typeof lastUpdatedRaw === "string" && lastUpdatedRaw.trim().length
        ? lastUpdatedRaw
        : null,
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
      payload?.busId ??
      bus?.id ??
      bus?._id ??
      payload?.id ??
      payload?._id ??
      "",
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
    trip: {
      id: String(
        payload?.trip?.id ??
        payload?.trip?._id ??
        bus?.trip?.id ??
        bus?.trip?._id ??
        "",
      ) || undefined,
      status: String(
        payload?.trip?.status ??
        bus?.trip?.status ??
        bus?.tripStatus ??
        payload?.tripStatus ??
        "",
      ) || undefined,
    },
    // Prefer the stored route polyline (admin-authored, passes through all stops)
    // over any top-level field that may have been recomputed with traffic avoidance.
    encodedPolyline: String(
      route?.encodedPolyline ??
      payload?.route?.encodedPolyline ??
      payload?.encodedPolyline ??
      "",
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
    fleetStatus: bus?.fleetStatus ?? payload?.fleetStatus ?? null,
    tripStatus: bus?.tripStatus ?? payload?.tripStatus ?? null,
    status: bus?.status ?? payload?.status ?? null,
    trackingStatus: bus?.trackingStatus ?? payload?.trackingStatus ?? null,
    lastUpdated: bus?.lastUpdated ?? payload?.lastUpdated ?? null,
    totalDistanceMeters:
      toNumber(route?.totalDistanceMeters) ??
      toNumber(payload?.totalDistanceMeters) ??
      undefined,
    estimatedDurationSeconds:
      toNumber(route?.estimatedDurationSeconds) ??
      toNumber(payload?.estimatedDurationSeconds) ??
      undefined,
    totalDistanceText:
      route?.totalDistanceText ?? payload?.totalDistanceText ?? undefined,
    estimatedDurationText:
      route?.estimatedDurationText ??
      payload?.estimatedDurationText ??
      undefined,
    etaToDestinationSeconds:
      toNumber(route?.etaToDestinationSeconds) ??
      toNumber(payload?.etaToDestinationSeconds) ??
      undefined,
    etaToDestinationText:
      route?.etaToDestinationText ?? payload?.etaToDestinationText ?? undefined,
    distanceToDestinationMeters:
      toNumber(route?.distanceToDestinationMeters) ??
      toNumber(payload?.distanceToDestinationMeters) ??
      undefined,
    distanceToDestinationText:
      route?.distanceToDestinationText ??
      payload?.distanceToDestinationText ??
      undefined,
    isActive: Boolean(payload?.isActive ?? payload?.active ?? true),
  };
};

const pickArray = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const directKeys = [
    "buses",
    "items",
    "docs",
    "rows",
    "results",
    "list",
    "subscriptions",
    "notifications",
  ];
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

const asObject = (value: unknown): Record<string, any> => {
  if (value && typeof value === "object") {
    return value as Record<string, any>;
  }

  return {};
};

const withApiGuard = async <T>(scope: string, handler: () => Promise<T>): Promise<T> => {
  try {
    return await handler();
  } catch (error) {
    throw logApiError(scope, error);
  }
};

export const searchUserBuses = async (numberPlate: string) => {
  return withApiGuard("searchUserBuses", async () => {
    const normalized = String(numberPlate ?? "").trim().toUpperCase();
    if (!normalized) {
      return [];
    }

    const response = await apiClient.get<
      BusSearchResult[] | { data?: BusSearchResult[] }
    >("/api/user/buses/search", {
      params: {
        numberPlate: normalized,
        q: normalized,
        plate: normalized,
      },
    });
    const safeResponse = assertAxiosSuccess(response, "searchUserBuses");

    const raw = safeResponse.data as any;
    const payload = unwrap<any>(raw);
    const list = pickArray(payload);

    const normalizedResults = list
      .map((item: any) => normalizeSearchItem(item))
      .filter((item: BusSearchResult | null): item is BusSearchResult =>
        Boolean(item),
      );

    return normalizedResults;
  });
};

export const getUserBusLive = async (busId: string) => {
  return withApiGuard("getUserBusLive", async () => {
    const normalizedBusId = String(busId ?? "").trim();
    if (!normalizedBusId) {
      throw new Error("Bus ID is required to fetch live status");
    }

    const response = await apiClient.get<
      BusLiveStatus | { data?: BusLiveStatus }
    >(`/api/user/buses/${normalizedBusId}/live`);
    const safeResponse = assertAxiosSuccess(response, "getUserBusLive");

    const raw = safeResponse.data as any;
    const payload = unwrap<any>(raw);
    return normalizeLive(payload);
  });
};

export const getAdminRouteById = async (routeId: string) => {
  return withApiGuard("getAdminRouteById", async () => {
    const normalizedRouteId = String(routeId ?? "").trim();
    if (!normalizedRouteId) {
      throw new Error("Route ID is required");
    }

    const response = await apiClient.get<AdminRoute | { route?: AdminRoute }>(
      `/api/admin/routes/${normalizedRouteId}`,
    );
    const safeResponse = assertAxiosSuccess(response, "getAdminRouteById");

    const raw = safeResponse.data as any;
    const payload = unwrap<any>(raw);
    const route = asObject(payload?.route ?? payload);

    return {
      id: String(route?.id ?? route?._id ?? normalizedRouteId),
      name: String(route?.name ?? "Route"),
      encodedPolyline: String(route?.encodedPolyline ?? ""),
      totalDistanceMeters: Number(route?.totalDistanceMeters ?? 0),
      estimatedDurationSeconds: Number(route?.estimatedDurationSeconds ?? 0),
      isActive: Boolean(route?.isActive ?? true),
      createdAt: route?.createdAt,
      updatedAt: route?.updatedAt,
    } as AdminRoute;
  });
};

export const createUserSubscription = async (
  payload: UserSubscriptionRequest,
) => {
  return withApiGuard("createUserSubscription", async () => {
    const response = await apiClient.post<
      UserSubscription | { data?: UserSubscription }
    >("/api/user/subscriptions", payload);
    const safeResponse = assertAxiosSuccess(response, "createUserSubscription");
    return unwrap<UserSubscription>(safeResponse.data as any);
  });
};

export const getUserSubscriptions = async () => {
  return withApiGuard("getUserSubscriptions", async () => {
    const response = await apiClient.get<
      UserSubscription[] | { data?: UserSubscription[] }
    >("/api/user/subscriptions");
    const safeResponse = assertAxiosSuccess(response, "getUserSubscriptions");
    const payload = unwrap<any>(safeResponse.data as any);
    const list = pickArray(payload);

    return list.filter(
      (item): item is UserSubscription => Boolean(item && typeof item === "object"),
    );
  });
};

export const deleteUserSubscription = async (subscriptionId: string) => {
  return withApiGuard("deleteUserSubscription", async () => {
    const normalizedId = String(subscriptionId ?? "").trim();
    if (!normalizedId) {
      throw new Error("Subscription ID is required");
    }

    const response = await apiClient.delete(`/api/user/subscriptions/${normalizedId}`);
    return assertAxiosSuccess(response, "deleteUserSubscription");
  });
};

export const patchUserFcmToken = async (fcmToken: string) => {
  return withApiGuard("patchUserFcmToken", async () => {
    const normalizedToken = String(fcmToken ?? "").trim();
    if (!normalizedToken) {
      throw new Error("FCM token is required");
    }

    const response = await apiClient.patch("/api/user/profile/fcm-token", {
      fcmToken: normalizedToken,
    });
    return assertAxiosSuccess(response, "patchUserFcmToken");
  });
};

export const getUserNotifications = async () => {
  return withApiGuard("getUserNotifications", async () => {
    const response = await apiClient.get<
      UserNotification[] | { data?: UserNotification[] }
    >("/api/user/notifications");
    const safeResponse = assertAxiosSuccess(response, "getUserNotifications");
    const payload = unwrap<any>(safeResponse.data as any);
    const list = pickArray(payload);

    return list.filter(
      (item): item is UserNotification => Boolean(item && typeof item === "object"),
    );
  });
};

export const markUserNotificationRead = async (notificationId: string) => {
  return withApiGuard("markUserNotificationRead", async () => {
    const normalizedId = String(notificationId ?? "").trim();
    if (!normalizedId) {
      throw new Error("Notification ID is required");
    }

    const response = await apiClient.patch(
      `/api/user/notifications/${normalizedId}/read`,
    );
    return assertAxiosSuccess(response, "markUserNotificationRead");
  });
};

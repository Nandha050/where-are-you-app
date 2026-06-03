import { withSentrySpan } from "../monitoring/sentry";
import apiClient, { assertAxiosSuccess, logApiError } from "./client";
import {
  AdminRoute,
  BusLiveStatus,
  BusSearchResult,
  DriverStop,
  TrackingBus,
  TrackingDriver,
  TrackingRoute,
  TrackingStop,
  TrackingTrip,
  UserNotification,
  UserSubscription,
  UserSubscriptionRequest,
  UserTrackingActiveTripResponse,
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

const toNonEmptyString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length) {
        return trimmed;
      }
    }
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
    arrivalClockTimeText:
      stop?.arrivalClockTimeText ?? stop?.arrivalTimeText ?? undefined,
    departedClockTimeText:
      stop?.departedClockTimeText ?? stop?.departedTimeText ?? undefined,
    status:
      stop?.status === "passed" ||
        stop?.status === "current" ||
        stop?.status === "upcoming"
        ? stop.status
        : undefined,
    leftSubLabel: stop?.leftSubLabel ?? undefined,
    rightPrimaryLabel: stop?.rightPrimaryLabel ?? undefined,
    rightSecondaryLabel: stop?.rightSecondaryLabel ?? undefined,
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
    item?.trip?.status ?? item?.tripStatus ?? item?.bus?.tripStatus ?? null;

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

  const routeStartNameRaw = toNonEmptyString(
    route?.startName,
    route?.start?.name,
    route?.sourceName,
    route?.originName,
    route?.startPointName,
    route?.startLocationName,
    payload?.routeStartName,
    payload?.startName,
    payload?.sourceName,
    payload?.originName,
    payload?.startPointName,
    payload?.startLocationName,
    payload?.route?.startName,
    payload?.route?.start?.name,
    payload?.route?.sourceName,
    payload?.route?.originName,
    payload?.route?.startPointName,
    payload?.route?.startLocationName,
  );

  const routeEndNameRaw = toNonEmptyString(
    route?.endName,
    route?.end?.name,
    route?.destinationName,
    route?.endPointName,
    route?.endLocationName,
    payload?.routeEndName,
    payload?.endName,
    payload?.destinationName,
    payload?.endPointName,
    payload?.endLocationName,
    payload?.route?.endName,
    payload?.route?.end?.name,
    payload?.route?.destinationName,
    payload?.route?.endPointName,
    payload?.route?.endLocationName,
  );

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

  const fallbackStartName =
    toNonEmptyString(normalizedStops[0]?.name, rawStops[0]?.name) ?? null;
  const fallbackEndName =
    toNonEmptyString(
      normalizedStops[normalizedStops.length - 1]?.name,
      rawStops[rawStops.length - 1]?.name,
    ) ?? null;

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
      id:
        String(
          payload?.trip?.id ??
          payload?.trip?._id ??
          bus?.trip?.id ??
          bus?.trip?._id ??
          "",
        ) || undefined,
      status:
        String(
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
    routeStartName:
      toNonEmptyString(routeStartNameRaw, fallbackStartName) ?? null,
    routeEndLat,
    routeEndLng,
    routeEndName: toNonEmptyString(routeEndNameRaw, fallbackEndName) ?? null,
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

const toTrackingNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toTrackingString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length) {
        return trimmed;
      }
    }
  }

  return null;
};

const normalizeTrackingStop = (stop: any): TrackingStop | null => {
  const latitude = toTrackingNumber(stop?.latitude ?? stop?.lat);
  const longitude = toTrackingNumber(stop?.longitude ?? stop?.lng);

  if (latitude == null || longitude == null) {
    return null;
  }

  const id = toTrackingString(stop?.id, stop?._id);
  const name = toTrackingString(stop?.name);

  if (!id || !name) {
    return null;
  }

  const sequenceOrder = toTrackingNumber(stop?.sequenceOrder ?? stop?.sequence) ?? 0;

  return {
    id,
    name,
    latitude,
    longitude,
    sequenceOrder,
    radiusMeters:
      toTrackingNumber(stop?.radiusMeters ?? stop?.radius) ?? null,
  };
};

const normalizeTrackingRoute = (route: any): TrackingRoute | null => {
  if (!route || typeof route !== "object") {
    return null;
  }

  const id = toTrackingString(route?.id, route?._id);
  const name = toTrackingString(route?.name);
  const encodedPolyline = toTrackingString(route?.encodedPolyline) ?? "";

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    startName: toTrackingString(route?.startName, route?.sourceName, route?.originName),
    endName: toTrackingString(route?.endName, route?.destinationName),
    startLat: toTrackingNumber(route?.startLat ?? route?.start?.lat ?? route?.start?.latitude),
    startLng: toTrackingNumber(route?.startLng ?? route?.start?.lng ?? route?.start?.longitude),
    endLat: toTrackingNumber(route?.endLat ?? route?.end?.lat ?? route?.end?.latitude),
    endLng: toTrackingNumber(route?.endLng ?? route?.end?.lng ?? route?.end?.longitude),
    encodedPolyline,
    totalDistanceMeters: toTrackingNumber(route?.totalDistanceMeters) ?? undefined,
    estimatedDurationSeconds: toTrackingNumber(route?.estimatedDurationSeconds) ?? undefined,
  };
};

const normalizeTrackingTrip = (trip: any): TrackingTrip | null => {
  if (!trip || typeof trip !== "object") {
    return null;
  }

  const id = toTrackingString(trip?.id, trip?._id);
  const status = toTrackingString(trip?.status) ?? "PENDING";

  if (!id) {
    return null;
  }

  const latitude = toTrackingNumber(trip?.currentLocation?.latitude ?? trip?.currentLocation?.lat);
  const longitude = toTrackingNumber(trip?.currentLocation?.longitude ?? trip?.currentLocation?.lng);

  return {
    id,
    status,
    startedAt: toTrackingString(trip?.startedAt) ?? null,
    currentLocation:
      latitude != null && longitude != null
        ? { latitude, longitude }
        : null,
    updatedAt: toTrackingString(trip?.updatedAt, trip?.lastUpdated) ?? null,
  };
};

const normalizeTrackingBus = (bus: any): TrackingBus | null => {
  if (!bus || typeof bus !== "object") {
    return null;
  }

  const id = toTrackingString(bus?.id, bus?._id);
  const numberPlate = toTrackingString(bus?.numberPlate, bus?.plateNumber);

  if (!id || !numberPlate) {
    return null;
  }

  return {
    id,
    numberPlate,
    status: toTrackingString(bus?.status, bus?.fleetStatus, bus?.trackingStatus) ?? null,
  };
};

const normalizeTrackingDriver = (driver: any): TrackingDriver | null => {
  if (!driver || typeof driver !== "object") {
    return null;
  }

  const id = toTrackingString(driver?.id, driver?._id);
  const name = toTrackingString(driver?.name, driver?.fullName);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    phone: toTrackingString(driver?.phone, driver?.phoneNumber) ?? null,
  };
};

const normalizeTrackingResponse = (payload: any): UserTrackingActiveTripResponse => {
  const data = asObject(payload?.data ?? payload?.result ?? payload);
  const route = normalizeTrackingRoute(data?.route ?? payload?.route);
  const stopsSource = Array.isArray(data?.stops)
    ? data.stops
    : Array.isArray(payload?.stops)
      ? payload.stops
      : [];
  const stops = stopsSource
    .map((stop: any) => normalizeTrackingStop(stop))
    .filter((stop: TrackingStop | null): stop is TrackingStop => Boolean(stop))
    .sort((a: TrackingStop, b: TrackingStop) => a.sequenceOrder - b.sequenceOrder);

  return {
    success: Boolean(payload?.success ?? data?.success ?? true),
    message: toTrackingString(payload?.message, data?.message) ?? undefined,
    data: {
      route,
      stops: stops.length ? stops : null,
      trip: normalizeTrackingTrip(data?.trip ?? payload?.trip),
      bus: normalizeTrackingBus(data?.bus ?? payload?.bus),
      driver: normalizeTrackingDriver(data?.driver ?? payload?.driver),
    },
  };
};

const withApiGuard = async <T>(
  scope: string,
  handler: () => Promise<T>,
): Promise<T> => {
  return withSentrySpan(
    {
      op: "http.client",
      name: `api.user:${scope}`,
    },
    async () => {
      try {
        return await handler();
      } catch (error) {
        throw logApiError(scope, error);
      }
    },
  );
};

export const searchUserBuses = async (numberPlate: string) => {
  return withApiGuard("searchUserBuses", async () => {
    const normalized = String(numberPlate ?? "")
      .trim()
      .toUpperCase();
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

export const getUserActiveTrip = async () => {
  return withApiGuard("getUserActiveTrip", async () => {
    const response = await apiClient.get<UserTrackingActiveTripResponse | { data?: UserTrackingActiveTripResponse }>(
      "/api/user/tracking/active-trip",
    );
    const safeResponse = assertAxiosSuccess(response, "getUserActiveTrip");
    const raw = safeResponse.data as any;
    const payload = unwrap<any>(raw);

    return normalizeTrackingResponse(payload);
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

    return list.filter((item): item is UserSubscription =>
      Boolean(item && typeof item === "object"),
    );
  });
};

export const deleteUserSubscription = async (subscriptionId: string) => {
  return withApiGuard("deleteUserSubscription", async () => {
    const normalizedId = String(subscriptionId ?? "").trim();
    if (!normalizedId) {
      throw new Error("Subscription ID is required");
    }

    const response = await apiClient.delete(
      `/api/user/subscriptions/${normalizedId}`,
    );
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

    return list.filter((item): item is UserNotification =>
      Boolean(item && typeof item === "object"),
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

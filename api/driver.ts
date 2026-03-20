import { withSentrySpan } from "../monitoring/sentry";
import apiClient, { assertAxiosSuccess, logApiError } from "./client";
import {
    ActiveTrip,
    DriverBus,
    DriverMeResponse,
    DriverMyRouteResponse,
    DriverProfile,
    DriverRoute,
    DriverStop,
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

const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length) {
            return value.trim();
        }
    }

    return undefined;
};

const pickNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }

    return undefined;
};

const normalizeBus = (raw: any): DriverBus | null => {
    const id = pickString(raw?.id, raw?._id);
    const numberPlate = pickString(raw?.numberPlate, raw?.plateNumber);

    if (!id || !numberPlate) {
        return null;
    }

    return {
        id,
        numberPlate,
    };
};

const normalizeRoute = (raw: any): DriverRoute | null => {
    const id = pickString(raw?.id, raw?._id);
    const name = pickString(raw?.name);
    const encodedPolyline =
        pickString(
            raw?.encodedPolyline,
            raw?.polyline,
            raw?.overviewPolyline,
            raw?.geometry?.encodedPolyline,
        ) ?? "";

    if (!id || !name) {
        return null;
    }

    return {
        id,
        name,
        encodedPolyline,
        totalDistanceMeters: pickNumber(raw?.totalDistanceMeters),
        estimatedDurationSeconds: pickNumber(raw?.estimatedDurationSeconds),
        totalDistanceText:
            typeof raw?.totalDistanceText === "string" ? raw.totalDistanceText : undefined,
        estimatedDurationText:
            typeof raw?.estimatedDurationText === "string"
                ? raw.estimatedDurationText
                : undefined,
        etaToDestinationSeconds: pickNumber(raw?.etaToDestinationSeconds),
        etaToDestinationText:
            typeof raw?.etaToDestinationText === "string"
                ? raw.etaToDestinationText
                : undefined,
        distanceToDestinationMeters: pickNumber(raw?.distanceToDestinationMeters),
        distanceToDestinationText:
            typeof raw?.distanceToDestinationText === "string"
                ? raw.distanceToDestinationText
                : undefined,
        averageSpeedKmph: pickNumber(raw?.averageSpeedKmph),
        isActive: Boolean(raw?.isActive ?? true),
    };
};

const normalizeStop = (raw: any): DriverStop | null => {
    const lat = pickNumber(
        raw?.lat,
        raw?.latitude,
        raw?.location?.lat,
        raw?.location?.latitude,
        raw?.position?.lat,
        raw?.position?.latitude,
    );
    const lng = pickNumber(
        raw?.lng,
        raw?.longitude,
        raw?.location?.lng,
        raw?.location?.longitude,
        raw?.position?.lng,
        raw?.position?.longitude,
    );

    if (lat == null || lng == null) {
        return null;
    }

    return {
        id: pickString(raw?.id, raw?._id),
        name: pickString(raw?.name),
        lat,
        lng,
        latitude: lat,
        longitude: lng,
        sequenceOrder: pickNumber(raw?.sequenceOrder, raw?.sequence),
        distanceFromCurrentMeters: pickNumber(raw?.distanceFromCurrentMeters),
        distanceFromCurrentText: pickString(raw?.distanceFromCurrentText),
        etaFromCurrentSeconds: pickNumber(raw?.etaFromCurrentSeconds),
        etaFromCurrentText: pickString(raw?.etaFromCurrentText),
        segmentDistanceMeters: pickNumber(raw?.segmentDistanceMeters),
        segmentDistanceText: pickString(raw?.segmentDistanceText),
        segmentEtaSeconds: pickNumber(raw?.segmentEtaSeconds),
        segmentEtaText: pickString(raw?.segmentEtaText),
        isPassed:
            typeof raw?.isPassed === "boolean"
                ? raw.isPassed
                : undefined,
    };
};

const normalizeTrip = (raw: any): ActiveTrip | null => {
    const id = pickString(raw?.id, raw?._id);
    const status = pickString(raw?.status, raw?.tripStatus)?.toUpperCase();

    if (!id || !status) {
        return null;
    }

    return {
        id,
        status,
        busId: pickString(raw?.busId, raw?.bus?.id, raw?.bus?._id),
        routeId: pickString(raw?.routeId, raw?.route?.id, raw?.route?._id),
        startedAt: pickString(raw?.startedAt),
        endedAt: pickString(raw?.endedAt),
        updatedAt: pickString(raw?.updatedAt),
    };
};

const asObject = (value: unknown): Record<string, any> => {
    if (value && typeof value === "object") {
        return value as Record<string, any>;
    }

    return {};
};

const withApiGuard = async <T>(scope: string, handler: () => Promise<T>): Promise<T> => {
    return withSentrySpan(
        {
            op: "http.client",
            name: `api.driver:${scope}`,
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

export type DriverMeSnapshot = {
    driver: DriverProfile | null;
    bus: DriverBus | null;
    route: DriverRoute | null;
    stops: DriverStop[];
};

export type DriverRouteSnapshot = {
    bus: DriverBus | null;
    route: DriverRoute | null;
    stops: DriverStop[];
};

export const getDriverMe = async (): Promise<DriverMeSnapshot> => {
    return withApiGuard("getDriverMe", async () => {
        const response = await apiClient.get<DriverMeResponse | { data?: DriverMeResponse }>(
            "/api/driver/me",
        );
        const safeResponse = assertAxiosSuccess(response, "getDriverMe");

        const payload = unwrap<any>(safeResponse.data as any);
        const source = asObject(payload?.data ?? payload);

        const driverSource = asObject(source?.driver ?? source?.user ?? source);
        const driver = pickString(driverSource?.id, driverSource?._id)
            ? {
                id: pickString(driverSource?.id, driverSource?._id) as string,
                name: pickString(driverSource?.name, driverSource?.fullName) ?? "Driver",
                role: pickString(driverSource?.role) ?? "driver",
            }
            : null;

        const bus = normalizeBus(source?.bus ?? source?.assignment?.bus);
        const route = normalizeRoute(source?.route ?? source?.assignment?.route);

        const rawStops = Array.isArray(source?.stops)
            ? source.stops
            : Array.isArray(source?.route?.stops)
                ? source.route.stops
                : [];

        const stops = rawStops
            .map((stop: any) => normalizeStop(stop))
            .filter((stop: DriverStop | null): stop is DriverStop => Boolean(stop));

        return {
            driver,
            bus,
            route,
            stops,
        };
    });
};

export const getDriverMyRoute = async (): Promise<DriverRouteSnapshot | null> => {
    return withApiGuard("getDriverMyRoute", async () => {
        try {
            const response = await apiClient.get<
                DriverMyRouteResponse | { data?: DriverMyRouteResponse }
            >("/api/driver/my-route");
            const safeResponse = assertAxiosSuccess(response, "getDriverMyRoute");

            const payload = unwrap<any>(safeResponse.data as any);
            const source = asObject(payload?.data ?? payload);

            const bus = normalizeBus(source?.bus ?? source?.assignment?.bus);
            const route = normalizeRoute(source?.route ?? source?.assignment?.route);

            const rawStops = Array.isArray(source?.stops)
                ? source.stops
                : Array.isArray(source?.route?.stops)
                    ? source.route.stops
                    : [];

            const stops = rawStops
                .map((stop: any) => normalizeStop(stop))
                .filter((stop: DriverStop | null): stop is DriverStop => Boolean(stop));

            return {
                bus,
                route,
                stops,
            };
        } catch (error: any) {
            if (error?.response?.status === 404) {
                return null;
            }

            throw error;
        }
    });
};

export const getActiveTrip = async (): Promise<ActiveTrip | null> => {
    return withApiGuard("getActiveTrip", async () => {
        try {
            const response = await apiClient.get<ActiveTrip | { data?: ActiveTrip }>(
                "/api/trip/active",
            );
            const safeResponse = assertAxiosSuccess(response, "getActiveTrip");

            const payload = unwrap<any>(safeResponse.data as any);
            return normalizeTrip(payload?.trip ?? payload) ?? null;
        } catch (error: any) {
            if (error?.response?.status === 404) {
                return null;
            }

            throw error;
        }
    });
};

export const startTrip = async (): Promise<ActiveTrip | null> => {
    return withApiGuard("startTrip", async () => {
        const response = await apiClient.post<ActiveTrip | { data?: ActiveTrip }>(
            "/api/trip/start",
            {},
        );
        const safeResponse = assertAxiosSuccess(response, "startTrip");

        const payload = unwrap<any>(safeResponse.data as any);
        return normalizeTrip(payload?.trip ?? payload);
    });
};

export const stopTrip = async (): Promise<ActiveTrip | null> => {
    return withApiGuard("stopTrip", async () => {
        const response = await apiClient.post<ActiveTrip | { data?: ActiveTrip }>(
            "/api/trip/stop",
            {},
        );
        const safeResponse = assertAxiosSuccess(response, "stopTrip");

        const payload = unwrap<any>(safeResponse.data as any);
        return normalizeTrip(payload?.trip ?? payload);
    });
};

export const postMyLocation = async (payload: {
    latitude: number;
    longitude: number;
    speed: number;
    timestamp: string;
}): Promise<{ skipped: boolean }> => {
    return withApiGuard("postMyLocation", async () => {
        const response = await apiClient.post<any>("/api/tracking/me/location", payload);
        const safeResponse = assertAxiosSuccess(response, "postMyLocation");
        const body = unwrap<any>(safeResponse.data as any);

        return {
            skipped: Boolean(body?.skipped ?? body?.throttled),
        };
    });
};

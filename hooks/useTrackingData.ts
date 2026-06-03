import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../api/client";
import { TrackingBus, TrackingDriver, TrackingRoute, TrackingStop, TrackingTrip } from "../api/types";
import { getUserActiveTrip } from "../api/user";
import socketService, { SocketConnectionStatus } from "../sockets/socketService";
import { useAuth } from "./useAuth";

type Coord = { latitude: number; longitude: number };

type TrackingLocationUpdate = {
    tripId?: string | number;
    busId?: string | number;
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
    currentLat?: number | string;
    currentLng?: number | string;
    speed?: number | string;
    speedKmph?: number | string;
    status?: string;
    timestamp?: number | string;
    updatedAt?: string;
    etaToDestinationSeconds?: number | string;
    etaToDestinationText?: string;
    currentStopId?: string;
    nextStopId?: string;
};

const LOCATION_UPDATE_EVENTS = ["busLocationUpdate", "location:updated", "trip:location-update"] as const;

export type TrackingDataState = {
    route: TrackingRoute | null;
    stops: TrackingStop[] | null;
    trip: TrackingTrip | null;
    bus: TrackingBus | null;
    driver: TrackingDriver | null;
    currentLocation: Coord | null;
    currentStopId: string | null;
    nextStopId: string | null;
    etaToDestinationSeconds: number | null;
    etaToDestinationText: string | null;
    speedKmph: number | null;
    connectionStatus: SocketConnectionStatus;
    lastUpdatedAt: string | null;
    loading: boolean;
    error: string | null;
};

type TrackingDataHook = TrackingDataState & {
    hasRouteAssigned: boolean;
    hasActiveTrip: boolean;
    refresh: () => void;
};

const INITIAL_STATE: TrackingDataState = {
    route: null,
    stops: null,
    trip: null,
    bus: null,
    driver: null,
    currentLocation: null,
    currentStopId: null,
    nextStopId: null,
    etaToDestinationSeconds: null,
    etaToDestinationText: null,
    speedKmph: null,
    connectionStatus: socketService.getConnectionStatus(),
    lastUpdatedAt: null,
    loading: true,
    error: null,
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

const toPrimitive = (value: unknown): string | number | undefined => {
    if (typeof value === "string" || typeof value === "number") {
        return value;
    }

    return undefined;
};

const toTimestampMs = (value: unknown): number | null => {
    const numeric = toNumber(value);
    if (numeric != null) {
        return numeric;
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    if (value instanceof Date) {
        const parsed = value.getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const toString = (...values: unknown[]): string | null => {
    for (const value of values) {
        if (typeof value === "string" || typeof value === "number") {
            const trimmed = String(value).trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
    }

    return null;
};

const isTerminalTripStatus = (status: unknown): boolean => {
    const normalized = toString(status)?.toUpperCase();
    return normalized === "COMPLETED" || normalized === "CANCELLED";
};

const normalizeLocationUpdate = (payload: unknown): TrackingLocationUpdate | null => {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const event = payload as Record<string, unknown> & {
        trip?: { id?: unknown };
        bus?: { id?: unknown; _id?: unknown };
        location?: {
            lat?: unknown;
            lng?: unknown;
            latitude?: unknown;
            longitude?: unknown;
            speed?: unknown;
        };
    };

    const updatedAt = event.updatedAt;
    const updatedAtTimestamp = toTimestampMs(updatedAt);

    const latitude =
        toNumber(event.currentLat) ??
        toNumber(event.lat) ??
        toNumber(event.latitude) ??
        toNumber(event.location?.lat) ??
        toNumber(event.location?.latitude) ??
        null;

    const longitude =
        toNumber(event.currentLng) ??
        toNumber(event.lng) ??
        toNumber(event.longitude) ??
        toNumber(event.location?.lng) ??
        toNumber(event.location?.longitude) ??
        null;

    const timestamp =
        toTimestampMs(event.timestamp) ??
        updatedAtTimestamp;

    if (latitude == null || longitude == null || timestamp == null) {
        return null;
    }

    const tripId = toPrimitive(event.tripId) ?? toPrimitive(event.trip?.id);
    const busId = toPrimitive(event.busId) ?? toPrimitive(event.bus?.id) ?? toPrimitive(event.bus?._id);
    const speed =
        toPrimitive(event.speed) ??
        toPrimitive(event.speedKmph) ??
        toPrimitive(event.location?.speed);

    const status = typeof event.status === "string" ? event.status : undefined;
    const etaToDestinationSeconds =
        typeof event.etaToDestinationSeconds === "string" || typeof event.etaToDestinationSeconds === "number"
            ? event.etaToDestinationSeconds
            : undefined;
    const etaToDestinationText =
        typeof event.etaToDestinationText === "string" ? event.etaToDestinationText : undefined;
    const currentStopId = typeof event.currentStopId === "string" ? event.currentStopId : undefined;
    const nextStopId = typeof event.nextStopId === "string" ? event.nextStopId : undefined;

    return {
        tripId,
        busId,
        lat: latitude,
        lng: longitude,
        speed,
        status,
        timestamp,
        updatedAt:
            typeof updatedAt === "string"
                ? updatedAt
                : updatedAt instanceof Date
                    ? updatedAt.toISOString()
                    : undefined,
        etaToDestinationSeconds,
        etaToDestinationText,
        currentStopId,
        nextStopId,
    };
};

const normalizeErrorMessage = (error: unknown): string => {
    if (error && typeof error === "object") {
        const maybeAxiosError = error as { response?: { data?: { message?: unknown } }; message?: unknown };
        const serverMessage = maybeAxiosError.response?.data?.message;
        if (typeof serverMessage === "string" && serverMessage.trim().length > 0) {
            return serverMessage;
        }

        if (typeof maybeAxiosError.message === "string" && maybeAxiosError.message.trim().length > 0) {
            return maybeAxiosError.message;
        }
    }

    return "Failed to load active trip";
};

const normalizeStops = (stops: TrackingStop[] | null): TrackingStop[] | null => {
    if (!stops || !stops.length) {
        return null;
    }

    return [...stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
};

export function useTrackingData(): TrackingDataHook {
    const { token } = useAuth();
    const [state, setState] = useState<TrackingDataState>(INITIAL_STATE);
    const requestIdRef = useRef(0);
    const lastLocationTimestampRef = useRef(0);

    const refresh = useCallback(() => {
        requestIdRef.current += 1;
        const currentRequestId = requestIdRef.current;

        setState((previous) => ({
            ...previous,
            loading: previous.route == null && previous.trip == null,
            error: null,
        }));

        void (async () => {
            try {
                const response = await getUserActiveTrip();

                if (currentRequestId !== requestIdRef.current) {
                    return;
                }

                lastLocationTimestampRef.current = 0;

                setState((previous) => ({
                    ...previous,
                    route: response.data.route,
                    stops: normalizeStops(response.data.stops),
                    trip: response.data.trip,
                    bus: response.data.bus,
                    driver: response.data.driver,
                    currentLocation: response.data.trip?.currentLocation ?? null,
                    currentStopId: null,
                    nextStopId: null,
                    etaToDestinationSeconds: null,
                    etaToDestinationText: null,
                    speedKmph: null,
                    lastUpdatedAt: response.data.trip?.updatedAt ?? response.data.trip?.startedAt ?? null,
                    connectionStatus: socketService.getConnectionStatus(),
                    loading: false,
                    error: null,
                }));
            } catch (error) {
                if (currentRequestId !== requestIdRef.current) {
                    return;
                }

                setState((previous) => ({
                    ...previous,
                    loading: false,
                    error: normalizeErrorMessage(error),
                }));
            }
        })();
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const tripId = toString(state.trip?.id);
        const busId = toString(state.bus?.id);
        const isTerminal = isTerminalTripStatus(state.trip?.status);

        if (!tripId || isTerminal) {
            setState((previous) => ({
                ...previous,
                connectionStatus: socketService.getConnectionStatus(),
            }));
            return;
        }

        socketService.connect(API_BASE_URL, token ?? undefined);

        const onConnect = () => {
            setState((previous) => ({
                ...previous,
                connectionStatus: "connected",
            }));
            socketService.joinTripRoom(tripId);
        };

        const onDisconnect = () => {
            setState((previous) => ({
                ...previous,
                connectionStatus: "offline",
            }));
        };

        const onReconnectAttempt = () => {
            setState((previous) => ({
                ...previous,
                connectionStatus: "reconnecting",
            }));
        };

        const onBusLocationUpdate = (payload: unknown) => {
            const update = normalizeLocationUpdate(payload);
            if (!update) {
                return;
            }

            const updateTripId = toString(update.tripId);
            const updateBusId = toString(update.busId);

            if (updateTripId && updateTripId !== tripId) {
                return;
            }

            if (busId && updateBusId && updateBusId !== busId) {
                return;
            }

            const updateTimestamp = Number(update.timestamp);
            if (!Number.isFinite(updateTimestamp) || updateTimestamp <= lastLocationTimestampRef.current) {
                return;
            }

            const latitude = Number(update.lat);
            const longitude = Number(update.lng);
            const nextUpdatedAt = update.updatedAt ?? new Date(updateTimestamp).toISOString();

            lastLocationTimestampRef.current = updateTimestamp;

            setState((previous) => {
                const nextTripStatus = toString(update.status)?.toUpperCase() ?? previous.trip?.status ?? null;

                return {
                    ...previous,
                    currentLocation: {
                        latitude,
                        longitude,
                    },
                    currentStopId: update.currentStopId ?? previous.currentStopId,
                    nextStopId: update.nextStopId ?? previous.nextStopId,
                    etaToDestinationSeconds:
                        toNumber(update.etaToDestinationSeconds) ?? previous.etaToDestinationSeconds,
                    etaToDestinationText: update.etaToDestinationText ?? previous.etaToDestinationText,
                    speedKmph: toNumber(update.speed) ?? previous.speedKmph,
                    trip: previous.trip
                        ? {
                            ...previous.trip,
                            status: nextTripStatus ?? previous.trip.status,
                            currentLocation: {
                                latitude,
                                longitude,
                            },
                            updatedAt: nextUpdatedAt,
                        }
                        : previous.trip,
                    bus: previous.bus
                        ? {
                            ...previous.bus,
                        }
                        : previous.bus,
                    lastUpdatedAt: nextUpdatedAt,
                };
            });
        };

        const onTripLocationUpdate = (payload: unknown) => {
            onBusLocationUpdate(payload);
        };

        socketService.on("connect", onConnect);
        socketService.on("disconnect", onDisconnect);
        socketService.onReconnectAttempt(onReconnectAttempt);
        LOCATION_UPDATE_EVENTS.forEach((eventName) => {
            socketService.on(eventName, onTripLocationUpdate);
        });

        if (socketService.isConnected()) {
            onConnect();
        }

        return () => {
            socketService.off("connect", onConnect);
            socketService.off("disconnect", onDisconnect);
            socketService.offReconnectAttempt(onReconnectAttempt);
            LOCATION_UPDATE_EVENTS.forEach((eventName) => {
                socketService.off(eventName, onTripLocationUpdate);
            });
            socketService.leaveTripRoom(tripId);
        };
    }, [state.bus?.id, state.trip?.id, state.trip?.status, token]);

    const hasRouteAssigned = useMemo(() => Boolean(state.route), [state.route]);
    const hasActiveTrip = useMemo(() => Boolean(state.trip), [state.trip]);

    return {
        ...state,
        hasRouteAssigned,
        hasActiveTrip,
        refresh,
    };
}

export default useTrackingData;
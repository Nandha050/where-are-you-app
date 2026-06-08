import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../api/client";
import { TrackingBus, TrackingDriver, TrackingRoute, TrackingStop, TrackingTrip } from "../api/types";
import { getUserActiveTrip, getUserBusLive } from "../api/user";
import socketService, { SocketConnectionStatus } from "../sockets/socketService";
import { deriveRouteProgress } from "./routeProgressUtils";
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
        // Detect Unix seconds (anything less than year 2001 in ms).
        // Backends often send Math.floor(Date.now() / 1000) rather than Date.now().
        if (numeric < 1_000_000_000_000) {
            return numeric * 1000;
        }
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

const deriveProgressState = (state: TrackingDataState) => {
    return deriveRouteProgress({
        encodedPolyline: state.route?.encodedPolyline ?? null,
        stops: state.stops,
        currentLocation: state.currentLocation,
        speed: state.speedKmph,
        routeEstimatedDurationSeconds: state.route?.estimatedDurationSeconds ?? null,
    });
};

export function useTrackingData(paramBusId?: string, paramTripId?: string): TrackingDataHook {
    const { token } = useAuth();
    const [state, setState] = useState<TrackingDataState>(INITIAL_STATE);
    const requestIdRef = useRef(0);
    const lastLocationTimestampRef = useRef(0);
    // Refs keep the handler closure from going stale when trip/bus IDs change.
    const tripIdRef = useRef<string | null>(null);
    const busIdRef = useRef<string | null>(null);
    const derivedProgress = useMemo(() => deriveProgressState(state), [
        state.currentLocation,
        state.route?.encodedPolyline,
        state.route?.estimatedDurationSeconds,
        state.stops,
        state.speedKmph,
    ]);

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
                let responseData;
                if (paramBusId) {
                    const live = await getUserBusLive(paramBusId);
                    responseData = {
                        success: true,
                        data: {
                            route: {
                                id: live.routeId || '',
                                name: live.routeName,
                                startName: live.routeStartName,
                                endName: live.routeEndName,
                                startLat: live.routeStartLat,
                                startLng: live.routeStartLng,
                                endLat: live.routeEndLat,
                                endLng: live.routeEndLng,
                                encodedPolyline: live.encodedPolyline,
                                totalDistanceMeters: live.totalDistanceMeters,
                                estimatedDurationSeconds: live.estimatedDurationSeconds
                            },
                            stops: live.stops.map(stop => ({
                                id: stop.id || '',
                                name: stop.name || '',
                                latitude: stop.lat ?? stop.latitude ?? 0,
                                longitude: stop.lng ?? stop.longitude ?? 0,
                                sequenceOrder: stop.sequenceOrder ?? 0,
                                radiusMeters: stop.radiusMeters ?? null
                            })),
                            trip: {
                                id: live.trip?.id || paramTripId || '',
                                status: live.tripStatus || live.status || 'PENDING',
                                startedAt: null,
                                currentLocation: (live.currentLat != null && live.currentLng != null) ? { latitude: live.currentLat, longitude: live.currentLng } : null,
                                updatedAt: live.lastUpdated
                            },
                            bus: {
                                id: live.busId,
                                numberPlate: live.numberPlate,
                                status: live.fleetStatus
                            },
                            driver: null
                        }
                    };
                } else {
                    responseData = await getUserActiveTrip();
                }

                if (currentRequestId !== requestIdRef.current) {
                    return;
                }

                lastLocationTimestampRef.current = 0;

                setState((previous) => ({
                    ...previous,
                    route: responseData.data.route,
                    stops: normalizeStops(responseData.data.stops),
                    trip: responseData.data.trip,
                    bus: responseData.data.bus,
                    driver: responseData.data.driver,
                    currentLocation: responseData.data.trip?.currentLocation ?? null,
                    currentStopId: null,
                    nextStopId: null,
                    etaToDestinationSeconds: null,
                    etaToDestinationText: null,
                    speedKmph: null,
                    lastUpdatedAt: responseData.data.trip?.updatedAt ?? responseData.data.trip?.startedAt ?? null,
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
    }, [paramBusId, paramTripId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Keep refs in sync with the latest IDs using a layout effect so
    // the socket callback always reads fresh values on the next event.
    useEffect(() => {
        tripIdRef.current = toString(state.trip?.id);
        busIdRef.current = toString(state.bus?.id);
    });

    useEffect(() => {
        const tripId = toString(state.trip?.id);
        const busId = toString(state.bus?.id);
        const isTerminal = isTerminalTripStatus(state.trip?.status);

        // Need at least a trip ID or bus ID to connect.
        // Empty string ('') comes from the API when trip.id is missing — treat as absent.
        const hasTripId = Boolean(tripId && tripId.trim());
        const hasBusId = Boolean(busId && busId.trim());

        if ((!hasTripId && !hasBusId) || isTerminal) {
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
            // Join trip room when we have a trip ID; fall back to bus room
            // (for cases where passenger tracks a bus without an active trip ID).
            console.log("🔵 SOCKET CONNECTED - joining room", { hasTripId, tripId, hasBusId, busId });
            if (hasTripId && tripId) {
                console.log("🔵 JOINING TRIP ROOM", tripId);
                socketService.joinTripRoom(tripId);
            } else if (hasBusId && busId) {
                console.log("🔵 JOINING BUS ROOM (fallback)", busId);
                socketService.joinBusRoom(busId);
            } else {
                console.log("⚠️ NO ROOM TO JOIN - no tripId and no busId");
            }
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
            console.log("🔥 EVENT RECEIVED", JSON.stringify(payload, null, 2));

            const update = normalizeLocationUpdate(payload);

            console.log("🔥 NORMALIZED UPDATE", update);

            if (!update) {
                console.log("❌ UPDATE NULL - normalizeLocationUpdate returned null");
                return;
            }

            // Use refs so we always compare against the current trip/bus IDs
            // even if this closure was created before the IDs were resolved.
            const currentTripId = tripIdRef.current;
            const currentBusId = busIdRef.current;

            const updateTripId = toString(update.tripId);
            const updateBusId = toString(update.busId);

            console.log("🔥 FILTER CHECK", {
                updateTripId,
                currentTripId,
                updateBusId,
                currentBusId,
            });

            if (updateTripId && currentTripId && updateTripId !== currentTripId) {
                console.log("❌ TRIP ID MISMATCH", {
                    received: updateTripId,
                    expected: currentTripId,
                });
                return;
            }

            if (currentBusId && updateBusId && updateBusId !== currentBusId) {
                console.log("❌ BUS ID MISMATCH", {
                    received: updateBusId,
                    expected: currentBusId,
                });
                return;
            }

            const updateTimestamp = Number(update.timestamp);

            console.log("🔥 TIMESTAMP CHECK", {
                updateTimestamp,
                lastTimestamp: lastLocationTimestampRef.current,
            });

            // Allow a 500 ms tolerance so same-second updates (common when the
            // backend sends Unix seconds) or minor clock skew don't get dropped.
            const TIMESTAMP_TOLERANCE_MS = 500;
            if (
                !Number.isFinite(updateTimestamp) ||
                updateTimestamp < lastLocationTimestampRef.current - TIMESTAMP_TOLERANCE_MS
            ) {
                console.log("❌ OLD OR INVALID TIMESTAMP", {
                    updateTimestamp,
                    lastTimestamp: lastLocationTimestampRef.current,
                });
                return;
            }

            const latitude = Number(update.lat);
            const longitude = Number(update.lng);

            console.log("🔥 LOCATION PARSED", {
                latitude,
                longitude,
            });

            const nextUpdatedAt =
                update.updatedAt ?? new Date(updateTimestamp).toISOString();

            lastLocationTimestampRef.current = updateTimestamp;

            console.log("🔥 SETTING LOCATION STATE", {
                latitude,
                longitude,
                nextUpdatedAt,
            });

            setState((previous) => {
                const nextTripStatus =
                    toString(update.status)?.toUpperCase() ??
                    previous.trip?.status ??
                    null;

                console.log("🔥 STATE UPDATED", {
                    latitude,
                    longitude,
                    nextTripStatus,
                });

                return {
                    ...previous,
                    currentLocation: {
                        latitude,
                        longitude,
                    },
                    currentStopId:
                        update.currentStopId ?? previous.currentStopId,
                    nextStopId:
                        update.nextStopId ?? previous.nextStopId,
                    etaToDestinationSeconds:
                        toNumber(update.etaToDestinationSeconds) ??
                        previous.etaToDestinationSeconds,
                    etaToDestinationText:
                        update.etaToDestinationText ??
                        previous.etaToDestinationText,
                    speedKmph:
                        toNumber(update.speed) ??
                        previous.speedKmph,
                    trip: previous.trip
                        ? {
                            ...previous.trip,
                            status:
                                nextTripStatus ??
                                previous.trip.status,
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
            if (hasTripId && tripId) {
                socketService.leaveTripRoom(tripId);
            } else if (hasBusId && busId) {
                socketService.leaveBusRoom(busId);
            }
        };
        // Intentionally exclude state.trip?.status — a status change (e.g. PENDING→RUNNING)
        // must NOT cause the effect to teardown and re-join the room, as that drops
        // in-flight location events during the brief leave/rejoin cycle.
    }, [state.trip?.id, state.bus?.id, token]);


    const hasRouteAssigned = useMemo(() => Boolean(state.route), [state.route]);
    const hasActiveTrip = useMemo(() => Boolean(state.trip), [state.trip]);

    return {
        ...state,
        currentStopId: derivedProgress?.currentStopId ?? state.currentStopId,
        nextStopId: derivedProgress?.nextStopId ?? state.nextStopId,
        etaToDestinationSeconds:
            derivedProgress?.etaToDestinationSeconds ?? state.etaToDestinationSeconds,
        etaToDestinationText:
            derivedProgress?.etaToDestinationText ?? state.etaToDestinationText,
        stops: derivedProgress?.stops ?? state.stops,
        hasRouteAssigned,
        hasActiveTrip,
        refresh,
    };
}

export default useTrackingData;
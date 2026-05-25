import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../api/client";
import socketService, { SocketConnectionStatus } from "../sockets/socketService";
import {
    TimelineMetadataStop,
    parseBusLocationUpdate,
    parseEtaUpdate,
    parseStopUpdate,
    shouldApplyLocationUpdate,
    shouldIgnoreStopUpdate,
} from "./routeTrackingUtils";
import { useAuth } from "./useAuth";

export type { BusLocationUpdate, EtaUpdate, StopUpdate } from "./routeTrackingUtils";

export type RouteEtaSummary = {
    etaToDestinationSeconds?: number;
    etaToDestinationText?: string;
};

const sortTimelineStops = (stops: TimelineMetadataStop[]): TimelineMetadataStop[] => {
    return [...stops].sort((a, b) => {
        const aOrder = typeof a.sequenceOrder === "number" ? a.sequenceOrder : Number.MAX_SAFE_INTEGER;
        const bOrder = typeof b.sequenceOrder === "number" ? b.sequenceOrder : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
    });
};

const mergeStopPatch = (
    existing: TimelineMetadataStop,
    patch: TimelineMetadataStop,
): TimelineMetadataStop => {
    return {
        ...existing,
        ...patch,
        id: patch.id ?? existing.id,
    };
};

const applyStopUpdatePatch = (
    existingStops: TimelineMetadataStop[],
    currentStopId: string,
    nextStopId: string,
    timeline?: {
        currentStop?: TimelineMetadataStop;
        nextStop?: TimelineMetadataStop;
    },
): TimelineMetadataStop[] => {
    if (!existingStops.length) {
        return existingStops;
    }

    const patched = existingStops.map((stop) => {
        if (!stop.id) {
            return stop;
        }

        let next = stop;
        if (stop.id === currentStopId) {
            next = {
                ...next,
                status: "current",
            };
            if (timeline?.currentStop) {
                next = mergeStopPatch(next, timeline.currentStop);
            }
        } else if (stop.id === nextStopId) {
            next = {
                ...next,
                status: "upcoming",
            };
            if (timeline?.nextStop) {
                next = mergeStopPatch(next, timeline.nextStop);
            }
        }

        return next;
    });

    return sortTimelineStops(patched);
};

export type RouteTrackingState = {
    currentStopId: string | null;
    nextStopId: string | null;
    lastStopTimestamp: number;
    etaMap: Record<string, number>;
    timelineStops: TimelineMetadataStop[];
    routeEtaSummary: RouteEtaSummary | null;
    busLocation: { lat: number; lng: number } | null;
    connectionStatus: SocketConnectionStatus;
    lastUpdatedTimestamp: number | null;
    isStale: boolean;
    refreshSnapshotNonce: number;
};

const INITIAL_STATE: RouteTrackingState = {
    currentStopId: null,
    nextStopId: null,
    lastStopTimestamp: 0,
    etaMap: {},
    timelineStops: [],
    routeEtaSummary: null,
    busLocation: null,
    connectionStatus: socketService.getConnectionStatus(),
    lastUpdatedTimestamp: null,
    isStale: false,
    refreshSnapshotNonce: 0,
};

export const useRouteTracking = (routeId?: string | null): RouteTrackingState & {
    isWaitingForUpdates: boolean;
} => {
    const { token } = useAuth();
    const normalizedRouteId = String(routeId ?? "").trim();

    const [state, setState] = useState<RouteTrackingState>(() => ({
        ...INITIAL_STATE,
        connectionStatus: socketService.getConnectionStatus(),
    }));
    const etaDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingEtaRef = useRef<{
        etaMap: Record<string, number>;
        stops?: TimelineMetadataStop[];
        routeEtaSummary?: RouteEtaSummary;
    } | null>(null);
    const wasDisconnectedRef = useRef(false);

    useEffect(() => {
        return () => {
            if (etaDebounceTimerRef.current) {
                clearTimeout(etaDebounceTimerRef.current);
                etaDebounceTimerRef.current = null;
            }
            pendingEtaRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!normalizedRouteId) {
            setState((previous) => ({
                ...INITIAL_STATE,
                connectionStatus: socketService.getConnectionStatus(),
            }));
            return;
        }

        setState((previous) => ({
            ...INITIAL_STATE,
            connectionStatus: socketService.getConnectionStatus(),
        }));
        wasDisconnectedRef.current = false;

        socketService.connect(API_BASE_URL, token ?? undefined);

        let currentLastLocationTimestamp = 0;

        const onConnect = () => {
            setState((previous) => ({
                ...previous,
                connectionStatus: "connected",
                refreshSnapshotNonce: wasDisconnectedRef.current
                    ? previous.refreshSnapshotNonce + 1
                    : previous.refreshSnapshotNonce,
            }));

            socketService.joinRouteRoom(normalizedRouteId);
            wasDisconnectedRef.current = false;
        };

        const onDisconnect = () => {
            wasDisconnectedRef.current = true;
            setState((previous) => ({
                ...previous,
                connectionStatus: "offline",
                isStale: true,
            }));
        };

        const onReconnectAttempt = () => {
            setState((previous) => ({
                ...previous,
                connectionStatus: "reconnecting",
                isStale: true,
            }));
        };

        const onStopUpdate = (payload: unknown) => {
            const incoming = parseStopUpdate(payload);
            if (!incoming || incoming.routeId !== normalizedRouteId) {
                return;
            }

            setState((previous) => {
                if (shouldIgnoreStopUpdate(previous, incoming)) {
                    return previous;
                }

                return {
                    ...previous,
                    currentStopId: incoming.currentStopId,
                    nextStopId: incoming.nextStopId,
                    lastStopTimestamp: incoming.timestamp,
                    timelineStops: applyStopUpdatePatch(
                        previous.timelineStops,
                        incoming.currentStopId,
                        incoming.nextStopId,
                        incoming.timeline,
                    ),
                    lastUpdatedTimestamp: incoming.timestamp,
                };
            });
        };

        const onEtaUpdate = (payload: unknown) => {
            const incoming = parseEtaUpdate(payload);
            if (!incoming) {
                return;
            }

            pendingEtaRef.current = {
                etaMap: incoming.etaMap,
                stops: incoming.stops,
                routeEtaSummary: incoming.routeEtaSummary,
            };

            if (etaDebounceTimerRef.current) {
                clearTimeout(etaDebounceTimerRef.current);
            }

            etaDebounceTimerRef.current = setTimeout(() => {
                const pending = pendingEtaRef.current;
                pendingEtaRef.current = null;
                etaDebounceTimerRef.current = null;
                if (!pending) {
                    return;
                }

                setState((previous) => ({
                    ...previous,
                    etaMap: {
                        ...previous.etaMap,
                        ...pending.etaMap,
                    },
                    timelineStops: pending.stops && pending.stops.length
                        ? sortTimelineStops(pending.stops)
                        : previous.timelineStops,
                    routeEtaSummary: pending.routeEtaSummary
                        ? {
                            ...previous.routeEtaSummary,
                            ...pending.routeEtaSummary,
                        }
                        : previous.routeEtaSummary,
                    isStale: false,
                    lastUpdatedTimestamp: Date.now(),
                }));
            }, 120);
        };

        const onBusLocationUpdate = (payload: unknown) => {
            const incoming = parseBusLocationUpdate(payload);
            if (!incoming || !shouldApplyLocationUpdate(incoming, currentLastLocationTimestamp)) {
                return;
            }

            currentLastLocationTimestamp = incoming.timestamp;
            setState((previous) => ({
                ...previous,
                busLocation: {
                    lat: incoming.lat,
                    lng: incoming.lng,
                },
                isStale: previous.connectionStatus !== "connected",
                lastUpdatedTimestamp: incoming.timestamp,
            }));
        };

        socketService.on("connect", onConnect);
        socketService.on("disconnect", onDisconnect);
        socketService.on("stopUpdate", onStopUpdate);
        socketService.on("etaUpdate", onEtaUpdate);
        socketService.on("busLocationUpdate", onBusLocationUpdate);
        socketService.onReconnectAttempt(onReconnectAttempt);

        if (socketService.isConnected()) {
            onConnect();
        }

        return () => {
            if (etaDebounceTimerRef.current) {
                clearTimeout(etaDebounceTimerRef.current);
                etaDebounceTimerRef.current = null;
            }
            pendingEtaRef.current = null;
            socketService.off("connect", onConnect);
            socketService.off("disconnect", onDisconnect);
            socketService.off("stopUpdate", onStopUpdate);
            socketService.off("etaUpdate", onEtaUpdate);
            socketService.off("busLocationUpdate", onBusLocationUpdate);
            socketService.offReconnectAttempt(onReconnectAttempt);
            socketService.leaveRouteRoom(normalizedRouteId);
        };
    }, [normalizedRouteId, token]);

    const isWaitingForUpdates = useMemo(() => {
        return (
            !state.currentStopId &&
            !state.nextStopId &&
            !state.busLocation &&
            Object.keys(state.etaMap).length === 0 &&
            state.timelineStops.length === 0
        );
    }, [state.busLocation, state.currentStopId, state.etaMap, state.nextStopId, state.timelineStops.length]);

    return {
        ...state,
        isWaitingForUpdates,
    };
};

export default useRouteTracking;

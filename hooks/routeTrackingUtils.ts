export interface StopUpdate {
    busId: string;
    routeId: string;
    currentStopId: string;
    nextStopId: string;
    timestamp: number;
    timeline?: {
        currentStop?: TimelineMetadataStop;
        nextStop?: TimelineMetadataStop;
    };
}

export interface EtaUpdate {
    busId: string;
    etaMap: Record<string, number>;
    stops?: TimelineMetadataStop[];
    routeEtaSummary?: {
        etaToDestinationSeconds?: number;
        etaToDestinationText?: string;
    };
}

export interface TimelineMetadataStop {
    id?: string;
    name?: string;
    sequenceOrder?: number;
    isPassed?: boolean;
    etaFromCurrentSeconds?: number;
    etaFromCurrentText?: string;
    segmentEtaSeconds?: number;
    segmentEtaText?: string;
    arrivalClockTimeText?: string;
    departedClockTimeText?: string;
    status?: "passed" | "current" | "upcoming";
    leftSubLabel?: string;
    rightPrimaryLabel?: string;
    rightSecondaryLabel?: string;
}

export interface BusLocationUpdate {
    busId: string;
    lat: number;
    lng: number;
    timestamp: number;
}

const isNonEmptyString = (value: unknown): value is string => {
    return typeof value === "string" && value.trim().length > 0;
};

const toOptionalString = (value: unknown): string | undefined => {
    if (!isNonEmptyString(value)) {
        return undefined;
    }

    return value.trim();
};

const toStopStatus = (
    value: unknown,
): "passed" | "current" | "upcoming" | undefined => {
    if (!isNonEmptyString(value)) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "passed" || normalized === "current" || normalized === "upcoming") {
        return normalized;
    }

    return undefined;
};

const parseTimelineStop = (value: unknown): TimelineMetadataStop | null => {
    if (!value || typeof value !== "object") {
        return null;
    }

    const raw = value as Record<string, unknown>;
    const id = toOptionalString(raw.id) ?? toOptionalString(raw._id);
    const name = toOptionalString(raw.name);
    const sequenceOrder = toFiniteNumber(raw.sequenceOrder) ?? toFiniteNumber(raw.sequence);

    const isPassed =
        typeof raw.isPassed === "boolean"
            ? raw.isPassed
            : typeof raw.passed === "boolean"
                ? raw.passed
                : undefined;

    const etaFromCurrentSeconds =
        toFiniteNumber(raw.etaFromCurrentSeconds) ?? toFiniteNumber(raw.etaSeconds) ?? undefined;
    const segmentEtaSeconds =
        toFiniteNumber(raw.segmentEtaSeconds) ?? toFiniteNumber(raw.segmentSeconds) ?? undefined;

    const parsed: TimelineMetadataStop = {
        id,
        name,
        sequenceOrder: sequenceOrder == null ? undefined : sequenceOrder,
        isPassed,
        etaFromCurrentSeconds,
        etaFromCurrentText: toOptionalString(raw.etaFromCurrentText) ?? toOptionalString(raw.etaText),
        segmentEtaSeconds,
        segmentEtaText: toOptionalString(raw.segmentEtaText) ?? toOptionalString(raw.segmentEta),
        arrivalClockTimeText:
            toOptionalString(raw.arrivalClockTimeText) ?? toOptionalString(raw.arrivalTimeText),
        departedClockTimeText:
            toOptionalString(raw.departedClockTimeText) ?? toOptionalString(raw.departedTimeText),
        status: toStopStatus(raw.status),
        leftSubLabel: toOptionalString(raw.leftSubLabel),
        rightPrimaryLabel: toOptionalString(raw.rightPrimaryLabel),
        rightSecondaryLabel: toOptionalString(raw.rightSecondaryLabel),
    };

    if (!parsed.id && !parsed.name) {
        return null;
    }

    return parsed;
};

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

export const parseStopUpdate = (payload: unknown): StopUpdate | null => {
    const event = payload as Partial<StopUpdate> | null;

    if (!event || typeof event !== "object") {
        console.warn("[RouteTracking][stopUpdate] Invalid payload", payload);
        return null;
    }

    const timestamp = toFiniteNumber(event.timestamp);
    if (
        !isNonEmptyString(event.busId) ||
        !isNonEmptyString(event.routeId) ||
        !isNonEmptyString(event.currentStopId) ||
        !isNonEmptyString(event.nextStopId) ||
        timestamp == null
    ) {
        console.warn("[RouteTracking][stopUpdate] Missing required fields", payload);
        return null;
    }

    return {
        busId: event.busId.trim(),
        routeId: event.routeId.trim(),
        currentStopId: event.currentStopId.trim(),
        nextStopId: event.nextStopId.trim(),
        timestamp,
        timeline:
            event.timeline && typeof event.timeline === "object"
                ? {
                    currentStop: parseTimelineStop(
                        (event.timeline as { currentStop?: unknown }).currentStop,
                    ) ?? undefined,
                    nextStop: parseTimelineStop(
                        (event.timeline as { nextStop?: unknown }).nextStop,
                    ) ?? undefined,
                }
                : undefined,
    };
};

export const parseEtaUpdate = (payload: unknown): EtaUpdate | null => {
    const event = payload as Partial<EtaUpdate> | null;

    if (!event || typeof event !== "object") {
        console.warn("[RouteTracking][etaUpdate] Invalid payload", payload);
        return null;
    }

    if (!isNonEmptyString(event.busId) || !event.etaMap || typeof event.etaMap !== "object") {
        console.warn("[RouteTracking][etaUpdate] Missing required fields", payload);
        return null;
    }

    const normalizedEtaMap: Record<string, number> = {};
    Object.entries(event.etaMap).forEach(([stopId, etaValue]) => {
        if (!isNonEmptyString(stopId)) {
            return;
        }

        const etaSeconds = toFiniteNumber(etaValue);
        if (etaSeconds == null || etaSeconds < 0) {
            return;
        }

        normalizedEtaMap[stopId.trim()] = etaSeconds;
    });

    const rawStops = Array.isArray((event as { stops?: unknown }).stops)
        ? ((event as { stops?: unknown[] }).stops ?? [])
        : [];
    const stops = rawStops
        .map(parseTimelineStop)
        .filter((stop): stop is TimelineMetadataStop => Boolean(stop));

    const routeEtaSummary =
        event.routeEtaSummary && typeof event.routeEtaSummary === "object"
            ? {
                etaToDestinationSeconds:
                    toFiniteNumber((event.routeEtaSummary as { etaToDestinationSeconds?: unknown }).etaToDestinationSeconds)
                    ?? undefined,
                etaToDestinationText:
                    toOptionalString((event.routeEtaSummary as { etaToDestinationText?: unknown }).etaToDestinationText)
                    ?? undefined,
            }
            : undefined;

    return {
        busId: event.busId.trim(),
        etaMap: normalizedEtaMap,
        stops,
        routeEtaSummary,
    };
};

export const parseBusLocationUpdate = (
    payload: unknown,
): BusLocationUpdate | null => {
    const event = payload as Partial<BusLocationUpdate> | null;

    if (!event || typeof event !== "object") {
        console.warn("[RouteTracking][busLocationUpdate] Invalid payload", payload);
        return null;
    }

    const lat = toFiniteNumber(event.lat);
    const lng = toFiniteNumber(event.lng);
    const timestamp = toFiniteNumber(event.timestamp);

    if (!isNonEmptyString(event.busId) || lat == null || lng == null || timestamp == null) {
        console.warn("[RouteTracking][busLocationUpdate] Missing required fields", payload);
        return null;
    }

    return {
        busId: event.busId.trim(),
        lat,
        lng,
        timestamp,
    };
};

export const shouldIgnoreStopUpdate = (
    previous: {
        lastStopTimestamp: number;
        currentStopId: string | null;
    },
    incoming: {
        timestamp: number;
        currentStopId: string;
    },
): boolean => {
    return (
        incoming.timestamp <= previous.lastStopTimestamp &&
        incoming.currentStopId === previous.currentStopId
    );
};

export const shouldApplyLocationUpdate = (
    incoming: {
        timestamp: number;
    },
    lastLocationTimestamp: number,
): boolean => {
    return incoming.timestamp > lastLocationTimestamp;
};

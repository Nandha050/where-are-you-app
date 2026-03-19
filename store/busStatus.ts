export const FLEET_STATUS_VALUES = [
    "IN_SERVICE",
    "OUT_OF_SERVICE",
    "MAINTENANCE",
] as const;

export const TRIP_STATUS_VALUES = [
    "PENDING",
    "STARTED",
    "RUNNING",
    "STOPPED",
    "COMPLETED",
    "CANCELLED",
] as const;

export const TRACKING_STATUS_VALUES = [
    "RUNNING",
    "STOPPED",
    "IDLE",
    "OFFLINE",
    "NO_SIGNAL",
] as const;

export type FleetStatus = (typeof FLEET_STATUS_VALUES)[number];
export type TripStatus = (typeof TRIP_STATUS_VALUES)[number];
export type TrackingStatus = (typeof TRACKING_STATUS_VALUES)[number];

export const UNKNOWN_STATUS_CODE = "UNKNOWN" as const;
export const UNKNOWN_STATUS_LABEL = "Unknown Status";

export type UnknownStatusCode = typeof UNKNOWN_STATUS_CODE;

export type NormalizedFleetStatus = FleetStatus | UnknownStatusCode;
export type NormalizedTripStatus = TripStatus | UnknownStatusCode;
export type NormalizedTrackingStatus = TrackingStatus | UnknownStatusCode;

export type StatusType = "fleetStatus" | "tripStatus" | "trackingStatus";

export type StatusVariant = "success" | "warning" | "danger" | "neutral" | "muted";

export const FLEET_STATUS_LABELS: Record<FleetStatus, string> = {
    IN_SERVICE: "In Service",
    OUT_OF_SERVICE: "Out of Service",
    MAINTENANCE: "Maintenance",
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
    PENDING: "Ready to start",
    STARTED: "Trip started",
    RUNNING: "Bus moving",
    STOPPED: "Bus stopped",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
};

export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
    RUNNING: "Running",
    STOPPED: "Stopped",
    IDLE: "Idle",
    OFFLINE: "No Signal",
    NO_SIGNAL: "No Signal",
};

const FLEET_STATUS_SET = new Set<string>(FLEET_STATUS_VALUES);
const TRIP_STATUS_SET = new Set<string>(TRIP_STATUS_VALUES);
const TRACKING_STATUS_SET = new Set<string>(TRACKING_STATUS_VALUES);

const hasOwn = (target: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(target, key);

const normalizeInput = (value: unknown): string =>
    String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");

const toRawStatus = (value: unknown): string | null => {
    if (value == null) {
        return null;
    }

    const raw = String(value).trim();
    return raw.length ? raw : null;
};

const toRawTimestamp = (value: unknown): string | null => {
    if (value == null) {
        return null;
    }

    const raw = String(value).trim();
    return raw.length ? raw : null;
};

export const isFleetStatus = (value: unknown): value is FleetStatus =>
    FLEET_STATUS_SET.has(normalizeInput(value));

export const isTripStatus = (value: unknown): value is TripStatus =>
    TRIP_STATUS_SET.has(normalizeInput(value));

export const isTrackingStatus = (value: unknown): value is TrackingStatus =>
    TRACKING_STATUS_SET.has(normalizeInput(value));

export const normalizeFleetStatus = (value: unknown): NormalizedFleetStatus => {
    const normalized = normalizeInput(value);
    if (FLEET_STATUS_SET.has(normalized)) {
        return normalized as FleetStatus;
    }

    return UNKNOWN_STATUS_CODE;
};

export const normalizeTripStatus = (value: unknown): NormalizedTripStatus => {
    const normalized = normalizeInput(value);
    if (TRIP_STATUS_SET.has(normalized)) {
        return normalized as TripStatus;
    }

    return UNKNOWN_STATUS_CODE;
};

export const normalizeTrackingStatus = (
    value: unknown,
): NormalizedTrackingStatus => {
    const normalized = normalizeInput(value);
    if (TRACKING_STATUS_SET.has(normalized)) {
        return normalized as TrackingStatus;
    }

    return UNKNOWN_STATUS_CODE;
};

export const getFleetStatusLabel = (value: unknown): string => {
    const normalized = normalizeFleetStatus(value);
    if (normalized === UNKNOWN_STATUS_CODE) {
        return UNKNOWN_STATUS_LABEL;
    }

    return FLEET_STATUS_LABELS[normalized];
};

export const getTripStatusLabel = (value: unknown): string => {
    const normalized = normalizeTripStatus(value);
    if (normalized === UNKNOWN_STATUS_CODE) {
        return UNKNOWN_STATUS_LABEL;
    }

    return TRIP_STATUS_LABELS[normalized];
};

export const getTrackingStatusLabel = (value: unknown): string => {
    const normalized = normalizeTrackingStatus(value);
    if (normalized === UNKNOWN_STATUS_CODE) {
        return UNKNOWN_STATUS_LABEL;
    }

    return TRACKING_STATUS_LABELS[normalized];
};

export const getStatusVariant = (
    statusType: StatusType,
    statusCode: unknown,
): StatusVariant => {
    if (statusType === "trackingStatus") {
        const normalized = normalizeTrackingStatus(statusCode);

        if (normalized === "RUNNING") return "success";
        if (normalized === "STOPPED" || normalized === "IDLE") return "neutral";
        if (normalized === "OFFLINE" || normalized === "NO_SIGNAL") return "muted";
        return "muted";
    }

    if (statusType === "tripStatus") {
        const normalized = normalizeTripStatus(statusCode);

        if (normalized === "STARTED" || normalized === "RUNNING") return "success";
        if (normalized === "CANCELLED") return "danger";
        if (
            normalized === "PENDING" ||
            normalized === "STOPPED" ||
            normalized === "COMPLETED"
        ) {
            return "neutral";
        }
        return "muted";
    }

    const normalized = normalizeFleetStatus(statusCode);
    if (normalized === "IN_SERVICE") return "success";
    if (normalized === "MAINTENANCE") return "warning";
    if (normalized === "OUT_OF_SERVICE") return "danger";
    return "muted";
};

type StatusField<TCode extends string> = {
    raw: string | null;
    code: TCode | UnknownStatusCode;
    label: string;
};

export type BusStatusState = {
    fleetStatus: StatusField<FleetStatus>;
    tripStatus: StatusField<TripStatus>;
    trackingStatus: StatusField<TrackingStatus>;
    rawStatus: string | null;
    lastUpdated: string | null;
};

export type RestStatusSnapshotInput = {
    fleetStatus?: unknown;
    tripStatus?: unknown;
    trackingStatus?: unknown;
    status?: unknown;
    lastUpdated?: unknown;
};

export type SocketStatusUpdateInput = {
    trackingStatus?: unknown;
    tripStatus?: unknown;
    status?: unknown;
    timestamp?: unknown;
    skipped?: unknown;
};

const buildFleetField = (raw: string | null): StatusField<FleetStatus> => {
    const code = normalizeFleetStatus(raw);
    return {
        raw,
        code,
        label: getFleetStatusLabel(raw),
    };
};

const buildTripField = (raw: string | null): StatusField<TripStatus> => {
    const code = normalizeTripStatus(raw);
    return {
        raw,
        code,
        label: getTripStatusLabel(raw),
    };
};

const buildTrackingField = (
    raw: string | null,
): StatusField<TrackingStatus> => {
    const code = normalizeTrackingStatus(raw);
    return {
        raw,
        code,
        label: getTrackingStatusLabel(raw),
    };
};

const sameField = <TCode extends string>(
    a: StatusField<TCode>,
    b: StatusField<TCode>,
): boolean => a.raw === b.raw && a.code === b.code && a.label === b.label;

export const createBusStatusStateFromRestSnapshot = (
    input: RestStatusSnapshotInput,
): BusStatusState => {
    const rawStatus = toRawStatus(input.status);
    const rawTracking = toRawStatus(input.trackingStatus) ?? rawStatus;
    const rawTrip = toRawStatus(input.tripStatus);
    const rawFleet = toRawStatus(input.fleetStatus);

    return {
        fleetStatus: buildFleetField(rawFleet),
        tripStatus: buildTripField(rawTrip),
        trackingStatus: buildTrackingField(rawTracking),
        rawStatus,
        lastUpdated: toRawTimestamp(input.lastUpdated),
    };
};

export const mergeBusStatusFromSocketUpdate = (
    previous: BusStatusState,
    input: SocketStatusUpdateInput,
): BusStatusState => {
    if (Boolean(input.skipped)) {
        return previous;
    }

    let rawStatus = previous.rawStatus;
    let trackingStatus = previous.trackingStatus;
    let tripStatus = previous.tripStatus;
    let lastUpdated = previous.lastUpdated;
    let changed = false;

    if (hasOwn(input as object, "status")) {
        const nextRawStatus = toRawStatus(input.status);
        if (nextRawStatus !== rawStatus) {
            rawStatus = nextRawStatus;
            changed = true;
        }
    }

    if (hasOwn(input as object, "trackingStatus") || hasOwn(input as object, "status")) {
        const nextTrackingRaw =
            toRawStatus(input.trackingStatus) ??
            (hasOwn(input as object, "status") ? toRawStatus(input.status) : null);

        const nextTrackingField = buildTrackingField(nextTrackingRaw);
        if (!sameField(previous.trackingStatus, nextTrackingField)) {
            trackingStatus = nextTrackingField;
            changed = true;
        }
    }

    if (hasOwn(input as object, "tripStatus")) {
        const nextTripField = buildTripField(toRawStatus(input.tripStatus));
        if (!sameField(previous.tripStatus, nextTripField)) {
            tripStatus = nextTripField;
            changed = true;
        }
    }

    if (hasOwn(input as object, "timestamp")) {
        const nextTimestamp = toRawTimestamp(input.timestamp);
        if (nextTimestamp !== lastUpdated) {
            lastUpdated = nextTimestamp;
            changed = true;
        }
    }

    if (!changed) {
        return previous;
    }

    return {
        ...previous,
        rawStatus,
        trackingStatus,
        tripStatus,
        lastUpdated,
    };
};

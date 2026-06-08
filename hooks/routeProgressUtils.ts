// @ts-nocheck
import polyline from "@mapbox/polyline";
import type { TrackingStop } from "../api/types";

export type GeoPoint = {
    latitude: number;
    longitude: number;
};

export type DerivedStopState = TrackingStop & {
    status: "passed" | "current" | "upcoming";
    isPassed: boolean;
    distanceFromCurrentMeters: number;
    distanceFromCurrentText: string;
    etaFromCurrentSeconds: number;
    etaFromCurrentText: string;
    segmentDistanceMeters: number;
    segmentDistanceText: string;
    segmentEtaSeconds: number;
    segmentEtaText: string;
    arrivalClockTimeText: string;
    leftSubLabel: string;
    rightPrimaryLabel: string;
    rightSecondaryLabel?: string;
};

export type RouteProgressSnapshot = {
    currentStopId: string | null;
    nextStopId: string | null;
    etaToDestinationSeconds: number | null;
    etaToDestinationText: string | null;
    routeDistanceMeters: number | null;
    routeDeviationMeters: number | null;
    effectiveSpeedMps: number;
    stops: DerivedStopState[];
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_SPEED_MPS = 8.33;
const MIN_EFFECTIVE_SPEED_MPS = 2.5;
const MAX_EFFECTIVE_SPEED_MPS = 27;
const STOP_PASS_TOLERANCE_METERS = 18;

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

const toRadians = (value: number): number => (value * Math.PI) / 180;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);
    const deltaLat = toRadians(b.latitude - a.latitude);
    const deltaLng = toRadians(b.longitude - a.longitude);

    const sinLat = Math.sin(deltaLat / 2);
    const sinLng = Math.sin(deltaLng / 2);
    const root = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(root)));
};

const formatDistance = (meters: number): string => {
    if (!Number.isFinite(meters) || meters <= 0) {
        return "0 m";
    }

    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    }

    return `${Math.round(meters)} m`;
};

const formatEta = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "Completed";
    }

    if (seconds < 60) {
        return "<1 min";
    }

    return `${Math.max(1, Math.round(seconds / 60))} min`;
};

const normalizePoint = (value?: Partial<GeoPoint> | null): GeoPoint | null => {
    if (
        !value ||
        typeof value.latitude !== "number" ||
        !Number.isFinite(value.latitude) ||
        typeof value.longitude !== "number" ||
        !Number.isFinite(value.longitude)
    ) {
        return null;
    }

    return {
        latitude: value.latitude,
        longitude: value.longitude,
    };
};

const decodeRoutePoints = (encodedPolyline?: string | null, fallbackPoints: GeoPoint[] = []): GeoPoint[] => {
    const normalizedFallback = fallbackPoints.filter((point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );

    if (!encodedPolyline || !encodedPolyline.trim()) {
        return normalizedFallback;
    }

    try {
        const decoded = polyline.decode(encodedPolyline) as [number, number][];
        const points = decoded
            .map(([latitude, longitude]) => ({ latitude, longitude }))
            .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

        return points.length ? points : normalizedFallback;
    } catch {
        return normalizedFallback;
    }
};

const projectPointToRoute = (point: GeoPoint, routePoints: GeoPoint[]): { alongMeters: number; deviationMeters: number } => {
    if (!routePoints.length) {
        return { alongMeters: 0, deviationMeters: Infinity };
    }

    if (routePoints.length === 1) {
        return {
            alongMeters: 0,
            deviationMeters: haversineMeters(point, routePoints[0]),
        };
    }

    let bestAlongMeters = 0;
    let bestDeviationMeters = Infinity;
    let cumulativeMeters = 0;

    for (let index = 0; index < routePoints.length - 1; index += 1) {
        const start = routePoints[index];
        const end = routePoints[index + 1];
        const segmentMeters = Math.max(haversineMeters(start, end), 0.001);

        const referenceLatitude = toRadians((start.latitude + end.latitude) / 2);
        const metersPerLongitude = Math.cos(referenceLatitude) * EARTH_RADIUS_METERS;

        const segmentX = toRadians(end.longitude - start.longitude) * metersPerLongitude;
        const segmentY = toRadians(end.latitude - start.latitude) * EARTH_RADIUS_METERS;
        const pointX = toRadians(point.longitude - start.longitude) * metersPerLongitude;
        const pointY = toRadians(point.latitude - start.latitude) * EARTH_RADIUS_METERS;

        const denominator = segmentX * segmentX + segmentY * segmentY;
        const projection = denominator > 0
            ? clamp((pointX * segmentX + pointY * segmentY) / denominator, 0, 1)
            : 0;

        const closestX = segmentX * projection;
        const closestY = segmentY * projection;
        const deltaX = pointX - closestX;
        const deltaY = pointY - closestY;
        const deviationMeters = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (deviationMeters < bestDeviationMeters) {
            bestDeviationMeters = deviationMeters;
            bestAlongMeters = cumulativeMeters + segmentMeters * projection;
        }

        cumulativeMeters += segmentMeters;
    }

    return {
        alongMeters: bestAlongMeters,
        deviationMeters: bestDeviationMeters,
    };
};

const resolveEffectiveSpeedMps = (
    speed: unknown,
    routeDistanceMeters: number | null,
    routeEstimatedDurationSeconds: number | null | undefined,
): number => {
    const rawSpeed = toNumber(speed);
    let effectiveSpeedMps: number | null = null;

    if (rawSpeed != null && rawSpeed > 0) {
        effectiveSpeedMps = rawSpeed > 50 ? rawSpeed / 3.6 : rawSpeed;
    }

    if (
        (effectiveSpeedMps == null || effectiveSpeedMps <= 0) &&
        routeDistanceMeters != null &&
        routeEstimatedDurationSeconds != null &&
        routeEstimatedDurationSeconds > 0
    ) {
        effectiveSpeedMps = routeDistanceMeters / routeEstimatedDurationSeconds;
    }

    if (effectiveSpeedMps == null || effectiveSpeedMps <= 0) {
        effectiveSpeedMps = DEFAULT_SPEED_MPS;
    }

    return clamp(effectiveSpeedMps, MIN_EFFECTIVE_SPEED_MPS, MAX_EFFECTIVE_SPEED_MPS);
};

const resolveStopStatus = (
    hasCurrentLocation: boolean,
    busProgressMeters: number,
    stopProgressMeters: number,
    index: number,
    resolvedCurrentIndex: number,
): "passed" | "current" | "upcoming" => {
    if (hasCurrentLocation) {
        if (busProgressMeters >= stopProgressMeters + STOP_PASS_TOLERANCE_METERS) {
            return "passed";
        }

        return index === resolvedCurrentIndex ? "current" : "upcoming";
    }

    if (index < resolvedCurrentIndex) {
        return "passed";
    }

    return index === resolvedCurrentIndex ? "current" : "upcoming";
};

export const deriveRouteProgress = (input: {
    encodedPolyline?: string | null;
    routePoints?: GeoPoint[];
    stops: TrackingStop[] | null | undefined;
    currentLocation?: GeoPoint | null;
    speed?: unknown;
    routeEstimatedDurationSeconds?: number | null;
}): RouteProgressSnapshot | null => {
    const sortedStops = (input.stops ?? [])
        .map((stop) => ({
            ...stop,
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude),
        }))
        .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    if (!sortedStops.length) {
        return null;
    }

    const routePoints = decodeRoutePoints(
        input.encodedPolyline,
        input.routePoints ?? sortedStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    );

    const routeDistanceMeters = routePoints.length > 1
        ? routePoints.reduce((total, point, index) => {
            if (index === 0) {
                return total;
            }

            return total + haversineMeters(routePoints[index - 1], point);
        }, 0)
        : null;

    const effectiveSpeedMps = resolveEffectiveSpeedMps(
        input.speed,
        routeDistanceMeters,
        input.routeEstimatedDurationSeconds,
    );

    const projectedStops = sortedStops
        .map((stop) => {
            const projection = projectPointToRoute(
                { latitude: stop.latitude, longitude: stop.longitude },
                routePoints,
            );

            return {
                ...stop,
                routeProgressMeters: projection.alongMeters,
                routeDeviationMeters: projection.deviationMeters,
            };
        })
        .sort((a, b) => {
            if (a.routeProgressMeters === b.routeProgressMeters) {
                return a.sequenceOrder - b.sequenceOrder;
            }

            return a.routeProgressMeters - b.routeProgressMeters;
        });

    const currentLocation = normalizePoint(input.currentLocation);
    const currentProjection = currentLocation
        ? projectPointToRoute(currentLocation, routePoints)
        : null;

    const busProgressMeters = currentProjection?.alongMeters ?? 0;
    const routeDeviationMeters = currentProjection?.deviationMeters ?? null;
    const currentStopIndex = currentLocation
        ? projectedStops.findIndex((stop) => busProgressMeters < stop.routeProgressMeters + STOP_PASS_TOLERANCE_METERS)
        : 0;
    const resolvedCurrentIndex = currentStopIndex < 0 ? projectedStops.length - 1 : currentStopIndex;
    const nextStopIndex = resolvedCurrentIndex + 1 < projectedStops.length ? resolvedCurrentIndex + 1 : null;

    const stops = projectedStops.map((stop, index) => {
        const status = resolveStopStatus(
            Boolean(currentLocation),
            busProgressMeters,
            stop.routeProgressMeters,
            index,
            resolvedCurrentIndex,
        );
        const isPassed = status === "passed";
        const isCurrent = index === resolvedCurrentIndex;
        const distanceFromCurrentMeters = isPassed
            ? 0
            : Math.max(0, stop.routeProgressMeters - busProgressMeters);
        const etaFromCurrentSeconds = isPassed
            ? 0
            : Math.max(0, Math.round(distanceFromCurrentMeters / effectiveSpeedMps));
        const segmentDistanceMeters = index === 0
            ? stop.routeProgressMeters
            : Math.max(0, stop.routeProgressMeters - projectedStops[index - 1].routeProgressMeters);
        const segmentEtaSeconds = Math.max(0, Math.round(segmentDistanceMeters / effectiveSpeedMps));
        const etaFromCurrentText = isPassed ? "Completed" : formatEta(etaFromCurrentSeconds);

        return {
            id: stop.id,
            name: stop.name,
            latitude: stop.latitude,
            longitude: stop.longitude,
            sequenceOrder: stop.sequenceOrder,
            radiusMeters: stop.radiusMeters,
            status,
            isPassed,
            distanceFromCurrentMeters,
            distanceFromCurrentText: formatDistance(distanceFromCurrentMeters),
            etaFromCurrentSeconds,
            etaFromCurrentText,
            segmentDistanceMeters,
            segmentDistanceText: formatDistance(segmentDistanceMeters),
            segmentEtaSeconds,
            segmentEtaText: formatEta(segmentEtaSeconds),
            arrivalClockTimeText: isPassed
                ? "Completed"
                : new Date(Date.now() + etaFromCurrentSeconds * 1000).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                }),
            departedClockTimeText: stop.departedClockTimeText,
            leftSubLabel: isPassed
                ? "Completed"
                : `${etaFromCurrentText} away`,
            rightPrimaryLabel: isPassed ? "Completed" : etaFromCurrentText,
            rightSecondaryLabel: isCurrent ? "CURRENT" : undefined,
        };
    });

    const etaToDestinationSeconds = stops.length
        ? stops[stops.length - 1].etaFromCurrentSeconds
        : null;

    return {
        currentStopId: projectedStops[resolvedCurrentIndex]?.id ?? null,
        nextStopId: nextStopIndex != null ? projectedStops[nextStopIndex]?.id ?? null : null,
        etaToDestinationSeconds,
        etaToDestinationText: etaToDestinationSeconds == null ? null : formatEta(etaToDestinationSeconds),
        routeDistanceMeters,
        routeDeviationMeters,
        effectiveSpeedMps,
        stops,
    };
};
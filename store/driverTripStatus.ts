import {
    normalizeTripStatus,
    type TripStatus,
} from "./busStatus";

export enum DriverConnectionState {
  CONNECTED = "CONNECTED",
  RECONNECTING = "RECONNECTING",
  DISCONNECTED_GRACE = "DISCONNECTED_GRACE",
  DISCONNECTED_HARD = "DISCONNECTED_HARD",
}

export const DEFAULT_DRIVER_DISCONNECT_GRACE_MS = Number(
  process.env.EXPO_PUBLIC_DRIVER_DISCONNECT_GRACE_MS || 15000,
);

export const ROUTE_CHANGE_CONFLICT_MESSAGE =
  "Trip is active. Complete or cancel trip before changing route.";

export const getDriverConnectionMessage = (
  state: DriverConnectionState,
): string => {
  if (state === DriverConnectionState.CONNECTED) {
    return "Live signal available.";
  }

  if (
    state === DriverConnectionState.RECONNECTING ||
    state === DriverConnectionState.DISCONNECTED_GRACE
  ) {
    return "Connection unstable. Keeping current trip state while reconnecting.";
  }

  return "Live signal unavailable. Trip status may be reset to Trip Not Started.";
};

export const isLiveOrWithinGrace = (state: DriverConnectionState): boolean =>
  state === DriverConnectionState.CONNECTED ||
  state === DriverConnectionState.RECONNECTING ||
  state === DriverConnectionState.DISCONNECTED_GRACE;

export const deriveDriverTripStatusForDisplay = (params: {
  backendTripStatus: unknown;
  trackingEnabled: boolean;
  connectionState: DriverConnectionState;
}): TripStatus => {
  const normalized = normalizeTripStatus(params.backendTripStatus);

  if (normalized === "ON_TRIP") {
    if (params.trackingEnabled && isLiveOrWithinGrace(params.connectionState)) {
      return "ON_TRIP";
    }

    return "TRIP_NOT_STARTED";
  }

  if (normalized === "UNKNOWN") {
    return "TRIP_NOT_STARTED";
  }

  return normalized;
};

export const isRouteChangeConflictError = (error: unknown): boolean => {
  const e = error as {
    response?: {
      status?: number;
      data?: {
        action?: string;
      };
    };
  };

  return (
    e?.response?.status === 409 &&
    e?.response?.data?.action === "complete_or_cancel_trip_then_retry"
  );
};

import { describe, expect, it } from "vitest";
import {
    DriverConnectionState,
    ROUTE_CHANGE_CONFLICT_MESSAGE,
    deriveDriverTripStatusForDisplay,
    getDriverConnectionMessage,
    isLiveOrWithinGrace,
    isRouteChangeConflictError,
} from "./driverTripStatus";

describe("driver connection messaging", () => {
  it("returns required user messages for each connection state", () => {
    expect(getDriverConnectionMessage(DriverConnectionState.CONNECTED)).toBe(
      "Live signal available.",
    );
    expect(getDriverConnectionMessage(DriverConnectionState.RECONNECTING)).toBe(
      "Connection unstable. Keeping current trip state while reconnecting.",
    );
    expect(
      getDriverConnectionMessage(DriverConnectionState.DISCONNECTED_GRACE),
    ).toBe("Connection unstable. Keeping current trip state while reconnecting.");
    expect(
      getDriverConnectionMessage(DriverConnectionState.DISCONNECTED_HARD),
    ).toBe("Live signal unavailable. Trip status may be reset to Trip Not Started.");
  });

  it("treats connected and grace states as live for trip-status gate", () => {
    expect(isLiveOrWithinGrace(DriverConnectionState.CONNECTED)).toBe(true);
    expect(isLiveOrWithinGrace(DriverConnectionState.RECONNECTING)).toBe(true);
    expect(isLiveOrWithinGrace(DriverConnectionState.DISCONNECTED_GRACE)).toBe(
      true,
    );
    expect(isLiveOrWithinGrace(DriverConnectionState.DISCONNECTED_HARD)).toBe(
      false,
    );
  });
});

describe("driver trip status display rule", () => {
  it("shows ON_TRIP only when tracking is enabled and socket is live/grace", () => {
    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "ON_TRIP",
        trackingEnabled: true,
        connectionState: DriverConnectionState.CONNECTED,
      }),
    ).toBe("ON_TRIP");

    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "ON_TRIP",
        trackingEnabled: true,
        connectionState: DriverConnectionState.DISCONNECTED_GRACE,
      }),
    ).toBe("ON_TRIP");

    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "ON_TRIP",
        trackingEnabled: false,
        connectionState: DriverConnectionState.CONNECTED,
      }),
    ).toBe("TRIP_NOT_STARTED");

    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "ON_TRIP",
        trackingEnabled: true,
        connectionState: DriverConnectionState.DISCONNECTED_HARD,
      }),
    ).toBe("TRIP_NOT_STARTED");
  });

  it("preserves backend-derived non-ON_TRIP statuses", () => {
    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "COMPLETED",
        trackingEnabled: false,
        connectionState: DriverConnectionState.DISCONNECTED_HARD,
      }),
    ).toBe("COMPLETED");

    expect(
      deriveDriverTripStatusForDisplay({
        backendTripStatus: "DELAYED",
        trackingEnabled: true,
        connectionState: DriverConnectionState.CONNECTED,
      }),
    ).toBe("DELAYED");
  });
});

describe("route conflict handling", () => {
  it("detects actionable route conflict API error", () => {
    const err = {
      response: {
        status: 409,
        data: {
          action: "complete_or_cancel_trip_then_retry",
        },
      },
    };

    expect(isRouteChangeConflictError(err)).toBe(true);
    expect(ROUTE_CHANGE_CONFLICT_MESSAGE).toBe(
      "Trip is active. Complete or cancel trip before changing route.",
    );
  });

  it("ignores unrelated API errors", () => {
    expect(
      isRouteChangeConflictError({
        response: { status: 409, data: { action: "other" } },
      }),
    ).toBe(false);

    expect(
      isRouteChangeConflictError({
        response: { status: 500, data: { action: "complete_or_cancel_trip_then_retry" } },
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
    UNKNOWN_STATUS_CODE,
    UNKNOWN_STATUS_LABEL,
    createBusStatusStateFromRestSnapshot,
    getFleetStatusLabel,
    getStatusVariant,
    getTrackingStatusLabel,
    getTripStatusLabel,
    mergeBusStatusFromSocketUpdate,
    normalizeFleetStatus,
    normalizeTrackingStatus,
    normalizeTripStatus,
} from "./busStatus";

describe("status normalizers", () => {
    it("normalizes fleet statuses with case-insensitive and trimmed inputs", () => {
        expect(normalizeFleetStatus(" in_service ")).toBe("IN_SERVICE");
        expect(normalizeFleetStatus("Out-Of-Service")).toBe("OUT_OF_SERVICE");
        expect(normalizeFleetStatus("maintenance")).toBe("MAINTENANCE");
    });

    it("normalizes trip statuses with case-insensitive and trimmed inputs", () => {
        expect(normalizeTripStatus(" pending ")).toBe("PENDING");
        expect(normalizeTripStatus("started")).toBe("STARTED");
        expect(normalizeTripStatus("running")).toBe("RUNNING");
    });

    it("normalizes tracking statuses with case-insensitive and trimmed inputs", () => {
        expect(normalizeTrackingStatus(" running ")).toBe("RUNNING");
        expect(normalizeTrackingStatus("NO SIGNAL")).toBe("NO_SIGNAL");
        expect(normalizeTrackingStatus("offline")).toBe("OFFLINE");
    });
});

describe("status labels", () => {
    it("maps canonical labels for fleet statuses", () => {
        expect(getFleetStatusLabel("IN_SERVICE")).toBe("In Service");
        expect(getFleetStatusLabel("OUT_OF_SERVICE")).toBe("Out of Service");
        expect(getFleetStatusLabel("MAINTENANCE")).toBe("Maintenance");
    });

    it("maps canonical labels for trip statuses", () => {
        expect(getTripStatusLabel("PENDING")).toBe("Ready to start");
        expect(getTripStatusLabel("STARTED")).toBe("Trip started");
        expect(getTripStatusLabel("RUNNING")).toBe("Bus moving");
        expect(getTripStatusLabel("STOPPED")).toBe("Bus stopped");
        expect(getTripStatusLabel("COMPLETED")).toBe("Completed");
        expect(getTripStatusLabel("CANCELLED")).toBe("Cancelled");
    });

    it("renders both OFFLINE and NO_SIGNAL as No Signal", () => {
        expect(getTrackingStatusLabel("OFFLINE")).toBe("No Signal");
        expect(getTrackingStatusLabel("NO_SIGNAL")).toBe("No Signal");
    });

    it("falls back safely for unknown status values", () => {
        expect(normalizeFleetStatus("BAD_STATUS")).toBe(UNKNOWN_STATUS_CODE);
        expect(normalizeTripStatus(null)).toBe(UNKNOWN_STATUS_CODE);
        expect(normalizeTrackingStatus("??")).toBe(UNKNOWN_STATUS_CODE);

        expect(getFleetStatusLabel("BAD_STATUS")).toBe(UNKNOWN_STATUS_LABEL);
        expect(getTripStatusLabel(undefined)).toBe(UNKNOWN_STATUS_LABEL);
        expect(getTrackingStatusLabel("??")).toBe(UNKNOWN_STATUS_LABEL);
    });
});

describe("status variants", () => {
    it("maps recommended semantic variants", () => {
        expect(getStatusVariant("trackingStatus", "RUNNING")).toBe("success");
        expect(getStatusVariant("tripStatus", "STARTED")).toBe("success");
        expect(getStatusVariant("tripStatus", "RUNNING")).toBe("success");

        expect(getStatusVariant("fleetStatus", "MAINTENANCE")).toBe("warning");

        expect(getStatusVariant("tripStatus", "CANCELLED")).toBe("danger");
        expect(getStatusVariant("fleetStatus", "OUT_OF_SERVICE")).toBe("danger");

        expect(getStatusVariant("trackingStatus", "IDLE")).toBe("neutral");
        expect(getStatusVariant("trackingStatus", "STOPPED")).toBe("neutral");

        expect(getStatusVariant("trackingStatus", "NO_SIGNAL")).toBe("muted");
        expect(getStatusVariant("trackingStatus", "OFFLINE")).toBe("muted");
    });
});

describe("socket status merge", () => {
    it("does not update state when payload is marked skipped", () => {
        const previous = createBusStatusStateFromRestSnapshot({
            trackingStatus: "RUNNING",
            tripStatus: "RUNNING",
            status: "RUNNING",
            lastUpdated: "2026-03-17T16:29:35.478Z",
        });

        const merged = mergeBusStatusFromSocketUpdate(previous, {
            skipped: true,
            trackingStatus: "OFFLINE",
            tripStatus: "CANCELLED",
            status: "OFFLINE",
            timestamp: "2026-03-17T16:31:35.478Z",
        });

        expect(merged).toBe(previous);
        expect(merged.trackingStatus.code).toBe("RUNNING");
        expect(merged.tripStatus.code).toBe("RUNNING");
        expect(merged.lastUpdated).toBe("2026-03-17T16:29:35.478Z");
    });

    it("updates changed status fields when skipped is false", () => {
        const previous = createBusStatusStateFromRestSnapshot({
            trackingStatus: "IDLE",
            tripStatus: "PENDING",
            status: "IDLE",
            lastUpdated: "2026-03-17T16:29:35.478Z",
        });

        const merged = mergeBusStatusFromSocketUpdate(previous, {
            skipped: false,
            trackingStatus: "running",
            tripStatus: "running",
            status: "running",
            timestamp: "2026-03-17T16:30:35.478Z",
        });

        expect(merged).not.toBe(previous);
        expect(merged.trackingStatus.code).toBe("RUNNING");
        expect(merged.trackingStatus.label).toBe("Running");
        expect(merged.tripStatus.code).toBe("RUNNING");
        expect(merged.tripStatus.label).toBe("Bus moving");
        expect(merged.rawStatus).toBe("running");
        expect(merged.lastUpdated).toBe("2026-03-17T16:30:35.478Z");
    });

    it("returns same reference when socket payload has no status changes", () => {
        const previous = createBusStatusStateFromRestSnapshot({
            trackingStatus: "RUNNING",
            tripStatus: "RUNNING",
            status: "RUNNING",
            lastUpdated: "2026-03-17T16:29:35.478Z",
        });

        const merged = mergeBusStatusFromSocketUpdate(previous, {
            skipped: false,
            trackingStatus: "RUNNING",
            tripStatus: "RUNNING",
            status: "RUNNING",
            timestamp: "2026-03-17T16:29:35.478Z",
        });

        expect(merged).toBe(previous);
    });
});

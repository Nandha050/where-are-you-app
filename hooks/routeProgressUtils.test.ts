import { describe, expect, it } from "vitest";
import { deriveRouteProgress } from "./routeProgressUtils";

describe("deriveRouteProgress", () => {
    it("marks stops as passed/current/upcoming when the bus has crossed a stop", () => {
        const progress = deriveRouteProgress({
            routePoints: [
                { latitude: 17.500, longitude: 78.100 },
                { latitude: 17.500, longitude: 78.110 },
                { latitude: 17.500, longitude: 78.120 },
                { latitude: 17.500, longitude: 78.130 },
            ],
            stops: [
                { id: "stop-1", name: "BVRIT", latitude: 17.500, longitude: 78.100, sequenceOrder: 1 },
                { id: "stop-2", name: "Sangareddy", latitude: 17.500, longitude: 78.110, sequenceOrder: 2 },
                { id: "stop-3", name: "Isnapur", latitude: 17.500, longitude: 78.120, sequenceOrder: 3 },
                { id: "stop-4", name: "Patancheru", latitude: 17.500, longitude: 78.130, sequenceOrder: 4 },
            ],
            currentLocation: { latitude: 17.500, longitude: 78.115 },
            speed: 10,
        });

        expect(progress).not.toBeNull();
        expect(progress?.currentStopId).toBe("stop-3");
        expect(progress?.nextStopId).toBe("stop-4");
        expect(progress?.stops.map((stop) => stop.status)).toEqual([
            "passed",
            "passed",
            "current",
            "upcoming",
        ]);
        expect(progress?.stops[2].etaFromCurrentSeconds).toBeGreaterThan(0);
        expect(progress?.stops[0].etaFromCurrentText).toBe("Completed");
    });

    it("falls back to a reasonable ETA when speed is missing", () => {
        const progress = deriveRouteProgress({
            routePoints: [
                { latitude: 17.500, longitude: 78.100 },
                { latitude: 17.500, longitude: 78.120 },
            ],
            stops: [
                { id: "stop-1", name: "A", latitude: 17.500, longitude: 78.100, sequenceOrder: 1 },
                { id: "stop-2", name: "B", latitude: 17.500, longitude: 78.120, sequenceOrder: 2 },
            ],
            currentLocation: { latitude: 17.500, longitude: 78.105 },
        });

        expect(progress).not.toBeNull();
        expect(progress?.etaToDestinationSeconds).not.toBeNull();
        expect(progress?.etaToDestinationText).toMatch(/min|Completed/);
    });
});
import { describe, expect, it } from "vitest";
import {
    parseEtaUpdate,
    parseStopUpdate,
    shouldApplyLocationUpdate,
    shouldIgnoreStopUpdate,
} from "./routeTrackingUtils";

describe("useRouteTracking helpers", () => {
    it("ignores duplicate or stale stop updates", () => {
        const shouldIgnoreDuplicate = shouldIgnoreStopUpdate(
            {
                lastStopTimestamp: 1000,
                currentStopId: "stop-1",
            },
            {
                timestamp: 1000,
                currentStopId: "stop-1",
            },
        );

        const shouldIgnoreStale = shouldIgnoreStopUpdate(
            {
                lastStopTimestamp: 2000,
                currentStopId: "stop-2",
            },
            {
                timestamp: 1500,
                currentStopId: "stop-2",
            },
        );

        const shouldApply = shouldIgnoreStopUpdate(
            {
                lastStopTimestamp: 2000,
                currentStopId: "stop-2",
            },
            {
                timestamp: 2001,
                currentStopId: "stop-3",
            },
        );

        expect(shouldIgnoreDuplicate).toBe(true);
        expect(shouldIgnoreStale).toBe(true);
        expect(shouldApply).toBe(false);
    });

    it("applies only newer location updates", () => {
        expect(
            shouldApplyLocationUpdate(
                {
                    timestamp: 3001,
                },
                3000,
            ),
        ).toBe(true);

        expect(
            shouldApplyLocationUpdate(
                {
                    timestamp: 3000,
                },
                3000,
            ),
        ).toBe(false);

        expect(
            shouldApplyLocationUpdate(
                {
                    timestamp: 2999,
                },
                3000,
            ),
        ).toBe(false);
    });

    it("parses etaUpdate with backend-driven timeline metadata", () => {
        const parsed = parseEtaUpdate({
            busId: "bus-1",
            etaMap: {
                "stop-1": 45,
            },
            routeEtaSummary: {
                etaToDestinationSeconds: 780,
                etaToDestinationText: "13 min",
            },
            stops: [
                {
                    id: "stop-1",
                    name: "Union Square",
                    sequenceOrder: 2,
                    status: "current",
                    leftSubLabel: "Arriving Now",
                    rightPrimaryLabel: "1:04 PM",
                    rightSecondaryLabel: "CURRENT",
                },
            ],
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.routeEtaSummary?.etaToDestinationText).toBe("13 min");
        expect(parsed?.stops?.[0]?.status).toBe("current");
        expect(parsed?.stops?.[0]?.leftSubLabel).toBe("Arriving Now");
    });

    it("keeps fallback compatibility when new timeline fields are missing", () => {
        const parsed = parseEtaUpdate({
            busId: "bus-1",
            etaMap: {
                "stop-2": 300,
            },
            stops: [
                {
                    id: "stop-2",
                    name: "Tech District East",
                    etaFromCurrentSeconds: 300,
                    etaFromCurrentText: "5 min",
                    segmentEtaSeconds: 120,
                },
            ],
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.stops?.[0]?.leftSubLabel).toBeUndefined();
        expect(parsed?.stops?.[0]?.etaFromCurrentText).toBe("5 min");
    });

    it("parses stopUpdate timeline patches for current and next stops", () => {
        const parsed = parseStopUpdate({
            busId: "bus-1",
            routeId: "route-1",
            currentStopId: "stop-2",
            nextStopId: "stop-3",
            timestamp: 1729000000,
            timeline: {
                currentStop: {
                    id: "stop-2",
                    status: "current",
                    leftSubLabel: "Arriving Now",
                    rightSecondaryLabel: "CURRENT",
                },
                nextStop: {
                    id: "stop-3",
                    status: "upcoming",
                    leftSubLabel: "In 6 mins",
                    rightPrimaryLabel: "1:10 PM",
                },
            },
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.timeline?.currentStop?.status).toBe("current");
        expect(parsed?.timeline?.nextStop?.leftSubLabel).toBe("In 6 mins");
    });
});

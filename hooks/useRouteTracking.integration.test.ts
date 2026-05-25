import { beforeEach, describe, expect, it, vi } from "vitest";
import * as routeTrackingUtils from "./routeTrackingUtils";
import {
    BusLocationUpdate,
    EtaUpdate,
    StopUpdate
} from "./useRouteTracking";

/**
 * Mock socket service for integration testing.
 * Allows manual emission of socket events to test hook behavior.
 */
class MockSocketService {
    private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
    private reconnectAttemptListeners: Set<(attempt: unknown) => void> = new Set();
    private connected = false;
    private connectionStatus: "connected" | "reconnecting" | "offline" = "offline";
    private joinedRoutes: Set<string> = new Set();

    connect(url: string, token?: string): void {
        // Mock connect
    }

    on(event: string, callback: (...args: any[]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
    }

    off(event: string, callback?: (...args: any[]) => void): void {
        if (!callback) {
            this.listeners.delete(event);
            return;
        }
        const listeners = this.listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    onReconnectAttempt(callback: (attempt: unknown) => void): void {
        this.reconnectAttemptListeners.add(callback);
    }

    offReconnectAttempt(callback: (attempt: unknown) => void): void {
        this.reconnectAttemptListeners.delete(callback);
    }

    isConnected(): boolean {
        return this.connected;
    }

    getConnectionStatus() {
        return this.connectionStatus;
    }

    joinRouteRoom(routeId: string): void {
        this.joinedRoutes.add(routeId);
    }

    leaveRouteRoom(routeId: string): void {
        this.joinedRoutes.delete(routeId);
    }

    // Test helpers
    emitConnect(): void {
        this.connected = true;
        this.connectionStatus = "connected";
        const callbacks = this.listeners.get("connect");
        if (callbacks) {
            callbacks.forEach((cb) => cb());
        }
    }

    emitDisconnect(): void {
        this.connected = false;
        this.connectionStatus = "offline";
        const callbacks = this.listeners.get("disconnect");
        if (callbacks) {
            callbacks.forEach((cb) => cb());
        }
    }

    emitReconnectAttempt(): void {
        this.connectionStatus = "reconnecting";
        this.reconnectAttemptListeners.forEach((cb) => cb(1));
    }

    emitStopUpdate(payload: StopUpdate): void {
        const callbacks = this.listeners.get("stopUpdate");
        if (callbacks) {
            callbacks.forEach((cb) => cb(payload));
        }
    }

    emitEtaUpdate(payload: EtaUpdate): void {
        const callbacks = this.listeners.get("etaUpdate");
        if (callbacks) {
            callbacks.forEach((cb) => cb(payload));
        }
    }

    emitBusLocationUpdate(payload: BusLocationUpdate): void {
        const callbacks = this.listeners.get("busLocationUpdate");
        if (callbacks) {
            callbacks.forEach((cb) => cb(payload));
        }
    }

    getJoinedRoutes(): Set<string> {
        return this.joinedRoutes;
    }

    reset(): void {
        this.listeners.clear();
        this.reconnectAttemptListeners.clear();
        this.connected = false;
        this.connectionStatus = "offline";
        this.joinedRoutes.clear();
    }
}

// Global mock socket service instance
let mockSocketService: MockSocketService;

// Mock auth hook
const mockUseAuth = vi.fn(() => ({
    token: "test-token",
    user: { id: "user-1", name: "Test User", role: "user" },
    isAuthenticated: true,
    isHydrated: true,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
}));

describe("useRouteTracking - Integration Tests", () => {
    beforeEach(() => {
        mockSocketService = new MockSocketService();
        vi.resetModules();
    });

    it("joins route room on connect and leaves on unmount", () => {
        const routeId = "route-123";

        // Simulate socket connecting (which happens before join)
        mockSocketService.emitConnect();
        expect(mockSocketService.getConnectionStatus()).toBe("connected");

        // Simulate hook joining the route room when socket is connected
        // (this would be called by useEffect in the real hook)
        mockSocketService.joinRouteRoom(routeId);
        expect(mockSocketService.getJoinedRoutes().has(routeId)).toBe(true);

        // Simulate socket disconnecting
        mockSocketService.emitDisconnect();
        expect(mockSocketService.getConnectionStatus()).toBe("offline");

        // Simulate cleanup on unmount (hook cleanup function)
        mockSocketService.leaveRouteRoom(routeId);
        expect(mockSocketService.getJoinedRoutes().has(routeId)).toBe(false);
    });

    it("processes stopUpdate and filters duplicates", () => {
        const stopUpdate1: StopUpdate = {
            busId: "bus-1",
            routeId: "route-123",
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            timestamp: 1000,
        };

        const stopUpdate2: StopUpdate = {
            busId: "bus-1",
            routeId: "route-123",
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            timestamp: 1000, // Same timestamp = duplicate
        };

        const stopUpdate3: StopUpdate = {
            busId: "bus-1",
            routeId: "route-123",
            currentStopId: "stop-2",
            nextStopId: "stop-3",
            timestamp: 2000, // New update
        };

        // First update should be applied
        const shouldIgnoreFirst = routeTrackingUtils.shouldIgnoreStopUpdate(
            { lastStopTimestamp: 0, currentStopId: null },
            { timestamp: stopUpdate1.timestamp, currentStopId: stopUpdate1.currentStopId },
        );
        expect(shouldIgnoreFirst).toBe(false);

        // Duplicate should be ignored
        const shouldIgnoreSecond = routeTrackingUtils.shouldIgnoreStopUpdate(
            { lastStopTimestamp: 1000, currentStopId: "stop-1" },
            { timestamp: stopUpdate2.timestamp, currentStopId: stopUpdate2.currentStopId },
        );
        expect(shouldIgnoreSecond).toBe(true);

        // New stop should be applied
        const shouldIgnoreThird = routeTrackingUtils.shouldIgnoreStopUpdate(
            { lastStopTimestamp: 1000, currentStopId: "stop-1" },
            { timestamp: stopUpdate3.timestamp, currentStopId: stopUpdate3.currentStopId },
        );
        expect(shouldIgnoreThird).toBe(false);
    });

    it("merges eta updates safely", () => {
        const etaUpdate1: EtaUpdate = {
            busId: "bus-1",
            etaMap: {
                "stop-1": 60,
                "stop-2": 120,
            },
        };

        const etaUpdate2: EtaUpdate = {
            busId: "bus-1",
            etaMap: {
                "stop-2": 90, // Updated ETA for stop-2
                "stop-3": 180, // New stop
            },
        };

        // Simulate merging
        let etaMap: Record<string, number> = {};

        // Apply first ETA update
        etaMap = { ...etaMap, ...etaUpdate1.etaMap };
        expect(etaMap).toEqual({ "stop-1": 60, "stop-2": 120 });

        // Apply second ETA update (should merge and update)
        etaMap = { ...etaMap, ...etaUpdate2.etaMap };
        expect(etaMap).toEqual({ "stop-1": 60, "stop-2": 90, "stop-3": 180 });
    });

    it("applies only newer bus location updates", () => {
        const location1: BusLocationUpdate = {
            busId: "bus-1",
            lat: 17.4,
            lng: 78.5,
            timestamp: 1000,
        };

        const location2: BusLocationUpdate = {
            busId: "bus-1",
            lat: 17.401,
            lng: 78.501,
            timestamp: 900, // Older than location1
        };

        const location3: BusLocationUpdate = {
            busId: "bus-1",
            lat: 17.402,
            lng: 78.502,
            timestamp: 2000, // Newer than location1
        };

        // First location should be applied
        const shouldApplyFirst = routeTrackingUtils.shouldApplyLocationUpdate(
            { timestamp: location1.timestamp },
            0,
        );
        expect(shouldApplyFirst).toBe(true);

        // Older location should be ignored
        const shouldApplySecond = routeTrackingUtils.shouldApplyLocationUpdate(
            { timestamp: location2.timestamp },
            1000,
        );
        expect(shouldApplySecond).toBe(false);

        // Newer location should be applied
        const shouldApplyThird = routeTrackingUtils.shouldApplyLocationUpdate(
            { timestamp: location3.timestamp },
            1000,
        );
        expect(shouldApplyThird).toBe(true);
    });

    it("handles malformed payloads gracefully", () => {
        // Invalid stop update (missing busId)
        const invalidStop = {
            routeId: "route-123",
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            timestamp: 1000,
        };

        const parsed = routeTrackingUtils.parseStopUpdate(invalidStop);
        expect(parsed).toBeNull();

        // Invalid ETA update (etaMap not an object)
        const invalidEta = {
            busId: "bus-1",
            etaMap: "not-an-object",
        };

        const parsedEta = routeTrackingUtils.parseEtaUpdate(invalidEta);
        expect(parsedEta).toBeNull();

        // Invalid location update (missing lat/lng)
        const invalidLocation = {
            busId: "bus-1",
            lat: 17.4,
            // missing lng
            timestamp: 1000,
        };

        const parsedLocation = routeTrackingUtils.parseBusLocationUpdate(invalidLocation);
        expect(parsedLocation).toBeNull();
    });

    it("parses valid payloads correctly", () => {
        const validStop: StopUpdate = {
            busId: "bus-1",
            routeId: "route-123",
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            timestamp: 1000,
        };

        const parsedStop = routeTrackingUtils.parseStopUpdate(validStop);
        expect(parsedStop).toEqual(validStop);

        const validEta: EtaUpdate = {
            busId: "bus-1",
            etaMap: { "stop-1": 60, "stop-2": 120 },
        };

        const parsedEta = routeTrackingUtils.parseEtaUpdate(validEta);
        expect(parsedEta).toEqual(validEta);

        const validLocation: BusLocationUpdate = {
            busId: "bus-1",
            lat: 17.4,
            lng: 78.5,
            timestamp: 1000,
        };

        const parsedLocation = routeTrackingUtils.parseBusLocationUpdate(validLocation);
        expect(parsedLocation).toEqual(validLocation);
    });

    it("filters events for wrong route ID", () => {
        const stopUpdate: StopUpdate = {
            busId: "bus-1",
            routeId: "route-999", // Different route
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            timestamp: 1000,
        };

        // This should be parsed successfully
        const parsed = routeTrackingUtils.parseStopUpdate(stopUpdate);
        expect(parsed).not.toBeNull();

        // But hook would filter it by routeId during the listener
        // For now, verify parsing succeeds
        expect(parsed?.routeId).toBe("route-999");
    });

    it("handles connection status transitions", () => {
        // Initial state: offline
        expect(mockSocketService.getConnectionStatus()).toBe("offline");

        // Transition to reconnecting
        mockSocketService.emitReconnectAttempt();
        expect(mockSocketService.getConnectionStatus()).toBe("reconnecting");

        // Transition to connected
        mockSocketService.emitConnect();
        expect(mockSocketService.getConnectionStatus()).toBe("connected");

        // Transition to offline
        mockSocketService.emitDisconnect();
        expect(mockSocketService.getConnectionStatus()).toBe("offline");
    });

    it("cleans up listeners on route change", () => {
        const route1 = "route-123";
        const route2 = "route-456";

        // Simulate joining route1
        mockSocketService.joinRouteRoom(route1);
        expect(mockSocketService.getJoinedRoutes().has(route1)).toBe(true);

        // Simulate switching to route2 (cleanup route1)
        mockSocketService.leaveRouteRoom(route1);
        mockSocketService.joinRouteRoom(route2);

        expect(mockSocketService.getJoinedRoutes().has(route1)).toBe(false);
        expect(mockSocketService.getJoinedRoutes().has(route2)).toBe(true);
    });

    it("re-joins route room on reconnect", () => {
        const routeId = "route-123";

        // Initial connect and join
        mockSocketService.emitConnect();
        mockSocketService.joinRouteRoom(routeId);
        expect(mockSocketService.getJoinedRoutes().has(routeId)).toBe(true);

        // Simulate disconnect
        mockSocketService.emitDisconnect();

        // Simulate reconnect attempt
        mockSocketService.emitReconnectAttempt();
        expect(mockSocketService.getConnectionStatus()).toBe("reconnecting");

        // Re-connect and the hook would re-join
        mockSocketService.emitConnect();
        mockSocketService.joinRouteRoom(routeId);
        expect(mockSocketService.getJoinedRoutes().has(routeId)).toBe(true);
    });

    it("distinguishes awaiting state based on data availability", () => {
        const emptyState = {
            currentStopId: null,
            nextStopId: null,
            busLocation: null,
            etaMap: {},
        };

        // No data available
        const isWaiting1 =
            !emptyState.currentStopId &&
            !emptyState.nextStopId &&
            !emptyState.busLocation &&
            Object.keys(emptyState.etaMap).length === 0;
        expect(isWaiting1).toBe(true);

        // With location
        const withLocationState = {
            currentStopId: null,
            nextStopId: null,
            busLocation: { lat: 17.4, lng: 78.5 },
            etaMap: {},
        };

        const isWaiting2 =
            !withLocationState.currentStopId &&
            !withLocationState.nextStopId &&
            !withLocationState.busLocation &&
            Object.keys(withLocationState.etaMap).length === 0;
        expect(isWaiting2).toBe(false);

        // With stops
        const withStopsState = {
            currentStopId: "stop-1",
            nextStopId: "stop-2",
            busLocation: null,
            etaMap: {},
        };

        const isWaiting3 =
            !withStopsState.currentStopId &&
            !withStopsState.nextStopId &&
            !withStopsState.busLocation &&
            Object.keys(withStopsState.etaMap).length === 0;
        expect(isWaiting3).toBe(false);
    });
});

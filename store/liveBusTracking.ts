import { API_BASE_URL } from "../api/client";
import socketService from "../sockets/socketService";

const SIGNAL_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 12_000;

export type LiveStatusLabel = "Running" | "Stopped" | "Idle" | "No Signal";

export type BusLocationUpdatePayload = {
    busId?: string | number;
    bus?: { id?: string | number; _id?: string | number };
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
    speed?: number | string;
    status?: string;
    timestamp?: string;
    trackingStatus?: string;
    tripStatus?: string;
    skipped?: boolean;
    location?: {
        lat?: number | string;
        lng?: number | string;
        latitude?: number | string;
        longitude?: number | string;
        speed?: number | string;
    };
};

export type LiveBusSnapshot = {
    busId: string;
    lat: number | null;
    lng: number | null;
    speed: number | null;
    status: string;
    displayStatus: LiveStatusLabel;
    timestamp: string | null;
    trackingStatus: string | null;
    tripStatus: string | null;
    skipped: boolean;
    lastUpdateMs: number;
};

type Listener = () => void;

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

const normalizeStatus = (status: unknown): LiveStatusLabel => {
    const value = String(status ?? "").trim().toLowerCase();

    if (value === "running") return "Running";
    if (value === "stopped") return "Stopped";
    if (value === "idle") return "Idle";
    if (value === "no signal" || value === "nosignal" || value === "offline") {
        return "No Signal";
    }

    return "Idle";
};

const toBusSnapshot = (payload: BusLocationUpdatePayload): LiveBusSnapshot | null => {
    const busIdRaw = payload.busId ?? payload.bus?.id ?? payload.bus?._id ?? null;
    const busId = busIdRaw == null ? "" : String(busIdRaw).trim();
    if (!busId) {
        return null;
    }

    const lat =
        toNumber(payload.lat) ??
        toNumber(payload.latitude) ??
        toNumber(payload.location?.lat) ??
        toNumber(payload.location?.latitude) ??
        null;

    const lng =
        toNumber(payload.lng) ??
        toNumber(payload.longitude) ??
        toNumber(payload.location?.lng) ??
        toNumber(payload.location?.longitude) ??
        null;

    const speed = toNumber(payload.speed) ?? toNumber(payload.location?.speed) ?? null;

    const rawStatus = payload.status ?? payload.trackingStatus ?? "Idle";
    const status = String(rawStatus ?? "Idle");
    const displayStatus = normalizeStatus(rawStatus);

    const timestamp =
        typeof payload.timestamp === "string" && payload.timestamp.trim().length
            ? payload.timestamp
            : new Date().toISOString();

    const parsedTs = new Date(timestamp).getTime();
    const lastUpdateMs = Number.isFinite(parsedTs) ? parsedTs : Date.now();

    return {
        busId,
        lat,
        lng,
        speed,
        status,
        displayStatus,
        timestamp,
        trackingStatus:
            payload.trackingStatus == null ? null : String(payload.trackingStatus),
        tripStatus: payload.tripStatus == null ? null : String(payload.tripStatus),
        skipped: Boolean(payload.skipped),
        lastUpdateMs,
    };
};

class LiveBusTrackingStore {
    private token: string | undefined;
    private initialized = false;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    private connectionState = false;

    private buses = new Map<string, LiveBusSnapshot>();
    private busListeners = new Map<string, Set<Listener>>();
    private listListeners = new Set<Listener>();
    private connectionListeners = new Set<Listener>();

    private roomRefCounts = new Map<string, number>();

    private readonly onConnect = () => {
        this.connectionState = true;
        this.notifyConnection();
        this.rejoinTrackedRooms();
    };

    private readonly onDisconnect = () => {
        this.connectionState = false;
        this.notifyConnection();
    };

    private readonly onBusLocationUpdate = (payload: unknown) => {
        this.upsert(payload as BusLocationUpdatePayload);
    };

    initialize(token?: string) {
        this.token = token ?? undefined;

        socketService.connect(API_BASE_URL, this.token);

        if (this.initialized) {
            this.connectionState = socketService.isConnected();
            this.notifyConnection();
            this.ensureWatchdog();
            return;
        }

        this.initialized = true;
        this.connectionState = socketService.isConnected();

        socketService.on("connect", this.onConnect);
        socketService.on("disconnect", this.onDisconnect);
        socketService.on("busLocationUpdate", this.onBusLocationUpdate);

        this.ensureWatchdog();
    }

    subscribeBus(busId: string, listener: Listener): () => void {
        const key = String(busId || "").trim();
        if (!key) {
            return () => undefined;
        }

        let listeners = this.busListeners.get(key);
        if (!listeners) {
            listeners = new Set<Listener>();
            this.busListeners.set(key, listeners);
        }

        listeners.add(listener);

        return () => {
            const set = this.busListeners.get(key);
            if (!set) {
                return;
            }

            set.delete(listener);
            if (!set.size) {
                this.busListeners.delete(key);
            }
        };
    }

    subscribeList(listener: Listener): () => void {
        this.listListeners.add(listener);
        return () => {
            this.listListeners.delete(listener);
        };
    }

    subscribeConnection(listener: Listener): () => void {
        this.connectionListeners.add(listener);
        return () => {
            this.connectionListeners.delete(listener);
        };
    }

    getBusSnapshot(busId?: string): LiveBusSnapshot | null {
        if (!busId) {
            return null;
        }
        return this.buses.get(String(busId)) ?? null;
    }

    getBusListSnapshot(busIds: string[]): LiveBusSnapshot[] {
        return busIds
            .map((busId) => this.buses.get(String(busId)))
            .filter((item): item is LiveBusSnapshot => Boolean(item));
    }

    isConnected(): boolean {
        return this.connectionState;
    }

    trackBusRoom(busId?: string): () => void {
        const normalized = String(busId ?? "").trim();
        if (!normalized) {
            return () => undefined;
        }

        const nextCount = (this.roomRefCounts.get(normalized) ?? 0) + 1;
        this.roomRefCounts.set(normalized, nextCount);

        socketService.joinBusRoom(normalized);

        return () => {
            const current = this.roomRefCounts.get(normalized) ?? 0;
            if (current <= 1) {
                this.roomRefCounts.delete(normalized);
                socketService.leaveBusRoom(normalized);
                return;
            }

            this.roomRefCounts.set(normalized, current - 1);
        };
    }

    upsert(payload: BusLocationUpdatePayload): void {
        const next = toBusSnapshot(payload);
        if (!next) {
            return;
        }

        const previous = this.buses.get(next.busId);

        const unchanged =
            previous &&
            previous.lat === next.lat &&
            previous.lng === next.lng &&
            previous.speed === next.speed &&
            previous.status === next.status &&
            previous.timestamp === next.timestamp;

        if (unchanged) {
            return;
        }

        this.buses.set(next.busId, next);
        this.notifyBus(next.busId);
        this.notifyList();
    }

    seedFromLive(payload: {
        busId: string;
        currentLat?: number | null;
        currentLng?: number | null;
        speed?: number | null;
        status?: string | null;
        trackingStatus?: string | null;
        tripStatus?: string | null;
        skipped?: boolean;
        lastUpdated?: string | null;
    }): void {
        this.upsert({
            busId: payload.busId,
            lat: payload.currentLat ?? null,
            lng: payload.currentLng ?? null,
            speed: payload.speed ?? null,
            status: payload.status ?? payload.trackingStatus ?? "Idle",
            trackingStatus: payload.trackingStatus ?? null,
            tripStatus: payload.tripStatus ?? null,
            skipped: payload.skipped ?? false,
            timestamp: payload.lastUpdated ?? new Date().toISOString(),
        });
    }

    private ensureWatchdog() {
        if (this.watchdogTimer) {
            return;
        }

        this.watchdogTimer = setInterval(() => {
            const now = Date.now();
            let listChanged = false;

            this.buses.forEach((snapshot, busId) => {
                const shouldMarkNoSignal =
                    now - snapshot.lastUpdateMs > SIGNAL_TIMEOUT_MS &&
                    snapshot.displayStatus !== "No Signal";

                if (!shouldMarkNoSignal) {
                    return;
                }

                const next: LiveBusSnapshot = {
                    ...snapshot,
                    displayStatus: "No Signal",
                };

                this.buses.set(busId, next);
                this.notifyBus(busId);
                listChanged = true;
            });

            if (listChanged) {
                this.notifyList();
            }
        }, WATCHDOG_INTERVAL_MS);
    }

    private rejoinTrackedRooms() {
        this.roomRefCounts.forEach((_count, busId) => {
            socketService.joinBusRoom(busId);
        });
    }

    private notifyBus(busId: string) {
        const listeners = this.busListeners.get(busId);
        if (!listeners) {
            return;
        }

        listeners.forEach((listener) => listener());
    }

    private notifyList() {
        this.listListeners.forEach((listener) => listener());
    }

    private notifyConnection() {
        this.connectionListeners.forEach((listener) => listener());
    }
}

const liveBusTrackingStore = new LiveBusTrackingStore();
export default liveBusTrackingStore;

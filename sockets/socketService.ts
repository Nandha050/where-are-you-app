import { io, type Socket } from "socket.io-client";
import {
  addSentryBreadcrumb,
  captureSentryException,
} from "../monitoring/sentry";

const SOCKET_PATH = process.env.EXPO_PUBLIC_SOCKET_PATH || "/socket.io";

const normalizeSocketUrl = (rawUrl: string) => {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return value;
  }
};

export type SocketConnectionStatus =
  | "connected"
  | "reconnecting"
  | "offline";

class SocketService {
  private socket: Socket | null = null;
  private activeBusRooms = new Set<string>();
  private activeRouteRooms = new Set<string>();
  private activeTripRooms = new Set<string>();
  private connectionUrl: string | null = null;
  private reconnectAttemptListeners = new Set<(attempt: unknown) => void>();
  private connectionStatus: SocketConnectionStatus = "offline";

  private rejoinTrackedRooms(): void {
    if (!this.socket?.connected) {
      return;
    }

    this.activeBusRooms.forEach((busId) => {
      this.socket?.emit("joinBusRoom", String(busId));
    });

    this.activeRouteRooms.forEach((routeId) => {
      this.socket?.emit("joinRoute", String(routeId));
    });

    this.activeTripRooms.forEach((tripId) => {
      this.socket?.emit("joinTripRoom", String(tripId));
    });
  }

  connect(url: string, token?: string): void {
    const normalizedUrl = normalizeSocketUrl(url);

    addSentryBreadcrumb({
      category: "socket",
      message: "Socket connect requested",
      level: "info",
      data: {
        normalizedUrl: normalizedUrl || "undefined",
        path: SOCKET_PATH,
        hasToken: Boolean(token),
      },
    });

    console.log("[Socket][connect]", {
      requestedUrl: url || "undefined",
      normalizedUrl: normalizedUrl || "undefined",
      path: SOCKET_PATH,
      hasToken: Boolean(token),
    });

    if (!normalizedUrl) {
      console.error(
        "[Socket][connect] Missing backend URL. Set EXPO_PUBLIC_BACKEND_URL.",
      );
      captureSentryException(new Error("Socket backend URL missing"), {
        tags: {
          area: "socket",
          stage: "connect",
        },
        extra: {
          requestedUrl: url || "undefined",
          path: SOCKET_PATH,
        },
      });
      return;
    }

    if (/localhost|127\.0\.0\.1/i.test(normalizedUrl)) {
      console.warn(
        "[Socket][connect] localhost URL on device may fail in production APK",
      );
      addSentryBreadcrumb({
        category: "socket",
        message: "Socket using localhost URL",
        level: "warning",
        data: {
          normalizedUrl,
        },
      });
    }

    if (this.socket) {
      if (
        this.connectionUrl &&
        normalizedUrl &&
        this.connectionUrl !== normalizedUrl
      ) {
        addSentryBreadcrumb({
          category: "socket",
          message: "Socket URL changed, disconnecting previous connection",
          level: "info",
          data: {
            from: this.connectionUrl,
            to: normalizedUrl,
          },
        });
        this.disconnect();
      }
    }

    if (this.socket) {
      if (token) {
        this.socket.auth = { token };
      }

      if (this.socket.connected) {
        // Socket is already connected — the caller just registered new listeners
        // but the 'connect' event already fired, so those listeners will never
        // receive it.  Immediately rejoin tracked rooms so new listeners work.
        addSentryBreadcrumb({
          category: "socket",
          message: "Socket already connected, rejoining rooms for new listeners",
          level: "info",
          data: { normalizedUrl },
        });
        this.rejoinTrackedRooms();
      } else {
        addSentryBreadcrumb({
          category: "socket",
          message: "Reusing existing socket instance",
          level: "info",
          data: { normalizedUrl },
        });
        this.socket.connect();
      }
      return;
    }

    const socket: Socket = io(normalizedUrl, {
      path: SOCKET_PATH,
      transports: ["polling", "websocket"],
      tryAllTransports: true,
      auth: token ? { token } : undefined,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    this.socket = socket;
    this.connectionUrl = normalizedUrl;

    socket.on("connect", () => {
      this.connectionStatus = "connected";
      console.log("Connected to socket server");
      addSentryBreadcrumb({
        category: "socket",
        message: "Socket connected",
        level: "info",
        data: {
          normalizedUrl,
          joinedRooms: Array.from(this.activeBusRooms),
          joinedRouteRooms: Array.from(this.activeRouteRooms),
          joinedTripRooms: Array.from(this.activeTripRooms),
        },
      });
      this.rejoinTrackedRooms();
    });

    socket.on("disconnect", (reason: unknown) => {
      this.connectionStatus = "offline";
      console.log("Disconnected from socket server", reason);
      addSentryBreadcrumb({
        category: "socket",
        message: "Socket disconnected",
        level: "warning",
        data: {
          reason: String(reason ?? "unknown"),
        },
      });
    });

    socket.on("connect_error", (error: unknown) => {
      console.warn("Socket connect error", error);
      captureSentryException(error, {
        tags: {
          area: "socket",
          stage: "connect_error",
        },
        extra: {
          normalizedUrl,
          path: SOCKET_PATH,
        },
        level: "error",
      });
    });

    socket.io.on("reconnect_attempt", (attempt: unknown) => {
      this.connectionStatus = "reconnecting";
      console.log("Socket reconnect attempt", attempt);
      addSentryBreadcrumb({
        category: "socket",
        message: "Socket reconnect attempt",
        level: "warning",
        data: {
          attempt,
        },
      });
      this.reconnectAttemptListeners.forEach((listener) => listener(attempt));
    });

    socket.io.on("reconnect", (attempt: unknown) => {
      this.connectionStatus = "connected";
      console.log("Socket reconnected", attempt);
      addSentryBreadcrumb({
        category: "socket",
        message: "Socket reconnected",
        level: "info",
        data: {
          attempt,
        },
      });
    });

    socket.io.on("reconnect_error", (error: unknown) => {
      console.warn("Socket reconnect error", error);
      captureSentryException(error, {
        tags: {
          area: "socket",
          stage: "reconnect_error",
        },
        extra: {
          normalizedUrl,
        },
        level: "warning",
      });
    });

    socket.connect();
  }

  emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      captureSentryException(new Error("Socket emit while disconnected"), {
        tags: {
          area: "socket",
          stage: "emit",
          event,
        },
        extra: {
          connected: false,
        },
      });
      throw new Error("Socket is not connected");
    }

    addSentryBreadcrumb({
      category: "socket",
      message: `Socket emit: ${event}`,
      level: "debug",
    });

    this.socket.emit(event, data);
  }

  async waitUntilConnected(timeoutMs = 5000): Promise<boolean> {
    if (this.socket?.connected) {
      return true;
    }

    const socket = this.socket;
    if (!socket) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
      };

      const onConnect = () => {
        cleanup();
        resolve(true);
      };

      const onError = () => {
        cleanup();
        captureSentryException(
          new Error("Socket connect_error while waiting for connection"),
          {
            tags: {
              area: "socket",
              stage: "wait_until_connected",
            },
            level: "warning",
          },
        );
        resolve(false);
      };

      const timeout = setTimeout(() => {
        cleanup();
        addSentryBreadcrumb({
          category: "socket",
          message: "Socket connection wait timed out",
          level: "warning",
          data: {
            timeoutMs,
            connected: Boolean(socket.connected),
          },
        });
        resolve(Boolean(socket.connected));
      }, timeoutMs);

      socket.on("connect", onConnect);
      socket.on("connect_error", onError);
      socket.connect();
    });
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.socket?.on(event, callback);
  }

  onReconnectAttempt(callback: (attempt: unknown) => void): void {
    this.reconnectAttemptListeners.add(callback);
  }

  off(event: string, callback?: (...args: any[]) => void): void {
    if (callback) {
      this.socket?.off(event, callback);
      return;
    }

    this.socket?.off(event);
  }

  offReconnectAttempt(callback: (attempt: unknown) => void): void {
    this.reconnectAttemptListeners.delete(callback);
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  getConnectionStatus(): SocketConnectionStatus {
    if (this.socket?.connected) {
      return "connected";
    }

    return this.connectionStatus;
  }

  joinBusRoom(busId: string): void {
    const normalized = String(busId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeBusRooms.add(normalized);
    if (this.socket?.connected) {
      addSentryBreadcrumb({
        category: "socket",
        message: "Join bus room",
        level: "info",
        data: {
          busId: normalized,
        },
      });
      this.socket.emit("joinBusRoom", normalized);
    }
  }

  leaveBusRoom(busId: string): void {
    const normalized = String(busId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeBusRooms.delete(normalized);
    if (this.socket?.connected) {
      addSentryBreadcrumb({
        category: "socket",
        message: "Leave bus room",
        level: "info",
        data: {
          busId: normalized,
        },
      });
      this.socket.emit("leaveBusRoom", normalized);
    }
  }

  joinRouteRoom(routeId: string): void {
    const normalized = String(routeId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeRouteRooms.add(normalized);
    if (this.socket?.connected) {
      addSentryBreadcrumb({
        category: "socket",
        message: "Join route room",
        level: "info",
        data: {
          routeId: normalized,
        },
      });
      this.socket.emit("joinRoute", normalized);
    }
  }

  joinTripRoom(tripId: string): void {
    const normalized = String(tripId || "").trim();

    if (!normalized) {
      return;
    }

    console.log("[FRONTEND JOIN TRIP ROOM]", {
      tripId: normalized,
      connected: this.socket?.connected,
    });

    this.activeTripRooms.clear();
    this.activeTripRooms.add(normalized);

    if (this.socket?.connected) {
      addSentryBreadcrumb({
        category: "socket",
        message: "Join trip room",
        level: "info",
        data: {
          tripId: normalized,
        },
      });

      console.log("[EMITTING joinTripRoom]", normalized);

      this.socket.emit("joinTripRoom", normalized);
    } else {
      console.log("[SOCKET NOT CONNECTED]");
    }
  }

  leaveTripRoom(tripId: string): void {
    const normalized = String(tripId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeTripRooms.delete(normalized);
    // Notify the server so it removes the socket from the room.
    // Without this emit the server keeps broadcasting to a departed client.
    if (this.socket?.connected) {
      addSentryBreadcrumb({
        category: "socket",
        message: "Leave trip room",
        level: "info",
        data: { tripId: normalized },
      });
      this.socket.emit("leaveTripRoom", normalized);
    }
  }

  leaveRouteRoom(routeId: string): void {
    const normalized = String(routeId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeRouteRooms.delete(normalized);
    addSentryBreadcrumb({
      category: "socket",
      message: "Leave route room",
      level: "info",
      data: {
        routeId: normalized,
      },
    });
  }

  disconnect(): void {
    addSentryBreadcrumb({
      category: "socket",
      message: "Socket disconnect invoked",
      level: "info",
      data: {
        roomCount: this.activeBusRooms.size,
        routeRoomCount: this.activeRouteRooms.size,
      },
    });

    this.socket?.disconnect();
    this.socket = null;
    this.connectionStatus = "offline";
    this.connectionUrl = null;
    this.activeBusRooms.clear();
    this.activeRouteRooms.clear();
    this.activeTripRooms.clear();
  }

  /**
   * Get direct access to socket instance for advanced operations
   * Used for emitting custom events in background location service
   */
  getSocket(): Socket | null {
    return this.socket;
  }
}

const socketService = new SocketService();
export default socketService;

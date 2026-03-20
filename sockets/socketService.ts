import type { Socket } from "socket.io-client";

const { io } = require("socket.io-client");

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

class SocketService {
  private socket: Socket | null = null;
  private activeBusRooms = new Set<string>();
  private connectionUrl: string | null = null;
  private reconnectAttemptListeners = new Set<(attempt: unknown) => void>();

  connect(url: string, token?: string): void {
    const normalizedUrl = normalizeSocketUrl(url);

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
      return;
    }

    if (/localhost|127\.0\.0\.1/i.test(normalizedUrl)) {
      console.warn(
        "[Socket][connect] localhost URL on device may fail in production APK",
      );
    }

    if (this.socket) {
      if (
        this.connectionUrl &&
        normalizedUrl &&
        this.connectionUrl !== normalizedUrl
      ) {
        this.disconnect();
      }
    }

    if (this.socket) {
      if (token) {
        this.socket.auth = { token };
      }

      if (!this.socket.connected) {
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
      console.log("Connected to socket server");
      this.activeBusRooms.forEach((busId) => {
        socket.emit("joinBusRoom", String(busId));
      });
    });

    socket.on("disconnect", (reason: unknown) => {
      console.log("Disconnected from socket server", reason);
    });

    socket.on("connect_error", (error: unknown) => {
      console.warn("Socket connect error", error);
    });

    socket.io.on("reconnect_attempt", (attempt: unknown) => {
      console.log("Socket reconnect attempt", attempt);
      this.reconnectAttemptListeners.forEach((listener) => listener(attempt));
    });

    socket.io.on("reconnect", (attempt: unknown) => {
      console.log("Socket reconnected", attempt);
    });

    socket.io.on("reconnect_error", (error: unknown) => {
      console.warn("Socket reconnect error", error);
    });

    socket.connect();
  }

  emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      throw new Error("Socket is not connected");
    }
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
        resolve(false);
      };

      const timeout = setTimeout(() => {
        cleanup();
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

  joinBusRoom(busId: string): void {
    const normalized = String(busId || "").trim();
    if (!normalized) {
      return;
    }

    this.activeBusRooms.add(normalized);
    if (this.socket?.connected) {
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
      this.socket.emit("leaveBusRoom", normalized);
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectionUrl = null;
    this.activeBusRooms.clear();
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

import { useEffect, useRef, useState } from "react";
import socketService from "../sockets/socketService";
import {
    DEFAULT_DRIVER_DISCONNECT_GRACE_MS,
    DriverConnectionState,
} from "../store/driverTripStatus";

type UseDriverSocketConnectionStateOptions = {
    enabled?: boolean;
    graceMs?: number;
    onConnectedRevalidate?: () => Promise<void> | void;
    onHardDisconnectRevalidate?: () => Promise<void> | void;
};

export const useDriverSocketConnectionState = (
    options: UseDriverSocketConnectionStateOptions,
) => {
    const {
        enabled = true,
        graceMs = DEFAULT_DRIVER_DISCONNECT_GRACE_MS,
        onConnectedRevalidate,
        onHardDisconnectRevalidate,
    } = options;

    const [connectionState, setConnectionState] = useState<DriverConnectionState>(
        socketService.isConnected()
            ? DriverConnectionState.CONNECTED
            : DriverConnectionState.DISCONNECTED_HARD,
    );

    const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const connectedRevalidateRef = useRef(onConnectedRevalidate);
    const hardDisconnectRevalidateRef = useRef(onHardDisconnectRevalidate);

    useEffect(() => {
        connectedRevalidateRef.current = onConnectedRevalidate;
    }, [onConnectedRevalidate]);

    useEffect(() => {
        hardDisconnectRevalidateRef.current = onHardDisconnectRevalidate;
    }, [onHardDisconnectRevalidate]);

    const clearTimers = () => {
        if (graceTimerRef.current) {
            clearTimeout(graceTimerRef.current);
            graceTimerRef.current = null;
        }
    };

    useEffect(() => {
        if (!enabled) {
            clearTimers();
            setConnectionState(DriverConnectionState.DISCONNECTED_HARD);
            return;
        }

        const runConnectedRevalidate = async () => {
            try {
                await connectedRevalidateRef.current?.();
            } catch {
                // Keep UI responsive even if snapshot refresh fails.
            }
        };

        const runHardDisconnectRevalidate = async () => {
            try {
                await hardDisconnectRevalidateRef.current?.();
            } catch {
                // Keep UI responsive even if snapshot refresh fails.
            }
        };

        const onConnect = () => {
            clearTimers();
            setConnectionState(DriverConnectionState.CONNECTED);
            void runConnectedRevalidate();
        };

        const onDisconnect = () => {
            clearTimers();
            setConnectionState(DriverConnectionState.RECONNECTING);

            queueMicrotask(() => {
                if (!socketService.isConnected()) {
                    setConnectionState(DriverConnectionState.DISCONNECTED_GRACE);
                }
            });

            graceTimerRef.current = setTimeout(() => {
                clearTimers();
                setConnectionState(DriverConnectionState.DISCONNECTED_HARD);
                void runHardDisconnectRevalidate();
            }, graceMs);
        };

        socketService.on("connect", onConnect);
        socketService.on("disconnect", onDisconnect);

        if (socketService.isConnected()) {
            onConnect();
        } else {
            setConnectionState(DriverConnectionState.DISCONNECTED_HARD);
        }

        return () => {
            clearTimers();
            socketService.off("connect", onConnect);
            socketService.off("disconnect", onDisconnect);
        };
    }, [enabled, graceMs]);

    return {
        connectionState,
    };
};

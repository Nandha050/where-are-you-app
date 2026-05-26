import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { logger } from '../../core/logger/logger';
import { locationQueueManager, type QueueStats } from '../queue/LocationQueueManager';
import { httpSyncManager } from '../sync/HTTPSyncManager';
import { backgroundLocationService } from '../tracking/BackgroundLocationService';

interface UseDriverTrackingState {
    isTracking: boolean;
    isSyncing: boolean;
    queueStats: QueueStats;
    syncStats: ReturnType<typeof httpSyncManager.getStats>;
    error: string | null;
}

interface UseDriverTrackingActions {
    startTracking: (driverId?: string, busId?: string, tripId?: string) => Promise<void>;
    stopTracking: () => Promise<void>;
    pauseTracking: () => Promise<void>;
    resumeTracking: () => Promise<void>;
    forceSyncNow: () => Promise<void>;
}

/**
 * Hook for driver HTTP-based location tracking
 * NO WebSocket - completely stateless HTTP uploads
 * 
 * Usage:
 * const driverTracking = useDriverTracking(API_BASE_URL);
 * 
 * await driverTracking.startTracking();  // Start background + foreground + HTTP sync
 * await driverTracking.stopTracking();   // Stop everything
 */
export function useDriverTracking(apiBaseUrl: string) {
    const { token } = useAuth();

    const [state, setState] = useState<UseDriverTrackingState>({
        isTracking: false,
        isSyncing: false,
        queueStats: { totalItems: 0, oldestItemAge: null, pendingRetries: 0 },
        syncStats: {
            successfulUploads: 0,
            failedAttempts: 0,
            totalItemsUploaded: 0,
            lastSyncTime: null,
            nextRetryTime: null,
        },
        error: null,
    });

    const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const statsIntervalRef = useRef<number | null>(null);

    /**
     * Initialize services with auth token
     */
    useEffect(() => {
        // Initialize with auth token if available
        if (token) {
            httpSyncManager.setAuthToken(token);
        }

        httpSyncManager.initialize(apiBaseUrl, token);
        void locationQueueManager.initialize();

        return () => {
            httpSyncManager.stop();
            void backgroundLocationService.stop();
        };
    }, [apiBaseUrl, token]);

    /**
     * Update stats periodically
     */
    useEffect(() => {
        const updateStats = () => {
            setState((prev) => ({
                ...prev,
                queueStats: locationQueueManager.getStats(),
                syncStats: httpSyncManager.getStats(),
                isSyncing: httpSyncManager.isSyncActive(),
            }));
        };

        statsIntervalRef.current = setInterval(updateStats, 2000);
        return () => {
            if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        };
    }, []);

    /**
     * Start tracking with background + foreground + HTTP sync
     * 
     * Requires:
     * - driverId: current driver ID
     * - busId: assigned bus ID
     * - tripId: active trip ID
     */
    const startTracking = useCallback(
        async (driverId?: string, busId?: string, tripId?: string) => {
            try {
                console.log('🔴 [useDriverTracking.startTracking] CALLED WITH PARAMS:', {
                    driverId: driverId || 'UNDEFINED',
                    busId: busId || 'UNDEFINED',
                    tripId: tripId || 'UNDEFINED',
                });

                logger.info('[useDriverTracking] startTracking called', {
                    driverId: driverId || 'UNDEFINED',
                    busId: busId || 'UNDEFINED',
                    tripId: tripId || 'UNDEFINED',
                });

                setState((prev) => ({ ...prev, error: null }));

                // CRITICAL: Always set identifiers (even partial) with diagnostics
                console.log('🟠 [useDriverTracking] About to call setDriverIdentifiers:', {
                    driverId,
                    busId,
                    tripId,
                });

                logger.info('[useDriverTracking] Setting identifiers', {
                    driverId: driverId || 'MISSING',
                    busId: busId || 'MISSING',
                    tripId: tripId || 'MISSING',
                });

                if (!driverId) logger.error('[useDriverTracking] ❌ driverId is missing!');
                if (!busId) logger.error('[useDriverTracking] ❌ busId is missing!');
                if (!tripId) logger.error('[useDriverTracking] ❌ tripId is missing!');

                // Set identifiers unconditionally to enable sync
                httpSyncManager.setDriverIdentifiers(driverId, busId, tripId);

                console.log('🟢 [useDriverTracking] setDriverIdentifiers completed, calling managers');

                if (driverId && busId && tripId) {
                    logger.info('[useDriverTracking] ✅ All identifiers available', {
                        driverId,
                        busId,
                        tripId,
                    });
                }

                await locationQueueManager.initialize();
                await backgroundLocationService.start();
                await backgroundLocationService.startForeground();

                httpSyncManager.start();

                setState((prev) => ({ ...prev, isTracking: true }));
                logger.info('[useDriverTracking] Tracking started');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                setState((prev) => ({
                    ...prev,
                    error: message,
                    isTracking: false,
                }));
                logger.error('[useDriverTracking] Failed to start', { error });
            }
        },
        []
    );

    /**
     * Stop tracking completely
     */
    const stopTracking = useCallback(async () => {
        try {
            backgroundLocationService.stopForeground();
            await backgroundLocationService.stop();
            httpSyncManager.stop();

            // Final sync attempt
            await httpSyncManager.forceSyncNow();

            setState((prev) => ({
                ...prev,
                isTracking: false,
                error: null,
            }));

            logger.info('[useDriverTracking] Tracking stopped');
        } catch (error) {
            logger.error('[useDriverTracking] Failed to stop', { error });
        }
    }, []);

    /**
     * Pause foreground but keep background active
     */
    const pauseTracking = useCallback(async () => {
        try {
            backgroundLocationService.stopForeground();
            logger.info('[useDriverTracking] Foreground paused');
        } catch (error) {
            logger.error('[useDriverTracking] Failed to pause', { error });
        }
    }, []);

    /**
     * Resume foreground tracking
     */
    const resumeTracking = useCallback(async () => {
        try {
            await backgroundLocationService.startForeground();
            logger.info('[useDriverTracking] Foreground resumed');
        } catch (error) {
            logger.error('[useDriverTracking] Failed to resume', { error });
        }
    }, []);

    /**
     * Force immediate sync (useful for debugging)
     */
    const forceSyncNow = useCallback(async () => {
        try {
            const success = await httpSyncManager.forceSyncNow();
            logger.info('[useDriverTracking] Manual sync triggered', { success });
        } catch (error) {
            logger.error('[useDriverTracking] Manual sync failed', { error });
        }
    }, []);

    const actions: UseDriverTrackingActions = {
        startTracking,
        stopTracking,
        pauseTracking,
        resumeTracking,
        forceSyncNow,
    };

    return { ...state, ...actions };
}

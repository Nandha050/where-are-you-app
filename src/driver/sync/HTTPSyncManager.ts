import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { logger } from '../../core/logger/logger';
import { cacheCoordinatorService } from '../cache/CacheCoordinatorService';
import { locationQueueManager } from '../queue/LocationQueueManager';

export interface SyncStats {
    successfulUploads: number;
    failedAttempts: number;
    totalItemsUploaded: number;
    lastSyncTime: string | null;
    nextRetryTime: string | null;
}

interface BackoffState {
    attempt: number;
    nextRetryMs: number;
}

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 64000]; // 7 attempts = ~2 minutes
const MAX_BATCH_SIZE = 100;
let SYNC_INTERVAL_MS = 15000; // 15 seconds (can be updated for battery optimization)

// ✅ Storage keys for persisting identifiers across background/foreground context
const STORAGE_KEYS = {
    DRIVER_ID: 'httpSyncManager_driverId',
    BUS_ID: 'httpSyncManager_busId',
    TRIP_ID: 'httpSyncManager_tripId',
    API_BASE_URL: 'httpSyncManager_apiBaseUrl',
};

export class HTTPSyncManager {
    private static instance: HTTPSyncManager;
    private stats: SyncStats = {
        successfulUploads: 0,
        failedAttempts: 0,
        totalItemsUploaded: 0,
        lastSyncTime: null,
        nextRetryTime: null,
    };
    private backoffState: BackoffState = {
        attempt: 0,
        nextRetryMs: 0,
    };
    private isSyncing = false;
    private syncTimer: number | null = null;
    private apiBaseUrl: string = '';
    private authToken: string | null = null;
    private driverId: string | null = null;
    private busId: string | null = null;
    private tripId: string | null = null;
    private currentSyncIntervalMs = 15000; // ✅ Dynamic sync interval for battery optimization

    private constructor() { }

    static getInstance(): HTTPSyncManager {
        if (!HTTPSyncManager.instance) {
            HTTPSyncManager.instance = new HTTPSyncManager();
        }
        return HTTPSyncManager.instance;
    }

    /**
     * Initialize with API base URL and authentication
     */
    initialize(apiBaseUrl: string, authToken?: string | null, driverId?: string, busId?: string, tripId?: string): void {
        this.apiBaseUrl = apiBaseUrl;
        this.authToken = authToken || null;
        this.driverId = driverId || null;
        this.busId = busId || null;
        this.tripId = tripId || null;
        logger.info('[HTTPSyncManager] Initialized', { apiBaseUrl, hasDriverId: !!driverId, hasBusId: !!busId, hasTripId: !!tripId });

        // ✅ Persist API URL for background context restoration
        void this.persistApiBaseUrl(apiBaseUrl);
    }

    /**
     * Persist API base URL to storage for background task access
     */
    private async persistApiBaseUrl(apiBaseUrl: string): Promise<void> {
        try {
            if (apiBaseUrl) {
                await AsyncStorage.setItem(STORAGE_KEYS.API_BASE_URL, apiBaseUrl);
                logger.debug('[HTTPSyncManager] API base URL persisted to storage');
            }
        } catch (error) {
            logger.error('[HTTPSyncManager] Failed to persist API base URL', { error });
        }
    }

    /**
     * Update authentication token and persist for background context
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;

        // ✅ Persist token to SecureStore for background context restoration
        if (token) {
            void this.persistAuthToken(token);
        }
    }

    /**
     * Persist auth token to secure storage for background task access
     */
    private async persistAuthToken(token: string): Promise<void> {
        try {
            if (Platform.OS === 'web') {
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem('httpSyncManager_authToken', token);
                }
                return;
            }
            await SecureStore.setItemAsync('httpSyncManager_authToken', token);
            logger.debug('[HTTPSyncManager] Auth token persisted to secure storage');
        } catch (error) {
            logger.error('[HTTPSyncManager] Failed to persist auth token', { error });
        }
    }

    /**
     * Update driver identifiers and persist to storage for background context
     */
    setDriverIdentifiers(driverId?: string, busId?: string, tripId?: string): void {
        console.log('🔵 [HTTPSyncManager.setDriverIdentifiers] CALLED WITH:', {
            driverId,
            busId,
            tripId,
        });

        this.driverId = driverId || null;
        this.busId = busId || null;
        this.tripId = tripId || null;

        console.log('🟢 [HTTPSyncManager.setDriverIdentifiers] SET TO:', {
            driverId: this.driverId,
            busId: this.busId,
            tripId: this.tripId,
        });

        logger.debug('[HTTPSyncManager] Driver identifiers updated', {
            driverId: this.driverId,
            busId: this.busId,
            tripId: this.tripId
        });

        // ✅ CRITICAL: Persist identifiers to AsyncStorage for background context
        // When background location task runs, it can restore these values
        void this.persistIdentifiers(driverId, busId, tripId);
    }

    /**
     * Persist identifiers to storage for background task access
     */
    private async persistIdentifiers(driverId?: string, busId?: string, tripId?: string): Promise<void> {
        try {
            if (driverId) await AsyncStorage.setItem(STORAGE_KEYS.DRIVER_ID, driverId);
            if (busId) await AsyncStorage.setItem(STORAGE_KEYS.BUS_ID, busId);
            if (tripId) await AsyncStorage.setItem(STORAGE_KEYS.TRIP_ID, tripId);

            logger.debug('[HTTPSyncManager] Identifiers persisted to storage', {
                driverId: !!driverId,
                busId: !!busId,
                tripId: !!tripId,
            });
        } catch (error) {
            logger.error('[HTTPSyncManager] Failed to persist identifiers', { error });
        }
    }

    /**
     * Restore identifiers from storage (used in background context)
     */
    async restoreIdentifiersFromStorage(): Promise<void> {
        try {
            const [driverId, busId, tripId] = await Promise.all([
                AsyncStorage.getItem(STORAGE_KEYS.DRIVER_ID),
                AsyncStorage.getItem(STORAGE_KEYS.BUS_ID),
                AsyncStorage.getItem(STORAGE_KEYS.TRIP_ID),
            ]);

            if (driverId || busId || tripId) {
                this.driverId = driverId;
                this.busId = busId;
                this.tripId = tripId;

                console.log('🔵 [HTTPSyncManager.restoreIdentifiersFromStorage] RESTORED:', {
                    driverId: this.driverId,
                    busId: this.busId,
                    tripId: this.tripId,
                });

                logger.debug('[HTTPSyncManager] Identifiers restored from storage', {
                    driverId: !!driverId,
                    busId: !!busId,
                    tripId: !!tripId,
                });
            }
        } catch (error) {
            logger.error('[HTTPSyncManager] Failed to restore identifiers from storage', { error });
        }
    }

    /**
     * Start periodic sync
     */
    start(): void {
        if (this.syncTimer) {
            logger.warn('[HTTPSyncManager] Already running');
            return;
        }

        console.log('🟢 [HTTPSyncManager.start] STARTING SYNC CYCLE');
        logger.info('[HTTPSyncManager] Starting periodic sync', {
            intervalMs: this.currentSyncIntervalMs
        });
        this.syncTimer = setInterval(() => {
            console.log('⏰ [HTTPSyncManager] TICK - Sync cycle triggered', {
                driverId: this.driverId,
                busId: this.busId,
                tripId: this.tripId,
                intervalMs: this.currentSyncIntervalMs,
            });
            logger.debug('[HTTPSyncManager] ⏰ TICK - Sync cycle triggered');
            void this.sync();
        }, this.currentSyncIntervalMs);

        // Do first sync immediately
        void this.sync();
    }

    /**
     * ✅ Update sync interval (e.g., for battery optimization)
     */
    updateSyncInterval(intervalMs: number): void {
        if (intervalMs === this.currentSyncIntervalMs) {
            return; // No change
        }

        const oldInterval = this.currentSyncIntervalMs;
        this.currentSyncIntervalMs = intervalMs;

        logger.info('[HTTPSyncManager] Sync interval updated', {
            oldInterval,
            newInterval: intervalMs,
            reason: intervalMs > 15000 ? 'low battery' : 'battery recovered',
        });

        // Restart timer with new interval if running
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = setInterval(() => {
                console.log('⏰ [HTTPSyncManager] TICK - Sync cycle triggered', {
                    driverId: this.driverId,
                    busId: this.busId,
                    tripId: this.tripId,
                    intervalMs: this.currentSyncIntervalMs,
                });
                logger.debug('[HTTPSyncManager] ⏰ TICK - Sync cycle triggered');
                void this.sync();
            }, this.currentSyncIntervalMs);
        }
    }

    /**
     * Stop periodic sync
     */
    stop(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
            logger.info('[HTTPSyncManager] Stopped');
        }
    }

    /**
     * Perform one sync cycle
     */
    async sync(): Promise<boolean> {
        // \u2705 DIAGNOSTIC LOG \u2014 required for production debugging
        logger.warn('[SYNC] LOCATION_SYNC_TRIGGERED', {
            queueSize: locationQueueManager.size(),
            hasDriverId: !!this.driverId,
            hasBusId: !!this.busId,
            hasTripId: !!this.tripId,
        });

        // Check backoff delay
        if (this.backoffState.nextRetryMs > Date.now()) {
            const waitMs = this.backoffState.nextRetryMs - Date.now();
            logger.debug('[HTTPSyncManager] Backoff active', { waitMs });
            return false;
        }

        if (this.isSyncing) {
            logger.debug('[HTTPSyncManager] Already syncing');
            return false;
        }

        try {
            this.isSyncing = true;

            const queueSize = locationQueueManager.size();

            console.log('📊 [HTTPSyncManager.sync] STATUS CHECK:', {
                queueSize,
                hasAuth: !!this.authToken,
                hasDriverId: !!this.driverId,
                hasBusId: !!this.busId,
                hasTripId: !!this.tripId,
                allIdsPresent: !!(this.driverId && this.busId && this.tripId),
            });

            logger.debug('[HTTPSyncManager] Sync cycle', {
                queueSize,
                hasAuth: !!this.authToken,
                hasDriverId: !!this.driverId,
                hasBusId: !!this.busId,
                hasTripId: !!this.tripId,
            });

            if (queueSize === 0) {
                if (this.backoffState.attempt > 0) {
                    this.backoffState.attempt = 0;
                    logger.info('[HTTPSyncManager] Backoff cleared');
                }
                logger.debug('[HTTPSyncManager] Queue empty, skipping sync');
                return true;
            }

            console.log('🟡 [HTTPSyncManager.sync] QUEUE HAS ITEMS, UPLOADING:', { queueSize });
            logger.debug('[HTTPSyncManager] Syncing', { queueSize });

            const success = await this.uploadBatchWithCoordinator();

            if (success) {
                this.stats.successfulUploads++;
                this.stats.lastSyncTime = new Date().toISOString();
                this.backoffState.attempt = 0;
                this.backoffState.nextRetryMs = 0;

                logger.info('[HTTPSyncManager] Batch uploaded successfully', {
                    queueRemaining: locationQueueManager.size(),
                });

                return true;
            } else {
                // Upload failed
                this.applyBackoff();
                this.stats.failedAttempts++;

                logger.warn('[HTTPSyncManager] Batch upload failed', {
                    attempt: this.backoffState.attempt,
                    nextRetryMs: this.backoffState.nextRetryMs - Date.now(),
                });

                return false;
            }
        } catch (error) {
            logger.error('[HTTPSyncManager] Sync error', { error });
            this.applyBackoff();
            return false;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Force immediate sync
     */
    async forceSyncNow(): Promise<boolean> {
        this.backoffState.nextRetryMs = 0;
        return this.sync();
    }

    /**
     * Upload batch with cache coordinator
     * Coordinator handles: queue management, batch formatting, Redis caching
     */
    private async uploadBatchWithCoordinator(): Promise<boolean> {
        try {
            if (!this.apiBaseUrl) {
                logger.error('[HTTPSyncManager] ❌ API base URL not configured');
                throw new Error('API base URL not configured');
            }

            if (!this.authToken) {
                logger.error('[HTTPSyncManager] ❌ Authentication token not available');
                throw new Error('Authentication token not available');
            }

            // LOG IDENTIFIERS AT UPLOAD TIME
            console.log('🔵 [HTTPSyncManager.uploadBatchWithCoordinator] CURRENT IDENTIFIERS:', {
                driverId: this.driverId,
                busId: this.busId,
                tripId: this.tripId,
                hasAll: !!(this.driverId && this.busId && this.tripId),
            });

            if (!this.driverId || !this.busId || !this.tripId) {
                console.warn('⚠️ [HTTPSyncManager] Missing identifiers for batch upload:', {
                    driverId: this.driverId || 'MISSING',
                    busId: this.busId || 'MISSING',
                    tripId: this.tripId || 'MISSING',
                });
            }

            // CHECK: Log all identifiers with status
            const missingIds = [];
            if (!this.driverId) missingIds.push('driverId');
            if (!this.busId) missingIds.push('busId');
            if (!this.tripId) missingIds.push('tripId');

            if (missingIds.length > 0) {
                logger.error('[HTTPSyncManager] ❌ BLOCKING: Missing identifiers', {
                    missing: missingIds.join(', '),
                    driverId: this.driverId || 'UNDEFINED',
                    busId: this.busId || 'UNDEFINED',
                    tripId: this.tripId || 'UNDEFINED',
                    queueSize: locationQueueManager.size(),
                });
                return false;
            }

            logger.debug('[HTTPSyncManager] Using cache coordinator for batch upload', {
                tripId: this.tripId,
                driverId: this.driverId,
                busId: this.busId,
            });

            // Coordinator handles: getting batch from queue, formatting, uploading, caching to Redis
            const result = await cacheCoordinatorService.coordinateBatchUpload(
                this.tripId!,
                this.driverId!,
                this.busId!,
                this.apiBaseUrl,
                this.authToken,
                MAX_BATCH_SIZE
            );

            if (!result) {
                logger.warn('[HTTPSyncManager] Coordinator returned no result (likely empty queue)');
                return true; // No error - just no data to upload
            }

            // Update stats with cache result
            this.stats.totalItemsUploaded += result.itemsProcessed;

            logger.info('[HTTPSyncManager] Batch uploaded via coordinator', {
                itemsProcessed: result.itemsProcessed,
                itemsValid: result.itemsValid,
                itemsDuplicate: result.itemsDuplicate,
                rateLimitRemaining: result.rateLimitRemaining,
                cacheUpdated: !!result.cacheKeys,
                cacheKeys: result.cacheKeys,
            });

            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;
                const message = (axiosError.response?.data as Record<string, unknown>)?.message || axiosError.message;

                logger.error('[HTTPSyncManager] Coordinator upload failed', {
                    status,
                    message,
                    code: axiosError.code,
                });

                // Don't retry on auth errors
                if (status === 401) {
                    logger.error('[HTTPSyncManager] Authentication failed');
                    return false;
                }

                // Don't retry on validation errors
                if (status === 400 || status === 422) {
                    logger.error('[HTTPSyncManager] Validation error', { message });
                    return false;
                }

                // Rate limiting - will retry with backoff
                if (status === 429) {
                    logger.warn('[HTTPSyncManager] Rate limited');
                    return false;
                }
            } else {
                logger.error('[HTTPSyncManager] Coordinator error', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }

            return false;
        }
    }

    /**
     * Apply exponential backoff
     */
    private applyBackoff(): void {
        if (this.backoffState.attempt < BACKOFF_DELAYS.length) {
            const delayMs = BACKOFF_DELAYS[this.backoffState.attempt];
            this.backoffState.nextRetryMs = Date.now() + delayMs;
            this.stats.nextRetryTime = new Date(
                this.backoffState.nextRetryMs
            ).toISOString();
            this.backoffState.attempt++;

            logger.info('[HTTPSyncManager] Backoff applied', {
                attempt: this.backoffState.attempt,
                delayMs,
            });
        } else {
            logger.warn('[HTTPSyncManager] Max backoff attempts reached');
            this.backoffState.attempt = 0; // Reset
        }
    }

    /**
     * Get sync statistics
     */
    getStats(): SyncStats {
        return { ...this.stats };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = {
            successfulUploads: 0,
            failedAttempts: 0,
            totalItemsUploaded: 0,
            lastSyncTime: null,
            nextRetryTime: null,
        };
    }

    /**
     * Pause sync (when app backgrounded)
     */
    pause(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
            logger.info('[HTTPSyncManager] Sync paused');
        }
    }

    /**
     * Resume sync (when app foregrounded)
     */
    resume(): void {
        if (!this.syncTimer) {
            this.start();
            logger.info('[HTTPSyncManager] Sync resumed');
        }
    }

    /**
     * Check if syncing is active
     */
    isSyncActive(): boolean {
        return this.isSyncing;
    }

    /**
     * Check backoff state
     */
    getBackoffState() {
        return {
            attempt: this.backoffState.attempt,
            nextRetryMs: Math.max(0, this.backoffState.nextRetryMs - Date.now()),
        };
    }
}

export const httpSyncManager = HTTPSyncManager.getInstance();

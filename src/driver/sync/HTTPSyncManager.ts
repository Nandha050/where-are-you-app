import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../core/logger/logger';
import { LocationRecord, locationQueueManager } from '../queue/LocationQueueManager';

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
const SYNC_INTERVAL_MS = 15000; // 15 seconds

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
    }

    /**
     * Update authentication token
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Update driver identifiers
     */
    setDriverIdentifiers(driverId?: string, busId?: string, tripId?: string): void {
        this.driverId = driverId || null;
        this.busId = busId || null;
        this.tripId = tripId || null;
        logger.debug('[HTTPSyncManager] Driver identifiers updated', { driverId, busId, tripId });
    }

    /**
     * Start periodic sync
     */
    start(): void {
        if (this.syncTimer) {
            logger.warn('[HTTPSyncManager] Already running');
            return;
        }

        logger.info('[HTTPSyncManager] Starting periodic sync');
        this.syncTimer = setInterval(() => {
            void this.sync();
        }, SYNC_INTERVAL_MS);
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
            if (queueSize === 0) {
                if (this.backoffState.attempt > 0) {
                    this.backoffState.attempt = 0;
                    logger.info('[HTTPSyncManager] Backoff cleared');
                }
                return true;
            }

            logger.debug('[HTTPSyncManager] Syncing', { queueSize });

            const batch = await locationQueueManager.getBatch(MAX_BATCH_SIZE);
            if (batch.length === 0) {
                return true;
            }

            const success = await this.uploadBatch(batch);

            if (success) {
                this.stats.successfulUploads++;
                this.stats.totalItemsUploaded += batch.length;
                this.stats.lastSyncTime = new Date().toISOString();
                this.backoffState.attempt = 0;
                this.backoffState.nextRetryMs = 0;

                logger.info('[HTTPSyncManager] Batch uploaded', {
                    itemCount: batch.length,
                    queueRemaining: locationQueueManager.size(),
                });

                return true;
            } else {
                // Upload failed, re-push and apply backoff
                await locationQueueManager.rePushBatch(batch);
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
     * Upload batch to backend
     * 
     * Request body:
     * {
     *   tripId: string,
     *   driverId: string,
     *   busId: string,
     *   batchTimestamp: ISO string,
     *   nonce: UUID (for replay attack prevention),
     *   locations: [...]
     * }
     */
    private async uploadBatch(batch: LocationRecord[]): Promise<boolean> {
        try {
            if (!this.apiBaseUrl) {
                throw new Error('API base URL not configured');
            }

            if (!this.authToken) {
                throw new Error('Authentication token not available');
            }

            if (!this.driverId || !this.busId || !this.tripId) {
                logger.warn('[HTTPSyncManager] Missing identifiers', {
                    driverId: !!this.driverId,
                    busId: !!this.busId,
                    tripId: !!this.tripId,
                });
                // Return false to trigger retry - identifiers might be loaded soon
                return false;
            }

            // Generate nonce for replay attack prevention
            const nonce = uuidv4();

            const payload = {
                tripId: this.tripId,
                driverId: this.driverId,
                busId: this.busId,
                batchTimestamp: new Date().toISOString(),
                nonce,
                locations: batch.map((loc) => ({
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    speed: loc.speed,
                    heading: loc.heading,
                    accuracy: loc.accuracy,
                    altitude: loc.altitude,
                    timestamp: loc.timestamp,
                })),
            };

            logger.debug('[HTTPSyncManager] Uploading batch', {
                nonce,
                itemCount: batch.length,
                tripId: this.tripId,
            });

            const response = await axios.post(
                `${this.apiBaseUrl}/api/tracking/batch`,
                payload,
                {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`,
                    },
                }
            );

            if (response.status === 200 || response.status === 201) {
                const data = response.data as {
                    success?: boolean;
                    processedCount?: number;
                    rateLimit?: { remaining: number; resetIn: number };
                };

                if (data.success === false) {
                    logger.warn('[HTTPSyncManager] Batch rejected by server', {
                        message: response.data.message,
                    });
                    return false;
                }

                logger.debug('[HTTPSyncManager] Batch uploaded successfully', {
                    processedCount: data.processedCount,
                    remaining: data.rateLimit?.remaining,
                });

                return true;
            }

            logger.warn('[HTTPSyncManager] Unexpected status', {
                status: response.status,
            });
            return false;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;
                const message = (axiosError.response?.data as Record<string, unknown>)?.message || axiosError.message;

                logger.error('[HTTPSyncManager] Upload failed', {
                    status,
                    message,
                    code: axiosError.code,
                });

                // Don't retry on client errors (4xx)
                if (status && status < 500) {
                    return false;
                }
            } else {
                logger.error('[HTTPSyncManager] Upload error', { error });
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

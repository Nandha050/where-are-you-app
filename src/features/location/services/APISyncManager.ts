/**
 * API Sync Manager
 * 
 * Handles uploading location data to backend with resilience.
 * 
 * Key responsibilities:
 * - Upload locations via HTTP
 * - Exponential backoff retry strategy
 * - Batch optimization
 * - Rate limiting
 * - Network error handling
 * - Token refresh on 401
 * - Telemetry and monitoring
 */

import axios from 'axios';
import {
    API_ENDPOINTS,
    calculateRetryDelay,
    DEFAULT_TRACKING_CONFIG,
    TIMEOUTS
} from '../../config/constants';
import { logger } from '../../core/logger/logger';
import {
    BatchLocationPayload,
    IAPISyncManager,
    LocationPayload,
    SyncState
} from '../api/types';
import { locationQueueManager } from './LocationQueueManager';

interface SyncMetrics {
    successfulUploads: number;
    failedUploads: number;
    totalLocations: number;
    averageLatency: number;
    lastSyncTime: number | null;
}

class APISyncManagerClass implements IAPISyncManager {
    private static instance: APISyncManagerClass | null = null;

    private syncState: SyncState = {
        status: 'idle',
        consecutiveFailures: 0,
    };

    private metrics: SyncMetrics = {
        successfulUploads: 0,
        failedUploads: 0,
        totalLocations: 0,
        averageLatency: 0,
        lastSyncTime: null,
    };

    private syncScheduled: NodeJS.Timeout | null = null;
    private apiClient: any = null;
    private backendUrl: string = '';
    private authToken: string = '';

    private constructor() { }

    static getInstance(): APISyncManagerClass {
        if (!APISyncManagerClass.instance) {
            APISyncManagerClass.instance = new APISyncManagerClass();
        }
        return APISyncManagerClass.instance;
    }

    /**
     * Initialize sync manager with API client
     */
    async initialize(apiClient: any, backendUrl: string): Promise<void> {
        this.apiClient = apiClient;
        this.backendUrl = backendUrl;

        logger.info('[APISyncManager] Initialized', {
            backendUrl,
            hasApiClient: !!apiClient,
        });
    }

    /**
     * Set authentication token
     */
    setAuthToken(token: string): void {
        this.authToken = token;
    }

    /**
     * Sync single location immediately
     */
    async sync(location: LocationPayload): Promise<boolean> {
        try {
            if (!this.canSync()) {
                logger.warn('[APISyncManager] Sync conditions not met, queueing');
                await locationQueueManager.enqueue(location);
                return false;
            }

            const startTime = Date.now();
            this.syncState.status = 'syncing';

            // Attempt direct upload
            const success = await this.uploadLocation(location);

            const latency = Date.now() - startTime;
            this.updateMetrics(success, 1, latency);

            if (!success) {
                // Queue for later retry
                await locationQueueManager.enqueue(location);
            }

            return success;
        } catch (error) {
            logger.error('[APISyncManager] Error in sync', { error });
            await locationQueueManager.enqueue(location);
            return false;
        } finally {
            this.syncState.status = 'idle';
        }
    }

    /**
     * Sync entire queue
     */
    async syncQueue(): Promise<void> {
        try {
            logger.info('[APISyncManager] Starting queue sync');

            const stats = await locationQueueManager.getStats();
            if (stats.size === 0) {
                logger.debug('[APISyncManager] Queue is empty');
                return;
            }

            this.syncState.status = 'syncing';

            // Batch upload: get items in chunks
            const batchSize = 50;
            let successCount = 0;
            let failureCount = 0;

            while (true) {
                const batch = await locationQueueManager.dequeue(batchSize);
                if (batch.length === 0) {
                    break;
                }

                const batchSuccess = await this.uploadBatch(batch);
                if (batchSuccess) {
                    successCount += batch.length;
                    this.syncState.consecutiveFailures = 0;
                } else {
                    failureCount += batch.length;
                    this.syncState.consecutiveFailures++;

                    // Re-queue failed items
                    for (const location of batch) {
                        await locationQueueManager.enqueue(location);
                    }

                    // Stop trying if we keep failing
                    if (this.syncState.consecutiveFailures >= 3) {
                        logger.warn('[APISyncManager] Too many failures, stopping sync');
                        break;
                    }
                }
            }

            logger.info('[APISyncManager] Queue sync completed', {
                succeeded: successCount,
                failed: failureCount,
            });

            this.metrics.lastSyncTime = Date.now();
        } catch (error) {
            logger.error('[APISyncManager] Error syncing queue', { error });
            this.syncState.status = 'error';
            this.syncState.lastError = String(error);
        } finally {
            this.syncState.status = 'idle';
        }
    }

    /**
     * Flush entire queue (emergency upload)
     */
    async flushQueue(): Promise<void> {
        try {
            logger.info('[APISyncManager] Flushing queue');

            const locations = await locationQueueManager.flush();

            if (locations.length === 0) {
                return;
            }

            // Try to upload everything
            const success = await this.uploadBatch(locations);
            if (!success) {
                // Re-queue if failed
                for (const location of locations) {
                    await locationQueueManager.enqueue(location);
                }
                logger.error('[APISyncManager] Flush failed, items re-queued');
            }
        } catch (error) {
            logger.error('[APISyncManager] Error flushing queue', { error });
        }
    }

    /**
     * Schedule sync to run after delay
     */
    scheduleSync(delayMs: number): void {
        // Cancel any existing scheduled sync
        if (this.syncScheduled) {
            clearTimeout(this.syncScheduled);
        }

        this.syncScheduled = setTimeout(() => {
            this.syncQueue().catch((error) => {
                logger.error('[APISyncManager] Scheduled sync failed', { error });
            });
        }, delayMs);

        logger.debug('[APISyncManager] Sync scheduled', { delayMs });
    }

    /**
     * Get current sync state
     */
    getStats(): SyncState {
        return { ...this.syncState };
    }

    /**
     * Get sync metrics
     */
    getMetrics(): SyncMetrics {
        return { ...this.metrics };
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Check if sync conditions are met
     */
    private canSync(): boolean {
        // Need API client and token
        if (!this.apiClient || !this.authToken) {
            return false;
        }

        // Not already syncing
        if (this.syncState.status === 'syncing') {
            return false;
        }

        return true;
    }

    /**
     * Upload single location with retry logic
     */
    private async uploadLocation(
        location: LocationPayload,
        attempt: number = 1
    ): Promise<boolean> {
        try {
            const startTime = Date.now();

            const response = await this.apiClient.post(
                API_ENDPOINTS.LOCATION_POST,
                location,
                {
                    timeout: TIMEOUTS.API_REQUEST_TIMEOUT,
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const latency = Date.now() - startTime;

            if (response.status === 200 || response.status === 201) {
                logger.debug('[APISyncManager] Location uploaded', { latency });
                return true;
            }

            return false;
        } catch (error) {
            if (attempt < DEFAULT_TRACKING_CONFIG.maxRetryCount) {
                const delay = calculateRetryDelay(attempt, DEFAULT_TRACKING_CONFIG);
                logger.warn('[APISyncManager] Upload failed, will retry', {
                    attempt,
                    delay,
                    error: this.getErrorMessage(error),
                });

                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.uploadLocation(location, attempt + 1);
            }

            logger.error('[APISyncManager] Upload failed after max retries', {
                error: this.getErrorMessage(error),
            });
            return false;
        }
    }

    /**
     * Upload batch of locations
     */
    private async uploadBatch(
        locations: LocationPayload[],
        attempt: number = 1
    ): Promise<boolean> {
        try {
            if (locations.length === 0) {
                return true;
            }

            // Group by trip for efficiency
            const byTrip = new Map<string, LocationPayload[]>();
            for (const loc of locations) {
                const tripId = loc.tripId;
                if (!byTrip.has(tripId)) {
                    byTrip.set(tripId, []);
                }
                byTrip.get(tripId)!.push(loc);
            }

            // Upload each trip's locations
            let allSuccess = true;
            for (const [tripId, tripLocations] of byTrip) {
                const payload: BatchLocationPayload = {
                    tripId,
                    busId: tripLocations[0].busId,
                    driverId: tripLocations[0].driverId,
                    locations: tripLocations,
                };

                const response = await this.apiClient.post(
                    API_ENDPOINTS.LOCATION_BATCH,
                    payload,
                    {
                        timeout: TIMEOUTS.API_REQUEST_TIMEOUT,
                        headers: {
                            'Authorization': `Bearer ${this.authToken}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );

                if (response.status !== 200 && response.status !== 201) {
                    allSuccess = false;
                }
            }

            return allSuccess;
        } catch (error) {
            // Check if it's an auth error
            if (this.isAuthError(error)) {
                logger.error('[APISyncManager] Auth error, cannot retry', {
                    error: this.getErrorMessage(error),
                });
                return false;
            }

            // Retry other errors
            if (attempt < DEFAULT_TRACKING_CONFIG.maxRetryCount) {
                const delay = calculateRetryDelay(attempt, DEFAULT_TRACKING_CONFIG);
                logger.warn('[APISyncManager] Batch upload failed, will retry', {
                    attempt,
                    delay,
                    error: this.getErrorMessage(error),
                });

                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.uploadBatch(locations, attempt + 1);
            }

            logger.error('[APISyncManager] Batch upload failed after max retries', {
                error: this.getErrorMessage(error),
            });
            return false;
        }
    }

    /**
     * Check if error is authentication related
     */
    private isAuthError(error: unknown): boolean {
        if (axios.isAxiosError(error)) {
            return error.response?.status === 401 || error.response?.status === 403;
        }
        return false;
    }

    /**
     * Get user-friendly error message
     */
    private getErrorMessage(error: unknown): string {
        if (axios.isAxiosError(error)) {
            return `${error.response?.status} ${error.message}`;
        }
        return String(error);
    }

    /**
     * Update sync metrics
     */
    private updateMetrics(
        success: boolean,
        count: number,
        latency: number
    ): void {
        if (success) {
            this.metrics.successfulUploads++;
        } else {
            this.metrics.failedUploads++;
        }

        this.metrics.totalLocations += count;

        // Update average latency
        const total = this.metrics.successfulUploads + this.metrics.failedUploads;
        this.metrics.averageLatency =
            (this.metrics.averageLatency * (total - 1) + latency) / total;
    }
}

/**
 * Singleton instance
 */
export const apiSyncManager = APISyncManagerClass.getInstance();

/**
 * For testing, export the class itself
 */
export { APISyncManagerClass };


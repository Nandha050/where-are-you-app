/**
 * Cache Coordinator Service
 * 
 * Orchestrates the flow:
 * 1. LocationQueueManager collects location data
 * 2. HTTPSyncManager retrieves batches from queue
 * 3. CacheTrackingService formats and monitors uploads
 * 4. Backend caches to Redis with proper TTLs
 * 5. Passengers subscribe to cache keys for real-time updates
 */

import { logger } from '../../core/logger/logger';
import { locationQueueManager } from '../queue/LocationQueueManager';
import { cacheTrackingService } from './CacheTrackingService';

export interface BatchUploadResult {
    success: boolean;
    itemsProcessed: number;
    itemsValid: number;
    itemsDuplicate: number;
    latency: number; // milliseconds
    cacheKeys?: {
        driver: string;
        bus: string;
        trip: string;
    };
    rateLimitRemaining: number;
    nextBatchTime: string;
}

export class CacheCoordinatorService {
    private static instance: CacheCoordinatorService;
    private totalBatches = 0;
    private totalDuplicates = 0;

    private constructor() { }

    static getInstance(): CacheCoordinatorService {
        if (!CacheCoordinatorService.instance) {
            CacheCoordinatorService.instance = new CacheCoordinatorService();
        }
        return CacheCoordinatorService.instance;
    }

    /**
     * Coordinate a complete batch upload cycle
     * 
     * Flow:
     * 1. Get batch from location queue
     * 2. Format as cache payload
     * 3. Upload to backend
     * 4. Backend caches to Redis
     * 5. Return result with cache info
     */
    async coordinateBatchUpload(
        tripId: string,
        driverId: string,
        busId: string,
        apiBaseUrl: string,
        authToken: string,
        maxBatchSize: number = 100
    ): Promise<BatchUploadResult | null> {
        try {
            // Step 1: Get batch from queue
            const batch = await locationQueueManager.getBatch(maxBatchSize);
            if (batch.length === 0) {
                logger.debug('[CacheCoordinator] No locations to batch');
                return null;
            }

            // Log what's in this batch
            logger.debug('[CacheCoordinator] Batch retrieved', {
                tripId,
                batchSize: batch.length,
                locations: batch.map(loc => ({
                    ts: loc.timestamp,
                    lat: loc.latitude,
                    lon: loc.longitude,
                })),
            });

            // Step 2: Format as cache payload
            const payload = cacheTrackingService.createBatchPayload(
                batch,
                tripId,
                driverId,
                busId
            );

            // Step 3: Upload to backend (which caches to Redis)
            const uploadResult = await cacheTrackingService.uploadBatchToCache(
                payload,
                apiBaseUrl,
                authToken
            );

            if (!uploadResult.success || !uploadResult.response) {
                // Upload failed - re-push batch to queue for retry
                await locationQueueManager.rePushBatch(batch);
                logger.warn('[CacheCoordinator] Batch upload failed, re-queued', {
                    tripId,
                    batchSize: batch.length,
                    locations: batch.map(loc => ({
                        ts: loc.timestamp,
                        lat: loc.latitude,
                        lon: loc.longitude,
                    })),
                });
                return null;
            }

            // Step 4: Process successful response
            const response = uploadResult.response;
            const latency = this.calculateLatency();

            // Note: Items are already removed from queue by getBatch()
            // No need to call removeBatch() again

            this.totalBatches++;
            this.totalDuplicates += response.duplicateCount;

            // Step 5: Return result with cache info
            const result: BatchUploadResult = {
                success: true,
                itemsProcessed: response.processedCount,
                itemsValid: response.validCount,
                itemsDuplicate: response.duplicateCount,
                latency,
                cacheKeys: response.cacheKeys
                    ? {
                        driver: response.cacheKeys.driverLocation,
                        bus: response.cacheKeys.busLocation,
                        trip: response.cacheKeys.tripLocation,
                    }
                    : undefined,
                rateLimitRemaining: response.rateLimit.remaining,
                nextBatchTime: response.nextExpectedBatch,
            };

            logger.info('[CacheCoordinator] Batch cycle completed', {
                tripId,
                driverId,
                itemsProcessed: result.itemsProcessed,
                itemsDuplicate: result.itemsDuplicate,
                latency: `${result.latency}ms`,
                rateLimitRemaining: result.rateLimitRemaining,
            });

            return result;
        } catch (error) {
            logger.error('[CacheCoordinator] Batch cycle failed', {
                tripId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return null;
        }
    }

    /**
     * Get coordinator statistics
     */
    getStats() {
        const cacheStats = cacheTrackingService.getStats();
        return {
            totalBatchesCycled: this.totalBatches,
            totalDuplicatesDetected: this.totalDuplicates,
            duplicateRate:
                cacheStats.totalLocationsProcessed > 0
                    ? (this.totalDuplicates / cacheStats.totalLocationsProcessed) * 100
                    : 0,
            ...cacheStats,
        };
    }

    /**
     * Reset all statistics
     */
    resetStats(): void {
        cacheTrackingService.resetStats();
        this.totalBatches = 0;
        this.totalDuplicates = 0;
    }

    /**
     * Calculate batch latency (simple approximation)
     */
    private calculateLatency(): number {
        // In real implementation, this would be measured
        // For now, return average from cache tracking service
        return cacheTrackingService.getStats().averageBatchLatency;
    }
}

export const cacheCoordinatorService = CacheCoordinatorService.getInstance();

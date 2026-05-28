import axios from 'axios';
import { logger } from '../../core/logger/logger';
import { LocationRecord } from '../queue/LocationQueueManager';
import { CACHE_KEYS } from './cacheKeys';

// Simple UUID v4 generator (no external dependencies)
const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

export interface CacheStats {
    totalBatchesSent: number;
    totalLocationsProcessed: number;
    lastBatchTimestamp: string | null;
    lastBatchSize: number;
    cacheHitRate: number; // 0-1
    averageBatchLatency: number; // milliseconds
    rateLimitRemaining: number;
}

export interface RedisCacheResponse {
    success: boolean;
    processedCount: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    cacheUpdated: boolean;
    rateLimit: {
        remaining: number;
        resetIn: number; // milliseconds
    };
    nextExpectedBatch: string;
    cacheKeys?: {
        driverLocation: string;
        busLocation: string;
        tripLocation: string;
    };
}

export interface LocationBatchPayload {
    tripId: string;
    driverId: string;
    busId: string;
    batchTimestamp: string;
    nonce: string;
    locations: Array<{
        latitude: number;        // -90 to 90
        longitude: number;       // -180 to 180
        speed: number;           // >= 0 (m/s)
        heading: number;         // 0-360 (degrees)
        accuracy: number;        // >= 0 (meters)
        timestamp: string;       // ISO-8601 format
        altitude?: number;       // Optional (meters)
    }>;
}

/**
 * Cache Tracking Service
 * Manages batching of location data and Redis cache integration
 * 
 * Architecture:
 * - Local queue buffers locations from GPS
 * - Every 15 seconds, batch is sent to backend
 * - Backend validates and caches to Redis (30s TTL)
 * - Passengers subscribe to Redis cache keys for real-time updates
 */
export class CacheTrackingService {
    private static instance: CacheTrackingService;
    private stats: CacheStats = {
        totalBatchesSent: 0,
        totalLocationsProcessed: 0,
        lastBatchTimestamp: null,
        lastBatchSize: 0,
        cacheHitRate: 0,
        averageBatchLatency: 0,
        rateLimitRemaining: 10,
    };
    private batchLatencies: number[] = [];
    private maxLatencyHistory = 100;

    private constructor() { }

    static getInstance(): CacheTrackingService {
        if (!CacheTrackingService.instance) {
            CacheTrackingService.instance = new CacheTrackingService();
        }
        return CacheTrackingService.instance;
    }

    /**
     * Create batch payload for Redis cache upload
     * ✅ FIXED: Validates and sanitizes all location fields
     */
    createBatchPayload(
        locations: LocationRecord[],
        tripId: string,
        driverId: string,
        busId: string
    ): LocationBatchPayload {
        return {
            tripId,
            driverId,
            busId,
            batchTimestamp: new Date().toISOString(),
            nonce: generateUUID(),
            locations: locations.map((loc) => this.sanitizeLocation(loc)),
        };
    }

    /**
     * ✅ NEW: Sanitize and validate location data before sending to backend
     * Ensures all fields meet backend validation requirements
     */
    private sanitizeLocation(loc: LocationRecord): {
        latitude: number;
        longitude: number;
        accuracy: number;
        speed: number;
        heading: number;
        timestamp: string;
        altitude?: number;
    } {
        // ✅ Validate timestamp format (ISO-8601)
        let timestamp = loc.timestamp;
        if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp)) {
            console.warn('[CacheTrackingService] Invalid timestamp format, using current time:', {
                provided: timestamp,
            });
            timestamp = new Date().toISOString();
        }

        // ✅ Check timestamp is not in future (> 30 seconds ahead)
        const locationTime = new Date(timestamp).getTime();
        const currentTime = Date.now();
        if (locationTime > currentTime + 30000) {
            console.warn('[CacheTrackingService] Location timestamp is in future, adjusting:', {
                provided: timestamp,
                adjusted: new Date(currentTime).toISOString(),
            });
            timestamp = new Date(currentTime).toISOString();
        }

        // ✅ Check timestamp is not older than 24 hours
        if (currentTime - locationTime > 24 * 60 * 60 * 1000) {
            console.warn('[CacheTrackingService] Location timestamp is > 24 hours old, skipping:', {
                timestamp,
                age: Math.round((currentTime - locationTime) / 1000) + 's',
            });
            // This location will fail on backend, but we send it anyway for logging
        }

        // ✅ Validate and clamp latitude (-90 to 90)
        const latitude = Math.max(-90, Math.min(90, loc.latitude));
        if (latitude !== loc.latitude) {
            console.warn('[CacheTrackingService] Invalid latitude, clamped:', {
                original: loc.latitude,
                clamped: latitude,
            });
        }

        // ✅ Validate and clamp longitude (-180 to 180)
        const longitude = Math.max(-180, Math.min(180, loc.longitude));
        if (longitude !== loc.longitude) {
            console.warn('[CacheTrackingService] Invalid longitude, clamped:', {
                original: loc.longitude,
                clamped: longitude,
            });
        }

        // ✅ Validate accuracy (non-negative)
        const accuracy = Math.max(0, loc.accuracy ?? 0);

        // ✅ Validate speed (non-negative)
        const speed = Math.max(0, loc.speed ?? 0);

        // ✅ Validate heading (0-360)
        const heading = loc.heading !== undefined && loc.heading !== null
            ? ((loc.heading % 360) + 360) % 360  // Normalize to 0-360
            : 0;

        // ✅ Build sanitized location
        const sanitized = {
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            timestamp,
            ...(loc.altitude !== undefined && loc.altitude !== null && { altitude: loc.altitude }),
        };

        return sanitized;
    }

    /**
     * Upload batch to backend and update Redis cache
     */
    async uploadBatchToCache(
        payload: LocationBatchPayload,
        apiBaseUrl: string,
        authToken: string
    ): Promise<{ success: boolean; response: RedisCacheResponse | null }> {
        const startTime = Date.now();

        try {
            if (!apiBaseUrl) {
                throw new Error('API base URL not configured');
            }

            if (!authToken) {
                throw new Error('Authentication token not available');
            }

            logger.debug('[CacheTrackingService] Uploading batch to cache', {
                tripId: payload.tripId,
                driverId: payload.driverId,
                locationCount: payload.locations.length,
                nonce: payload.nonce,
                locations: payload.locations.map(loc => ({
                    lat: loc.latitude,
                    lon: loc.longitude,
                    ts: loc.timestamp,
                    speed: loc.speed,
                    heading: loc.heading,
                    accuracy: loc.accuracy,
                })),
            });

            const response = await axios.post<RedisCacheResponse>(
                `${apiBaseUrl}/api/tracking/batch`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000, // 10 second timeout
                }
            );

            if (!response.data.success) {
                throw new Error(`Cache upload failed: ${JSON.stringify(response.data)}`);
            }

            // Update stats
            const latency = Date.now() - startTime;
            this.recordBatchLatency(latency);
            this.stats.totalBatchesSent++;
            this.stats.totalLocationsProcessed += payload.locations.length;
            this.stats.lastBatchTimestamp = payload.batchTimestamp;
            this.stats.lastBatchSize = payload.locations.length;
            this.stats.rateLimitRemaining = response.data.rateLimit.remaining;

            logger.info('[CacheTrackingService] Batch uploaded successfully', {
                tripId: payload.tripId,
                processedCount: response.data.processedCount,
                validCount: response.data.validCount,
                duplicateCount: response.data.duplicateCount,
                latency: `${latency}ms`,
                cacheUpdated: response.data.cacheUpdated,
                cacheKeys: response.data.cacheKeys,
                nextBatch: response.data.nextExpectedBatch,
            });

            return {
                success: true,
                response: response.data,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';

            // ADD THIS: Extract response details from backend error
            let responseBody = '';
            if (axios.isAxiosError(error) && error.response?.data) {
                responseBody = JSON.stringify(error.response.data);
            }

            // Check for rate limiting
            if (
                axios.isAxiosError(error) &&
                error.response?.status === 429
            ) {
                logger.warn('[CacheTrackingService] Rate limited', {
                    tripId: payload.tripId,
                    resetIn: error.response.headers['retry-after'],
                });
            }

            // UPDATED: Now logs the backend error message
            logger.error('[CacheTrackingService] Batch upload failed', {
                tripId: payload.tripId,
                error: message,
                status: axios.isAxiosError(error) ? error.response?.status : 'unknown',
                responseBody: responseBody || 'no response body',  // ← THIS IS THE KEY
                payloadSummary: {
                    locationCount: payload.locations.length,
                    fields: Object.keys(payload),
                },
                locations: payload.locations.map(loc => ({
                    lat: loc.latitude,
                    lon: loc.longitude,
                    ts: loc.timestamp,
                })),
            });

            return {
                success: false,
                response: null,
            };
        }
    }

    /**
     * Get cache statistics for monitoring
     */
    getStats(): CacheStats {
        return {
            ...this.stats,
            averageBatchLatency: this.calculateAverageLatency(),
        };
    }

    /**
     * Record batch upload latency
     */
    private recordBatchLatency(latency: number): void {
        this.batchLatencies.push(latency);
        if (this.batchLatencies.length > this.maxLatencyHistory) {
            this.batchLatencies.shift();
        }
    }

    /**
     * Calculate average latency
     */
    private calculateAverageLatency(): number {
        if (this.batchLatencies.length === 0) return 0;
        const sum = this.batchLatencies.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.batchLatencies.length);
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats = {
            totalBatchesSent: 0,
            totalLocationsProcessed: 0,
            lastBatchTimestamp: null,




























































            lastBatchSize: 0,
            cacheHitRate: 0,
            averageBatchLatency: 0,
            rateLimitRemaining: 10,
        };
        this.batchLatencies = [];
    }

    /**
     * Get cache key info for driver
     */
    getCacheKeysForDriver(tripId: string, driverId: string, busId: string) {
        return {
            driver: CACHE_KEYS.driverLocation(driverId),
            bus: CACHE_KEYS.busLocation(busId),
            trip: CACHE_KEYS.tripLocation(tripId),
            activeTrip: CACHE_KEYS.driverActiveTrip(driverId),
            tripMetadata: CACHE_KEYS.tripMetadata(tripId),
        };
    }
}

export const cacheTrackingService = CacheTrackingService.getInstance();

/**
 * Redis Cache Key Management
 * Defines all cache key patterns used for driver location tracking
 */

export const CACHE_KEYS = {
    /**
     * Latest driver location
     * Used for: Passenger tracking, route optimization
     * TTL: 30 seconds
     */
    driverLocation: (driverId: string) => `location:driver_${driverId}`,

    /**
     * Latest bus location
     * Used for: Fleet tracking, analytics
     * TTL: 30 seconds
     */
    busLocation: (busId: string) => `location:bus_${busId}`,

    /**
     * Latest trip location aggregate
     * Used for: Trip timeline, history
     * TTL: 30 seconds
     */
    tripLocation: (tripId: string) => `location:trip_${tripId}`,

    /**
     * Driver active trip reference
     * Used for: Linking driver to current trip
     * TTL: Until trip ends
     */
    driverActiveTrip: (driverId: string) => `driver:active_trip_${driverId}`,

    /**
     * Active trip metadata
     * Used for: Route info, stops, eta calculations
     * TTL: Until trip ends
     */
    tripMetadata: (tripId: string) => `trip:metadata_${tripId}`,

    /**
     * Batch upload acknowledgment
     * Used for: Deduplication, rate limiting
     * TTL: 60 seconds
     */
    batchAck: (nonce: string) => `batch:ack_${nonce}`,

    /**
     * Rate limit counter for driver
     * Used for: Throttling uploads
     * TTL: 60 seconds
     */
    rateLimit: (driverId: string) => `ratelimit:driver_${driverId}`,

    /**
     * Cache health check key
     * Used for: Monitoring
     * TTL: 60 seconds
     */
    healthCheck: () => 'cache:health',

    /**
     * Batch statistics for driver
     * Used for: Monitoring batch uploads
     * TTL: 60 seconds
     */
    batchStats: (driverId: string) => `batch:stats_${driverId}`,
} as const;

export type CacheKeyType = ReturnType<typeof CACHE_KEYS[keyof typeof CACHE_KEYS]>;

/**
 * Get all cache keys for a driver
 * Useful for cleanup/invalidation
 */
export function getDriverCacheKeys(driverId: string): string[] {
    return [
        CACHE_KEYS.driverLocation(driverId),
        CACHE_KEYS.driverActiveTrip(driverId),
        CACHE_KEYS.rateLimit(driverId),
        CACHE_KEYS.batchStats(driverId),
    ];
}

/**
 * Get all cache keys for a trip
 */
export function getTripCacheKeys(tripId: string): string[] {
    return [
        CACHE_KEYS.tripLocation(tripId),
        CACHE_KEYS.tripMetadata(tripId),
    ];
}

/**
 * Get all cache keys for a bus
 */
export function getBusCacheKeys(busId: string): string[] {
    return [CACHE_KEYS.busLocation(busId)];
}

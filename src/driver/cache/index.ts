/**
 * Driver Cache System - Unified Exports
 * 
 * Complete Redis cache system for driver location tracking
 */

// Cache keys and management
export { CACHE_KEYS, getBusCacheKeys, getDriverCacheKeys, getTripCacheKeys } from './cacheKeys';
export type { CacheKeyType } from './cacheKeys';

// Core cache tracking service
export { cacheTrackingService, CacheTrackingService } from './CacheTrackingService';
export type { CacheStats, LocationBatchPayload, RedisCacheResponse } from './CacheTrackingService';

// Cache coordinator for batch management
export { cacheCoordinatorService, CacheCoordinatorService } from './CacheCoordinatorService';
export type { BatchUploadResult } from './CacheCoordinatorService';

// Monitoring and utilities
export { CacheHealthReport, CacheMonitoring } from './CacheMonitoring';

// React hook for cache monitoring
export { useCacheTracking } from '../hooks/useCacheTracking';


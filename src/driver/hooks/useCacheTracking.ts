import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../../core/logger/logger';
import { cacheTrackingService, type CacheStats } from '../cache/CacheTrackingService';

interface UseCacheTrackingState {
    cacheStats: CacheStats;
    isCacheHealthy: boolean;
    lastCacheUpdate: string | null;
    rateLimitStatus: {
        remaining: number;
        limited: boolean;
    };
}

/**
 * Hook for monitoring Redis cache tracking
 * 
 * Provides real-time statistics about batch uploads and cache performance
 * 
 * Usage:
 * const cacheMonitor = useCacheTracking();
 * console.log(cacheMonitor.cacheStats); // View cache performance
 */
export function useCacheTracking() {
    const [state, setState] = useState<UseCacheTrackingState>({
        cacheStats: cacheTrackingService.getStats(),
        isCacheHealthy: true,
        lastCacheUpdate: null,
        rateLimitStatus: {
            remaining: 10,
            limited: false,
        },
    });

    const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /**
     * Update cache stats periodically
     */
    useEffect(() => {
        const updateStats = () => {
            const stats = cacheTrackingService.getStats();
            const isHealthy =
                stats.rateLimitRemaining > 0 &&
                stats.averageBatchLatency < 5000; // Latency threshold

            setState({
                cacheStats: stats,
                isCacheHealthy: isHealthy,
                lastCacheUpdate: new Date().toISOString(),
                rateLimitStatus: {
                    remaining: stats.rateLimitRemaining,
                    limited: stats.rateLimitRemaining <= 2,
                },
            });
        };

        updateStats();
        updateIntervalRef.current = setInterval(updateStats, 2000);

        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, []);

    /**
     * Reset cache statistics
     */
    const resetCacheStats = useCallback(() => {
        cacheTrackingService.resetStats();
        setState((prev) => ({
            ...prev,
            cacheStats: cacheTrackingService.getStats(),
        }));
        logger.info('[useCacheTracking] Cache stats reset');
    }, []);

    return {
        ...state,
        resetCacheStats,
    };
}

/**
 * Cache Monitoring Utilities
 * 
 * Tools for monitoring, debugging, and optimizing Redis cache usage
 */

import { logger } from '../../core/logger/logger';
import { cacheCoordinatorService } from './CacheCoordinatorService';
import { cacheTrackingService } from './CacheTrackingService';
import { CACHE_KEYS } from './cacheKeys';

export interface CacheHealthReport {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    metrics: {
        totalBatchesSent: number;
        totalLocationsProcessed: number;
        averageLatency: number;
        rateLimitRemaining: number;
        isRateLimited: boolean;
        duplicateRate: number;
        successRate: number;
    };
    warnings: string[];
    recommendations: string[];
}

export class CacheMonitoring {
    /**
     * Get comprehensive health report
     */
    static getHealthReport(): CacheHealthReport {
        const coordStats = cacheCoordinatorService.getStats();
        const warnings: string[] = [];
        const recommendations: string[] = [];

        // Check rate limiting
        if (coordStats.rateLimitRemaining <= 2) {
            warnings.push('Rate limit threshold reached (≤2 remaining)');
            recommendations.push('Reduce batch frequency or increase batch interval');
        }

        // Check latency
        if (coordStats.averageBatchLatency > 5000) {
            warnings.push('High batch upload latency (>5s)');
            recommendations.push('Check network connectivity');
            recommendations.push('Verify backend performance');
        }

        // Check duplicate rate
        if (coordStats.duplicateRate > 5) {
            warnings.push('High duplicate rate (>5%)');
            recommendations.push('Verify GPS accuracy settings');
            recommendations.push('Check time synchronization');
        }

        // Calculate success rate
        const totalBatches = coordStats.totalBatchesSent;
        const duplicates = coordStats.totalDuplicatesDetected;
        const successRate =
            totalBatches > 0
                ? ((totalBatches - duplicates) / totalBatches) * 100
                : 100;

        if (successRate < 90) {
            warnings.push(`Low success rate (${successRate.toFixed(1)}%)`);
            recommendations.push('Check authentication token');
            recommendations.push('Verify backend is running');
        }

        const status: 'healthy' | 'degraded' | 'unhealthy' =
            warnings.length === 0
                ? 'healthy'
                : warnings.length <= 2
                    ? 'degraded'
                    : 'unhealthy';

        return {
            status,
            timestamp: new Date().toISOString(),
            metrics: {
                totalBatchesSent: coordStats.totalBatchesSent,
                totalLocationsProcessed: coordStats.totalLocationsProcessed,
                averageLatency: coordStats.averageBatchLatency,
                rateLimitRemaining: coordStats.rateLimitRemaining,
                isRateLimited: coordStats.rateLimitRemaining <= 2,
                duplicateRate: coordStats.duplicateRate,
                successRate,
            },
            warnings,
            recommendations,
        };
    }

    /**
     * Log detailed cache statistics
     */
    static logCacheStats(context: string = 'Manual Check'): void {
        const report = this.getHealthReport();

        logger.info(`[CacheMonitoring] Health Report - ${context}`, {
            status: report.status,
            metrics: report.metrics,
        });

        if (report.warnings.length > 0) {
            logger.warn(`[CacheMonitoring] Warnings - ${context}`, {
                warnings: report.warnings,
                recommendations: report.recommendations,
            });
        }
    }

    /**
     * Get cache keys for a specific trip/driver/bus
     */
    static getCacheKeysInfo(
        tripId: string,
        driverId: string,
        busId: string
    ) {
        return {
            description:
                'Cache keys used for this trip (visible in RedisInsight)',
            driver: {
                key: CACHE_KEYS.driverLocation(driverId),
                description: 'Latest driver location (30s TTL)',
                usage: 'Passenger tracking, route optimization',
            },
            bus: {
                key: CACHE_KEYS.busLocation(busId),
                description: 'Latest bus location (30s TTL)',
                usage: 'Fleet tracking, analytics',
            },
            trip: {
                key: CACHE_KEYS.tripLocation(tripId),
                description: 'Latest trip location aggregate (30s TTL)',
                usage: 'Trip timeline, trip history',
            },
            driverTrip: {
                key: CACHE_KEYS.driverActiveTrip(driverId),
                description: 'Driver active trip reference',
                usage: 'Linking driver to current trip',
            },
            tripMetadata: {
                key: CACHE_KEYS.tripMetadata(tripId),
                description: 'Trip metadata and route info',
                usage: 'Route info, stops, ETA calculations',
            },
        };
    }

    /**
     * Format cache statistics for display/logging
     */
    static formatCacheStatsForDisplay(verbose: boolean = false): string {
        const report = this.getHealthReport();
        const m = report.metrics;

        let output = `
╔════════════════════════════════════════════════════════╗
║            REDIS CACHE TRACKING HEALTH                 ║
╠════════════════════════════════════════════════════════╣
║ Status: ${report.status.toUpperCase().padEnd(46)}║
║ Timestamp: ${report.timestamp.slice(11, 19).padEnd(41)}║
╠════════════════════════════════════════════════════════╣
║ 📊 Metrics:                                            ║
║   • Total Batches Sent: ${String(m.totalBatchesSent).padEnd(37)}║
║   • Total Locations: ${String(m.totalLocationsProcessed).padEnd(39)}║
║   • Avg Latency: ${String(m.averageLatency + 'ms').padEnd(40)}║
║   • Rate Limit: ${String(m.rateLimitRemaining + ' remaining').padEnd(39)}║
║   • Duplicate Rate: ${String((m.duplicateRate.toFixed(1) + '%')).padEnd(37)}║
║   • Success Rate: ${String((m.successRate.toFixed(1) + '%')).padEnd(38)}║
    `;

        if (verbose && report.warnings.length > 0) {
            output += `║ ⚠️  Warnings:\n`;
            report.warnings.forEach((w) => {
                output += `║   • ${w.padEnd(50)}║\n`;
            });
        }

        if (verbose && report.recommendations.length > 0) {
            output += `║ 💡 Recommendations:\n`;
            report.recommendations.forEach((r) => {
                output += `║   • ${r.padEnd(50)}║\n`;
            });
        }

        output += `╚════════════════════════════════════════════════════════╝`;

        return output;
    }

    /**
     * Export cache stats as JSON for analysis
     */
    static exportStatsAsJSON() {
        const report = this.getHealthReport();
        const coordStats = cacheCoordinatorService.getStats();
        const cacheStats = cacheTrackingService.getStats();

        return {
            exported_at: new Date().toISOString(),
            health_report: report,
            detailed_stats: {
                coordinator: coordStats,
                cache_tracking: cacheStats,
            },
        };
    }

    /**
     * Reset all monitoring statistics
     */
    static resetMonitoring(): void {
        cacheCoordinatorService.resetStats();
        logger.info('[CacheMonitoring] All statistics reset');
    }
}

// Export monitoring utilities
export default CacheMonitoring;

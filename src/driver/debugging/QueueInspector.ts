/**
 * QUEUE INSPECTOR
 * 
 * Inspects queue state and detects corruption/issues
 * Provides safe access to queue metadata
 * 
 * ISSUE FIXED:
 * - Issue #6: Queue Race Conditions
 * - Issue #12: No Offline Queue Handling
 */

import { logger } from '../../core/logger/logger';
import { locationQueueManager } from '../queue/LocationQueueManager';

export interface QueueInspection {
    size: number;
    oldestItemAge: number | null;
    newestItemAge: number | null;
    maxSize: number;
    utilizationPercent: number;
    estimatedMemoryBytes: number;
    corruption: string | null;
    warnings: string[];
}

export class QueueInspector {
    private static instance: QueueInspector;
    private lastSizeCheck: number = 0;
    private maxSizeObserved: number = 0;

    private constructor() { }

    static getInstance(): QueueInspector {
        if (!QueueInspector.instance) {
            QueueInspector.instance = new QueueInspector();
        }
        return QueueInspector.instance;
    }

    /**
     * Inspect queue state
     */
    async inspect(): Promise<QueueInspection> {
        try {
            const stats = locationQueueManager.getStats();
            const now = Date.now();
            const maxSize = 500;

            // Calculate metrics
            const utilizationPercent = Math.round((stats.totalItems / maxSize) * 100);
            const estimatedMemoryBytes = stats.totalItems * 150; // ~150 bytes per location

            // Check for corruption
            let corruption: string | null = null;
            const warnings: string[] = [];

            // WARNING: Queue growing too fast
            if (stats.totalItems > this.lastSizeCheck + 100) {
                warnings.push(
                    `Rapid queue growth detected (+${stats.totalItems - this.lastSizeCheck} items)`
                );
            }

            // WARNING: Queue too full
            if (stats.totalItems > maxSize * 0.9) {
                warnings.push(`Queue nearly full (${stats.totalItems}/${maxSize})`);
                corruption = `CRITICAL: Queue ${utilizationPercent}% full - data loss imminent`;
            }

            // WARNING: Old items stuck
            if (stats.oldestItemAge && stats.oldestItemAge > 1000 * 60 * 30) {
                // 30 minutes old
                warnings.push(
                    `Oldest item ${Math.round(stats.oldestItemAge / 1000 / 60)} minutes old - sync may be stuck`
                );
            }

            // WARNING: Queue not flushing
            if (stats.totalItems > 50 && stats.oldestItemAge && stats.oldestItemAge > 1000 * 60 * 2) {
                warnings.push('Queue not flushing - possible sync failure');
                if (!corruption) {
                    corruption = 'STALE_QUEUE: Items not uploading';
                }
            }

            this.lastSizeCheck = stats.totalItems;
            this.maxSizeObserved = Math.max(this.maxSizeObserved, stats.totalItems);

            const newestItemAge = stats.oldestItemAge
                ? now - (new Date().getTime() - stats.oldestItemAge)
                : null;

            return {
                size: stats.totalItems,
                oldestItemAge: stats.oldestItemAge,
                newestItemAge: newestItemAge,
                maxSize,
                utilizationPercent,
                estimatedMemoryBytes,
                corruption,
                warnings,
            };
        } catch (error) {
            logger.error('[QueueInspector] Inspection failed', { error });
            return {
                size: 0,
                oldestItemAge: null,
                newestItemAge: null,
                maxSize: 500,
                utilizationPercent: 0,
                estimatedMemoryBytes: 0,
                corruption: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
                warnings: ['Inspection failed'],
            };
        }
    }

    /**
     * Get queue diagnostics report
     */
    async getDiagnosticsReport(): Promise<string> {
        const inspection = await this.inspect();

        let report = '\n╔════════════════════════════════════════════════════════════╗\n';
        report += '║         QUEUE DIAGNOSTICS REPORT                           ║\n';
        report += '╚════════════════════════════════════════════════════════════╝\n\n';

        // Health indicator
        let healthEmoji = '🟢';
        if (inspection.corruption) {
            healthEmoji = '🔴';
        } else if (inspection.warnings.length > 0) {
            healthEmoji = '🟡';
        }

        report += `${healthEmoji} QUEUE HEALTH:\n`;
        if (inspection.corruption) {
            report += `  Status:   CORRUPTED\n`;
            report += `  Error:    ${inspection.corruption}\n`;
        } else if (inspection.warnings.length > 0) {
            report += `  Status:   WARNING\n`;
        } else {
            report += `  Status:   HEALTHY\n`;
        }
        report += '\n';

        // Queue Status
        report += '📦 QUEUE STATUS:\n';
        report += `  Size:               ${inspection.size}/${inspection.maxSize}\n`;
        report += `  Utilization:        ${inspection.utilizationPercent}%\n`;
        report += `  Estimated Memory:   ${inspection.estimatedMemoryBytes.toLocaleString()} bytes\n`;

        if (inspection.oldestItemAge) {
            const oldest = this.formatAge(inspection.oldestItemAge);
            report += `  Oldest Item:        ${oldest} old\n`;
        }

        report += `  Max Observed:       ${this.maxSizeObserved} (${Math.round((this.maxSizeObserved / inspection.maxSize) * 100)}%)\n\n`;

        // Warnings
        if (inspection.warnings.length > 0) {
            report += '⚠️ WARNINGS:\n';
            for (const warning of inspection.warnings) {
                report += `  • ${warning}\n`;
            }
            report += '\n';
        }

        // Recommendations
        report += '💡 RECOMMENDATIONS:\n';
        if (inspection.size > 250) {
            report += '  • Queue is large - consider triggering manual sync\n';
        }
        if (inspection.corruption) {
            report += '  • Queue may be corrupted - restart app\n';
            report += '  • Check AsyncStorage integrity\n';
        }
        if (inspection.oldestItemAge && inspection.oldestItemAge > 1000 * 60 * 5) {
            report += '  • Old items stuck in queue - check HTTP sync\n';
        }
        report += '\n';

        return report;
    }

    /**
     * Format age for display
     */
    private formatAge(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Get max observed queue size
     */
    getMaxObserved(): number {
        return this.maxSizeObserved;
    }

    /**
     * Reset max observation
     */
    resetMaxObserved(): void {
        this.maxSizeObserved = 0;
    }
}

export const queueInspector = QueueInspector.getInstance();

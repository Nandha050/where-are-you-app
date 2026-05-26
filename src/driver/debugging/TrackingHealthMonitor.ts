/**
 * TRACKING HEALTH MONITOR
 * 
 * Monitors entire tracking system health and performance
 * Provides metrics, diagnostics, and alerts
 * 
 * ISSUE FIXED:
 * - Issue #8: No Background Execution Diagnostics
 * - Issue #13: Missing Health Monitoring & Alerts
 */

import { logger } from '../../core/logger/logger';
import { locationQueueManager } from '../queue/LocationQueueManager';
import { httpSyncManager } from '../sync/HTTPSyncManager';
import { backgroundLocationService } from '../tracking/BackgroundLocationService';
import { appStateManager } from './AppStateManager';
import { networkStateManager } from './NetworkStateManager';

export interface HealthMetrics {
    // Tracking Status
    isTracking: boolean;
    isForegroundActive: boolean;
    isBackgroundActive: boolean;

    // Collection Metrics
    totalLocationsCollected: number;
    collectRate: number; // locations per minute
    duplicatesFiltered: number;

    // Queue Metrics
    queueSize: number;
    oldestQueueItem: string | null;
    queueHealthy: boolean;

    // Sync Metrics
    successfulSyncs: number;
    failedSyncs: number;
    successRate: number; // percentage
    totalItemsUploaded: number;
    averageLatency: number;
    lastSyncTime: string | null;

    // Network Metrics
    isConnected: boolean | null;
    wasRecentlyOffline: boolean;
    networkType: string;

    // App State
    appState: string;
    isPaused: boolean;

    // Health Score
    healthScore: number; // 0-100
    issues: string[];
}

export class TrackingHealthMonitor {
    private static instance: TrackingHealthMonitor;
    private metrics: HealthMetrics | null = null;
    private collectStartTime: number = 0;
    private backgroundTaskExecutions: number = 0;
    private backgroundTaskErrors: number = 0;

    private constructor() { }

    static getInstance(): TrackingHealthMonitor {
        if (!TrackingHealthMonitor.instance) {
            TrackingHealthMonitor.instance = new TrackingHealthMonitor();
        }
        return TrackingHealthMonitor.instance;
    }

    /**
     * Start health monitoring
     */
    start(): void {
        this.collectStartTime = Date.now();
        logger.info('[TrackingHealthMonitor] Started monitoring');
    }

    /**
     * Get current health metrics
     */
    getMetrics(): HealthMetrics {
        const bgService = backgroundLocationService;
        const syncStats = httpSyncManager.getStats();
        const queueStats = locationQueueManager.getStats();
        const networkState = networkStateManager.getCurrentState();
        const appState = appStateManager.getCurrentState();

        const isTracking = bgService.isActive();
        const isForegroundActive = bgService.isForegroundActive();
        const isBackgroundActive = bgService.isActive();

        // Calculate metrics
        const uptime = Date.now() - this.collectStartTime;
        const collectRatePerMin =
            uptime > 0
                ? (queueStats.totalItems + syncStats.totalItemsUploaded) /
                (uptime / 1000 / 60)
                : 0;

        const successRate =
            syncStats.successfulUploads + syncStats.failedAttempts > 0
                ? (syncStats.successfulUploads /
                    (syncStats.successfulUploads + syncStats.failedAttempts)) *
                100
                : 100;

        const issues = this.identifyIssues(
            isTracking,
            queueStats.totalItems,
            successRate,
            networkState.isConnected
        );

        const healthScore = this.calculateHealthScore(
            queueStats.totalItems,
            successRate,
            issues.length
        );

        this.metrics = {
            isTracking,
            isForegroundActive,
            isBackgroundActive,
            totalLocationsCollected: queueStats.totalItems + syncStats.totalItemsUploaded,
            collectRate: Math.round(collectRatePerMin * 10) / 10,
            duplicatesFiltered: 0, // Could track in LocationQueueManager

            queueSize: queueStats.totalItems,
            oldestQueueItem: queueStats.oldestItemAge
                ? this.formatAge(queueStats.oldestItemAge)
                : null,
            queueHealthy: queueStats.totalItems < 250,

            successfulSyncs: syncStats.successfulUploads,
            failedSyncs: syncStats.failedAttempts,
            successRate: Math.round(successRate),
            totalItemsUploaded: syncStats.totalItemsUploaded,
            averageLatency: 0, // Could be tracked in CacheTrackingService
            lastSyncTime: syncStats.lastSyncTime,

            isConnected: networkState.isConnected,
            wasRecentlyOffline: networkStateManager.wasRecentlyOffline(),
            networkType: networkState.type,

            appState: appState,
            isPaused: appStateManager.isPausedState(),

            healthScore,
            issues,
        };

        return this.metrics;
    }

    /**
     * Identify issues from metrics
     */
    private identifyIssues(
        isTracking: boolean,
        queueSize: number,
        successRate: number,
        isConnected: boolean | null
    ): string[] {
        const issues: string[] = [];

        if (!isTracking) {
            issues.push('Tracking not active');
        }

        if (queueSize > 400) {
            issues.push(`Queue nearly full (${queueSize}/500)`);
        } else if (queueSize > 100) {
            issues.push(`Queue building up (${queueSize} items)`);
        }

        if (successRate < 50) {
            issues.push(`Low sync success rate (${successRate}%)`);
        } else if (successRate < 90) {
            issues.push(`Moderate sync failures (${100 - successRate}% fail rate)`);
        }

        if (isConnected === false) {
            issues.push('Network offline - queuing locations');
        }

        if (successRate < 80 && queueSize > 50) {
            issues.push('Potential sync/queue deadlock');
        }

        return issues;
    }

    /**
     * Calculate health score (0-100)
     */
    private calculateHealthScore(queueSize: number, successRate: number, issueCount: number): number {
        let score = 100;

        // Deduct for queue size
        if (queueSize > 400) score -= 50;
        else if (queueSize > 200) score -= 30;
        else if (queueSize > 100) score -= 15;

        // Deduct for sync failures
        if (successRate < 50) score -= 40;
        else if (successRate < 80) score -= 20;

        // Deduct for issues
        score -= issueCount * 5;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Format age for display
     */
    private formatAge(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Get detailed health report
     */
    getDetailedReport(): string {
        const m = this.getMetrics();

        let report = '\n╔════════════════════════════════════════════════════════════╗\n';
        report += '║         TRACKING HEALTH REPORT                             ║\n';
        report += '╚════════════════════════════════════════════════════════════╝\n\n';

        // Health Score
        const scoreEmoji =
            m.healthScore >= 80
                ? '🟢'
                : m.healthScore >= 50
                    ? '🟡'
                    : '🔴';
        report += `${scoreEmoji} HEALTH SCORE: ${m.healthScore}/100\n\n`;

        // Tracking Status
        report += '📍 TRACKING STATUS:\n';
        report += `  Tracking:          ${m.isTracking ? '✅ ACTIVE' : '❌ INACTIVE'}\n`;
        report += `  Foreground:        ${m.isForegroundActive ? '✅ YES' : '❌ NO'}\n`;
        report += `  Background:        ${m.isBackgroundActive ? '✅ YES' : '❌ NO'}\n`;
        report += `  App State:         ${m.appState}\n`;
        report += `  Paused:            ${m.isPaused ? 'Yes' : 'No'}\n\n`;

        // Collection Metrics
        report += '🌍 COLLECTION METRICS:\n';
        report += `  Total Collected:   ${m.totalLocationsCollected} locations\n`;
        report += `  Collection Rate:   ${m.collectRate} locations/min\n`;
        report += `  Duplicates:        ${m.duplicatesFiltered} filtered\n\n`;

        // Queue Status
        report += '📦 QUEUE STATUS:\n';
        report += `  Queue Size:        ${m.queueSize}/500\n`;
        report += `  Health:            ${m.queueHealthy ? '✅ GOOD' : '⚠️ WARNING'}\n`;
        if (m.oldestQueueItem) {
            report += `  Oldest Item:       ${m.oldestQueueItem} old\n`;
        }
        report += '\n';

        // Sync Metrics
        report += '🔄 SYNC METRICS:\n';
        report += `  Successful:        ${m.successfulSyncs}\n`;
        report += `  Failed:            ${m.failedSyncs}\n`;
        report += `  Success Rate:      ${m.successRate}%\n`;
        report += `  Total Uploaded:    ${m.totalItemsUploaded} locations\n`;
        if (m.lastSyncTime) {
            report += `  Last Sync:         ${m.lastSyncTime}\n`;
        }
        report += '\n';

        // Network Status
        report += '🌐 NETWORK STATUS:\n';
        report += `  Connected:         ${m.isConnected === true ? '✅ YES' : m.isConnected === false ? '❌ NO' : '❓ UNKNOWN'}\n`;
        report += `  Network Type:      ${m.networkType}\n`;
        report += `  Recently Offline:  ${m.wasRecentlyOffline ? 'Yes' : 'No'}\n\n`;

        // Issues
        if (m.issues.length > 0) {
            report += '⚠️ ISSUES DETECTED:\n';
            for (const issue of m.issues) {
                report += `  • ${issue}\n`;
            }
            report += '\n';
        }

        return report;
    }

    /**
     * Log background task execution
     */
    recordBackgroundTaskExecution(success: boolean): void {
        this.backgroundTaskExecutions++;
        if (!success) {
            this.backgroundTaskErrors++;
        }

        logger.info('[TrackingHealthMonitor] Background task executed', {
            success,
            totalExecutions: this.backgroundTaskExecutions,
            totalErrors: this.backgroundTaskErrors,
            errorRate: Math.round(
                (this.backgroundTaskErrors / this.backgroundTaskExecutions) * 100
            ),
        });
    }

    /**
     * Get background task statistics
     */
    getBackgroundTaskStats() {
        return {
            totalExecutions: this.backgroundTaskExecutions,
            totalErrors: this.backgroundTaskErrors,
            errorRate: this.backgroundTaskExecutions > 0
                ? (this.backgroundTaskErrors / this.backgroundTaskExecutions) * 100
                : 0,
        };
    }
}

export const trackingHealthMonitor = TrackingHealthMonitor.getInstance();

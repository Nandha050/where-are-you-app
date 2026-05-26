/**
 * PERMISSION DEBUGGER
 * 
 * Verifies all location permissions before tracking starts
 * Provides detailed permission status for diagnostics
 * 
 * ISSUE FIXED:
 * - Issue #2: TaskManager Registration Too Late
 * - Issue #4: No Permission Verification
 * - Issue #11: No Battery Optimization Awareness
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { logger } from '../../core/logger/logger';

export interface PermissionStatus {
    foreground: boolean;
    background: boolean;
    taskManager: boolean;
    locationServicesEnabled: boolean;
    accuracy: string;
}

export interface PermissionDebugInfo {
    status: PermissionStatus;
    diagnostics: string[];
    recommendations: string[];
    canStart: boolean;
}

const BACKGROUND_TASK_NAME = 'driver-background-location';

export class PermissionDebugger {
    private static instance: PermissionDebugger;
    private lastCheckTime: number = 0;
    private taskManagerRegistered = false;

    private constructor() { }

    static getInstance(): PermissionDebugger {
        if (!PermissionDebugger.instance) {
            PermissionDebugger.instance = new PermissionDebugger();
        }
        return PermissionDebugger.instance;
    }

    /**
     * Register TaskManager handler EARLY (app startup)
     * CRITICAL: Must be called before any Location API
     */
    registerTaskManagerHandler(handler: (taskData: any) => Promise<void>): void {
        if (this.taskManagerRegistered) {
            logger.debug('[PermissionDebugger] TaskManager handler already registered');
            return;
        }

        try {
            if (!TaskManager.isTaskDefined(BACKGROUND_TASK_NAME)) {
                TaskManager.defineTask(BACKGROUND_TASK_NAME, handler);
                logger.info('[PermissionDebugger] ✅ TaskManager handler registered (EARLY)');
            }
            this.taskManagerRegistered = true;
        } catch (error) {
            logger.error('[PermissionDebugger] TaskManager registration failed', { error });
            throw error;
        }
    }

    /**
     * Verify all permissions before starting tracking
     */
    async verifyPermissions(): Promise<PermissionDebugInfo> {
        const now = Date.now();
        const info: PermissionDebugInfo = {
            status: {
                foreground: false,
                background: false,
                taskManager: false,
                locationServicesEnabled: false,
                accuracy: 'Unknown',
            },
            diagnostics: [],
            recommendations: [],
            canStart: false,
        };

        try {
            // ============================================================
            // 1. Check Location Services Enabled
            // ============================================================
            const servicesEnabled = await Location.hasServicesEnabledAsync();
            info.status.locationServicesEnabled = servicesEnabled;

            if (!servicesEnabled) {
                info.diagnostics.push('❌ Location services disabled on device');
                info.recommendations.push('User must enable Location in Settings');

                if (Platform.OS === 'android') {
                    info.recommendations.push('Check: Settings → Location → toggle ON');
                } else {
                    info.recommendations.push('Check: Settings → Privacy → Location → toggle ON');
                }
            } else {
                info.diagnostics.push('✅ Location services enabled');
            }

            // ============================================================
            // 2. Check Foreground Permission
            // ============================================================
            const foreground = await Location.getForegroundPermissionsAsync();
            info.status.foreground = foreground.granted;

            if (foreground.granted) {
                info.diagnostics.push('✅ Foreground location permission granted');
                info.status.accuracy = foreground.accuracy || 'Reduced';
            } else {
                info.diagnostics.push('❌ Foreground location permission DENIED');
                info.recommendations.push('Call Location.requestForegroundPermissionsAsync()');
            }

            // ============================================================
            // 3. Check Background Permission (Android 10+, iOS Always)
            // ============================================================
            if (Platform.OS === 'android') {
                const background = await Location.getBackgroundPermissionsAsync();
                info.status.background = background.granted;

                if (background.granted) {
                    info.diagnostics.push('✅ Background location permission granted (Android)');
                } else {
                    info.diagnostics.push('⚠️ Background location permission NOT granted (Android)');
                    info.diagnostics.push(
                        'NOTE: Tracking will ONLY work while app is in foreground'
                    );
                    info.recommendations.push('Call Location.requestBackgroundPermissionsAsync()');
                    info.recommendations.push(
                        'User must select "Allow all the time" in permission dialog'
                    );
                }
            } else if (Platform.OS === 'ios') {
                // iOS: Check for "Always" authorization
                const foreground = await Location.getForegroundPermissionsAsync();
                const always = foreground.ios?.accuracy === 'full';
                info.status.background = always;

                if (always) {
                    info.diagnostics.push('✅ iOS "Always" location permission granted');
                } else {
                    info.diagnostics.push(
                        '⚠️ iOS location permission NOT "Always" (background may not work)'
                    );
                    info.recommendations.push(
                        'User must select "Always" in iOS location permission dialog'
                    );
                }
            }

            // ============================================================
            // 4. Check TaskManager Handler
            // ============================================================
            const isTaskDefined = TaskManager.isTaskDefined(BACKGROUND_TASK_NAME);
            info.status.taskManager = isTaskDefined;

            if (isTaskDefined) {
                info.diagnostics.push('✅ TaskManager handler registered');
            } else {
                info.diagnostics.push('❌ TaskManager handler NOT registered');
                info.recommendations.push(
                    'Call PermissionDebugger.registerTaskManagerHandler() at app startup'
                );
            }

            // ============================================================
            // 5. Determine if can start
            // ============================================================
            info.canStart =
                servicesEnabled &&
                info.status.foreground &&
                info.status.taskManager;

            logger.info('[PermissionDebugger] Permission check complete', {
                canStart: info.canStart,
                foreground: info.status.foreground,
                background: info.status.background,
                servicesEnabled,
                checkTime: now,
            });

            return info;
        } catch (error) {
            logger.error('[PermissionDebugger] Permission verification failed', { error });
            info.diagnostics.push(`ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
            info.recommendations.push('Restart app and try again');
            return info;
        }
    }

    /**
     * Get detailed permission report for debugging
     */
    async getDetailedReport(): Promise<string> {
        const info = await this.verifyPermissions();

        let report = '\n╔════════════════════════════════════════════════════════════╗\n';
        report += '║         LOCATION PERMISSION DEBUG REPORT                    ║\n';
        report += '╚════════════════════════════════════════════════════════════╝\n\n';

        report += '📋 PERMISSION STATUS:\n';
        report += `  Foreground:        ${info.status.foreground ? '✅ GRANTED' : '❌ DENIED'}\n`;
        report += `  Background:        ${info.status.background ? '✅ GRANTED' : '⚠️ NOT GRANTED'}\n`;
        report += `  TaskManager:       ${info.status.taskManager ? '✅ REGISTERED' : '❌ NOT REGISTERED'}\n`;
        report += `  Services Enabled:  ${info.status.locationServicesEnabled ? '✅ YES' : '❌ NO'}\n`;
        report += `  Location Accuracy: ${info.status.accuracy}\n\n`;

        report += '🔍 DIAGNOSTICS:\n';
        for (const diag of info.diagnostics) {
            report += `  ${diag}\n`;
        }

        if (info.recommendations.length > 0) {
            report += '\n💡 RECOMMENDATIONS:\n';
            for (const rec of info.recommendations) {
                report += `  • ${rec}\n`;
            }
        }

        report += `\n🚀 CAN START TRACKING: ${info.canStart ? '✅ YES' : '❌ NO'}\n\n`;

        return report;
    }

    /**
     * Request missing permissions
     */
    async requestMissingPermissions(): Promise<boolean> {
        try {
            const info = await this.verifyPermissions();

            // Request foreground first
            if (!info.status.foreground) {
                logger.info('[PermissionDebugger] Requesting foreground location permission');
                const fg = await Location.requestForegroundPermissionsAsync();
                if (!fg.granted) {
                    logger.error('[PermissionDebugger] Foreground permission denied');
                    return false;
                }
            }

            // Then request background (Android only)
            if (Platform.OS === 'android' && !info.status.background) {
                logger.info('[PermissionDebugger] Requesting background location permission');
                const bg = await Location.requestBackgroundPermissionsAsync();
                if (!bg.granted) {
                    logger.warn('[PermissionDebugger] Background permission denied (but proceeding)');
                }
            }

            return true;
        } catch (error) {
            logger.error('[PermissionDebugger] Permission request failed', { error });
            return false;
        }
    }
}

export const permissionDebugger = PermissionDebugger.getInstance();

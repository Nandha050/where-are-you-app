/**
 * Permission Service
 * 
 * Handles location permission requests and validation.
 * Manages platform-specific permission flows.
 * 
 * Key responsibilities:
 * - Request foreground + background permissions
 * - Check permission status
 * - Validate location services enabled
 * - Handle permission denial gracefully
 * - Platform-specific behavior (Android vs iOS)
 */

import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { logger } from '../../core/logger/logger';
import {
    IPermissionService,
    PermissionCheckResult,
    PermissionRequest,
    PermissionStatus,
} from '../api/types';

class PermissionServiceClass implements IPermissionService {
    private static instance: PermissionServiceClass | null = null;

    private constructor() { }

    static getInstance(): PermissionServiceClass {
        if (!PermissionServiceClass.instance) {
            PermissionServiceClass.instance = new PermissionServiceClass();
        }
        return PermissionServiceClass.instance;
    }

    /**
     * Check current permission status
     * Does not request permissions, only checks current state
     */
    async checkPermissions(): Promise<PermissionCheckResult> {
        try {
            logger.debug('[PermissionService] Checking permissions');

            const foreground = await this.checkForegroundPermission();
            const background = await this.checkBackgroundPermission();
            const servicesEnabled = await Location.hasServicesEnabledAsync();

            return {
                foreground,
                background,
                servicesEnabled,
                canAskAgain: await this.canAskPermissionsAgain(),
            };
        } catch (error) {
            logger.error('[PermissionService] Error checking permissions', { error });
            return {
                foreground: 'undetermined',
                background: 'undetermined',
                servicesEnabled: false,
                canAskAgain: false,
            };
        }
    }

    /**
     * Request location permissions
     * Handles both foreground and background permissions
     */
    async requestPermissions(
        request: PermissionRequest
    ): Promise<PermissionCheckResult> {
        try {
            logger.info('[PermissionService] Requesting permissions', {
                foreground: request.foreground,
                background: request.background,
                platform: Platform.OS,
            });

            // Step 1: Request foreground permission
            if (request.foreground) {
                const foreground =
                    await Location.requestForegroundPermissionsAsync();
                if (!foreground.granted) {
                    logger.warn('[PermissionService] Foreground permission denied');
                    return {
                        foreground: this.mapPermissionStatus(foreground.status),
                        background: 'denied',
                        servicesEnabled: false,
                        canAskAgain: foreground.canAskAgain ?? false,
                    };
                }
            }

            // Step 2: Request background permission
            if (request.background) {
                const background =
                    await Location.requestBackgroundPermissionsAsync();

                if (!background.granted) {
                    logger.warn('[PermissionService] Background permission denied', {
                        platform: Platform.OS,
                        status: background.status,
                        canAskAgain: background.canAskAgain,
                    });

                    // On Android, background permission is required for reliable tracking
                    if (Platform.OS === 'android') {
                        return {
                            foreground: 'granted',
                            background: this.mapPermissionStatus(background.status),
                            servicesEnabled: false,
                            canAskAgain: background.canAskAgain ?? false,
                        };
                    }

                    // On iOS, we can continue with just foreground
                    // Background tracking will be limited but still work
                    logger.info(
                        '[PermissionService] iOS: Continuing with foreground-only tracking'
                    );
                }
            }

            // Step 3: Verify location services enabled
            const servicesEnabled = await Location.hasServicesEnabledAsync();
            if (!servicesEnabled) {
                logger.warn('[PermissionService] Location services disabled');
                // Don't fail here - user will need to enable manually in settings
            }

            // All permissions granted
            logger.info('[PermissionService] Permissions granted successfully');

            return {
                foreground: 'granted',
                background: request.background ? 'granted' : 'undetermined',
                servicesEnabled,
                canAskAgain: false,
            };
        } catch (error) {
            logger.error('[PermissionService] Error requesting permissions', {
                error,
                platform: Platform.OS,
            });

            return {
                foreground: 'undetermined',
                background: 'undetermined',
                servicesEnabled: false,
                canAskAgain: false,
            };
        }
    }

    /**
     * Check if location services are enabled
     */
    async hasLocationServices(): Promise<boolean> {
        try {
            return await Location.hasServicesEnabledAsync();
        } catch (error) {
            logger.error('[PermissionService] Error checking location services', {
                error,
            });
            return false;
        }
    }

    /**
     * Check if we can ask for permissions again
     * Some systems only allow asking once
     */
    private async canAskPermissionsAgain(): Promise<boolean> {
        try {
            // Try to get current permission status with canAskAgain flag
            const foreground = await Location.getForegroundPermissionsAsync();
            const background = await Location.getBackgroundPermissionsAsync();

            return (
                (foreground.canAskAgain ?? true) ||
                (background.canAskAgain ?? true)
            );
        } catch {
            return true; // Assume we can ask if check fails
        }
    }

    /**
     * Get detailed permission information
     * Used for debugging and diagnostics
     */
    async getDetailedPermissionInfo(): Promise<{
        foreground: {
            status: PermissionStatus;
            expires: string;
            granted: boolean;
            canAskAgain: boolean;
        };
        background: {
            status: PermissionStatus;
            expires: string;
            granted: boolean;
            canAskAgain: boolean;
        };
    }> {
        try {
            const foreground = await Location.getForegroundPermissionsAsync();
            const background = await Location.getBackgroundPermissionsAsync();

            return {
                foreground: {
                    status: this.mapPermissionStatus(foreground.status),
                    expires: foreground.expires ? new Date(foreground.expires).toISOString() : 'never',
                    granted: foreground.granted,
                    canAskAgain: foreground.canAskAgain ?? false,
                },
                background: {
                    status: this.mapPermissionStatus(background.status),
                    expires: background.expires ? new Date(background.expires).toISOString() : 'never',
                    granted: background.granted,
                    canAskAgain: background.canAskAgain ?? false,
                },
            };
        } catch (error) {
            logger.error('[PermissionService] Error getting detailed info', {
                error,
            });
            throw error;
        }
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Check foreground permission status
     */
    private async checkForegroundPermission(): Promise<PermissionStatus> {
        try {
            const result = await Location.getForegroundPermissionsAsync();
            return this.mapPermissionStatus(result.status);
        } catch {
            return 'undetermined';
        }
    }

    /**
     * Check background permission status
     */
    private async checkBackgroundPermission(): Promise<PermissionStatus> {
        try {
            const result = await Location.getBackgroundPermissionsAsync();
            return this.mapPermissionStatus(result.status);
        } catch {
            return 'undetermined';
        }
    }

    /**
     * Map expo-location permission status to our enum
     */
    private mapPermissionStatus(
        status: Location.PermissionStatus
    ): PermissionStatus {
        switch (status) {
            case Location.PermissionStatus.GRANTED:
                return 'granted';
            case Location.PermissionStatus.DENIED:
                return 'denied';
            case Location.PermissionStatus.UNDETERMINED:
                return 'undetermined';
            default:
                return 'undetermined';
        }
    }
}

/**
 * Singleton instance
 */
export const permissionService = PermissionServiceClass.getInstance();

/**
 * For testing, export the class itself
 */
export { PermissionServiceClass };


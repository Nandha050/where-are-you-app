import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { type AppStateStatus, Platform } from 'react-native';
import { ANDROID_CONFIG } from '../../config/constants';
import { logger } from '../../core/logger/logger';
import { locationQueueManager, type LocationRecord } from '../queue/LocationQueueManager';
import { httpSyncManager } from '../sync/HTTPSyncManager';

const BACKGROUND_TASK_NAME = 'driver-background-location';

// ✅ Battery optimization thresholds
const CRITICAL_BATTERY_THRESHOLD = 0.1; // 10%

export interface BackgroundTrackingConfig {
    accuracy: Location.Accuracy;
    intervalMs: number;
    minDistanceMeters: number;
    syncIntervalMs: number; // Added for sync interval adaptation
}

export class BackgroundLocationService {
    private static instance: BackgroundLocationService;
    private isRunning = false;
    private watchSubscription: Location.LocationSubscription | null = null;

    // ✅ Battery optimization state
    private currentBatteryLevel = 1.0;
    private isLowBattery = false;
    private appState: AppStateStatus = 'active';
    private batteryCheckInterval: ReturnType<typeof setInterval> | null = null;

    private constructor() { }

    static getInstance(): BackgroundLocationService {
        if (!BackgroundLocationService.instance) {
            BackgroundLocationService.instance = new BackgroundLocationService();
        }
        return BackgroundLocationService.instance;
    }

    /**
     * Start background tracking
     */
    async start(): Promise<void> {
        try {
            if (this.isRunning) {
                logger.warn('[BackgroundLocationService] Already running');
                return;
            }

            // Request permissions
            const foreground = await Location.requestForegroundPermissionsAsync();
            if (!foreground.granted) {
                throw new Error('Foreground location permission denied');
            }

            if (Platform.OS === 'android') {
                const notificationPermissions = await Notifications.getPermissionsAsync();
                if (notificationPermissions.status !== 'granted') {
                    const requestedPermissions = await Notifications.requestPermissionsAsync();
                    if (requestedPermissions.status !== 'granted') {
                        logger.warn('[BackgroundLocationService] Notification permission denied - foreground service notification may be limited');
                    }
                }

                const background =
                    await Location.requestBackgroundPermissionsAsync();
                if (!background.granted) {
                    logger.warn(
                        '[BackgroundLocationService] Background permission denied - tracking will stop when app minimized'
                    );
                }
            }

            // ✅ Start battery monitoring
            await this.startBatteryMonitoring();

            // Define background task
            if (!TaskManager.isTaskDefined(BACKGROUND_TASK_NAME)) {
                TaskManager.defineTask(BACKGROUND_TASK_NAME, this.handleBackgroundLocation);
            }

            // Start background tracking
            const config = this.getAdaptiveConfig();
            await Location.startLocationUpdatesAsync(BACKGROUND_TASK_NAME, {
                accuracy: config.accuracy,
                timeInterval: config.intervalMs,
                distanceInterval: config.minDistanceMeters,
                showsBackgroundLocationIndicator: true,
                foregroundService: {
                    notificationTitle: ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.title,
                    notificationBody: `${ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.body}${this.isLowBattery ? ' (low battery)' : ''}`,
                    notificationColor: ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.color,
                    killServiceOnDestroy: false,
                },
            });

            this.isRunning = true;
            logger.info('[BackgroundLocationService] Started', {
                batteryLevel: Math.round(this.currentBatteryLevel * 100) + '%',
                isLowBattery: this.isLowBattery,
            });
        } catch (error) {
            logger.error('[BackgroundLocationService] Failed to start', { error });
            throw error;
        }
    }

    /**
     * Stop background tracking
     */
    async stop(): Promise<void> {
        try {
            if (!this.isRunning) {
                return;
            }

            // ✅ Stop battery monitoring
            this.stopBatteryMonitoring();

            // Stop background task
            const isTaskDefined = TaskManager.isTaskDefined(BACKGROUND_TASK_NAME);
            if (isTaskDefined) {
                await Location.stopLocationUpdatesAsync(BACKGROUND_TASK_NAME);
            }

            // Stop foreground watch
            if (this.watchSubscription) {
                this.watchSubscription.remove();
                this.watchSubscription = null;
            }

            this.isRunning = false;
            logger.info('[BackgroundLocationService] Stopped');
        } catch (error) {
            logger.error('[BackgroundLocationService] Failed to stop', { error });
        }
    }

    /**
     * Start foreground tracking
     */
    async startForeground(): Promise<void> {
        try {
            if (this.watchSubscription) {
                logger.warn('[BackgroundLocationService] Foreground tracking already running');
                return;
            }

            const config = this.getAdaptiveConfig();

            this.watchSubscription = await Location.watchPositionAsync(
                {
                    accuracy: config.accuracy,
                    timeInterval: config.intervalMs / 2, // Faster in foreground
                    distanceInterval: config.minDistanceMeters,
                },
                (location) => {
                    void this.handleLocationUpdate(location);
                }
            );

            logger.info('[BackgroundLocationService] Foreground tracking started');
        } catch (error) {
            logger.error('[BackgroundLocationService] Failed to start foreground', {
                error,
            });
        }
    }

    /**
     * Stop foreground tracking
     */
    stopForeground(): void {
        if (this.watchSubscription) {
            this.watchSubscription.remove();
            this.watchSubscription = null;
            logger.info('[BackgroundLocationService] Foreground tracking stopped');
        }
    }

    /**
     * Handle location update
     */
    private async handleLocationUpdate(location: Location.LocationObject): Promise<void> {
        try {
            const record: LocationRecord = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                speed: location.coords.speed || null,
                heading: location.coords.heading ?? undefined,
                accuracy: location.coords.accuracy ?? undefined,
                altitude: location.coords.altitude ?? undefined,
                timestamp: new Date(location.timestamp).toISOString(),
            };

            const enqueued = await locationQueueManager.enqueue(record);

            if (enqueued) {
                logger.debug('[BackgroundLocationService] Location enqueued', {
                    lat: record.latitude,
                    lng: record.longitude,
                });
            }

            // Trigger sync if queue is small
            if (locationQueueManager.size() <= 1) {
                await httpSyncManager.forceSyncNow();
            }
        } catch (error) {
            logger.error('[BackgroundLocationService] Handle location error', {
                error,
            });
        }
    }

    /**
     * Handle background task location updates
     */
    private handleBackgroundLocation = async (
        taskData: TaskManager.TaskManagerTaskBody
    ): Promise<void> => {
        const locations = (taskData as any).locations as Location.LocationObject[] | undefined;

        if (!locations || locations.length === 0) {
            return;
        }

        try {
            for (const location of locations) {
                await this.handleLocationUpdate(location);
            }

            // Trigger periodic sync
            await httpSyncManager.sync();
        } catch (error) {
            logger.error('[BackgroundLocationService] Background task error', {
                error,
            });
        }
    };

    /**
     * Get adaptive configuration based on battery and speed
     * ✅ BATTERY OPTIMIZATION: Reduce accuracy and increase interval on low battery
     */
    private getAdaptiveConfig(): BackgroundTrackingConfig {
        // ✅ Low battery mode: Reduced accuracy, longer intervals
        if (this.isLowBattery) {
            logger.debug('[BackgroundLocationService] Using low battery config', {
                batteryLevel: Math.round(this.currentBatteryLevel * 100) + '%',
            });
            return {
                accuracy: Location.Accuracy.Balanced, // Medium accuracy
                intervalMs: 30000, // 30 seconds (normal: 10 seconds)
                minDistanceMeters: 20, // Only update if moved 20+ meters (normal: 10)
                syncIntervalMs: 30000, // 30 seconds (normal: 15 seconds)
            };
        }

        // ✅ Critical battery mode: Very reduced accuracy
        if (this.currentBatteryLevel < CRITICAL_BATTERY_THRESHOLD) {
            logger.warn('[BackgroundLocationService] Using critical battery config', {
                batteryLevel: Math.round(this.currentBatteryLevel * 100) + '%',
            });
            return {
                accuracy: Location.Accuracy.Balanced,
                intervalMs: 60000, // 60 seconds
                minDistanceMeters: 50, // Only update if moved 50+ meters
                syncIntervalMs: 60000, // 60 seconds
            };
        }

        // ✅ Normal mode: Full accuracy, standard intervals
        return {
            accuracy: Location.Accuracy.High,
            intervalMs: 10000, // 10 seconds base interval
            minDistanceMeters: 10, // Update if moved 10+ meters
            syncIntervalMs: 15000, // 15 seconds (standard)
        };
    }

    /**
     * ✅ Start battery level monitoring
     */
    private async startBatteryMonitoring(): Promise<void> {
        try {
            // Initial battery check
            await this.checkBatteryLevel();

            // Check battery every 30 seconds
            this.batteryCheckInterval = setInterval(() => {
                void this.checkBatteryLevel();
            }, 30000);

            logger.info('[BackgroundLocationService] Battery monitoring started');
        } catch (error) {
            logger.error('[BackgroundLocationService] Failed to start battery monitoring', {
                error,
            });
        }
    }

    /**
     * ✅ Stop battery monitoring
     */
    private stopBatteryMonitoring(): void {
        if (this.batteryCheckInterval) {
            clearInterval(this.batteryCheckInterval);
            this.batteryCheckInterval = null;
            logger.info('[BackgroundLocationService] Battery monitoring stopped');
        }
    }

    /**
     * ✅ Check and update battery level
     * NOTE: Requires 'expo-battery' or native battery monitoring
     * TODO: Implement using native Android BatteryManager or iOS UIDevice
     */
    private async checkBatteryLevel(): Promise<void> {
        try {
            // ⚠️ TODO: Implement actual battery level monitoring
            // For now, we use a stub implementation
            // In production, use:
            // - Android: BatteryManager.getIntProperty(BATTERY_PROPERTY_ENERGY_COUNTER)
            // - iOS: UIDevice.current.batteryLevel
            // - React Native: @react-native-camera-roll/camera-roll or similar

            // Stub: Assume normal battery for now
            const wasLowBattery = this.isLowBattery;
            this.currentBatteryLevel = 1.0;
            this.isLowBattery = false;

            // Log state change when battery crosses threshold
            if (wasLowBattery !== this.isLowBattery) {
                if (this.isLowBattery) {
                    logger.warn('[BackgroundLocationService] ⚠️ Low battery detected', {
                        level: Math.round(this.currentBatteryLevel * 100) + '%',
                        config: 'Reduced accuracy, 30s sync interval',
                    });

                    // Update sync manager with new interval
                    void httpSyncManager.updateSyncInterval(30000);
                } else {
                    logger.info('[BackgroundLocationService] ✅ Battery recovered', {
                        level: Math.round(this.currentBatteryLevel * 100) + '%',
                        config: 'Normal accuracy, 15s sync interval',
                    });

                    // Resume normal interval
                    void httpSyncManager.updateSyncInterval(15000);
                }
            }
        } catch (error) {
            logger.error('[BackgroundLocationService] Failed to check battery', {
                error,
            });
        }
    }

    /**
     * Check if tracking is active
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Check if foreground is active
     */
    isForegroundActive(): boolean {
        return this.watchSubscription !== null;
    }

    /**
     * Get current battery state (for diagnostics)
     */
    getBatteryState(): { level: number; isLow: boolean } {
        return {
            level: this.currentBatteryLevel,
            isLow: this.isLowBattery,
        };
    }
}

export const backgroundLocationService = BackgroundLocationService.getInstance();

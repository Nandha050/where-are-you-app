import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { type AppStateStatus, Platform } from 'react-native';
import { ANDROID_CONFIG, BACKGROUND_LOCATION_TASK_NAME } from '../../config/constants';
import { logger } from '../../core/logger/logger';
import { locationQueueManager, type LocationRecord } from '../queue/LocationQueueManager';
import { httpSyncManager } from '../sync/HTTPSyncManager';

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

            logger.info('[BackgroundLocationService] Start requested', {
                taskName: BACKGROUND_LOCATION_TASK_NAME,
                platform: Platform.OS,
            });

            if (!(await Location.hasServicesEnabledAsync())) {
                logger.error('[BackgroundLocationService] Location services disabled');
                throw new Error('Location services are disabled');
            }

            // Request permissions
            const foreground = await Location.requestForegroundPermissionsAsync();
            if (!foreground.granted) {
                logger.error('[BackgroundLocationService] Foreground permission denied');
                throw new Error('Foreground location permission denied');
            }

            logger.info('[BackgroundLocationService] Foreground permission granted', {
                status: foreground.status,
            });

            if (Platform.OS === 'android') {
                const notificationPermissions = await Notifications.getPermissionsAsync();
                if (notificationPermissions.status !== 'granted') {
                    const requestedPermissions = await Notifications.requestPermissionsAsync();
                    if (requestedPermissions.status !== 'granted') {
                        logger.warn('[BackgroundLocationService] Notification permission denied - foreground service notification may be limited');
                    } else {
                        logger.info('[BackgroundLocationService] Notification permission granted', {
                            status: requestedPermissions.status,
                        });
                    }
                } else {
                    logger.info('[BackgroundLocationService] Notification permission already granted', {
                        status: notificationPermissions.status,
                    });
                }

                const background =
                    await Location.requestBackgroundPermissionsAsync();
                if (!background.granted) {
                    logger.error('[BackgroundLocationService] Background permission denied');
                    throw new Error('Background location permission denied');
                }

                logger.info('[BackgroundLocationService] Background permission granted', {
                    status: background.status,
                });
            }

            // ✅ Start battery monitoring
            await this.startBatteryMonitoring();

            await this.ensureBackgroundTaskRegistered();

            // Start background tracking
            const config = this.getAdaptiveConfig();
            logger.info('[BackgroundLocationService] Starting background updates', {
                accuracy: config.accuracy,
                intervalMs: config.intervalMs,
                minDistanceMeters: config.minDistanceMeters,
                syncIntervalMs: config.syncIntervalMs,
            });
            await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
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
                logger.debug('[BackgroundLocationService] Stop requested while idle');
                return;
            }

            logger.info('[BackgroundLocationService] Stop requested');

            // ✅ Stop battery monitoring
            this.stopBatteryMonitoring();

            // Stop background task
            const isTaskDefined = TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME);
            if (isTaskDefined) {
                logger.info('[BackgroundLocationService] Stopping background updates', {
                    taskName: BACKGROUND_LOCATION_TASK_NAME,
                });
                await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
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
            logger.info('[BackgroundLocationService] Starting foreground watch', {
                accuracy: config.accuracy,
                intervalMs: config.intervalMs / 2,
            });

            // Immediately enqueue the current position so the first sync
            // cycle has data even before the device moves.
            try {
                const currentPos = await Location.getCurrentPositionAsync({
                    accuracy: config.accuracy,
                });
                logger.info('[BackgroundLocationService] Initial foreground position received', {
                    lat: currentPos.coords.latitude,
                    lng: currentPos.coords.longitude,
                });
                await this.handleLocationUpdate(currentPos);
            } catch (initError) {
                logger.warn('[BackgroundLocationService] Could not get initial position', { initError });
            }

            this.watchSubscription = await Location.watchPositionAsync(
                {
                    accuracy: config.accuracy,
                    timeInterval: config.intervalMs / 2, // Faster in foreground
                    // distanceInterval 0 = fire on every timeInterval tick regardless of movement.
                    // This is critical — a stationary driver would never trigger updates
                    // if distanceInterval > 0 and the bus is parked.
                    distanceInterval: 0,
                },
                (location) => {
                    logger.debug('[BackgroundLocationService] Foreground watch fired', {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude,
                        queueSizeBefore: locationQueueManager.size(),
                    });
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
        } else {
            logger.debug('[BackgroundLocationService] Foreground stop requested with no active watch');
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

            logger.info('[BackgroundLocationService] Location received', {
                lat: record.latitude,
                lng: record.longitude,
                queueBefore: locationQueueManager.size(),
                accuracy: record.accuracy ?? null,
                speed: record.speed ?? null,
            });

            const enqueued = await locationQueueManager.enqueue(record);

            if (enqueued) {
                logger.info('[BackgroundLocationService] Location queued', {
                    lat: record.latitude,
                    lng: record.longitude,
                    queueAfter: locationQueueManager.size(),
                });
            } else {
                logger.warn('[BackgroundLocationService] Location was not queued', {
                    lat: record.latitude,
                    lng: record.longitude,
                });
            }
        } catch (error) {
            logger.error('[BackgroundLocationService] Handle location error', {
                error,
            });
        }
    }

    async processBackgroundLocations(locations: Location.LocationObject[]): Promise<void> {
        if (!locations.length) {
            logger.debug('[BackgroundLocationService] Background task received no locations');
            return;
        }

        logger.info('[BackgroundLocationService] Processing background locations', {
            count: locations.length,
            queueBefore: locationQueueManager.size(),
        });

        await locationQueueManager.initialize();
        if (typeof httpSyncManager.restoreIdentifiersFromStorage === 'function') {
            await httpSyncManager.restoreIdentifiersFromStorage();
        }

        for (const location of locations) {
            await this.handleLocationUpdate(location);
        }

        logger.info('[BackgroundLocationService] Upload triggered from background task', {
            queueSize: locationQueueManager.size(),
        });

        const success = await httpSyncManager.forceSyncNow();

        if (success) {
            logger.info('[BackgroundLocationService] Background upload completed', {
                queueSize: locationQueueManager.size(),
            });
        } else {
            logger.warn('[BackgroundLocationService] Background upload failed or was skipped', {
                queueSize: locationQueueManager.size(),
            });
        }
    }

    /**
     * Handle background task location updates
     */
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
            intervalMs: 5000,  // 5 second base interval (was 10s — faster for real-time tracking)
            minDistanceMeters: 0, // 0 = fire on every timeInterval regardless of movement
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

    private async ensureBackgroundTaskRegistered(): Promise<void> {
        if (TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME)) {
            logger.debug('[BackgroundLocationService] Background task already defined', {
                taskName: BACKGROUND_LOCATION_TASK_NAME,
            });
            return;
        }

        logger.info('[BackgroundLocationService] Defining background task', {
            taskName: BACKGROUND_LOCATION_TASK_NAME,
        });

        TaskManager.defineTask(BACKGROUND_LOCATION_TASK_NAME, handleBackgroundLocationTask);
    }
}

export const backgroundLocationService = BackgroundLocationService.getInstance();

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME)) {
    logger.info('[BackgroundLocationService] Registering background task at module load', {
        taskName: BACKGROUND_LOCATION_TASK_NAME,
    });

    TaskManager.defineTask(BACKGROUND_LOCATION_TASK_NAME, handleBackgroundLocationTask);
}

async function handleBackgroundLocationTask({
    data,
    error,
}: TaskManager.TaskManagerTaskBody): Promise<void> {
    logger.info('[BackgroundLocationService] Background task fired', {
        taskName: BACKGROUND_LOCATION_TASK_NAME,
        hasError: Boolean(error),
    });

    if (error) {
        logger.error('[BackgroundLocationService] Background task error', { error });
        return;
    }

    const taskData = data as { locations?: Location.LocationObject[] } | undefined;
    const locations = taskData?.locations ?? [];

    if (!locations.length) {
        logger.debug('[BackgroundLocationService] Background task fired with no locations');
        return;
    }

    try {
        await backgroundLocationService.processBackgroundLocations(locations);
    } catch (taskError) {
        logger.error('[BackgroundLocationService] Background task failed', {
            error: taskError,
        });
    }
}

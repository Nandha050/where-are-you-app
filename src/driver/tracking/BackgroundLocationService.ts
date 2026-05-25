import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { logger } from '../../core/logger/logger';
import { locationQueueManager, type LocationRecord } from '../queue/LocationQueueManager';
import { httpSyncManager } from '../sync/HTTPSyncManager';

const BACKGROUND_TASK_NAME = 'driver-background-location';
const LOCATION_TRACKING_ENABLED_KEY = 'driver_location_tracking_enabled';

export interface BackgroundTrackingConfig {
    accuracy: Location.Accuracy;
    intervalMs: number;
    minDistanceMeters: number;
}

export class BackgroundLocationService {
    private static instance: BackgroundLocationService;
    private isRunning = false;
    private watchSubscription: Location.LocationSubscription | null = null;

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
                const background =
                    await Location.requestBackgroundPermissionsAsync();
                if (!background.granted) {
                    logger.warn(
                        '[BackgroundLocationService] Background permission denied - tracking will stop when app minimized'
                    );
                }
            }

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
                    notificationTitle: 'Live Tracking',
                    notificationBody: 'Tracking your location',
                    notificationColor: '#007AFF',
                },
            });

            this.isRunning = true;
            logger.info('[BackgroundLocationService] Started');
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
                speed: location.coords.speed,
                heading: location.coords.heading,
                accuracy: location.coords.accuracy,
                altitude: location.coords.altitude,
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
        const { locations } = taskData as {
            locations: Location.LocationObject[];
        };

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
     */
    private getAdaptiveConfig(): BackgroundTrackingConfig {
        return {
            accuracy: Location.Accuracy.High,
            intervalMs: 10000, // 10 seconds base interval
            minDistanceMeters: 10, // Update if moved 10+ meters
        };
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
}

export const backgroundLocationService = BackgroundLocationService.getInstance();

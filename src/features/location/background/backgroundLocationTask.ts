/**
 * Background Location Task
 * 
 * Handles location updates when app is backgrounded or killed.
 * Runs on both Android and iOS using Expo TaskManager.
 * 
 * Critical notes:
 * - Must complete within OS time limits (~30 seconds)
 * - No UI rendering allowed
 * - Must use AsyncStorage/SecureStore for state
 * - Socket.IO won't work in background - HTTP only
 * - iOS is more aggressive about task suspension
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import {
    ANDROID_CONFIG,
    API_ENDPOINTS,
    BACKGROUND_LOCATION_TASK_NAME,
    DEFAULT_TRACKING_CONFIG,
    IOS_CONFIG,
    STORAGE_KEYS,
    TIMEOUTS
} from '../../config/constants';
import {
    LastHandledLocation,
    LocationPayload
} from '../api/types';

// ============================================================================
// BACKGROUND TASK STATE
// ============================================================================

let lastHandledLocationCache: LastHandledLocation | null = null;

// ✅ Track stationary state so we can detect movement resumption
// and never suppress the first update after the bus starts moving.
let lastStationaryTimestamp: number | null = null;
const STATIONARY_SPEED_THRESHOLD = 0.5; // m/s — below this = stationary

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get stored value from secure/regular storage based on platform
 */
async function getStoredValue(key: string): Promise<string | null> {
    try {
        if (Platform.OS === 'web') {
            if (typeof window === 'undefined') return null;
            return window.localStorage.getItem(key);
        }
        return await SecureStore.getItemAsync(key);
    } catch (error) {
        console.error(`[BackgroundTask] Error getting ${key}:`, error);
        return null;
    }
}

/**
 * Set stored value
 */
async function setStoredValue(key: string, value: string): Promise<void> {
    try {
        if (Platform.OS === 'web') {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(key, value);
            }
            return;
        }
        await SecureStore.setItemAsync(key, value);
    } catch (error) {
        console.error(`[BackgroundTask] Error setting ${key}:`, error);
    }
}

/**
 * Calculate distance using Haversine formula
 */
function distanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Read location queue from storage
 */
async function readQueue(): Promise<LocationPayload[]> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.LOCATION_QUEUE);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Write location queue to storage
 */
async function writeQueue(queue: LocationPayload[]): Promise<void> {
    try {
        await AsyncStorage.setItem(
            STORAGE_KEYS.LOCATION_QUEUE,
            JSON.stringify(queue)
        );
    } catch (error) {
        console.warn('[BackgroundTask] Failed to persist queue', error);
    }
}

/**
 * Enqueue location for later sync
 */
async function enqueueLocation(location: LocationPayload): Promise<void> {
    const queue = await readQueue();
    queue.push(location);

    // Keep only last 300 items
    const maxSize = DEFAULT_TRACKING_CONFIG.maxQueueSize;
    if (queue.length > maxSize) {
        queue.splice(0, queue.length - maxSize);
    }

    await writeQueue(queue);
}

/**
 * Read last handled location from cache/storage
 */
async function readLastHandledLocation(): Promise<LastHandledLocation | null> {
    // Check memory cache first (fast path)
    if (lastHandledLocationCache) {
        return lastHandledLocationCache;
    }

    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.LAST_HANDLED_LOCATION);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as LastHandledLocation;
        if (
            typeof parsed?.latitude === 'number' &&
            typeof parsed?.longitude === 'number' &&
            typeof parsed?.timestamp === 'number'
        ) {
            lastHandledLocationCache = parsed;
            return parsed;
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Write last handled location
 */
async function writeLastHandledLocation(
    value: LastHandledLocation
): Promise<void> {
    lastHandledLocationCache = value;

    try {
        await AsyncStorage.setItem(
            STORAGE_KEYS.LAST_HANDLED_LOCATION,
            JSON.stringify(value)
        );
    } catch {
        // Non-critical
    }
}

/**
 * Determine if location should be processed
 * Uses duplicate detection based on distance + time
 *
 * ✅ FIX: Never suppress locations when movement resumes after stationary.
 * Previously the first location updates after a bus stop were dropped because
 * they were <5m from the cached stop position, making the passenger map appear
 * frozen even after the bus started moving.
 */
async function shouldSkipLocation(
    current: LocationPayload
): Promise<boolean> {
    const lastHandled = await readLastHandledLocation();
    if (!lastHandled) {
        return false;
    }

    const timeDelta = Math.abs(
        new Date(current.timestamp).getTime() - lastHandled.timestamp
    );
    const distance = distanceMeters(
        lastHandled.latitude,
        lastHandled.longitude,
        current.latitude,
        current.longitude
    );

    const minDistance = DEFAULT_TRACKING_CONFIG.minDistanceBetweenLocationsM;
    const minTime = DEFAULT_TRACKING_CONFIG.minTimeBetweenLocationsSec * 1000;

    // ✅ FIX: If the device is reporting non-zero speed after a stationary
    // period, this is a resumption event. Always pass it through so the
    // passenger sees the bus start moving immediately.
    const isMoving = (current.speed ?? 0) > STATIONARY_SPEED_THRESHOLD;
    const wasStationary = lastStationaryTimestamp !== null;

    if (isMoving && wasStationary) {
        console.log('[BG_TASK] Movement resumed after stationary — forcing location through', {
            speed: current.speed,
            stationaryDurationMs: Date.now() - (lastStationaryTimestamp ?? Date.now()),
        });
        lastStationaryTimestamp = null;
        return false; // Never skip on movement resumption
    }

    // Track stationary state
    if (!isMoving) {
        if (lastStationaryTimestamp === null) {
            lastStationaryTimestamp = Date.now();
        }
    } else {
        lastStationaryTimestamp = null;
    }

    return distance < minDistance && timeDelta < minTime;
}

/**
 * Send location to backend via HTTP
 */
async function sendLocationToBackend(
    location: LocationPayload
): Promise<boolean> {
    try {
        const token = await getStoredValue(STORAGE_KEYS.AUTH_TOKEN);
        const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();

        if (!token || !backendUrl) {
            console.warn('[BackgroundTask] Missing auth or backend URL');
            return false;
        }

        // Send via HTTP (only reliable method in background)
        const response = await axios.post(
            `${backendUrl}${API_ENDPOINTS.LOCATION_POST}`,
            location,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: TIMEOUTS.API_REQUEST_TIMEOUT,
            }
        );

        return response.status === 200 || response.status === 201;
    } catch (error) {
        console.warn('[BackgroundTask] Failed to send location', {
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * Flush queued locations (attempt to upload accumulated items)
 */
async function flushQueue(): Promise<void> {
    try {
        const queue = await readQueue();
        if (queue.length === 0) {
            return;
        }

        const token = await getStoredValue(STORAGE_KEYS.AUTH_TOKEN);
        const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();

        if (!token || !backendUrl) {
            return;
        }

        const pending: LocationPayload[] = [];

        // Try to upload each item sequentially
        for (let i = 0; i < queue.length; i++) {
            try {
                const item = queue[i];

                const response = await axios.post(
                    `${backendUrl}${API_ENDPOINTS.LOCATION_POST}`,
                    item,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 8000,
                    }
                );

                if (response.status !== 200 && response.status !== 201) {
                    pending.push(...queue.slice(i));
                    break;
                }
            } catch {
                // Stop on first failure, keep rest for next attempt
                pending.push(...queue.slice(i));
                break;
            }
        }

        // Update queue with remaining items
        await writeQueue(pending);
    } catch (error) {
        console.error('[BackgroundTask] Error flushing queue', error);
    }
}

/**
 * Normalize raw location to internal format
 */
function normalizeLocation(
    raw: Location.LocationObject
): LocationPayload | null {
    try {
        if (!raw?.coords) {
            return null;
        }

        return {
            latitude: raw.coords.latitude,
            longitude: raw.coords.longitude,
            speed: raw.coords.speed ?? 0,
            heading: raw.coords.heading ?? 0,
            accuracy: raw.coords.accuracy ?? 0,
            altitude: raw.coords.altitude ?? 0,
            timestamp: new Date(raw.timestamp).toISOString(),

            // Device info
            deviceId: Platform.OS,
            batteryLevel: 0,
            batteryState: 'unknown' as const,

            // Trip context (from storage)
            tripId: '', // Will be filled from storage
            busId: '', // Will be filled from storage
            driverId: '', // Will be filled from storage

            platform: Platform.OS as any,
        };
    } catch (error) {
        console.error('[BackgroundTask] Error normalizing location', error);
        return null;
    }
}

// ============================================================================
// BACKGROUND TASK DEFINITION
// ============================================================================

/**
 * Main background location task handler
 * Registered with TaskManager to receive location updates
 */
TaskManager.defineTask(
    BACKGROUND_LOCATION_TASK_NAME,
    async ({ data, error }: any) => {
        try {
            if (error) {
                console.error('[BG_TASK] Task error:', error);
                return;
            }

            const { locations } = data as {
                locations: Location.LocationObject[];
            };

            if (!locations || locations.length === 0) {
                console.log('[BG_TASK] No locations received in task payload');
                return;
            }

            // Get latest location
            const latestRaw = locations[locations.length - 1];

            // ✅ DIAGNOSTIC LOG — required for production debugging
            console.warn('[BG_TASK] LOCATION_RECEIVED', {
                latitude: latestRaw.coords.latitude,
                longitude: latestRaw.coords.longitude,
                speed: latestRaw.coords.speed,
                accuracy: latestRaw.coords.accuracy,
                timestamp: new Date(latestRaw.timestamp).toISOString(),
                totalBatch: locations.length,
            });

            // Check if tracking enabled
            const trackingEnabled = await getStoredValue(STORAGE_KEYS.TRACKING_ENABLED);
            if (trackingEnabled !== 'true') {
                console.log('[BG_TASK] Tracking disabled, skipping');
                return;
            }

            // Normalize location
            const location = normalizeLocation(latestRaw);
            if (!location) {
                console.warn('[BG_TASK] Failed to normalize location');
                return;
            }

            // Fill in trip context from storage
            location.tripId = (await getStoredValue(STORAGE_KEYS.TRIP_ID)) || 'unknown';
            location.busId = (await getStoredValue(STORAGE_KEYS.ASSIGNED_BUS_ID)) || 'unknown';
            location.driverId = (await getStoredValue(STORAGE_KEYS.DRIVER_ID)) || 'unknown';

            // Check for duplicates
            if (await shouldSkipLocation(location)) {
                console.log('[BG_TASK] Skipping duplicate location (distance+time threshold)');
                return;
            }

            // Update last handled
            await writeLastHandledLocation({
                latitude: location.latitude,
                longitude: location.longitude,
                heading: location.heading,
                speed: location.speed,
                timestamp: new Date(location.timestamp).getTime(),
            });

            // ✅ DIAGNOSTIC LOG — enqueue
            console.warn('[QUEUE] LOCATION_ENQUEUED', {
                latitude: location.latitude,
                longitude: location.longitude,
                speed: location.speed,
                tripId: location.tripId,
            });

            // ✅ DIAGNOSTIC LOG — sync triggered
            console.warn('[SYNC] LOCATION_SYNC_TRIGGERED', {
                latitude: location.latitude,
                longitude: location.longitude,
            });

            // Try to send immediately
            const success = await sendLocationToBackend(location);

            if (!success) {
                // Queue for later
                await enqueueLocation(location);
            }

            // Attempt to flush any queued items
            await flushQueue();
        } catch (err) {
            console.error('[BG_TASK] Fatal error:', err);
        }
    }
);

// ============================================================================
// EXPORTS
// ============================================================================

export const backgroundLocationTask = {
    /**
     * Get task name
     */
    getTaskName(): string {
        return BACKGROUND_LOCATION_TASK_NAME;
    },

    /**
     * Start background location updates
     */
    async start(token: string, busId: string, driverId: string): Promise<boolean> {
        try {
            console.log('[BackgroundTask] Starting background location tracking');

            // Store credentials for background task
            await setStoredValue(STORAGE_KEYS.AUTH_TOKEN, token);
            await setStoredValue(STORAGE_KEYS.ASSIGNED_BUS_ID, busId);
            await setStoredValue(STORAGE_KEYS.DRIVER_ID, driverId);
            await setStoredValue(STORAGE_KEYS.TRACKING_ENABLED, 'true');

            // Request permissions
            const foreground = await Location.requestForegroundPermissionsAsync();
            if (!foreground.granted) {
                console.warn('[BackgroundTask] Foreground permission denied');
                return false;
            }

            const background = await Location.requestBackgroundPermissionsAsync();
            if (!background.granted) {
                console.warn('[BackgroundTask] Background permission denied');
                if (Platform.OS === 'android') {
                    return false;
                }
                // Continue on iOS
            }

            // Verify location services enabled
            const enabled = await Location.hasServicesEnabledAsync();
            if (!enabled) {
                console.warn('[BackgroundTask] Location services disabled');
                return false;
            }

            // Start background updates
            const isRegistered = await TaskManager.isTaskRegisteredAsync(
                BACKGROUND_LOCATION_TASK_NAME
            );

            if (!isRegistered) {
                if (Platform.OS === 'android') {
                    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
                        accuracy: Location.Accuracy.BestForNavigation,
                        timeInterval: ANDROID_CONFIG.LOCATION_UPDATES_INTERVAL,
                        distanceInterval: ANDROID_CONFIG.LOCATION_UPDATES_DISTANCE,
                        foregroundService: {
                            notificationTitle: ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.title,
                            notificationBody:
                                ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.body,
                            notificationColor:
                                ANDROID_CONFIG.FOREGROUND_SERVICE_NOTIFICATION.color,
                        },
                    });
                } else if (Platform.OS === 'ios') {
                    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, {
                        accuracy: Location.Accuracy.BestForNavigation,
                        timeInterval: IOS_CONFIG.LOCATION_UPDATES_INTERVAL,
                        distanceInterval: IOS_CONFIG.LOCATION_UPDATES_DISTANCE,
                        pausesUpdatesAutomatically: IOS_CONFIG.PAUSES_UPDATES_AUTOMATICALLY,
                        activityType: Location.ActivityType.AutomotiveNavigation,
                        showsBackgroundLocationIndicator: IOS_CONFIG.SHOW_BACKGROUND_LOCATION_INDICATOR,
                    });
                }
            }

            console.log('[BackgroundTask] Started successfully');
            return true;
        } catch (error) {
            console.error('[BackgroundTask] Failed to start:', error);
            return false;
        }
    },

    /**
     * Stop background location updates
     */
    async stop(): Promise<boolean> {
        try {
            console.log('[BackgroundTask] Stopping background location tracking');

            await setStoredValue(STORAGE_KEYS.TRACKING_ENABLED, 'false');

            const isRegistered = await TaskManager.isTaskRegisteredAsync(
                BACKGROUND_LOCATION_TASK_NAME
            );

            if (isRegistered) {
                await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
                console.log('[BackgroundTask] Stopped successfully');
            }

            return true;
        } catch (error) {
            console.error('[BackgroundTask] Failed to stop:', error);
            return false;
        }
    },

    /**
     * Check if background tracking is enabled
     */
    async isRunning(): Promise<boolean> {
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(
                BACKGROUND_LOCATION_TASK_NAME
            );
            const enabled = await getStoredValue(STORAGE_KEYS.TRACKING_ENABLED);

            return isRegistered && enabled === 'true';
        } catch {
            return false;
        }
    },
};

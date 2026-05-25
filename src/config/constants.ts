/**
 * Location Tracking Configuration Constants
 * 
 * Centralized configuration for the entire tracking system
 * Tuned for production use on real-world networks and devices
 */

import { TrackingConfig } from '../api/types';

// ============================================================================
// TASK NAMES & STORAGE KEYS
// ============================================================================

export const BACKGROUND_LOCATION_TASK_NAME = 'background-location-tracking-task';
export const BACKGROUND_FETCH_TASK_NAME = 'background-location-sync-task';
export const BOOT_RECEIVER_ACTION = 'com.whereareyou.LOCATION_BOOT_COMPLETED';

// Storage keys (AsyncStorage + SecureStore)
export const STORAGE_KEYS = {
    // Auth (SecureStore)
    AUTH_TOKEN: 'auth_token',
    AUTH_TOKEN_REFRESH: 'auth_token_refresh',
    AUTH_EXPIRES_AT: 'auth_expires_at',
    DEVICE_ID: 'device_id',

    // Tracking state (AsyncStorage)
    TRACKING_ENABLED: 'location_tracking_enabled',
    TRACKING_SESSION: 'location_tracking_session',
    ASSIGNED_BUS_ID: 'assigned_bus_id',
    DRIVER_ID: 'driver_id',
    TRIP_ID: 'current_trip_id',

    // Queue & sync (AsyncStorage)
    LOCATION_QUEUE: 'location_queue',
    LAST_HANDLED_LOCATION: 'last_handled_location',
    SYNC_STATE: 'location_sync_state',
    LAST_SYNC_TIME: 'last_sync_time',

    // Geofence (AsyncStorage)
    GEOFENCES: 'geofences',
    GEOFENCE_STATES: 'geofence_states',

    // Configuration (AsyncStorage)
    TRACKING_CONFIG: 'tracking_config',
    BATTERY_OPTIMIZATION_MODE: 'battery_optimization_mode',
} as const;

// ============================================================================
// TRACKING CONFIGURATION
// ============================================================================

/**
 * Default tracking configuration
 * These values are tuned for production use based on:
 * - Uber/Google Maps architecture
 * - Android/iOS capabilities
 * - Battery life vs accuracy tradeoff
 * - Network bandwidth optimization
 */
export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
    // Foreground: More frequent updates for real-time experience
    foregroundTimeInterval: 5000, // 5 seconds
    foregroundDistanceInterval: 5, // 5 meters

    // Background: Less frequent to preserve battery and respect OS limits
    backgroundTimeInterval: 15000, // 15 seconds (Android), ~30s (iOS)
    backgroundDistanceInterval: 15, // 15 meters

    // Adaptation
    enableAdaptiveTracking: true,
    lowBatteryModeThreshold: 10, // Below 10%, enable battery mode

    // Movement detection (for pausing when stationary)
    stationary_threshold_meters: 5, // Less than 5m movement
    stationary_threshold_duration: 5000, // Within 5 seconds

    // Retry policy (exponential backoff)
    maxRetryCount: 8,
    initialRetryDelayMs: 1000, // 1 second
    maxRetryDelayMs: 64000, // 64 seconds

    // Queue management
    maxQueueSize: 300, // ~300 items max in memory
    queueCleanupBatchSize: 50, // Clean in batches
    maxQueueAgeMs: 24 * 60 * 60 * 1000, // 24 hours

    // Rate limiting & deduplication
    minTimeBetweenLocationsSec: 5, // Minimum 5 seconds
    minDistanceBetweenLocationsM: 5, // Minimum 5 meters
};

/**
 * Adaptive tracking presets based on speed
 * Used to optimize battery/accuracy tradeoff
 */
export const ADAPTIVE_TRACKING_PRESETS = {
    stationary: {
        // Speed 0-5 km/h - Stationary or very slow
        timeInterval: 30000, // 30 seconds
        distanceInterval: 50, // 50 meters
        accuracy: 'Balanced' as const,
        reason: 'Stationary - optimize battery' as const,
    },
    city: {
        // Speed 5-40 km/h - City driving
        timeInterval: 10000, // 10 seconds
        distanceInterval: 10, // 10 meters
        accuracy: 'BestForNavigation' as const,
        reason: 'City driving - balanced' as const,
    },
    highway: {
        // Speed >40 km/h - Highway/fast driving
        timeInterval: 5000, // 5 seconds
        distanceInterval: 5, // 5 meters
        accuracy: 'BestForNavigation' as const,
        reason: 'Highway - maximum accuracy' as const,
    },
    lowBattery: {
        // Battery <10% - Battery saver mode
        timeInterval: 60000, // 60 seconds
        distanceInterval: 100, // 100 meters
        accuracy: 'Balanced' as const,
        reason: 'Low battery mode' as const,
    },
    offline: {
        // No network - Minimize power consumption
        timeInterval: 30000, // 30 seconds
        distanceInterval: 50, // 50 meters
        accuracy: 'Balanced' as const,
        reason: 'Offline - battery preservation' as const,
    },
};

// ============================================================================
// PLATFORM-SPECIFIC CONFIGURATION
// ============================================================================

/**
 * Android-specific configuration
 */
export const ANDROID_CONFIG = {
    // Foreground service notification
    FOREGROUND_SERVICE_NOTIFICATION: {
        title: 'Live Tracking Active',
        body: 'Your location is being shared in background',
        color: '#1d4ed8',
        priority: 'high' as const,
        channelId: 'location-tracking',
    },

    // Permissions
    PERMISSIONS: [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.RECEIVE_BOOT_COMPLETED',
    ],

    // Task timing (optimized for Android 8+)
    LOCATION_UPDATES_INTERVAL: 15000, // 15 seconds
    LOCATION_UPDATES_DISTANCE: 15, // 15 meters
    LOCATION_UPDATE_FASTEST_INTERVAL: 5000, // 5 seconds minimum

    // Battery optimization
    IGNORE_BATTERY_OPTIMIZATION_REQUEST: true,
} as const;

/**
 * iOS-specific configuration
 */
export const IOS_CONFIG = {
    // Notification (background indicator)
    SHOW_BACKGROUND_LOCATION_INDICATOR: true,

    // Permissions
    PERMISSIONS: {
        NSLocationWhenInUseUsageDescription:
            'We need your location to track the bus in real-time',
        NSLocationAlwaysAndWhenInUseUsageDescription:
            'We need your location to track the bus even when the app is in the background',
        NSLocationAlwaysUsageDescription:
            'We need your location to track the bus continuously',
    },

    // Activity type affects location accuracy and battery usage
    // Must be set to AutomotiveNavigation for driving apps
    ACTIVITY_TYPE: 'AutomotiveNavigation',

    // Background modes required in Info.plist
    BACKGROUND_MODES: [
        'location', // Receive location updates in background
        'voip', // Optional: for push notifications
    ],

    // iOS-specific timing (iOS is more restrictive)
    LOCATION_UPDATES_INTERVAL: 30000, // 30 seconds (iOS will adjust)
    LOCATION_UPDATES_DISTANCE: 15, // 15 meters
    PAUSES_UPDATES_AUTOMATICALLY: false, // Critical: don't pause
    DEFERRAL_DISTANCE: 500, // Defer updates until user moves 500m

    // Battery considerations
    // iOS aggressively suspends background apps
    // Can't rely on frequent updates like Android
    // Use significant location updates as fallback
} as const;

// ============================================================================
// API ENDPOINTS
// ============================================================================

export const API_ENDPOINTS = {
    // Tracking endpoints
    LOCATION_POST: '/api/tracking/me/location',
    LOCATION_BATCH: '/api/tracking/batch',
    SYNC_STATUS: '/api/tracking/sync-status',

    // Auth endpoints
    TOKEN_REFRESH: '/api/auth/refresh',
    AUTH_VERIFY: '/api/auth/verify',

    // Trip endpoints
    TRIP_ACTIVE: '/api/trips/active',
    TRIP_STATUS: '/api/trips/:tripId/status',

    // Geofence endpoints
    GEOFENCES_LIST: '/api/geofences',
    GEOFENCE_CREATE: '/api/geofences',
    GEOFENCE_DELETE: '/api/geofences/:id',
} as const;

// ============================================================================
// RETRY STRATEGY
// ============================================================================

/**
 * Calculate retry delay using exponential backoff
 * Attempt 1: 1s, 2: 2s, 3: 4s, 4: 8s, 5: 16s, 6: 32s, 7: 64s, 8: 64s (max)
 */
export const calculateRetryDelay = (
    attempt: number,
    config: TrackingConfig
): number => {
    if (attempt >= config.maxRetryCount) {
        return config.maxRetryDelayMs;
    }

    const delay = config.initialRetryDelayMs * Math.pow(2, attempt - 1);
    return Math.min(delay, config.maxRetryDelayMs);
};

// ============================================================================
// BATTERY THRESHOLDS
// ============================================================================

export const BATTERY_THRESHOLDS = {
    CRITICAL: 5, // Critical: disable all non-essential features
    LOW: 10, // Low: enable battery saver mode
    MEDIUM: 30, // Medium: normal operation
    FULL: 100, // Full charge
} as const;

// ============================================================================
// GEOFENCING CONSTANTS
// ============================================================================

export const GEOFENCE_CONFIG = {
    MAX_ACTIVE_GEOFENCES: 20,
    MIN_RADIUS_METERS: 50,
    MAX_RADIUS_METERS: 10000,
    CHECK_INTERVAL_MS: 5000, // Check every 5 seconds
    DWELL_TIME_MS: 5000, // Wait 5 seconds before triggering
} as const;

// ============================================================================
// NOTIFICATION CONFIGURATION
// ============================================================================

export const NOTIFICATION_CONFIG = {
    // Channel IDs (Android)
    CHANNEL_ID_TRACKING: 'location-tracking',
    CHANNEL_ID_ALERTS: 'location-alerts',
    CHANNEL_ID_CRITICAL: 'location-critical',

    // Importance levels (Android)
    IMPORTANCE_DEFAULT: 3,
    IMPORTANCE_HIGH: 4,
    IMPORTANCE_MAX: 5,

    // Vibration pattern (milliseconds)
    VIBRATION_PATTERN: [0, 100, 50, 100], // Buzz

    // Sound configuration
    USE_DEFAULT_SOUND: true,
    USE_DEFAULT_VIBRATION: true,
} as const;

// ============================================================================
// LOGGING & MONITORING
// ============================================================================

export const LOGGING_CONFIG = {
    ENABLE_CONSOLE_LOGS: __DEV__, // Only in development
    ENABLE_SENTRY: true,
    SENTRY_SAMPLE_RATE: 0.1, // Sample 10% of events
    LOG_LOCATION_UPDATES: __DEV__,
    LOG_NETWORK_REQUESTS: __DEV__,
    LOG_STORAGE_OPERATIONS: __DEV__,
} as const;

// ============================================================================
// TIMEOUT CONFIGURATION
// ============================================================================

export const TIMEOUTS = {
    // Location operations
    GET_LOCATION_TIMEOUT: 30000, // 30 seconds
    LOCATION_SERVICES_TIMEOUT: 10000, // 10 seconds

    // Network operations
    API_REQUEST_TIMEOUT: 30000, // 30 seconds
    API_CONNECT_TIMEOUT: 10000, // 10 seconds

    // Permission requests
    PERMISSION_REQUEST_TIMEOUT: 60000, // 60 seconds

    // Background task
    BACKGROUND_TASK_TIMEOUT: 25000, // 25 seconds (iOS limit is ~30)

    // Socket.io
    SOCKET_CONNECT_TIMEOUT: 10000, // 10 seconds
    SOCKET_RECONNECT_DELAY: 1000, // 1 second initial
    SOCKET_RECONNECT_DELAY_MAX: 5000, // 5 seconds max
} as const;

// ============================================================================
// PERFORMANCE THRESHOLDS
// ============================================================================

export const PERFORMANCE_THRESHOLDS = {
    // Queue thresholds
    QUEUE_WARNING_SIZE: 100, // Warn if queue >100 items
    QUEUE_CRITICAL_SIZE: 250, // Critical if >250 items

    // Sync latency
    SYNC_ACCEPTABLE_LATENCY: 10000, // 10 seconds
    SYNC_WARN_LATENCY: 30000, // 30 seconds

    // Update frequency
    EXPECTED_UPDATE_FREQUENCY: 12, // Per minute in city driving
    MIN_UPDATE_FREQUENCY: 2, // Per minute (minimum acceptable)

    // Battery drain
    ACCEPTABLE_BATTERY_DRAIN: 1.0, // % per hour
    WARN_BATTERY_DRAIN: 2.0, // % per hour
} as const;

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
    PERMISSION_DENIED: 'Location permission denied by user',
    SERVICES_DISABLED: 'Location services are disabled',
    LOCATION_UNAVAILABLE: 'Unable to determine current location',
    TIMEOUT: 'Location request timed out',
    NETWORK_ERROR: 'Network error - will retry later',
    AUTH_ERROR: 'Authentication failed - please login again',
    STORAGE_ERROR: 'Failed to access device storage',
    INVALID_TOKEN: 'Authentication token invalid or expired',
    TOKEN_REFRESH_FAILED: 'Failed to refresh authentication token',
    BACKGROUND_TASK_ERROR: 'Background location task encountered an error',
} as const;

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export const FEATURE_FLAGS = {
    ENABLE_LOCATION_TRACKING: true,
    ENABLE_BACKGROUND_TRACKING: true,
    ENABLE_GEOFENCING: true,
    ENABLE_VOICE_ALERTS: true,
    ENABLE_ADAPTIVE_TRACKING: true,
    ENABLE_OFFLINE_QUEUE: true,
    ENABLE_BATCH_UPLOADS: true,
    ENABLE_PERFORMANCE_MONITORING: true,
    ENABLE_DETAILED_LOGGING: __DEV__,
} as const;

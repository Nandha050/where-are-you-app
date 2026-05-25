/**
 * Location Tracking - Type Definitions
 * 
 * Comprehensive types for the entire location tracking system
 * Covers all data structures used across the application
 */

// ============================================================================
// CORE LOCATION TYPES
// ============================================================================

/**
 * The main location payload sent to the backend
 * Minimal payload for efficient bandwidth usage
 */
export interface LocationPayload {
    latitude: number;
    longitude: number;
    speed: number; // m/s
    heading: number; // degrees (0-360)
    accuracy: number; // meters
    altitude: number; // meters
    timestamp: string; // ISO-8601

    // Device context
    deviceId: string;
    batteryLevel: number; // 0-100
    batteryState: 'charging' | 'full' | 'discharging' | 'unknown';

    // Trip context
    tripId: string;
    busId: string;
    driverId: string;

    // Platform info
    platform: 'ios' | 'android' | 'web';
}

/**
 * Location with additional metadata for internal processing
 */
export interface LocationWithMetadata extends LocationPayload {
    id: string; // UUID for deduplication
    enqueuedAt: number; // Unix timestamp
    retryCount: number;
    lastRetryAt?: number;
}

/**
 * Last handled location for duplicate detection
 */
export interface LastHandledLocation {
    latitude: number;
    longitude: number;
    heading: number;
    speed: number;
    timestamp: number; // Unix milliseconds
}

/**
 * Location update event emitted internally
 */
export interface LocationUpdate {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    accuracy: number;
    altitude: number;
    timestamp: number; // Unix milliseconds
    isSignificantChange: boolean; // Distance or speed changed significantly
}

// ============================================================================
// PERMISSION TYPES
// ============================================================================

export type PermissionStatus =
    | 'granted'
    | 'denied'
    | 'undetermined'
    | 'restricted';

export interface PermissionCheckResult {
    foreground: PermissionStatus;
    background: PermissionStatus;
    servicesEnabled: boolean;
    canAskAgain: boolean;
}

export interface PermissionRequest {
    foreground: boolean;
    background: boolean;
}

// ============================================================================
// TRACKING STATE TYPES
// ============================================================================

export type TrackingState =
    | 'idle'         // Not tracking
    | 'initializing' // Starting up
    | 'active'       // Currently tracking
    | 'paused'       // Paused by user
    | 'suspended'    // System suspended
    | 'stopped';     // Explicitly stopped

export interface TrackingSession {
    id: string;
    tripId: string;
    busId: string;
    driverId: string;
    startedAt: number;
    endedAt?: number;
    totalDistance: number; // meters
    locations: LocationPayload[];
    queueSize: number;
    lastSyncAt?: number;
}

export interface TrackingConfig {
    // Polling intervals (milliseconds)
    foregroundTimeInterval: number;
    foregroundDistanceInterval: number;

    backgroundTimeInterval: number;
    backgroundDistanceInterval: number;

    // Adaptation
    enableAdaptiveTracking: boolean;
    lowBatteryModeThreshold: number; // Battery percentage (10)
    stationary_threshold_meters: number; // Distance to be considered stationary (5)
    stationary_threshold_duration: number; // Time to wait before pausing (5000ms)

    // Retry
    maxRetryCount: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;

    // Queue
    maxQueueSize: number;
    queueCleanupBatchSize: number;
    maxQueueAgeMs: number;

    // Rate limiting
    minTimeBetweenLocationsSec: number;
    minDistanceBetweenLocationsM: number;
}

// ============================================================================
// QUEUE TYPES
// ============================================================================

export interface QueueItem {
    id: string; // UUID
    location: LocationPayload;
    enqueuedAt: number;
    retryCount: number;
    lastRetryAt?: number;
}

export interface QueueStats {
    size: number;
    oldestItemAge: number; // milliseconds
    pendingRetries: number;
    estimatedSize: number; // bytes
}

// ============================================================================
// BATTERY TYPES
// ============================================================================

export type BatteryState =
    | 'charging'
    | 'full'
    | 'discharging'
    | 'unknown';

export interface BatteryInfo {
    level: number; // 0-100
    state: BatteryState;
    isLowPowerMode: boolean;
}

export interface BatteryOptimizationStrategy {
    accuracy: 'Best' | 'BestForNavigation' | 'Balanced' | 'Lowest';
    timeInterval: number;
    distanceInterval: number;
    reason: 'normal' | 'lowBattery' | 'offline';
}

// ============================================================================
// GEOFENCE TYPES
// ============================================================================

export interface Geofence {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    type: 'entry' | 'exit' | 'both';
    triggerUrl?: string;
}

export interface GeofenceEvent {
    geofenceId: string;
    type: 'entry' | 'exit';
    triggeredAt: number;
    location: LocationPayload;
}

export interface GeofenceState {
    geofenceId: string;
    isInside: boolean;
    lastCheckedAt: number;
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

export interface NotificationConfig {
    title: string;
    body: string;
    color?: string;
    smallIcon?: string;
    channelId: string;
    priority: 'max' | 'high' | 'default' | 'low' | 'min';
}

export interface NotificationTrigger {
    type: 'geofence_entry' | 'geofence_exit' | 'speed_alert' | 'offline_alert';
    geofenceId?: string;
    message: string;
}

export interface VoiceAlertConfig {
    enabled: boolean;
    rate: number; // 0.5 - 2.0
    pitch: number; // 0.5 - 2.0
    volume: number; // 0 - 1
}

// ============================================================================
// API TYPES
// ============================================================================

export interface LocationApiResponse {
    success: boolean;
    skipped?: boolean;
    throttled?: boolean;
    message?: string;
    nextSyncTime?: number;
}

export interface BatchLocationPayload {
    tripId: string;
    busId: string;
    driverId: string;
    locations: LocationPayload[];
}

export interface BatchLocationResponse {
    success: boolean;
    accepted: number;
    rejected: number;
    errors?: Array<{
        index: number;
        error: string;
    }>;
}

// ============================================================================
// SYNC TYPES
// ============================================================================

export type SyncStrategy =
    | 'immediate' // Sync ASAP
    | 'batch' // Wait for multiple locations
    | 'periodic' // Sync every N seconds
    | 'offline-first'; // Queue first, sync later

export interface SyncState {
    status: 'idle' | 'syncing' | 'queued' | 'error';
    lastSyncAt?: number;
    nextScheduledSync?: number;
    lastError?: string;
    consecutiveFailures: number;
}

export interface RetryPolicy {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number; // Exponential backoff
    shouldRetry: (error: unknown, attempt: number) => boolean;
}

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface AuthToken {
    access: string;
    refresh?: string;
    expiresIn: number;
    expiresAt: number;
    tokenType: string;
}

export interface AuthContext {
    token: AuthToken | null;
    userId: string;
    driverId: string;
    role: 'driver' | 'user' | 'admin';
    isAuthenticated: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export type LocationErrorCode =
    | 'PERMISSION_DENIED'
    | 'SERVICES_DISABLED'
    | 'LOCATION_UNAVAILABLE'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'AUTH_ERROR'
    | 'STORAGE_ERROR'
    | 'UNKNOWN';

export interface LocationError {
    code: LocationErrorCode;
    message: string;
    originalError?: Error;
    timestamp: number;
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

export interface PerformanceMetric {
    name: string;
    duration: number; // milliseconds
    timestamp: number;
    tags: Record<string, string>;
}

export interface LocationMetrics {
    updateFrequency: number; // per minute
    averageSyncLatency: number; // milliseconds
    queueThroughput: number; // items per minute
    successRate: number; // 0-100%
    batteryDrainRate: number; // % per hour
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface LocationStore {
    // State
    currentLocation: LocationUpdate | null;
    lastLocation: LocationUpdate | null;
    trackingState: TrackingState;
    trackingConfig: TrackingConfig;
    batteryInfo: BatteryInfo;
    queueStats: QueueStats;
    syncState: SyncState;
    geofences: Geofence[];
    geofenceStates: Map<string, GeofenceState>;
    errors: LocationError[];

    // Actions
    setCurrentLocation: (location: LocationUpdate) => void;
    setTrackingState: (state: TrackingState) => void;
    updateBatteryInfo: (info: BatteryInfo) => void;
    updateQueueStats: (stats: QueueStats) => void;
    updateSyncState: (state: SyncState) => void;
    addGeofence: (geofence: Geofence) => void;
    removeGeofence: (id: string) => void;
    updateGeofenceState: (id: string, state: GeofenceState) => void;
    addError: (error: LocationError) => void;
    clearErrors: () => void;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

/**
 * Interface for location service
 */
export interface ILocationService {
    startTracking(config: Partial<TrackingConfig>): Promise<boolean>;
    stopTracking(): Promise<boolean>;
    getCurrentLocation(): Promise<LocationUpdate | null>;
    getLastLocation(): LocationUpdate | null;
    subscribe(callback: (location: LocationUpdate) => void): () => void;
}

/**
 * Interface for permission service
 */
export interface IPermissionService {
    checkPermissions(): Promise<PermissionCheckResult>;
    requestPermissions(request: PermissionRequest): Promise<PermissionCheckResult>;
    hasLocationServices(): Promise<boolean>;
}

/**
 * Interface for queue manager
 */
export interface ILocationQueueManager {
    enqueue(location: LocationPayload): Promise<void>;
    dequeue(count: number): Promise<LocationPayload[]>;
    getStats(): Promise<QueueStats>;
    clear(): Promise<void>;
    flush(): Promise<void>;
}

/**
 * Interface for API sync manager
 */
export interface IAPISyncManager {
    sync(location: LocationPayload): Promise<boolean>;
    syncQueue(): Promise<void>;
    flushQueue(): Promise<void>;
    scheduleSync(delayMs: number): void;
    getStats(): SyncState;
}

/**
 * Interface for notification service
 */
export interface INotificationService {
    showPersistentNotification(config: NotificationConfig): Promise<void>;
    updatePersistentNotification(config: NotificationConfig): Promise<void>;
    dismissPersistentNotification(): Promise<void>;
    sendAlert(trigger: NotificationTrigger): Promise<void>;
    playVoiceAlert(message: string, config: VoiceAlertConfig): Promise<void>;
}

/**
 * Interface for geofence service
 */
export interface IGeofenceService {
    add(geofence: Geofence): Promise<void>;
    remove(id: string): Promise<void>;
    update(geofence: Geofence): Promise<void>;
    checkAllGeofences(location: LocationPayload): Promise<GeofenceEvent[]>;
    getActive(): Geofence[];
}

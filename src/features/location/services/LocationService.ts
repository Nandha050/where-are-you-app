/**
 * Core Location Service
 * 
 * Handles all location acquisition and filtering logic.
 * Provides the main API for tracking operations.
 * 
 * Architecture:
 * - Single instance (singleton)
 * - Observable pattern for updates
 * - Automatic filtering for duplicates
 * - Platform-agnostic (works on Android/iOS/web)
 * - Handles foreground location only (background handled by TaskManager)
 */

import * as Location from 'expo-location';
import {
    ADAPTIVE_TRACKING_PRESETS,
    DEFAULT_TRACKING_CONFIG,
    TIMEOUTS
} from '../../config/constants';
import { logger } from '../../core/logger/logger';
import {
    ILocationService,
    LastHandledLocation,
    LocationError,
    LocationErrorCode,
    LocationUpdate,
    TrackingConfig,
} from '../api/types';

type LocationUpdateCallback = (location: LocationUpdate) => void;

/**
 * Core location service
 * Singleton instance manages all location tracking
 */
class LocationServiceClass implements ILocationService {
    private static instance: LocationServiceClass | null = null;

    private isTracking = false;
    private currentLocation: LocationUpdate | null = null;
    private lastLocation: LocationUpdate | null = null;
    private lastHandledLocation: LastHandledLocation | null = null;

    private config: TrackingConfig = DEFAULT_TRACKING_CONFIG;
    private watchSubscription: Location.LocationSubscription | null = null;
    private updateCallbacks = new Set<LocationUpdateCallback>();
    private errors: LocationError[] = [];
    private batteryLevel = 100;

    // Prevent duplicate instantiation
    private constructor() { }

    static getInstance(): LocationServiceClass {
        if (!LocationServiceClass.instance) {
            LocationServiceClass.instance = new LocationServiceClass();
        }
        return LocationServiceClass.instance;
    }

    /**
     * Start foreground location tracking
     * Only for foreground tracking; background handled by TaskManager
     */
    async startTracking(overrideConfig?: Partial<TrackingConfig>): Promise<boolean> {
        try {
            if (this.isTracking) {
                logger.warn('[LocationService] Already tracking, skipping start');
                return true;
            }

            logger.info('[LocationService] Starting foreground location tracking');

            // Merge configuration
            this.config = {
                ...DEFAULT_TRACKING_CONFIG,
                ...overrideConfig,
            };

            // Start watching location updates
            const success = await this.startWatchingLocation();
            if (success) {
                this.isTracking = true;
                logger.info('[LocationService] Successfully started tracking');
                return true;
            }

            return false;
        } catch (error) {
            this.handleError(
                error,
                'UNKNOWN',
                'Failed to start tracking'
            );
            return false;
        }
    }

    /**
     * Stop foreground location tracking
     */
    async stopTracking(): Promise<boolean> {
        try {
            logger.info('[LocationService] Stopping foreground location tracking');

            if (this.watchSubscription) {
                this.watchSubscription.remove();
                this.watchSubscription = null;
            }

            this.isTracking = false;
            this.currentLocation = null;
            this.lastHandledLocation = null;
            logger.info('[LocationService] Successfully stopped tracking');

            return true;
        } catch (error) {
            this.handleError(
                error,
                'UNKNOWN',
                'Failed to stop tracking'
            );
            return false;
        }
    }

    /**
     * Get current location immediately
     */
    async getCurrentLocation(): Promise<LocationUpdate | null> {
        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.BestForNavigation,
                timeout: TIMEOUTS.GET_LOCATION_TIMEOUT,
            });

            return this.normalizeLocation(location);
        } catch (error) {
            this.handleError(error, 'TIMEOUT', 'Failed to get current location');
            return null;
        }
    }

    /**
     * Get last known location
     */
    getLastLocation(): LocationUpdate | null {
        return this.lastLocation;
    }

    /**
     * Subscribe to location updates
     * Returns unsubscribe function
     */
    subscribe(callback: LocationUpdateCallback): () => void {
        this.updateCallbacks.add(callback);

        // Return unsubscribe function
        return () => {
            this.updateCallbacks.delete(callback);
        };
    }

    /**
     * Get tracking state
     */
    isCurrentlyTracking(): boolean {
        return this.isTracking;
    }

    /**
     * Get current configuration
     */
    getConfig(): TrackingConfig {
        return this.config;
    }

    /**
     * Update configuration at runtime
     */
    updateConfig(overrideConfig: Partial<TrackingConfig>): void {
        this.config = {
            ...this.config,
            ...overrideConfig,
        };
        logger.debug('[LocationService] Configuration updated', { config: this.config });
    }

    /**
     * Update battery level for adaptive tracking
     */
    setBatteryLevel(level: number): void {
        this.batteryLevel = Math.max(0, Math.min(100, level));
        this.adaptivelyAdjustTracking();
    }

    /**
     * Get all recorded errors
     */
    getErrors(): LocationError[] {
        return [...this.errors];
    }

    /**
     * Clear error history
     */
    clearErrors(): void {
        this.errors = [];
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Start watching location updates
     */
    private async startWatchingLocation(): Promise<boolean> {
        try {
            // Check if location services enabled
            const servicesEnabled = await Location.hasServicesEnabledAsync();
            if (!servicesEnabled) {
                this.handleError(
                    new Error('Location services disabled'),
                    'SERVICES_DISABLED',
                    'Location services are not enabled'
                );
                return false;
            }

            // Stop any existing watch
            if (this.watchSubscription) {
                this.watchSubscription.remove();
            }

            // Start watching position
            this.watchSubscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.BestForNavigation,
                    timeInterval: this.config.foregroundTimeInterval,
                    distanceInterval: this.config.foregroundDistanceInterval,
                },
                (location) => {
                    this.handleLocationUpdate(location);
                }
            );

            return true;
        } catch (error) {
            this.handleError(
                error,
                'PERMISSION_DENIED',
                'Failed to start watching location'
            );
            return false;
        }
    }

    /**
     * Handle incoming location update
     * Applies filtering and notifies subscribers
     */
    private async handleLocationUpdate(
        rawLocation: Location.LocationObject
    ): Promise<void> {
        try {
            // Normalize location
            const normalized = this.normalizeLocation(rawLocation);
            if (!normalized) {
                return;
            }

            // Apply filtering
            const shouldUpdate = await this.shouldUpdateLocation(normalized);
            if (!shouldUpdate) {
                return;
            }

            // Update state
            this.lastLocation = this.currentLocation;
            this.currentLocation = normalized;

            // Update last handled for duplicate detection
            this.lastHandledLocation = {
                latitude: normalized.latitude,
                longitude: normalized.longitude,
                heading: normalized.heading,
                speed: normalized.speed,
                timestamp: normalized.timestamp,
            };

            // Notify all subscribers
            this.notifySubscribers(normalized);

            // Adapt tracking if enabled
            if (this.config.enableAdaptiveTracking) {
                this.adaptivelyAdjustTracking();
            }
        } catch (error) {
            logger.error('[LocationService] Error handling location update', { error });
        }
    }

    /**
     * Normalize raw location to internal format
     */
    private normalizeLocation(
        raw: Location.LocationObject
    ): LocationUpdate | null {
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
                timestamp: raw.timestamp,
                isSignificantChange: false, // Will be set by filtering
            };
        } catch (error) {
            logger.error('[LocationService] Error normalizing location', { error });
            return null;
        }
    }

    /**
     * Determine if location should be processed
     * Applies duplicate detection and filtering
     */
    private async shouldUpdateLocation(
        current: LocationUpdate
    ): Promise<boolean> {
        try {
            // First update always pass
            if (!this.lastHandledLocation) {
                current.isSignificantChange = true;
                return true;
            }

            // Calculate time delta
            const timeDelta = current.timestamp - this.lastHandledLocation.timestamp;
            const minTimeSec = this.config.minTimeBetweenLocationsSec * 1000;
            if (timeDelta < minTimeSec) {
                return false; // Too soon
            }

            // Calculate distance moved
            const distanceM = this.distanceMeters(
                this.lastHandledLocation.latitude,
                this.lastHandledLocation.longitude,
                current.latitude,
                current.longitude
            );

            const minDistanceM = this.config.minDistanceBetweenLocationsM;
            if (distanceM < minDistanceM) {
                return false; // Haven't moved far enough
            }

            // Significant change detected
            current.isSignificantChange = true;
            return true;
        } catch (error) {
            logger.error('[LocationService] Error in shouldUpdateLocation', { error });
            return true; // Pass through on error
        }
    }

    /**
     * Adapt tracking parameters based on speed and battery
     * Reduces battery drain while maintaining reasonable accuracy
     */
    private adaptivelyAdjustTracking(): void {
        try {
            if (!this.isTracking || !this.currentLocation) {
                return;
            }

            let preset = ADAPTIVE_TRACKING_PRESETS.city; // Default

            // Check battery first
            if (this.batteryLevel < this.config.lowBatteryModeThreshold) {
                preset = ADAPTIVE_TRACKING_PRESETS.lowBattery;
            }
            // Then check speed
            else if (this.currentLocation.speed < 1.4) {
                // < 5 km/h
                preset = ADAPTIVE_TRACKING_PRESETS.stationary;
            } else if (this.currentLocation.speed > 11.1) {
                // > 40 km/h
                preset = ADAPTIVE_TRACKING_PRESETS.highway;
            }
            // else use city preset (already set)

            // Update if different from current config
            if (this.config.foregroundTimeInterval !== preset.timeInterval) {
                this.config.foregroundTimeInterval = preset.timeInterval;
                this.config.foregroundDistanceInterval = preset.distanceInterval;

                logger.debug('[LocationService] Adapted tracking', {
                    preset: preset.reason,
                    speed: this.currentLocation.speed,
                    battery: this.batteryLevel,
                });
            }
        } catch (error) {
            logger.error('[LocationService] Error in adaptive adjustment', { error });
        }
    }

    /**
     * Calculate distance between two points using Haversine formula
     */
    private distanceMeters(
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number
    ): number {
        const R = 6371000; // Earth radius in meters
        const rad = (deg: number) => (deg * Math.PI) / 180;

        const dLat = rad(lat2 - lat1);
        const dLon = rad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(lat1)) *
            Math.cos(rad(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Notify all subscribers of location update
     */
    private notifySubscribers(location: LocationUpdate): void {
        this.updateCallbacks.forEach((callback) => {
            try {
                callback(location);
            } catch (error) {
                logger.error('[LocationService] Error in callback', { error });
            }
        });
    }

    /**
     * Handle and record errors
     */
    private handleError(
        error: unknown,
        code: LocationErrorCode,
        message: string
    ): void {
        const locationError: LocationError = {
            code,
            message,
            originalError: error instanceof Error ? error : undefined,
            timestamp: Date.now(),
        };

        this.errors.push(locationError);

        // Keep only last 50 errors
        if (this.errors.length > 50) {
            this.errors = this.errors.slice(-50);
        }

        logger.error('[LocationService]', {
            code,
            message,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Singleton instance
 */
export const locationService = LocationServiceClass.getInstance();

/**
 * For testing, export the class itself
 */
export { LocationServiceClass };


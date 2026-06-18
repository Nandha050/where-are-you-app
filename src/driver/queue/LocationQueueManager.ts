import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../../core/logger/logger';

export interface LocationRecord {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading?: number;
    accuracy?: number;
    altitude?: number;
    timestamp: string;
}

export interface QueueStats {
    totalItems: number;
    oldestItemAge: number | null; // milliseconds
    pendingRetries: number;
}

const QUEUE_STORAGE_KEY = 'driver_location_queue';
const MAX_QUEUE_SIZE = 500;
const RETENTION_TIME_MS = 3 * 60 * 60 * 1000; // 3 hours

export class LocationQueueManager {
    private static instance: LocationQueueManager;
    private queue: LocationRecord[] = [];
    private isLoaded = false;

    private constructor() { }

    static getInstance(): LocationQueueManager {
        if (!LocationQueueManager.instance) {
            LocationQueueManager.instance = new LocationQueueManager();
        }
        return LocationQueueManager.instance;
    }

    /**
     * Initialize queue from storage
     */
    async initialize(): Promise<void> {
        if (this.isLoaded) return;

        try {
            const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
            if (stored) {
                this.queue = JSON.parse(stored);
                logger.info('[LocationQueueManager] Initialized', {
                    queueSize: this.queue.length,
                });
            }
            this.isLoaded = true;
        } catch (error) {
            logger.error('[LocationQueueManager] Failed to initialize', { error });
            this.queue = [];
            this.isLoaded = true;
        }
    }

    /**
     * Enqueue location
     */
    async enqueue(location: LocationRecord): Promise<boolean> {
        try {
            // Prevent duplicates - if same location received within 1 second, skip
            const lastItem = this.queue[this.queue.length - 1];
            if (lastItem) {
                const timeDiff = new Date(location.timestamp).getTime() -
                    new Date(lastItem.timestamp).getTime();
                const distance = this.haversineDistance(
                    lastItem.latitude,
                    lastItem.longitude,
                    location.latitude,
                    location.longitude
                );

                if (timeDiff < 1000 && distance < 5) {
                    return false; // Duplicate
                }
            }

            this.queue.push(location);

            // Keep only recent items
            if (this.queue.length > MAX_QUEUE_SIZE) {
                this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
            }

            await this.persist();

            // \u2705 DIAGNOSTIC LOG \u2014 required for production debugging
            logger.warn('[QUEUE] LOCATION_ENQUEUED', {
                lat: location.latitude,
                lng: location.longitude,
                speed: location.speed,
                queueSize: this.queue.length,
                timestamp: location.timestamp,
            });

            return true;
        } catch (error) {
            logger.error('[LocationQueueManager] Enqueue failed', { error });
            return false;
        }
    }

    /**
     * Get and clear batch for upload
     */
    async getBatch(maxSize: number = 50): Promise<LocationRecord[]> {
        const batch = this.queue.splice(0, maxSize);
        await this.persist();
        return batch;
    }

    /**
     * Return items to queue (retry)
     */
    async rePushBatch(items: LocationRecord[]): Promise<void> {
        try {
            this.queue.unshift(...items);
            await this.persist();
            logger.info('[LocationQueueManager] Batch re-queued', {
                itemCount: items.length,
            });
        } catch (error) {
            logger.error('[LocationQueueManager] Batch re-push failed', { error });
        }
    }

    /**
     * Clear queue
     */
    async clear(): Promise<void> {
        try {
            this.queue = [];
            await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
            logger.info('[LocationQueueManager] Queue cleared');
        } catch (error) {
            logger.error('[LocationQueueManager] Clear failed', { error });
        }
    }

    /**
     * Get queue stats
     */
    getStats(): QueueStats {
        if (this.queue.length === 0) {
            return {
                totalItems: 0,
                oldestItemAge: null,
                pendingRetries: 0,
            };
        }

        const oldestItem = this.queue[0];
        const now = Date.now();
        const oldestTime = new Date(oldestItem.timestamp).getTime();
        const oldestItemAge = now - oldestTime;

        return {
            totalItems: this.queue.length,
            oldestItemAge: Math.max(0, oldestItemAge),
            pendingRetries: 0,
        };
    }

    /**
     * Clean expired items
     */
    async cleanExpired(): Promise<number> {
        const now = Date.now();
        const beforeCount = this.queue.length;

        this.queue = this.queue.filter((item) => {
            const itemTime = new Date(item.timestamp).getTime();
            return now - itemTime < RETENTION_TIME_MS;
        });

        const removed = beforeCount - this.queue.length;
        if (removed > 0) {
            await this.persist();
            logger.info('[LocationQueueManager] Expired items removed', { removed });
        }

        return removed;
    }

    /**
     * Get queue size
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Check if queue is backed up
     */
    isBackedUp(): boolean {
        return this.queue.length > 100;
    }

    /**
     * Persist queue to storage
     */
    private async persist(): Promise<void> {
        try {
            await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
        } catch (error) {
            logger.error('[LocationQueueManager] Persist failed', { error });
        }
    }

    /**
     * Haversine distance calculation
     */
    private haversineDistance(
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number
    ): number {
        const R = 6371000; // Earth radius in meters
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
}

export const locationQueueManager = LocationQueueManager.getInstance();

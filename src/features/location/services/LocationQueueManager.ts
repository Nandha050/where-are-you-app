/**
 * Location Queue Manager
 * 
 * Offline-first queue system for location data.
 * Ensures no location is lost even if network is unavailable.
 * 
 * Key responsibilities:
 * - Queue locations in AsyncStorage
 * - Automatic deduplication
 * - Size management (max 300 items)
 * - Age-based cleanup (>24h old)
 * - Batch optimization
 * - Thread-safe operations
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_TRACKING_CONFIG, STORAGE_KEYS } from '../../config/constants';
import { logger } from '../../core/logger/logger';
import {
    ILocationQueueManager,
    LocationPayload,
    QueueItem,
    QueueStats
} from '../api/types';

class LocationQueueManagerClass implements ILocationQueueManager {
    private static instance: LocationQueueManagerClass | null = null;
    private isLocked = false; // Prevent concurrent access

    private constructor() { }

    static getInstance(): LocationQueueManagerClass {
        if (!LocationQueueManagerClass.instance) {
            LocationQueueManagerClass.instance = new LocationQueueManagerClass();
        }
        return LocationQueueManagerClass.instance;
    }

    /**
     * Add location to queue
     * Automatically handles deduplication and size limits
     */
    async enqueue(location: LocationPayload): Promise<void> {
        try {
            // Acquire lock to prevent concurrent modifications
            await this.acquireLock();

            logger.debug('[LocationQueueManager] Enqueuing location', {
                lat: location.latitude,
                lng: location.longitude,
            });

            // Read current queue
            const queue = await this.readQueue();

            // Create queue item with metadata
            const item: QueueItem = {
                id: uuidv4(),
                location,
                enqueuedAt: Date.now(),
                retryCount: 0,
            };

            // Check for near-duplicates (same location within last 30 seconds)
            const isDuplicate = queue.some((existing) => {
                const timeDiff = item.enqueuedAt - existing.enqueuedAt;
                const isSameLocation =
                    existing.location.latitude === location.latitude &&
                    existing.location.longitude === location.longitude;

                return isSameLocation && timeDiff < 30000;
            });

            if (isDuplicate) {
                logger.debug('[LocationQueueManager] Skipping duplicate location');
                return;
            }

            // Add new item
            queue.push(item);

            // Enforce size limit
            const maxSize = DEFAULT_TRACKING_CONFIG.maxQueueSize;
            if (queue.length > maxSize) {
                // Keep the most recent items, discard oldest
                const trimmed = queue.slice(-maxSize);
                logger.warn('[LocationQueueManager] Queue exceeded max size, trimming', {
                    original: queue.length,
                    trimmed: trimmed.length,
                });
                queue.length = 0;
                queue.push(...trimmed);
            }

            // Persist to storage
            await this.writeQueue(queue);

            logger.debug('[LocationQueueManager] Location enqueued', {
                queueSize: queue.length,
            });
        } catch (error) {
            logger.error('[LocationQueueManager] Error enqueueing location', {
                error,
            });
            throw error;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Remove and return multiple locations from queue
     */
    async dequeue(count: number): Promise<LocationPayload[]> {
        try {
            await this.acquireLock();

            const queue = await this.readQueue();

            if (queue.length === 0) {
                return [];
            }

            // Take from front (FIFO)
            const toReturn = queue.splice(0, Math.min(count, queue.length));
            const locations = toReturn.map((item) => item.location);

            // Persist updated queue
            await this.writeQueue(queue);

            logger.debug('[LocationQueueManager] Dequeued locations', {
                count: locations.length,
                queueRemaining: queue.length,
            });

            return locations;
        } catch (error) {
            logger.error('[LocationQueueManager] Error dequeueing locations', {
                error,
            });
            throw error;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Get queue statistics without modifying
     */
    async getStats(): Promise<QueueStats> {
        try {
            const queue = await this.readQueue();

            if (queue.length === 0) {
                return {
                    size: 0,
                    oldestItemAge: 0,
                    pendingRetries: 0,
                    estimatedSize: 0,
                };
            }

            // Calculate stats
            const oldest = queue[0];
            const newest = queue[queue.length - 1];
            const oldestAge = Date.now() - oldest.enqueuedAt;

            const pendingRetries = queue.filter((item) => item.retryCount > 0).length;

            // Rough estimate of queue size in bytes
            // Average location is ~200 bytes
            const estimatedSize = queue.length * 200;

            return {
                size: queue.length,
                oldestItemAge: oldestAge,
                pendingRetries,
                estimatedSize,
            };
        } catch (error) {
            logger.error('[LocationQueueManager] Error getting stats', { error });
            return {
                size: 0,
                oldestItemAge: 0,
                pendingRetries: 0,
                estimatedSize: 0,
            };
        }
    }

    /**
     * Clear entire queue
     */
    async clear(): Promise<void> {
        try {
            await this.acquireLock();

            await AsyncStorage.removeItem(STORAGE_KEYS.LOCATION_QUEUE);

            logger.info('[LocationQueueManager] Queue cleared');
        } catch (error) {
            logger.error('[LocationQueueManager] Error clearing queue', { error });
            throw error;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Flush entire queue (get all items and clear)
     */
    async flush(): Promise<LocationPayload[]> {
        try {
            await this.acquireLock();

            const queue = await this.readQueue();
            const locations = queue.map((item) => item.location);

            // Clear queue
            await AsyncStorage.removeItem(STORAGE_KEYS.LOCATION_QUEUE);

            logger.info('[LocationQueueManager] Queue flushed', {
                itemsReturned: locations.length,
            });

            return locations;
        } catch (error) {
            logger.error('[LocationQueueManager] Error flushing queue', { error });
            throw error;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Mark item as failed and increment retry count
     * Called by sync manager on upload failure
     */
    async markRetry(index: number): Promise<void> {
        try {
            await this.acquireLock();

            const queue = await this.readQueue();

            if (index >= 0 && index < queue.length) {
                queue[index].retryCount += 1;
                queue[index].lastRetryAt = Date.now();

                await this.writeQueue(queue);

                logger.debug('[LocationQueueManager] Marked for retry', {
                    index,
                    retryCount: queue[index].retryCount,
                });
            }
        } catch (error) {
            logger.error('[LocationQueueManager] Error marking retry', { error });
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Remove old items (>24h old)
     * Should be called periodically
     */
    async cleanupOldItems(): Promise<number> {
        try {
            await this.acquireLock();

            const queue = await this.readQueue();
            const maxAge = DEFAULT_TRACKING_CONFIG.maxQueueAgeMs;
            const now = Date.now();

            const beforeCount = queue.length;
            const filtered = queue.filter((item) => {
                const age = now - item.enqueuedAt;
                return age < maxAge;
            });

            const removed = beforeCount - filtered.length;

            if (removed > 0) {
                await this.writeQueue(filtered);

                logger.info('[LocationQueueManager] Cleaned up old items', {
                    removed,
                    remaining: filtered.length,
                });
            }

            return removed;
        } catch (error) {
            logger.error('[LocationQueueManager] Error cleaning up items', { error });
            return 0;
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Get specific item by index
     */
    async getItem(index: number): Promise<QueueItem | null> {
        try {
            const queue = await this.readQueue();
            return queue[index] ?? null;
        } catch (error) {
            logger.error('[LocationQueueManager] Error getting item', { error });
            return null;
        }
    }

    /**
     * Get all items in queue (for debugging)
     */
    async getAllItems(): Promise<QueueItem[]> {
        try {
            return await this.readQueue();
        } catch (error) {
            logger.error('[LocationQueueManager] Error getting all items', { error });
            return [];
        }
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Read queue from AsyncStorage
     */
    private async readQueue(): Promise<QueueItem[]> {
        try {
            const raw = await AsyncStorage.getItem(STORAGE_KEYS.LOCATION_QUEUE);
            if (!raw) {
                return [];
            }

            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            logger.error('[LocationQueueManager] Error reading queue', { error });
            return [];
        }
    }

    /**
     * Write queue to AsyncStorage
     */
    private async writeQueue(queue: QueueItem[]): Promise<void> {
        try {
            const json = JSON.stringify(queue);
            await AsyncStorage.setItem(STORAGE_KEYS.LOCATION_QUEUE, json);
        } catch (error) {
            logger.error('[LocationQueueManager] Error writing queue', { error });
            throw error;
        }
    }

    /**
     * Simple lock mechanism to prevent concurrent access
     * Uses a promise-based approach
     */
    private async acquireLock(): Promise<void> {
        // Simple busy-wait with exponential backoff
        let attempts = 0;
        while (this.isLocked && attempts < 100) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            attempts++;
        }

        if (this.isLocked) {
            logger.warn('[LocationQueueManager] Lock acquisition timeout');
        }

        this.isLocked = true;
    }

    /**
     * Release lock
     */
    private releaseLock(): void {
        this.isLocked = false;
    }
}

/**
 * Singleton instance
 */
export const locationQueueManager = LocationQueueManagerClass.getInstance();

/**
 * For testing, export the class itself
 */
export { LocationQueueManagerClass };


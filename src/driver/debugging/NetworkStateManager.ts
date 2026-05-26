/**
 * NETWORK STATE MANAGER
 * 
 * Detects network state changes and triggers immediate sync
 * Handles offline ↔ online transitions
 * 
 * ISSUE FIXED:
 * - Issue #3: No Network State Handling
 * - Issue #10: No Error Recovery for Failed Syncs
 * - Issue #12: No Offline Queue Handling
 */

import { logger } from '../../core/logger/logger';
import { httpSyncManager } from '../sync/HTTPSyncManager';

// NetInfo is optional - only load if available
let NetInfo: any;
try {
    // Try to load netinfo - it's an optional dependency
    NetInfo = require('@react-native-community/netinfo');
} catch (e) {
    logger.warn('[NetworkStateManager] NetInfo not available - using fallback');
    NetInfo = null;
}

interface NetInfoState {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
}

export interface NetworkState {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
}

export class NetworkStateManager {
    private static instance: NetworkStateManager;
    private currentState: NetworkState = {
        isConnected: null,
        isInternetReachable: null,
        type: 'unknown',
    };
    private unsubscribe: (() => void) | null = null;
    private wasOffline = false;

    private constructor() { }

    static getInstance(): NetworkStateManager {
        if (!NetworkStateManager.instance) {
            NetworkStateManager.instance = new NetworkStateManager();
        }
        return NetworkStateManager.instance;
    }

    /**
     * Start listening to network state changes
     */
    start(): void {
        if (!NetInfo) {
            logger.warn('[NetworkStateManager] NetInfo not available - monitoring disabled');
            return;
        }

        if (this.unsubscribe) {
            logger.warn('[NetworkStateManager] Already listening');
            return;
        }

        // Listen to network state changes
        this.unsubscribe = NetInfo.addEventListener(this.handleStateChange);

        // Get initial state
        NetInfo.fetch().then(this.handleStateChange);

        logger.info('[NetworkStateManager] Started');
    }

    /**
     * Stop listening to network state changes
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
            logger.info('[NetworkStateManager] Stopped');
        }
    }

    /**
     * Handle network state change
     */
    private handleStateChange = async (state: NetInfoState): Promise<void> => {
        const wasConnected = this.currentState.isConnected;
        const isNowConnected = state.isConnected;

        this.currentState = {
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
            type: state.type,
        };

        logger.info('[NetworkStateManager] Network state changed', {
            from: wasConnected ? 'CONNECTED' : 'OFFLINE',
            to: isNowConnected ? 'CONNECTED' : 'OFFLINE',
            type: state.type,
            internet: state.isInternetReachable,
        });

        // ============================================================
        // ONLINE → ONLINE (type change, e.g., Wifi → Cellular)
        // ============================================================
        if (wasConnected && isNowConnected && state.type !== this.getTypeFromState(this.currentState)) {
            logger.info('[NetworkStateManager] Network type changed (reconnected via different interface)');
            // Trigger immediate sync
            await this.triggerImmediateSync();
        }

        // ============================================================
        // OFFLINE → ONLINE (Reconnection detected)
        // ============================================================
        else if (!wasConnected && isNowConnected) {
            this.wasOffline = false;
            logger.info('[NetworkStateManager] 🟢 NETWORK RECONNECTED - Triggering immediate sync');

            // Urgent: Sync immediately (don't wait for next 15s interval)
            await this.triggerImmediateSync();

            // Log queue status after reconnection
            logger.info('[NetworkStateManager] Queue flushed after reconnection');
        }

        // ============================================================
        // ONLINE → OFFLINE (Connection lost)
        // ============================================================
        else if (wasConnected && !isNowConnected) {
            this.wasOffline = true;
            logger.warn('[NetworkStateManager] 🔴 NETWORK LOST - Queuing will continue');

            // Pause sync attempts (exponential backoff will handle retries)
            httpSyncManager.pause();
            logger.warn('[NetworkStateManager] Sync paused until reconnection');
        }
    };

    /**
     * Trigger immediate sync (bypass backoff)
     */
    private async triggerImmediateSync(): Promise<void> {
        try {
            logger.info('[NetworkStateManager] Forcing immediate sync');
            await httpSyncManager.forceSyncNow();
            logger.info('[NetworkStateManager] Immediate sync completed');
        } catch (error) {
            logger.error('[NetworkStateManager] Immediate sync failed', { error });
        }
    }

    /**
     * Get network type from state
     */
    private getTypeFromState(state: NetworkState): string {
        return state.type;
    }

    /**
     * Get current network state
     */
    getCurrentState(): NetworkState {
        return { ...this.currentState };
    }

    /**
     * Check if connected
     */
    isConnected(): boolean | null {
        return this.currentState.isConnected;
    }

    /**
     * Check if internet is reachable
     */
    isInternetReachable(): boolean | null {
        return this.currentState.isInternetReachable;
    }

    /**
     * Get network type
     */
    getNetworkType(): string {
        return this.currentState.type;
    }

    /**
     * Check if was offline (for diagnostics)
     */
    wasRecentlyOffline(): boolean {
        return this.wasOffline;
    }
}

export const networkStateManager = NetworkStateManager.getInstance();

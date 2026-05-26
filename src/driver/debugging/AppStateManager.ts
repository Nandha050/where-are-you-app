/**
 * APP STATE LIFECYCLE MANAGER
 * 
 * Handles foreground ↔ background transitions
 * Manages pause/resume of tracking services
 * 
 * ISSUE FIXED:
 * - Issue #1: Missing AppState Lifecycle Management
 * - Issue #5: SyncInterval Running in Background
 * - Issue #7: No Cleanup on Background Transition
 */

import { AppState, AppStateStatus } from 'react-native';
import { logger } from '../../core/logger/logger';
import { httpSyncManager } from '../sync/HTTPSyncManager';
import { backgroundLocationService } from '../tracking/BackgroundLocationService';

export interface AppStateListenerConfig {
    onBackgrounded?: () => Promise<void>;
    onForegrounded?: () => Promise<void>;
}

export class AppStateManager {
    private static instance: AppStateManager;
    private currentState: AppStateStatus = 'active';
    private appStateSubscription: any = null;
    private config: AppStateListenerConfig = {};
    private isPaused = false;

    private constructor() { }

    static getInstance(): AppStateManager {
        if (!AppStateManager.instance) {
            AppStateManager.instance = new AppStateManager();
        }
        return AppStateManager.instance;
    }

    /**
     * Start listening to app state changes
     */
    start(config?: AppStateListenerConfig): void {
        if (this.appStateSubscription) {
            logger.warn('[AppStateManager] Already listening');
            return;
        }

        this.config = config || {};

        this.appStateSubscription = AppState.addEventListener(
            'change',
            this.handleAppStateChange
        );

        // Get current state
        this.currentState = AppState.currentState || 'active';
        logger.info('[AppStateManager] Started', { currentState: this.currentState });
    }

    /**
     * Stop listening to app state changes
     */
    stop(): void {
        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
            logger.info('[AppStateManager] Stopped');
        }
    }

    /**
     * Handle app state change
     */
    private handleAppStateChange = async (nextAppState: AppStateStatus): Promise<void> => {
        const previousState = this.currentState;
        this.currentState = nextAppState;

        logger.info('[AppStateManager] State changed', {
            from: previousState,
            to: nextAppState,
        });

        try {
            if (previousState === 'active' && nextAppState.match(/inactive|background/)) {
                // App going background
                await this.onBackgrounded();
            } else if (previousState.match(/inactive|background/) && nextAppState === 'active') {
                // App coming to foreground
                await this.onForegrounded();
            }
        } catch (error) {
            logger.error('[AppStateManager] State change handler error', { error });
        }
    };

    /**
     * Handle app backgrounding
     */
    private onBackgrounded = async (): Promise<void> => {
        logger.info('[AppStateManager] ▼ APP BACKGROUNDED');

        try {
            // 1. Pause foreground location watch
            backgroundLocationService.stopForeground();
            logger.debug('[AppStateManager] Foreground watch paused');

            // 2. Pause HTTP sync timer (background task continues)
            this.pauseSyncTimer();
            logger.debug('[AppStateManager] Sync timer paused');

            // 3. Force immediate sync before backgrounding
            await httpSyncManager.forceSyncNow();
            logger.debug('[AppStateManager] Final sync before background');

            // 4. Custom handler
            if (this.config.onBackgrounded) {
                await this.config.onBackgrounded();
            }

            this.isPaused = true;
            logger.info('[AppStateManager] Background handling complete');
        } catch (error) {
            logger.error('[AppStateManager] Background handling failed', { error });
        }
    };

    /**
     * Handle app foregrounding
     */
    private onForegrounded = async (): Promise<void> => {
        logger.info('[AppStateManager] ▲ APP FOREGROUNDED');

        try {
            // 1. Resume foreground location watch
            await backgroundLocationService.startForeground();
            logger.debug('[AppStateManager] Foreground watch resumed');

            // 2. Resume HTTP sync timer
            this.resumeSyncTimer();
            logger.debug('[AppStateManager] Sync timer resumed');

            // 3. Trigger immediate sync to catch up
            await httpSyncManager.forceSyncNow();
            logger.debug('[AppStateManager] Immediate sync after foreground');

            // 4. Custom handler
            if (this.config.onForegrounded) {
                await this.config.onForegrounded();
            }

            this.isPaused = false;
            logger.info('[AppStateManager] Foreground handling complete');
        } catch (error) {
            logger.error('[AppStateManager] Foreground handling failed', { error });
        }
    };

    /**
     * Pause sync timer (called when backgrounding)
     */
    private pauseSyncTimer(): void {
        // Signal to HTTPSyncManager to pause
        // This will be intercepted by HTTPSyncManager.pause()
        httpSyncManager.pause?.();
    }

    /**
     * Resume sync timer (called when foregrounding)
     */
    private resumeSyncTimer(): void {
        // Signal to HTTPSyncManager to resume
        // This will be intercepted by HTTPSyncManager.resume()
        httpSyncManager.resume?.();
    }

    /**
     * Check if currently paused
     */
    isPausedState(): boolean {
        return this.isPaused;
    }

    /**
     * Get current app state
     */
    getCurrentState(): AppStateStatus {
        return this.currentState;
    }

    /**
     * Check if app is in foreground
     */
    isInForeground(): boolean {
        return this.currentState === 'active';
    }

    /**
     * Check if app is backgrounded
     */
    isBackgrounded(): boolean {
        return this.currentState.match(/inactive|background/) !== null;
    }
}

export const appStateManager = AppStateManager.getInstance();

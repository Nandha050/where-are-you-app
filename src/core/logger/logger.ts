/**
 * Logging Service
 * 
 * Centralized logging with Sentry integration for error tracking.
 * Used throughout the app for debugging and monitoring.
 */

import * as Sentry from '@sentry/react-native';
import { LOGGING_CONFIG } from '../../config/constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    [key: string]: unknown;
}

class Logger {
    private static instance: Logger | null = null;

    private constructor() { }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Log debug message
     */
    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    /**
     * Log info message
     */
    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    /**
     * Log warning message
     */
    warn(message: string, context?: LogContext): void {
        this.log('warn', message, context);
    }

    /**
     * Log error message
     */
    error(message: string, context?: LogContext): void {
        this.log('error', message, context);

        // Also capture in Sentry for error tracking
        if (LOGGING_CONFIG.ENABLE_SENTRY) {
            Sentry.captureException(new Error(message), {
                extra: context,
            });
        }
    }

    /**
     * Capture exception with context
     */
    captureException(error: Error, context?: LogContext): void {
        this.error(error.message, context);

        if (LOGGING_CONFIG.ENABLE_SENTRY) {
            Sentry.captureException(error, {
                extra: context,
                tags: {
                    area: 'location-tracking',
                },
            });
        }
    }

    /**
     * Add breadcrumb for tracking user actions
     */
    addBreadcrumb(message: string, category: string, data?: LogContext): void {
        if (LOGGING_CONFIG.ENABLE_SENTRY) {
            Sentry.addBreadcrumb({
                message,
                category,
                data,
            });
        }

        if (LOGGING_CONFIG.ENABLE_CONSOLE_LOGS) {
            console.log(`[${category}] ${message}`, data ?? '');
        }
    }

    /**
     * Start performance monitoring
     */
    startSpan(operation: string, description: string): any {
        if (LOGGING_CONFIG.ENABLE_SENTRY) {
            return Sentry.startSpan({
                op: operation,
                name: description,
            }, () => { });
        }
        return null;
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    private log(
        level: LogLevel,
        message: string,
        context?: LogContext
    ): void {
        if (!LOGGING_CONFIG.ENABLE_CONSOLE_LOGS) {
            return;
        }

        const timestamp = new Date().toISOString();
        const contextStr = context ? JSON.stringify(context) : '';

        switch (level) {
            case 'debug':
                console.debug(`[${timestamp}] ${message}`, contextStr);
                break;
            case 'info':
                console.info(`[${timestamp}] ${message}`, contextStr);
                break;
            case 'warn':
                console.warn(`[${timestamp}] ${message}`, contextStr);
                break;
            case 'error':
                console.error(`[${timestamp}] ${message}`, contextStr);
                break;
        }
    }
}

export const logger = Logger.getInstance();

/**
 * Example: Driver Tracking Screen with Redis Cache Integration
 * 
 * Complete example showing how to integrate the Redis cache system
 * into a driver's trip tracking screen
 */

import { API_BASE_URL } from '@/api/client';
import { Button } from '@/components/Button';
import { useAuth } from '@/hooks/useAuth';
import {
    CacheMonitoring,
    useCacheTracking
} from '@/src/driver/cache';
import { useDriverTracking } from '@/src/driver/hooks/useDriverTracking';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';

interface DriverTrackingScreenProps {
    trip: any; // Your trip type
}

/**
 * Complete driver tracking screen with cache monitoring
 */
export function DriverTrackingScreenWithCache({
    trip,
}: DriverTrackingScreenProps) {
    const { user, token } = useAuth();
    const driverTracking = useDriverTracking(API_BASE_URL);
    const cacheMonitor = useCacheTracking();

    const [tripStarted, setTripStarted] = useState(false);
    const [healthReport, setHealthReport] = useState(
        CacheMonitoring.getHealthReport()
    );

    /**
     * Start trip and location tracking
     */
    const handleStartTrip = useCallback(async () => {
        try {
            if (!user?.id || !trip?.busId || !trip?._id) {
                Alert.alert('Error', 'Missing driver, bus, or trip information');
                return;
            }

            // Start tracking with driver identifiers
            await driverTracking.startTracking(
                user.id,      // driverId
                trip.busId,   // busId
                trip._id      // tripId
            );

            setTripStarted(true);
            Alert.alert('Success', '✅ Location tracking started');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Alert.alert('Error', `Failed to start tracking: ${message}`);
        }
    }, [user, trip, driverTracking]);

    /**
     * Stop trip and location tracking
     */
    const handleStopTrip = useCallback(async () => {
        try {
            await driverTracking.stopTracking();
            setTripStarted(false);
            Alert.alert('Success', '✅ Location tracking stopped');

            // Log final stats
            const finalReport = CacheMonitoring.getHealthReport();
            console.log('Final Cache Stats:', finalReport);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Alert.alert('Error', `Failed to stop tracking: ${message}`);
        }
    }, [driverTracking]);

    /**
     * Force immediate sync
     */
    const handleForceSyncNow = useCallback(async () => {
        try {
            await driverTracking.forceSyncNow();
            Alert.alert('Success', '✅ Immediate sync completed');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Alert.alert('Error', `Sync failed: ${message}`);
        }
    }, [driverTracking]);

    /**
     * Update health report periodically
     */
    useEffect(() => {
        const interval = setInterval(() => {
            setHealthReport(CacheMonitoring.getHealthReport());
        }, 5000); // Update every 5 seconds

        return () => clearInterval(interval);
    }, []);

    /**
     * Log cache stats periodically when tracking
     */
    useEffect(() => {
        if (!tripStarted) return;

        const logInterval = setInterval(() => {
            CacheMonitoring.logCacheStats('Periodic Check');
        }, 30000); // Every 30 seconds

        return () => clearInterval(logInterval);
    }, [tripStarted]);

    const stats = cacheMonitor.cacheStats;
    const health = healthReport;
    const statusColor =
        health.status === 'healthy'
            ? '#4CAF50'
            : health.status === 'degraded'
                ? '#FF9800'
                : '#F44336';

    return (
        <ScrollView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.title}>Driver Trip Tracking</Text>
                <Text style={styles.tripInfo}>Trip: {trip?.busId}</Text>
                <Text style={styles.driverId}>Driver: {user?.id}</Text>
            </View>

            {/* Status Section */}
            <View style={styles.statusSection}>
                <View
                    style={[
                        styles.statusBadge,
                        { backgroundColor: tripStarted ? '#4CAF50' : '#9E9E9E' },
                    ]}
                >
                    <Text style={styles.statusText}>
                        {tripStarted ? '🟢 Tracking Active' : '⚫ Standby'}
                    </Text>
                </View>
            </View>

            {/* Control Buttons */}
            <View style={styles.buttonGroup}>
                <Button
                    title={tripStarted ? '⏹️ Stop Trip' : '▶️ Start Trip'}
                    onPress={tripStarted ? handleStopTrip : handleStartTrip}
                    disabled={!user?.id || !trip}
                />
                <Button
                    title="🔄 Force Sync Now"
                    onPress={handleForceSyncNow}
                    disabled={!tripStarted}
                    secondary
                />
            </View>

            {/* Cache Health Status */}
            <View style={[styles.card, { borderLeftColor: statusColor }]}>
                <Text style={styles.cardTitle}>📊 Cache Health</Text>
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Status:</Text>
                    <Text style={[styles.value, { color: statusColor }]}>
                        {health.status.toUpperCase()}
                    </Text>
                </View>

                {health.warnings.length > 0 && (
                    <View style={styles.warningBox}>
                        <Text style={styles.warningTitle}>⚠️ Warnings:</Text>
                        {health.warnings.map((w, i) => (
                            <Text key={i} style={styles.warningText}>
                                • {w}
                            </Text>
                        ))}
                    </View>
                )}
            </View>

            {/* Batch Statistics */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>📦 Batch Statistics</Text>

                <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Batches Sent</Text>
                        <Text style={styles.statValue}>{stats.totalBatchesSent}</Text>
                    </View>

                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Locations</Text>
                        <Text style={styles.statValue}>
                            {stats.totalLocationsProcessed}
                        </Text>
                    </View>

                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Avg Latency</Text>
                        <Text style={styles.statValue}>{stats.averageBatchLatency}ms</Text>
                    </View>

                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Rate Limit</Text>
                        <Text
                            style={[
                                styles.statValue,
                                cacheMonitor.rateLimitStatus.limited && styles.rateLimitWarning,
                            ]}
                        >
                            {cacheMonitor.rateLimitStatus.remaining}/10
                        </Text>
                    </View>
                </View>
            </View>

            {/* Queue Status */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>📍 Queue Status</Text>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Queue Size:</Text>
                    <Text style={styles.value}>{driverTracking.queueStats.totalItems}</Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Oldest Item:</Text>
                    <Text style={styles.value}>
                        {driverTracking.queueStats.oldestItemAge
                            ? `${(driverTracking.queueStats.oldestItemAge / 1000).toFixed(1)}s ago`
                            : 'N/A'}
                    </Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Pending Retries:</Text>
                    <Text style={styles.value}>
                        {driverTracking.queueStats.pendingRetries}
                    </Text>
                </View>
            </View>

            {/* Sync Status */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>🔄 Sync Status</Text>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Active Sync:</Text>
                    <Text style={styles.value}>
                        {driverTracking.isSyncing ? '⏳ In Progress' : '✅ Idle'}
                    </Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Last Sync:</Text>
                    <Text style={styles.value}>
                        {driverTracking.syncStats.lastSyncTime
                            ? new Date(driverTracking.syncStats.lastSyncTime).toLocaleTimeString()
                            : 'Never'}
                    </Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Failed Attempts:</Text>
                    <Text style={styles.value}>
                        {driverTracking.syncStats.failedAttempts}
                    </Text>
                </View>
            </View>

            {/* Cache Keys Reference */}
            {tripStarted && (
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>🔑 Redis Cache Keys</Text>
                    <Text style={styles.subtitle}>
                        View these in RedisInsight to monitor caching:
                    </Text>

                    <View style={styles.codeBlock}>
                        <Text style={styles.codeText}>
                            location:driver_{'\n'}
                            {user?.id?.slice(0, 8)}...
                        </Text>
                    </View>

                    <View style={styles.codeBlock}>
                        <Text style={styles.codeText}>
                            location:bus_{'\n'}
                            {trip?.busId?.slice(0, 8)}...
                        </Text>
                    </View>

                    <View style={styles.codeBlock}>
                        <Text style={styles.codeText}>
                            location:trip_{'\n'}
                            {trip?._id?.slice(0, 8)}...
                        </Text>
                    </View>
                </View>
            )}

            {/* Recommendations */}
            {health.recommendations.length > 0 && (
                <View style={[styles.card, styles.recommendationCard]}>
                    <Text style={styles.cardTitle}>💡 Recommendations</Text>
                    {health.recommendations.map((rec, i) => (
                        <Text key={i} style={styles.recommendationText}>
                            • {rec}
                        </Text>
                    ))}
                </View>
            )}

            {/* Error Display */}
            {driverTracking.error && (
                <View style={styles.errorCard}>
                    <Text style={styles.errorTitle}>❌ Error</Text>
                    <Text style={styles.errorText}>{driverTracking.error}</Text>
                </View>
            )}

            {/* Footer */}
            <View style={styles.footer}>
                <Text style={styles.footerText}>
                    Last Updated: {new Date().toLocaleTimeString()}
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
        padding: 12,
    },
    header: {
        marginBottom: 16,
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 8,
        elevation: 2,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    tripInfo: {
        fontSize: 14,
        color: '#666',
        marginBottom: 4,
    },
    driverId: {
        fontSize: 14,
        color: '#666',
    },
    statusSection: {
        marginBottom: 16,
    },
    statusBadge: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    buttonGroup: {
        marginBottom: 16,
        gap: 8,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        elevation: 1,
        borderLeftWidth: 4,
        borderLeftColor: '#2196F3',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
        color: '#333',
    },
    subtitle: {
        fontSize: 12,
        color: '#666',
        marginBottom: 8,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    statItem: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: '#f9f9f9',
        padding: 12,
        borderRadius: 6,
        alignItems: 'center',
    },
    statLabel: {
        fontSize: 12,
        color: '#666',
        marginBottom: 4,
    },
    statValue: {
        fontSize: 18,
        fontWeight: '700',
        color: '#333',
    },
    rateLimitWarning: {
        color: '#F44336',
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    label: {
        fontSize: 14,
        color: '#666',
        fontWeight: '500',
    },
    value: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    warningBox: {
        backgroundColor: '#FFF3E0',
        padding: 12,
        borderRadius: 6,
        marginTop: 12,
        borderLeftWidth: 3,
        borderLeftColor: '#FF9800',
    },
    warningTitle: {
        color: '#E65100',
        fontWeight: '600',
        marginBottom: 4,
    },
    warningText: {
        color: '#E65100',
        fontSize: 12,
        marginBottom: 2,
    },
    codeBlock: {
        backgroundColor: '#f5f5f5',
        padding: 12,
        borderRadius: 6,
        marginBottom: 8,
        borderLeftWidth: 3,
        borderLeftColor: '#4CAF50',
    },
    codeText: {
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#333',
    },
    recommendationCard: {
        borderLeftColor: '#FFC107',
    },
    recommendationText: {
        fontSize: 13,
        color: '#F57F17',
        marginBottom: 4,
        lineHeight: 18,
    },
    errorCard: {
        backgroundColor: '#FFEBEE',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#F44336',
    },
    errorTitle: {
        color: '#C62828',
        fontWeight: '600',
        marginBottom: 4,
    },
    errorText: {
        color: '#C62828',
        fontSize: 12,
    },
    footer: {
        padding: 12,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#eee',
        marginTop: 16,
    },
    footerText: {
        fontSize: 12,
        color: '#999',
    },
});

export default DriverTrackingScreenWithCache;

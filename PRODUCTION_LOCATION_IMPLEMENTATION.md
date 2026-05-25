# Production Location Tracking - Implementation Guide

## Quick Start

This guide shows how to integrate the production-grade location tracking system into your React Native app.

### Step 1: Install Dependencies

```bash
npx expo install expo-location expo-task-manager expo-notifications
npm install zustand axios @react-native-async-storage/async-storage expo-secure-store uuid
npm install -D @types/react-native
```

### Step 2: Initialize Services

```typescript
// src/services/locationInit.ts

import { locationService } from '../features/location/services/LocationService';
import { permissionService } from '../features/location/services/PermissionService';
import { locationQueueManager } from '../features/location/services/LocationQueueManager';
import { apiSyncManager } from '../features/location/services/APISyncManager';
import { backgroundLocationTask } from '../features/location/background/backgroundLocationTask';
import { logger } from '../core/logger/logger';

export async function initializeLocationTracking() {
  try {
    logger.info('Initializing location tracking system');

    // Check permissions
    const permissions = await permissionService.checkPermissions();
    logger.info('Permission check:', { permissions });

    // Initialize background task
    await backgroundLocationTask.start(
      authToken,
      busId,
      driverId
    );

    logger.info('Location tracking initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize location tracking', { error });
  }
}
```

### Step 3: Create Zustand Store

```typescript
// src/features/location/store/locationStore.ts

import { create } from 'zustand';
import { LocationStore, TrackingState, LocationUpdate, BatteryInfo, QueueStats } from '../api/types';
import { DEFAULT_TRACKING_CONFIG } from '../../config/constants';

export const useLocationStore = create<LocationStore>((set, get) => ({
  // State
  currentLocation: null,
  lastLocation: null,
  trackingState: 'idle' as TrackingState,
  trackingConfig: DEFAULT_TRACKING_CONFIG,
  batteryInfo: { level: 100, state: 'unknown', isLowPowerMode: false },
  queueStats: { size: 0, oldestItemAge: 0, pendingRetries: 0, estimatedSize: 0 },
  syncState: { status: 'idle', consecutiveFailures: 0 },
  geofences: [],
  geofenceStates: new Map(),
  errors: [],

  // Actions
  setCurrentLocation: (location: LocationUpdate) => set({ currentLocation: location }),
  setTrackingState: (state: TrackingState) => set({ trackingState: state }),
  updateBatteryInfo: (info: BatteryInfo) => set({ batteryInfo: info }),
  updateQueueStats: (stats: QueueStats) => set({ queueStats: stats }),
  updateSyncState: (state) => set((prev) => ({ syncState: { ...prev.syncState, ...state } })),
  addGeofence: (geofence) => set((prev) => ({ geofences: [...prev.geofences, geofence] })),
  removeGeofence: (id: string) => set((prev) => ({
    geofences: prev.geofences.filter((g) => g.id !== id),
  })),
  updateGeofenceState: (id, state) => set((prev) => {
    const newMap = new Map(prev.geofenceStates);
    newMap.set(id, state);
    return { geofenceStates: newMap };
  }),
  addError: (error) => set((prev) => ({
    errors: [...prev.errors, error].slice(-50), // Keep last 50
  })),
  clearErrors: () => set({ errors: [] }),
}));
```

### Step 4: Create Custom Hooks

```typescript
// src/features/location/hooks/useTracking.ts

import { useEffect, useCallback } from 'react';
import { useLocationStore } from '../store/locationStore';
import { locationService } from '../services/LocationService';
import { permissionService } from '../services/PermissionService';
import { backgroundLocationTask } from '../background/backgroundLocationTask';
import { logger } from '../../core/logger/logger';

export function useTracking() {
  const store = useLocationStore();

  const startTracking = useCallback(async (token: string, busId: string, driverId: string) => {
    try {
      store.setTrackingState('initializing');

      // Check permissions
      const permissions = await permissionService.checkPermissions();
      if (!permissions.foreground || !permissions.servicesEnabled) {
        const result = await permissionService.requestPermissions({
          foreground: true,
          background: true,
        });

        if (!result.foreground) {
          store.setTrackingState('idle');
          store.addError({
            code: 'PERMISSION_DENIED',
            message: 'Location permission required',
            timestamp: Date.now(),
          });
          return false;
        }
      }

      // Start foreground tracking
      const success = await locationService.startTracking();
      if (!success) {
        store.setTrackingState('idle');
        return false;
      }

      // Start background tracking
      const bgSuccess = await backgroundLocationTask.start(token, busId, driverId);
      if (!bgSuccess) {
        logger.warn('Background tracking failed, continuing with foreground');
      }

      // Subscribe to location updates
      const unsubscribe = locationService.subscribe((location) => {
        store.setCurrentLocation(location);
      });

      store.setTrackingState('active');
      return true;
    } catch (error) {
      logger.error('Failed to start tracking', { error });
      store.setTrackingState('idle');
      return false;
    }
  }, [store]);

  const stopTracking = useCallback(async () => {
    try {
      store.setTrackingState('stopped');
      await locationService.stopTracking();
      await backgroundLocationTask.stop();
    } catch (error) {
      logger.error('Failed to stop tracking', { error });
    }
  }, [store]);

  return {
    trackingState: store.trackingState,
    currentLocation: store.currentLocation,
    startTracking,
    stopTracking,
  };
}
```

### Step 5: Use in Component

```typescript
// app/(driver)/tracking.tsx

import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useTracking } from '../../src/features/location/hooks/useTracking';

export default function TrackingScreen() {
  const { trackingState, currentLocation, startTracking, stopTracking } = useTracking();

  useEffect(() => {
    // Start tracking when component mounts
    startTracking(authToken, busId, driverId);

    // Cleanup
    return () => {
      stopTracking();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Text>Tracking State: {trackingState}</Text>

      {currentLocation && (
        <Text>
          Location: {currentLocation.latitude}, {currentLocation.longitude}
        </Text>
      )}

      {trackingState === 'active' && <ActivityIndicator />}
    </View>
  );
}
```

---

## Architecture Implementation Details

### Service Layer Architecture

```
┌─ Custom Hook (useTracking)
│
├─ LocationService (Foreground)
│  ├─ Location.watchPositionAsync()
│  ├─ Duplicate filtering
│  └─ Update subscribers
│
├─ BackgroundLocationTask (Background)
│  ├─ TaskManager
│  ├─ Offline queue
│  └─ HTTP sync
│
├─ PermissionService
│  ├─ Request permissions
│  └─ Check status
│
├─ LocationQueueManager
│  ├─ AsyncStorage persistence
│  ├─ Deduplication
│  └─ Size management
│
└─ APISyncManager
   ├─ Retry logic
   ├─ Exponential backoff
   └─ Batch optimization
```

### Data Flow

1. **Foreground**: User actively tracking
   - LocationService gets updates via Location.watchPositionAsync()
   - Filters duplicates
   - Notifies subscribers
   - APISyncManager uploads immediately

2. **Background**: App minimized/suspended
   - BackgroundLocationTask receives updates via TaskManager
   - Checks if tracking enabled
   - Filters duplicates
   - Attempts HTTP upload
   - Queues failures

3. **Offline**: No network
   - All locations queued to AsyncStorage
   - APISyncManager retries with exponential backoff
   - When network returns, flushes queue

### Critical Implementation Points

#### Permission Flow

```typescript
// 1. Request foreground (required for both platforms)
const fg = await Location.requestForegroundPermissionsAsync();

// 2. Request background
const bg = await Location.requestBackgroundPermissionsAsync();

// 3. Android fails if no background - iOS continues
if (Platform.OS === 'android' && !bg.granted) {
  // Can't track in background
  return false;
}

// 4. Check location services enabled
const enabled = await Location.hasServicesEnabledAsync();
if (!enabled) {
  // Prompt user to enable
}
```

#### Foreground Service (Android)

```typescript
// Required for Android 8+ to run in background
await Location.startLocationUpdatesAsync(TASK_NAME, {
  foregroundService: {
    notificationTitle: 'Live Tracking',
    notificationBody: 'Your location is being shared',
    notificationColor: '#1d4ed8',
  },
});

// Notification is required by OS - can't hide it
```

#### iOS Background Configuration

```typescript
// In app.config.js, Info.plist:
ios: {
  infoPlist: {
    NSLocationWhenInUseUsageDescription: '...',
    NSLocationAlwaysAndWhenInUseUsageDescription: '...',
    UIBackgroundModes: ['location'], // Critical!
  },
}
```

#### Offline-First Queue

```typescript
// All network failures are queued
try {
  await api.post('/location', location);
} catch {
  // Queue for retry
  await locationQueueManager.enqueue(location);
  // Later, when network returns
  await apiSyncManager.syncQueue();
}
```

---

## Platform-Specific Configuration

### Android manifest.xml (Auto-generated from app.config.js)

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<service android:name="com.facebook.react.modules.location.LocationModule" />
```

### iOS Info.plist (Auto-generated from app.config.js)

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to track the bus in real-time</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We need your location to track the bus even when the app is in the background</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

---

## Testing Strategy

### Unit Tests

```typescript
// Test LocationService filtering
describe('LocationService', () => {
  it('should filter duplicate locations', async () => {
    const location1 = { lat: 12.0, lng: 77.0, timestamp: 1000 };
    const location2 = { lat: 12.0001, lng: 77.0, timestamp: 1100 };

    // Should skip if distance < 5m and time < 5s
    const result = await locationService.shouldProcess(location2);
    expect(result).toBe(false);
  });
});

// Test APISyncManager retry
describe('APISyncManager', () => {
  it('should retry with exponential backoff', async () => {
    const spy = jest.spyOn(axiosInstance, 'post');
    spy.mockRejectedValue(new Error('Network error'));

    await apiSyncManager.sync(location);

    expect(spy).toHaveBeenCalledTimes(8); // Max retries
  });
});
```

### Integration Tests

```typescript
// Test full flow
describe('Location Tracking Flow', () => {
  it('should track location through entire pipeline', async () => {
    // 1. Start tracking
    await locationService.startTracking();

    // 2. Simulate location update
    await simulateLocationUpdate({ lat: 12.0, lng: 77.0 });

    // 3. Verify sync
    expect(await apiSyncManager.getMetrics().successfulUploads).toBe(1);

    // 4. Verify store updated
    expect(useLocationStore.getState().currentLocation).toBeDefined();
  });
});
```

### Device Testing

```bash
# Android: View logs
adb logcat | grep "BackgroundTask"

# Android: Simulate background
adb shell am set-idle --reset com.example.app

# iOS: Check background mode
Xcode → Capabilities → Background Modes → Location

# Both: Test offline
- Disable WiFi
- Verify queue fills
- Re-enable WiFi
- Verify queue flushes
```

---

## Monitoring & Debugging

### Key Metrics to Monitor

```typescript
// Track in Sentry
const metrics = apiSyncManager.getMetrics();
Sentry.captureMessage('Location Tracking Health', {
  tags: {
    successRate: metrics.successfulUploads / (metrics.successfulUploads + metrics.failedUploads),
    avgLatency: metrics.averageLatency,
    queueSize: queueStats.size,
  },
});
```

### Enable Debug Logging

```typescript
// In app initialization
if (__DEV__) {
  locationService.setDebugMode(true);
  apiSyncManager.setDebugMode(true);
  // Check console for detailed logs
}
```

### Check Background Task Status

```typescript
// Check if background task is running
const running = await backgroundLocationTask.isRunning();
console.log('Background tracking active:', running);

// Get queue stats
const stats = await locationQueueManager.getStats();
console.log('Queue size:', stats.size);
console.log('Oldest item age:', stats.oldestItemAge);
```

---

## Deployment Checklist

### Before EAS Build

- [ ] All type definitions typed correctly
- [ ] Constants configured for production
- [ ] Sentry initialized for error tracking
- [ ] API endpoints point to production backend
- [ ] Permissions properly declared in app.config.js

### After Release

- [ ] Monitor Sentry for errors
- [ ] Check queue sizes (should stay low)
- [ ] Verify API sync success rate >95%
- [ ] Monitor battery drain (should be <2% per hour)
- [ ] Check background task execution frequency

---

## Common Issues & Solutions

### Issue: Background Task Not Starting

**Cause**: Permission not granted or location services disabled

**Solution**:
```typescript
// Explicitly request background permission
const result = await permissionService.requestPermissions({
  foreground: true,
  background: true,
});

// Check location services
const enabled = await Location.hasServicesEnabledAsync();
if (!enabled) {
  // Show prompt to enable
}
```

### Issue: Queue Growing Indefinitely

**Cause**: API sync failing, network issues

**Solution**:
```typescript
// Monitor queue size
const stats = await locationQueueManager.getStats();
if (stats.size > 100) {
  logger.warn('Queue growing, checking network');
  // Attempt manual flush
  await apiSyncManager.flushQueue();
}
```

### Issue: High Battery Drain

**Cause**: Tracking interval too frequent

**Solution**:
```typescript
// Increase intervals in production
locationService.updateConfig({
  foregroundTimeInterval: 10000, // 10s instead of 5s
  foregroundDistanceInterval: 10, // 10m instead of 5m
});

// Enable adaptive tracking
locationService.updateConfig({ enableAdaptiveTracking: true });
```

### Issue: iOS Background Tracking Unreliable

**Cause**: App suspension, iOS restrictions

**Solution**:
```typescript
// Accept lower frequency on iOS
if (Platform.OS === 'ios') {
  locationService.updateConfig({
    backgroundTimeInterval: 30000, // 30s for iOS
  });
}

// Use significant location updates fallback
// (already handled by Expo)
```

---

## Next Steps

1. **Integrate Zustand Store**: Implement full state management
2. **Add Geofencing**: Trigger alerts at specific locations
3. **Add Push Notifications**: Notify backend of events
4. **Implement Voice Alerts**: Audio feedback for driver
5. **Setup Monitoring Dashboard**: Real-time tracking metrics
6. **Performance Optimization**: Fine-tune for your use cases

This architecture provides a solid foundation that you can extend with additional features as needed.

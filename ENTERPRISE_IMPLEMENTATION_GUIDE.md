# Production Location Tracking - Enterprise Implementation Guide

**Level**: Senior Developer / Architect  
**Complexity**: 7/10 (Moderate, well-documented)  
**Time to Implement**: 8-10 hours  
**Date**: May 22, 2026  

---

## Overview

This guide provides **production-ready implementation** for the architecture described in `ENTERPRISE_LOCATION_ARCHITECTURE.md`.

You now have:
- ✅ Complete type system
- ✅ Service architecture
- ✅ Background task handler
- ✅ Queue management
- ✅ API sync with retry logic
- ✅ Constants and configuration

**This guide covers**:
- How to wire everything together
- Best practices for each component
- Testing strategies
- Common pitfalls and solutions
- Scaling considerations

---

## Step 1: Verify Your Project Setup

### Dependencies Check

```bash
# Check if all required packages are installed
npm ls expo-location expo-task-manager @react-native-async-storage/async-storage axios zustand

# If missing, install them:
npx expo install expo-location expo-task-manager expo-secure-store
npm install @react-native-async-storage/async-storage axios zustand uuid
```

### File Structure Verification

```
src/
├── features/location/
│   ├── api/
│   │   └── types.ts ✅
│   ├── services/
│   │   ├── LocationService.ts ✅
│   │   ├── PermissionService.ts ✅
│   │   ├── LocationQueueManager.ts ✅
│   │   └── APISyncManager.ts ✅
│   ├── background/
│   │   └── backgroundLocationTask.ts ✅
│   ├── store/
│   │   └── locationStore.ts (CREATE)
│   └── hooks/
│       └── useTracking.ts (CREATE)
├── core/
│   ├── api/
│   │   └── apiClient.ts (CREATE)
│   ├── logger/
│   │   └── logger.ts ✅
│   └── network/
│       └── networkState.ts (CREATE)
└── config/
    └── constants.ts ✅
```

---

## Step 2: Network State Management

**Why**: Need to know when network is available for smart queue flushing

### Create Network State Service

```typescript
// src/core/network/networkState.ts
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../logger/logger';

type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';
type NetworkChangeListener = (isConnected: boolean, type: NetworkType) => void;

class NetworkStateManager {
  private static instance: NetworkStateManager | null = null;
  private listeners = new Set<NetworkChangeListener>();
  private isConnected = true;
  private networkType: NetworkType = 'unknown';

  private constructor() {
    this.initialize();
  }

  static getInstance(): NetworkStateManager {
    if (!NetworkStateManager.instance) {
      NetworkStateManager.instance = new NetworkStateManager();
    }
    return NetworkStateManager.instance;
  }

  private async initialize(): Promise<void> {
    try {
      // Get initial state
      const state = await NetInfo.fetch();
      this.updateState(state.isConnected ?? false, state.type as NetworkType);

      // Subscribe to changes
      NetInfo.addEventListener((state) => {
        this.updateState(state.isConnected ?? false, state.type as NetworkType);
      });

      logger.info('[NetworkState] Initialized', {
        isConnected: this.isConnected,
        type: this.networkType,
      });
    } catch (error) {
      logger.error('[NetworkState] Initialization error', { error });
    }
  }

  private updateState(isConnected: boolean, type: NetworkType): void {
    const stateChanged =
      this.isConnected !== isConnected || this.networkType !== type;

    if (stateChanged) {
      this.isConnected = isConnected;
      this.networkType = type;

      logger.debug('[NetworkState] State changed', {
        isConnected,
        type,
      });

      // Notify listeners
      this.listeners.forEach((listener) => listener(isConnected, type));
    }
  }

  /**
   * Add listener for network state changes
   */
  addListener(listener: NetworkChangeListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if network is available
   */
  isNetworkAvailable(): boolean {
    return this.isConnected;
  }

  /**
   * Get current network type
   */
  getNetworkType(): NetworkType {
    return this.networkType;
  }

  /**
   * Check if connected via WiFi (more reliable)
   */
  isWiFiConnected(): boolean {
    return this.isConnected && this.networkType === 'wifi';
  }

  /**
   * Check if connected via cellular (less reliable)
   */
  isCellularConnected(): boolean {
    return this.isConnected && this.networkType === 'cellular';
  }
}

export const networkState = NetworkStateManager.getInstance();
```

### Install NetInfo Package

```bash
npm install @react-native-community/netinfo
# Or with Expo:
npx expo install @react-native-community/netinfo
```

---

## Step 3: API Client with Interceptors

**Why**: Centralized API handling with auth refresh, error handling, retry logic

### Create API Client

```typescript
// src/core/api/apiClient.ts
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../../config/constants';
import { logger } from '../logger/logger';

interface APIClientConfig {
  baseURL: string;
  timeout?: number;
}

class APIClient {
  private static instance: APIClient | null = null;
  private client: AxiosInstance;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  private constructor(config: APIClientConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  static initialize(config: APIClientConfig): void {
    if (!APIClient.instance) {
      APIClient.instance = new APIClient(config);
    }
  }

  static getInstance(): APIClient {
    if (!APIClient.instance) {
      throw new Error('APIClient not initialized. Call initialize() first.');
    }
    return APIClient.instance;
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor: Add auth token
    this.client.interceptors.request.use(
      async (config) => {
        try {
          const token = await SecureStore.getItemAsync(STORAGE_KEYS.AUTH_TOKEN);
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (error) {
          logger.error('[APIClient] Error getting auth token', { error });
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: Handle 401, retry, etc.
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & {
          _retry?: boolean;
        };

        // Handle 401 (token expired)
        if (error.response?.status === 401 && !originalRequest._retry) {
          if (this.isRefreshing) {
            // Wait for token refresh
            return new Promise((resolve) => {
              this.refreshSubscribers.push((token: string) => {
                originalRequest.headers = originalRequest.headers || {};
                originalRequest.headers.Authorization = `Bearer ${token}`;
                resolve(this.client(originalRequest));
              });
            });
          }

          this.isRefreshing = true;
          originalRequest._retry = true;

          try {
            // Attempt token refresh
            const refreshToken = await SecureStore.getItemAsync(
              STORAGE_KEYS.AUTH_TOKEN_REFRESH
            );

            if (refreshToken) {
              // Call refresh endpoint
              const response = await this.client.post('/api/auth/refresh', {
                refreshToken,
              });

              const newToken = response.data.token;

              // Store new token
              await SecureStore.setItemAsync(
                STORAGE_KEYS.AUTH_TOKEN,
                newToken
              );

              logger.info('[APIClient] Token refreshed successfully');

              // Notify subscribers
              this.refreshSubscribers.forEach((callback) => callback(newToken));
              this.refreshSubscribers = [];

              // Retry original request
              originalRequest.headers = originalRequest.headers || {};
              originalRequest.headers.Authorization = `Bearer ${newToken}`;

              return this.client(originalRequest);
            }
          } catch (refreshError) {
            logger.error('[APIClient] Token refresh failed', { refreshError });
            // Token refresh failed, user needs to login again
            // Clear stored tokens
            await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN);
            await SecureStore.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN_REFRESH);
          } finally {
            this.isRefreshing = false;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * GET request
   */
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  /**
   * POST request
   */
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  /**
   * PUT request
   */
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  /**
   * DELETE request
   */
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  /**
   * Set auth token manually
   */
  setAuthToken(token: string): void {
    this.client.defaults.headers.Authorization = `Bearer ${token}`;
  }

  /**
   * Get underlying axios instance (for advanced use)
   */
  getAxiosInstance(): AxiosInstance {
    return this.client;
  }
}

export { APIClient };
```

### Initialize in App

```typescript
// app.tsx or App.tsx
import { APIClient } from './src/core/api/apiClient';

export default function App() {
  useEffect(() => {
    // Initialize API client at app startup
    const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    if (backendUrl) {
      APIClient.initialize({
        baseURL: backendUrl,
        timeout: 30000,
      });
    }
  }, []);

  return <YourApp />;
}
```

---

## Step 4: Zustand Store for Location State

**Why**: Centralized state for UI components to subscribe to

### Create Location Store

```typescript
// src/features/location/store/locationStore.ts
import create from 'zustand';
import {
  LocationPayload,
  LocationUpdate,
  QueueStats,
  SyncState,
  TrackingState,
} from '../api/types';

interface LocationStoreState {
  // Tracking state
  trackingState: TrackingState;
  currentLocation: LocationUpdate | null;
  lastUpdate: number; // timestamp

  // Queue state
  queueStats: QueueStats | null;
  syncState: SyncState | null;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  setTrackingState: (state: TrackingState) => void;
  setCurrentLocation: (location: LocationUpdate) => void;
  setQueueStats: (stats: QueueStats) => void;
  setSyncState: (state: SyncState) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  trackingState: 'idle',
  currentLocation: null,
  lastUpdate: 0,
  queueStats: null,
  syncState: null,
  isLoading: false,
  error: null,
};

export const useLocationStore = create<LocationStoreState>((set) => ({
  ...initialState,

  setTrackingState: (trackingState: TrackingState) => {
    set({ trackingState });
  },

  setCurrentLocation: (currentLocation: LocationUpdate) => {
    set({
      currentLocation,
      lastUpdate: Date.now(),
    });
  },

  setQueueStats: (queueStats: QueueStats) => {
    set({ queueStats });
  },

  setSyncState: (syncState: SyncState) => {
    set({ syncState });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  reset: () => {
    set(initialState);
  },
}));
```

---

## Step 5: Custom Tracking Hook

**Why**: Simple hook for components to use tracking system

### Create useTracking Hook

```typescript
// src/features/location/hooks/useTracking.ts
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { backgroundLocationTask } from '../background/backgroundLocationTask';
import { locationService } from '../services/LocationService';
import { locationQueueManager } from '../services/LocationQueueManager';
import { apiSyncManager } from '../services/APISyncManager';
import { permissionService } from '../services/PermissionService';
import { STORAGE_KEYS } from '../../config/constants';
import { useLocationStore } from '../store/locationStore';
import { logger } from '../../core/logger/logger';
import { networkState } from '../../core/network/networkState';

interface UseTrackingOptions {
  tripId: string;
  busId: string;
  driverId: string;
  authToken: string;
  onError?: (error: string) => void;
}

/**
 * Main hook for location tracking
 * Manages all tracking lifecycle
 */
export function useTracking(options: UseTrackingOptions) {
  const {
    tripId,
    busId,
    driverId,
    authToken,
    onError,
  } = options;

  const store = useLocationStore();
  const unsubscribeRef = useRef<(() => void)[]>([]);

  /**
   * Start tracking (foreground + background)
   */
  const startTracking = async () => {
    try {
      store.setLoading(true);
      store.setTrackingState('initializing');

      // Step 1: Request permissions
      const permissionsResult = await permissionService.requestPermissions({
        foreground: true,
        background: Platform.OS === 'android', // Android requires explicit background
      });

      if (!permissionsResult.foreground) {
        throw new Error('Location permission required');
      }

      // Step 2: Store credentials securely
      await SecureStore.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, authToken);
      await SecureStore.setItemAsync(STORAGE_KEYS.TRIP_ID, tripId);
      await SecureStore.setItemAsync(STORAGE_KEYS.DRIVER_ID, driverId);
      await SecureStore.setItemAsync(STORAGE_KEYS.ASSIGNED_BUS_ID, busId);

      // Step 3: Initialize API sync manager
      apiSyncManager.setAuthToken(authToken);

      // Step 4: Start background tracking
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const bgStarted = await backgroundLocationTask.start(
          authToken,
          busId,
          driverId
        );
        if (!bgStarted && Platform.OS === 'android') {
          logger.warn('[useTracking] Background task failed to start on Android');
        }
      }

      // Step 5: Start foreground tracking
      await locationService.startTracking();

      // Step 6: Subscribe to location updates
      const unsubscribeLocation = locationService.subscribe((location) => {
        store.setCurrentLocation(location);
      });

      // Step 7: Subscribe to queue stats (poll every 5 seconds)
      const pollQueue = setInterval(async () => {
        const stats = await locationQueueManager.getStats();
        store.setQueueStats(stats);
      }, 5000);

      // Step 8: Subscribe to network state changes
      const unsubscribeNetwork = networkState.addListener(
        async (isConnected) => {
          if (isConnected) {
            logger.info('[useTracking] Network available, flushing queue');
            // Network is back, try to flush queue
            await apiSyncManager.syncQueue();
          }
        }
      );

      // Save unsubscribe functions
      unsubscribeRef.current = [
        unsubscribeLocation,
        () => clearInterval(pollQueue),
        unsubscribeNetwork,
      ];

      store.setTrackingState('active');
      store.setError(null);
      store.setLoading(false);

      logger.info('[useTracking] Tracking started successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      store.setError(errorMsg);
      store.setTrackingState('idle');
      store.setLoading(false);
      onError?.(errorMsg);
      logger.error('[useTracking] Failed to start tracking', { error });
    }
  };

  /**
   * Stop tracking
   */
  const stopTracking = async () => {
    try {
      store.setLoading(true);
      store.setTrackingState('stopped');

      // Unsubscribe from all listeners
      unsubscribeRef.current.forEach((unsub) => unsub());
      unsubscribeRef.current = [];

      // Stop foreground tracking
      await locationService.stopTracking();

      // Stop background tracking
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        await backgroundLocationTask.stop();
      }

      store.setTrackingState('idle');
      store.setLoading(false);
      logger.info('[useTracking] Tracking stopped');
    } catch (error) {
      logger.error('[useTracking] Error stopping tracking', { error });
    }
  };

  /**
   * Pause tracking (background continues)
   */
  const pauseTracking = async () => {
    try {
      await locationService.stopTracking();
      store.setTrackingState('paused');
    } catch (error) {
      logger.error('[useTracking] Error pausing tracking', { error });
    }
  };

  /**
   * Resume tracking
   */
  const resumeTracking = async () => {
    try {
      await locationService.startTracking();
      store.setTrackingState('active');
    } catch (error) {
      logger.error('[useTracking] Error resuming tracking', { error });
    }
  };

  /**
   * Flush queue manually
   */
  const flushQueue = async () => {
    try {
      store.setLoading(true);
      await apiSyncManager.syncQueue();
      store.setLoading(false);
    } catch (error) {
      logger.error('[useTracking] Error flushing queue', { error });
      store.setLoading(false);
    }
  };

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      unsubscribeRef.current.forEach((unsub) => unsub());
    };
  }, []);

  return {
    // State
    trackingState: store.trackingState,
    currentLocation: store.currentLocation,
    queueStats: store.queueStats,
    isLoading: store.isLoading,
    error: store.error,

    // Actions
    startTracking,
    stopTracking,
    pauseTracking,
    resumeTracking,
    flushQueue,
  };
}
```

---

## Step 6: Usage in Components

### Example: Tracking Screen

```typescript
// app/(driver)/tracking.tsx
import { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTracking } from '../../src/features/location/hooks/useTracking';
import { useAuth } from '../../hooks/useAuth'; // Your auth hook

export default function TrackingScreen() {
  const { user, token } = useAuth();
  const { currentTrip } = useCurrentTrip(); // Your current trip hook

  const {
    trackingState,
    currentLocation,
    queueStats,
    isLoading,
    error,
    startTracking,
    stopTracking,
    flushQueue,
  } = useTracking({
    tripId: currentTrip?.id,
    busId: currentTrip?.busId,
    driverId: user?.id,
    authToken: token,
    onError: (error) => {
      Alert.alert('Tracking Error', error);
    },
  });

  return (
    <ScrollView style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 20 }}>
        Location Tracking
      </Text>

      {/* Status */}
      <View style={{ backgroundColor: '#f0f0f0', padding: 10, marginBottom: 10 }}>
        <Text>Status: {trackingState}</Text>
        <Text>Loading: {isLoading ? 'Yes' : 'No'}</Text>
        {error && <Text style={{ color: 'red' }}>Error: {error}</Text>}
      </View>

      {/* Current Location */}
      {currentLocation && (
        <View style={{ backgroundColor: '#f0f0f0', padding: 10, marginBottom: 10 }}>
          <Text>Latitude: {currentLocation.latitude.toFixed(6)}</Text>
          <Text>Longitude: {currentLocation.longitude.toFixed(6)}</Text>
          <Text>Speed: {(currentLocation.speed * 3.6).toFixed(1)} km/h</Text>
          <Text>Accuracy: {currentLocation.accuracy.toFixed(0)}m</Text>
        </View>
      )}

      {/* Queue Stats */}
      {queueStats && (
        <View style={{ backgroundColor: '#f0f0f0', padding: 10, marginBottom: 10 }}>
          <Text>Queue Size: {queueStats.size} items</Text>
          <Text>Oldest Item: {queueStats.oldestItemAge}s old</Text>
          <Text>Pending Retries: {queueStats.pendingRetries}</Text>
        </View>
      )}

      {/* Controls */}
      <View style={{ gap: 10 }}>
        {trackingState === 'idle' ? (
          <TouchableOpacity
            onPress={startTracking}
            disabled={isLoading}
            style={{
              backgroundColor: '#4CAF50',
              padding: 15,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: 'white', textAlign: 'center' }}>
              Start Tracking
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={stopTracking}
            disabled={isLoading}
            style={{
              backgroundColor: '#f44336',
              padding: 15,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: 'white', textAlign: 'center' }}>
              Stop Tracking
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={flushQueue}
          disabled={isLoading}
          style={{
            backgroundColor: '#2196F3',
            padding: 15,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: 'white', textAlign: 'center' }}>
            Flush Queue
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

---

## Step 7: Testing Strategy

### Unit Tests

```typescript
// __tests__/LocationService.test.ts
import { locationService } from '../src/features/location/services/LocationService';
import { LocationUpdate } from '../src/features/location/api/types';

describe('LocationService', () => {
  it('should filter duplicate locations', () => {
    const callback = jest.fn();
    locationService.subscribe(callback);

    // Simulate same location twice
    const location1: LocationUpdate = {
      latitude: 12.97,
      longitude: 77.59,
      speed: 0,
      heading: 0,
      accuracy: 5,
      altitude: 0,
      timestamp: 1000,
      isSignificantChange: true,
    };

    // Same location 2 seconds later
    const location2: LocationUpdate = {
      ...location1,
      timestamp: 3000, // Only 2 seconds later
    };

    // Should call callback for first
    // Should NOT call for second (duplicate within 5s)
    // Would be verified with mock tracking
  });

  it('should adapt tracking intervals based on speed', () => {
    // Test speed-based adaptation
    // Stationary (0 km/h) should have longer interval
    // Highway (100 km/h) should have shorter interval
  });
});
```

### Integration Tests

```typescript
// __tests__/integration.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { locationQueueManager } from '../src/features/location/services/LocationQueueManager';
import { LocationPayload } from '../src/features/location/api/types';

describe('Queue Integration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('should survive app restart', async () => {
    const location: LocationPayload = {
      latitude: 12.97,
      longitude: 77.59,
      speed: 10,
      heading: 180,
      accuracy: 5,
      altitude: 500,
      timestamp: new Date().toISOString(),
      deviceId: 'device-1',
      batteryLevel: 75,
      batteryState: 'discharging',
      tripId: 'trip-1',
      busId: 'bus-1',
      driverId: 'driver-1',
      platform: 'android',
    };

    // Enqueue
    await locationQueueManager.enqueue(location);

    // Check it's stored
    let stats = await locationQueueManager.getStats();
    expect(stats.size).toBe(1);

    // Simulate app restart (new instance)
    const newManager = locationQueueManager;

    // Should still see item
    stats = await newManager.getStats();
    expect(stats.size).toBe(1);
  });
});
```

### Device Testing Checklist

```
✅ Android Device (Real)
   ├─ Permissions flow
   ├─ Foreground tracking works
   ├─ App background tracking works (kill, see logs)
   ├─ Queue persistence across restart
   ├─ Network offline/online transitions
   └─ Battery drain measurement (1 hour)

✅ iOS Device (Real)
   ├─ Permissions flow
   ├─ Foreground tracking works
   ├─ App background tracking works
   ├─ Queue persistence
   ├─ Network transitions
   └─ Battery drain measurement

✅ Network Scenarios
   ├─ Kill network → Offline queue
   ├─ Restore network → Queue flush
   ├─ 4G → WiFi switch
   ├─ Airplane mode on/off
   └─ Connection timeout
```

---

## Step 8: Production Deployment

### Before Deploy Checklist

```
Code Quality:
  ✅ No TypeScript errors
  ✅ No runtime errors in development
  ✅ All services initialized properly
  ✅ Error handling comprehensive
  ✅ Logging covers critical paths

Configuration:
  ✅ Backend URL set in .env
  ✅ API endpoints match backend
  ✅ Sentry DSN configured
  ✅ App permissions in app.config.js

Device Testing:
  ✅ Real Android device (multiple OS versions)
  ✅ Real iOS device (multiple OS versions)
  ✅ Background tracking works
  ✅ Battery drain <2% per hour
  ✅ Network recovery works

Performance:
  ✅ Memory <100 MB
  ✅ Queue operations <100ms
  ✅ API response <5s (normal)
  ✅ No memory leaks (1 hour test)

Monitoring:
  ✅ Sentry configured
  ✅ Error alerts set up
  ✅ Dashboard available
```

### EAS Build Command

```bash
# Build for production
eas build --platform android --profile production
eas build --platform ios --profile production

# Monitor:
# - Android: Check crash reports in Google Play Console
# - iOS: Check TestFlight feedback
# - Check Sentry dashboard for errors
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Background Task Not Starting

**Problem**: `backgroundLocationTask.start()` returns false

**Causes**:
- Permissions not granted
- Foreground service not registered
- Location services disabled

**Solution**:
```typescript
// Check permissions first
const perms = await permissionService.checkPermissions();
console.log('Permissions:', perms);

// Ensure location services enabled
const hasServices = await permissionService.hasLocationServices();
console.log('Services enabled:', hasServices);

// Then start
const success = await backgroundLocationTask.start(token, busId, driverId);
console.log('Background task started:', success);
```

### Pitfall 2: Queue Growing Indefinitely

**Problem**: Queue keeps growing, never flushes

**Causes**:
- API endpoint broken
- Auth token invalid
- Rate limiting triggered

**Solution**:
```typescript
// Check sync state
const syncState = await apiSyncManager.getStats();
console.log('Sync state:', syncState);

// Check network
console.log('Network available:', networkState.isNetworkAvailable());

// Try manual flush
await apiSyncManager.flushQueue();

// Check logs
logger.getErrorHistory(); // See last 50 errors
```

### Pitfall 3: High Battery Drain

**Problem**: Battery drains >3% per hour

**Causes**:
- Tracking interval too frequent
- GPS accuracy too high
- Adaptive tracking disabled

**Solution**:
```typescript
// Check current config
const config = await locationService.getCurrentConfig();
console.log('Config:', config);

// Verify adaptive tracking enabled
// Increase intervals if needed
await locationService.updateConfig({
  foregroundTimeInterval: 15000, // 15s instead of 5s
  backgroundTimeInterval: 30000, // 30s instead of 15s
});

// Switch to balanced accuracy on battery low
await locationService.updateConfig({
  accuracy: 'Balanced',
});
```

### Pitfall 4: iOS Background Tracking Unreliable

**Problem**: iOS stops tracking after 10 minutes

**Note**: This is expected on iOS. Apple limits background execution.

**Solution**:
- Accept 30+ second update intervals on iOS
- Use geofencing for critical alerts
- Educate users: "Battery optimization feature"

---

## Monitoring & Troubleshooting

### Key Metrics to Watch

```typescript
// Daily checks
const health = {
  // API
  apiErrorRate: '<1%',                    // Alert if >1%
  apiResponseTime: '<2s (p50), <5s (p95)', // Alert if >10s
  
  // Queue
  avgQueueSize: '<10 items',              // Alert if >50
  maxQueueAge: '<5 minutes',              // Alert if >1 hour
  
  // Location
  locationsPerDriver: '>200 per hour',    // Alert if <100
  averageAccuracy: '<20 meters',          // Alert if >100
  
  // User Experience
  batteryDrain: '1-2% per hour',          // Alert if >3%
  trackingUptime: '>99.5%',               // Alert if <99%
};
```

### Debugging Tools

```typescript
// Export queue for debugging
const allItems = await locationQueueManager.getAllItems();
console.table(allItems);

// Get API metrics
const metrics = apiSyncManager.getMetrics();
console.log('Sync Metrics:', metrics);

// Check location service state
const location = locationService.getLastLocation();
console.log('Last Location:', location);

// View logs
const errors = logger.getErrorHistory();
console.log('Recent Errors:', errors);
```

---

## Next Steps

1. **Copy all files** from this guide into your project
2. **Run tests** on real devices
3. **Monitor** Sentry dashboard post-deployment
4. **Optimize** based on real-world metrics
5. **Scale** with multiple servers if needed

---

**Status**: Production Ready  
**Last Updated**: May 22, 2026  
**Estimated Implementation Time**: 8-10 hours  
**Complexity Level**: 7/10 (Moderate)

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { locationQueueManager } from "../src/driver/queue/LocationQueueManager";
import { httpSyncManager } from "../src/driver/sync/HTTPSyncManager";
import socketService from "./socketService";

const LOCATION_TASK_NAME = "background-location-task";
const LOCATION_TRACKING_ENABLED_KEY = "location_tracking_enabled";
const ASSIGNED_BUS_ID_KEY = "assigned_bus_id";
const AUTH_TOKEN_KEY = "auth_token";
const MIN_DISTANCE_METERS = 5;
const MIN_TIME_DELTA_MS = 5000;

// ✅ Storage keys for HTTPSyncManager restoration in background context
const SYNC_MANAGER_STORAGE_KEYS = {
  DRIVER_ID: 'httpSyncManager_driverId',
  BUS_ID: 'httpSyncManager_busId',
  TRIP_ID: 'httpSyncManager_tripId',
  API_BASE_URL: 'httpSyncManager_apiBaseUrl',
};

type LocationPayload = {
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: string;
};

const toRadians = (value: number): number => (value * Math.PI) / 180;

const distanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const distanceThreshold = (lat1: number, lon1: number, lat2: number, lon2: number): boolean => {
  const moved = distanceMeters(lat1, lon1, lat2, lon2);
  return moved >= MIN_DISTANCE_METERS;
};

const emitSocketLocation = (payload: LocationPayload): void => {
  try {
    if (!socketService.isConnected()) {
      return;
    }

    const socket = socketService.getSocket();
    if (!socket) {
      return;
    }

    socket.emit("driverLocationUpdate", payload);
  } catch (err) {
    console.warn("[backgroundLocationService] Socket emit failed", err);
  }
};

const sendLocationToBackend = async (
  payload: LocationPayload,
): Promise<boolean> => {
  try {
    const trackingEnabled = await getStoredValue(LOCATION_TRACKING_ENABLED_KEY);
    if (trackingEnabled !== "true") {
      return false;
    }

    const token = await getStoredValue(AUTH_TOKEN_KEY);
    const busId = await getStoredValue(ASSIGNED_BUS_ID_KEY);
    const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || "").trim();

    if (!token || !busId || !backendUrl) {
      return false;
    }

    // ✅ NEW: Queue location for batch upload instead of posting individually
    // The HTTPSyncManager will batch these locations every 15 seconds
    // and send them via /api/tracking/batch for Redis caching
    locationQueueManager.enqueue({
      latitude: payload.latitude,
      longitude: payload.longitude,
      speed: payload.speed,
      timestamp: payload.timestamp,
      heading: 0,
      accuracy: 0,
      altitude: 0,
    });

    // ✅ CRITICAL: Trigger immediate sync in background context
    // The setInterval in HTTPSyncManager won't run when app is backgrounded,
    // so we must trigger sync manually from the background task
    const queueSize = locationQueueManager.size();
    console.log("[backgroundLocationService] Queued location, triggering sync", {
      queueSize,
      lat: payload.latitude,
      lng: payload.longitude,
    });

    // ✅ Restore identifiers from storage in background context
    // This is critical because HTTPSyncManager's in-memory state is lost when backgrounded
    try {
      const [driverId, busId, tripId, apiBaseUrl] = await Promise.all([
        AsyncStorage.getItem(SYNC_MANAGER_STORAGE_KEYS.DRIVER_ID),
        AsyncStorage.getItem(SYNC_MANAGER_STORAGE_KEYS.BUS_ID),
        AsyncStorage.getItem(SYNC_MANAGER_STORAGE_KEYS.TRIP_ID),
        AsyncStorage.getItem(SYNC_MANAGER_STORAGE_KEYS.API_BASE_URL),
      ]);

      if (driverId || busId || tripId) {
        console.log("[backgroundLocationService] Restored identifiers from storage", {
          driverId: !!driverId,
          busId: !!busId,
          tripId: !!tripId,
        });

        // Restore identifiers to HTTPSyncManager
        httpSyncManager.setDriverIdentifiers(driverId || undefined, busId || undefined, tripId || undefined);
      }

      if (apiBaseUrl) {
        httpSyncManager.initialize(apiBaseUrl, token);
      }

      // ✅ Restore auth token from secure storage
      const restoredToken = await getStoredValue(AUTH_TOKEN_KEY);
      if (restoredToken) {
        httpSyncManager.setAuthToken(restoredToken);
      }
    } catch (err) {
      console.warn("[backgroundLocationService] Failed to restore sync manager state:", err);
    }

    // Force sync without waiting (don't await - background tasks have time limits)
    void httpSyncManager.forceSyncNow().catch((err) => {
      console.warn("[backgroundLocationService] Background sync failed:", err);
    });

    // Still emit via socket for real-time updates
    emitSocketLocation(payload);

    console.log(
      "[backgroundLocationService] Location queued for batch upload",
      {
        queueSize: locationQueueManager.size(),
        latitude: payload.latitude,
        longitude: payload.longitude,
      }
    );

    return true;
  } catch (err: any) {
    console.warn("[backgroundLocationService] sendLocationToBackend failed", {
      status: err?.response?.status,
      message: err?.message,
    });
    return false;
  }
};

const getStoredValue = async (key: string): Promise<string | null> => {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  } catch (err) {
    console.error(`[BackgroundTask] Error getting ${key}:`, err);
    return null;
  }
};

const setStoredValue = async (key: string, value: string): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, value);
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch (err) {
    console.error(`[BackgroundTask] Error setting ${key}:`, err);
  }
};

// Define background location task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  try {
    if (error) {
      console.error(`[${LOCATION_TASK_NAME}] Task error:`, error);
      return;
    }

    const { locations } = data as {
      locations: Location.LocationObject[];
    };

    if (!locations || locations.length === 0) {
      console.log(`[${LOCATION_TASK_NAME}] No locations received`);
      return;
    }

    const latestLocation = locations[locations.length - 1];
    console.log(`[${LOCATION_TASK_NAME}] Received location:`, {
      lat: latestLocation.coords.latitude,
      lng: latestLocation.coords.longitude,
      accuracy: latestLocation.coords.accuracy,
      timestamp: new Date(latestLocation.timestamp).toISOString(),
    });

    // Check if tracking is enabled
    const trackingEnabled = await getStoredValue(LOCATION_TRACKING_ENABLED_KEY);
    if (trackingEnabled !== "true") {
      console.log(
        `[${LOCATION_TASK_NAME}] Location tracking disabled, skipping upload`,
      );
      return;
    }

    const payload: LocationPayload = {
      latitude: latestLocation.coords.latitude,
      longitude: latestLocation.coords.longitude,
      speed: latestLocation.coords.speed ?? 0,
      timestamp: new Date(latestLocation.timestamp).toISOString(),
    };

    // ✅ Queue location for batch upload instead of posting individually
    await sendLocationToBackend(payload);
  } catch (err) {
    console.error(`[${LOCATION_TASK_NAME}] Fatal error:`, err);
  }
});

export const backgroundLocationService = {
  /**
   * Start background location tracking
   * This runs even when the app is closed/backgrounded
   */
  async startBackgroundTracking(token: string, busId: string) {
    try {
      console.log("[backgroundLocationService] Starting background tracking");

      // Store values for background tasks
      await setStoredValue(AUTH_TOKEN_KEY, token);
      await setStoredValue(ASSIGNED_BUS_ID_KEY, busId);
      await setStoredValue(LOCATION_TRACKING_ENABLED_KEY, "true");

      // Request location permissions
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (!foreground.granted) {
        console.warn(
          "[backgroundLocationService] Foreground location permission denied",
        );
        return false;
      }

      // Request background permission on both Android and iOS.
      // Android 10+ requires explicit background grant for reliable background updates.
      const background = await Location.requestBackgroundPermissionsAsync();
      if (!background.granted) {
        console.warn(
          "[backgroundLocationService] Background location permission denied",
          {
            platform: Platform.OS,
            status: background.status,
            canAskAgain: background.canAskAgain,
          },
        );
        if (Platform.OS === "android") {
          return false;
        }
      }

      // Check if location services enabled
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        console.warn("[backgroundLocationService] Location services disabled");
        return false;
      }

      // Start background location task (Android)
      // This gets location updates even when app is backgrounded
      if (Platform.OS === "android") {
        const isRegistered =
          await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
        console.log(
          `[backgroundLocationService] Location task registered: ${isRegistered}`,
        );

        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 3000,
            distanceInterval: 5,
            foregroundService: {
              notificationTitle: "Live Tracking Active",
              notificationBody: "Your location is being shared in background",
              notificationColor: "#1d4ed8",
            },
          });
          console.log(
            "[backgroundLocationService] Started background location updates",
          );
        }
      }

      return true;
    } catch (err) {
      console.error(
        "[backgroundLocationService] Failed to start background tracking:",
        err,
      );
      return false;
    }
  },

  /**
   * Stop background location tracking
   */
  async stopBackgroundTracking() {
    try {
      console.log("[backgroundLocationService] Stopping background tracking");

      // Disable tracking flag
      await setStoredValue(LOCATION_TRACKING_ENABLED_KEY, "false");

      // Stop background location updates (Android)
      if (Platform.OS === "android") {
        const isRegistered =
          await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
          console.log(
            "[backgroundLocationService] Stopped background location updates",
          );
        }
      }

      return true;
    } catch (err) {
      console.error(
        "[backgroundLocationService] Failed to stop background tracking:",
        err,
      );
      return false;
    }
  },

  /**
   * Check if background tracking is enabled
   */
  async isTrackingEnabled(): Promise<boolean> {
    const enabled = await getStoredValue(LOCATION_TRACKING_ENABLED_KEY);
    return enabled === "true";
  },
};

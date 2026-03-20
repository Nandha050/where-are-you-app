import axios from "axios";
import * as BackgroundFetch from "expo-background-fetch";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

const LOCATION_TASK_NAME = "background-location-task";
const BG_FETCH_TASK_NAME = "driver-location-sync-task";
const LOCATION_TRACKING_ENABLED_KEY = "location_tracking_enabled";
const ASSIGNED_BUS_ID_KEY = "assigned_bus_id";
const AUTH_TOKEN_KEY = "auth_token";

const sendLocationToBackend = async (location: {
  latitude: number;
  longitude: number;
  speed?: number | null;
  timestamp?: string;
}): Promise<boolean> => {
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

    const payload = {
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed ?? 0,
      timestamp: location.timestamp ?? new Date().toISOString(),
    };

    // Use the same endpoint as foreground tracking to avoid API contract mismatch.
    await axios.post(`${backendUrl}/api/tracking/me/location`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    });

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

    await sendLocationToBackend({
      latitude: latestLocation.coords.latitude,
      longitude: latestLocation.coords.longitude,
      speed: latestLocation.coords.speed,
      timestamp: new Date(latestLocation.timestamp).toISOString(),
    });
  } catch (err) {
    console.error(`[${LOCATION_TASK_NAME}] Fatal error:`, err);
  }
});

// Define background fetch task for sending locations to server
TaskManager.defineTask(BG_FETCH_TASK_NAME, async () => {
  try {
    console.log(
      `[${BG_FETCH_TASK_NAME}] Task running at ${new Date().toISOString()}`,
    );

    // Check if tracking is enabled
    const trackingEnabled = await getStoredValue(LOCATION_TRACKING_ENABLED_KEY);
    if (trackingEnabled !== "true") {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Ensure mandatory values exist
    const token = await getStoredValue(AUTH_TOKEN_KEY);
    const busId = await getStoredValue(ASSIGNED_BUS_ID_KEY);
    if (!token || !busId) {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // Try multiple methods to get location (aggressive fallback)
    let currentLocation: Location.LocationObject | null = null;

    try {
      // Method 1: Try high accuracy with timeout
      currentLocation = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        ),
      ]);
    } catch {
      try {
        // Method 2: Try balanced accuracy
        currentLocation = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 3000),
          ),
        ]);
      } catch {
        // Method 3: Use last known position
        try {
          currentLocation = await Location.getLastKnownPositionAsync();
        } catch {
          currentLocation = null;
        }
      }
    }

    // If no location, don't stop - just retry next interval
    if (!currentLocation) {
      console.warn(
        `[${BG_FETCH_TASK_NAME}] No location available, retrying next interval`,
      );
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const sent = await sendLocationToBackend({
      latitude: currentLocation.coords.latitude,
      longitude: currentLocation.coords.longitude,
      speed: currentLocation.coords.speed ?? 0,
      timestamp: new Date().toISOString(),
    });

    if (sent) {
      console.log(`[${BG_FETCH_TASK_NAME}] Location sent`);
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.Failed;
  } catch (err) {
    console.error(`[${BG_FETCH_TASK_NAME}] Task error:`, err);
    // Keep task alive despite errors
    return BackgroundFetch.BackgroundFetchResult.Failed;
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
            accuracy: Location.Accuracy.High,
            timeInterval: 5000, // 5 seconds
            distanceInterval: 0, // allow time-based updates even with low movement
            deferredUpdatesInterval: 5000,
            deferredUpdatesDistance: 0,
            foregroundService: {
              notificationTitle: "Bus Tracking Active",
              notificationBody: "Your location is being shared in real-time",
              notificationColor: "#1d4ed8",
            },
          });
          console.log(
            "[backgroundLocationService] Started background location updates",
          );
        }
      }

      // Start background fetch task
      // This periodically syncs location to server
      try {
        await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK_NAME, {
          minimumInterval: 5, // Every 5 seconds minimum
          stopOnTerminate: false, // Continue even if app is terminated
          startOnBoot: true, // Start on device boot
        });
        console.log(
          "[backgroundLocationService] Registered background fetch task",
        );
      } catch (err) {
        console.warn(
          "[backgroundLocationService] Background fetch not available:",
          err,
        );
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

      // Unregister background fetch
      try {
        const fetchRegistered =
          await TaskManager.isTaskRegisteredAsync(BG_FETCH_TASK_NAME);
        if (fetchRegistered) {
          await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK_NAME);
          console.log(
            "[backgroundLocationService] Unregistered background fetch",
          );
        }
      } catch (err) {
        console.warn(
          "[backgroundLocationService] Warning unregistering fetch:",
          err,
        );
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

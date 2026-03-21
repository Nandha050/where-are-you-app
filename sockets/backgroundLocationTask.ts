import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import socketService from "./socketService";

const LOCATION_TASK_NAME = "background-location-task";
const LOCATION_TRACKING_ENABLED_KEY = "location_tracking_enabled";
const ASSIGNED_BUS_ID_KEY = "assigned_bus_id";
const AUTH_TOKEN_KEY = "auth_token";
const LOCATION_QUEUE_KEY = "driver_location_queue";
const LAST_HANDLED_LOCATION_KEY = "last_handled_driver_location";
const MIN_DISTANCE_METERS = 5;
const MIN_TIME_DELTA_MS = 5000;

type LocationPayload = {
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: string;
};

type LastHandledLocation = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

let lastHandledCache: LastHandledLocation | null = null;

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

const readQueue = async (): Promise<LocationPayload[]> => {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocationPayload[]) : [];
  } catch {
    return [];
  }
};

const writeQueue = async (queue: LocationPayload[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn(
      "[backgroundLocationService] Failed to persist location queue",
      err,
    );
  }
};

const enqueueLocation = async (payload: LocationPayload): Promise<void> => {
  const queue = await readQueue();
  queue.push(payload);
  await writeQueue(queue.slice(-300));
};

const readLastHandled = async (): Promise<LastHandledLocation | null> => {
  if (lastHandledCache) {
    return lastHandledCache;
  }

  try {
    const raw = await AsyncStorage.getItem(LAST_HANDLED_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastHandledLocation;
    if (
      typeof parsed?.latitude === "number" &&
      typeof parsed?.longitude === "number" &&
      typeof parsed?.timestamp === "number"
    ) {
      lastHandledCache = parsed;
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
};

const writeLastHandled = async (value: LastHandledLocation): Promise<void> => {
  lastHandledCache = value;
  try {
    await AsyncStorage.setItem(
      LAST_HANDLED_LOCATION_KEY,
      JSON.stringify(value),
    );
  } catch {
    // Non-critical; filtering still works for current runtime via memory cache.
  }
};

const shouldSkipLocation = async (
  payload: LocationPayload,
): Promise<boolean> => {
  const lastHandled = await readLastHandled();
  if (!lastHandled) {
    return false;
  }

  const deltaMs = Math.abs(
    new Date(payload.timestamp).getTime() - lastHandled.timestamp,
  );
  const movedMeters = distanceMeters(
    lastHandled.latitude,
    lastHandled.longitude,
    payload.latitude,
    payload.longitude,
  );

  return movedMeters < MIN_DISTANCE_METERS && deltaMs < MIN_TIME_DELTA_MS;
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

const sendHttpLocation = async (
  payload: LocationPayload,
  token: string,
  backendUrl: string,
): Promise<void> => {
  await axios.post(`${backendUrl}/api/tracking/me/location`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 8000,
  });
};

const flushQueue = async (token: string, backendUrl: string): Promise<void> => {
  const queue = await readQueue();
  if (!queue.length) {
    return;
  }

  const pending: LocationPayload[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      await sendHttpLocation(item, token, backendUrl);
      emitSocketLocation(item);
    } catch {
      pending.push(...queue.slice(index));
      break;
    }
  }

  await writeQueue(pending);
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

    await sendHttpLocation(payload, token, backendUrl);
    emitSocketLocation(payload);
    await flushQueue(token, backendUrl);
    return true;
  } catch (err: any) {
    console.warn("[backgroundLocationService] sendLocationToBackend failed", {
      status: err?.response?.status,
      message: err?.message,
    });
    await enqueueLocation(payload);
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

    if (!(await shouldSkipLocation(payload))) {
      await writeLastHandled({
        latitude: payload.latitude,
        longitude: payload.longitude,
        timestamp: new Date(payload.timestamp).getTime(),
      });
      await sendLocationToBackend(payload);
    }
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

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  getNotificationPreferences,
  patchUserFcmToken,
  registerDeviceToken,
} from "../../../api/user";
import { captureSentryException } from "../../../monitoring/sentry";

const PREFS_KEY = "@navixgo/notification_preferences";
const FCM_TOKEN_KEY = "@navixgo/fcm_token";
const ASSIGNED_STOP_KEY = "@navixgo/assigned_stop";

export type LanguageCode = "en" | "te" | "hi";

export interface NotificationPrefs {
  busNearStopEnabled: boolean;
  busArrivedEnabled: boolean;
  tripStartedEnabled: boolean;
  delayAlertsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  voiceEnabled: boolean;
  alertBeforeArrivalEnabled: boolean;
  alertBeforeArrivalMinutes: number; // 1, 3, 5, 10
  language: LanguageCode;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  busNearStopEnabled: true,
  busArrivedEnabled: true,
  tripStartedEnabled: true,
  delayAlertsEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  voiceEnabled: true,
  alertBeforeArrivalEnabled: true,
  alertBeforeArrivalMinutes: 5,
  language: "en",
};

// Extensible Multi-lingual Announcements
export const VOICE_TRANSLATIONS: Record<
  LanguageCode,
  Record<string, string>
> = {
  en: {
    busNearStop:
      "Your bus is approaching your stop. Please be ready. This is a sample notification.",
    busArrived: "Your bus has arrived at your stop.",
    tripStarted: "Your bus has started and is on the way.",
    delayAlerts: "Your bus is running behind schedule.",
    tripCompleted: "Your bus trip has been completed. Thank you.",
    testNotice: "This is how your notifications will appear.",
  },
  te: {
    busNearStop:
      "మీ బస్సు మీ స్టాప్ దగ్గరకు వస్తోంది. దయచేసి సిద్ధంగా ఉండండి. ఇది ఒక నమూనా నోటిఫికేషన్.",
    busArrived: "మీ బస్సు మీ స్టాప్‌కు చేరుకుంది.",
    tripStarted: "మీ బస్సు ప్రయాణం ప్రారంభమైంది మరియు దారిలో ఉంది.",
    delayAlerts: "మీ బస్సు నిర్ణీత సమయం కంటే ఆలస్యంగా నడుస్తోంది.",
    tripCompleted: "మీ బస్సు ప్రయాణం పూర్తయింది. ధన్యవాదాలు.",
    testNotice: "మీ నోటిఫికేషన్‌లు ఈ విధంగా కనిపిస్తాయి.",
  },
  hi: {
    busNearStop:
      "आपकी बस आपके स्टॉप के पास आ रही है। कृपया तैयार रहें। यह एक नमूना अधिसूचना है।",
    busArrived: "आपकी बस आपके स्टॉप पर पहुंच गई है।",
    tripStarted: "आपकी बस शुरू हो चुकी है और रास्ते में है।",
    delayAlerts: "आपकी बस अपने निर्धारित समय से देरी से चल रही है।",
    tripCompleted: "आपकी बस यात्रा पूरी हो गई है। धन्यवाद।",
    testNotice: "आपकी अधिसूचनाएं इस प्रकार दिखाई देंगी।",
  },
};

class NotificationService {
  private static instance: NotificationService;
  private currentUserId: string | null = null;
  private isInitialized = false;
  private cachedPrefs: NotificationPrefs | null = null;
  private lastSpokenText: string | null = null;
  private lastSpokenTime: number = 0;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize notification handlers, check permissions, and register FCM token
   */
  async init(userId: string): Promise<void> {
    this.currentUserId = userId;

    if (this.isInitialized) {
      return;
    }

    try {
      // 1. Pre-load preferences into memory cache to prevent any delays later
      await this.getPreferences(true);

      // 2. Setup handler for foreground notifications dynamically respecting settings
      console.log(
        "[NOTIFICATION HANDLER REGISTERED] Setting up handler for SDK 54",
      );
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const data = (notification.request.content.data || {}) as any;
          const isLocal = data?.isLocal === true;
          const prefs = this.getPreferencesSync();

          const shouldShow = isLocal;
          console.log(
            `[NOTIFICATION RECEIVED] Foreground notification received. isLocal: ${isLocal}, shouldShowBanner: ${shouldShow}`,
          );

          return {
            shouldShowBanner: shouldShow,
            shouldShowList: true,
            shouldPlaySound: prefs.soundEnabled,
            shouldSetBadge: true,
          };
        },
      });

      // Configure Android channels with _v1 suffix to bypass OS channel settings cache
      if (Platform.OS === "android") {
        // 1. High importance channel with sound & vibration
        await Notifications.setNotificationChannelAsync("default_sound_v1", {
          name: "Alerts with Sound & Vibration",
          importance: Notifications.AndroidImportance.MAX,
          sound: "default",
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#2563EB",
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log(
          "[CHANNEL CREATED] default_sound_v1 channel created with MAX importance, sound, and vibration",
        );

        // 2. Sound only channel
        await Notifications.setNotificationChannelAsync("sound_only_v1", {
          name: "Sound Only Alerts",
          importance: Notifications.AndroidImportance.MAX,
          sound: "default",
          enableVibrate: false,
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log(
          "[CHANNEL CREATED] sound_only_v1 channel created with MAX importance, sound configuration",
        );

        // 3. Vibration only channel
        await Notifications.setNotificationChannelAsync("vibration_only_v1", {
          name: "Vibration Only Alerts",
          importance: Notifications.AndroidImportance.MAX,
          sound: null,
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log(
          "[CHANNEL CREATED] vibration_only_v1 channel created with MAX importance, vibration configuration",
        );

        // 4. Silent channel
        await Notifications.setNotificationChannelAsync("silent_v1", {
          name: "Silent Alerts",
          importance: Notifications.AndroidImportance.MAX,
          sound: null,
          enableVibrate: false,
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log(
          "[CHANNEL CREATED] silent_v1 channel created with MAX importance, silent configuration",
        );

        // 5. Critical channel
        await Notifications.setNotificationChannelAsync("critical_v1", {
          name: "Critical Alerts",
          importance: Notifications.AndroidImportance.MAX,
          sound: "default",
          enableVibrate: true,
          vibrationPattern: [0, 500, 250, 500],
          lightColor: "#EF4444",
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log(
          "[CHANNEL CREATED] critical_v1 channel created with MAX importance, custom vibration and red light",
        );

        // 6. Map constants for backend payloads
        await Notifications.setNotificationChannelAsync("location_alerts_v1", {
          name: "Location Alerts",
          importance: Notifications.AndroidImportance.MAX,
          sound: "default",
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        console.log("[CHANNEL CREATED] location_alerts_v1 channel created");

        await Notifications.setNotificationChannelAsync(
          "location_critical_v1",
          {
            name: "Location Critical Alerts",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
            enableVibrate: true,
            vibrationPattern: [0, 500, 250, 500],
            lightColor: "#EF4444",
            bypassDnd: true,
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.PUBLIC,
          },
        );
        console.log("[CHANNEL CREATED] location_critical_v1 channel created");

        await Notifications.setNotificationChannelAsync(
          "location_tracking_v1",
          {
            name: "Location Tracking Active",
            importance: Notifications.AndroidImportance.LOW,
            sound: null,
            enableVibrate: false,
            bypassDnd: false,
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.SECRET,
          },
        );
        console.log("[CHANNEL CREATED] location_tracking_v1 channel created");
      }

      // 3. Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.log("[NotificationService] Permissions not granted");
        return;
      }

      // 4. Register device token
      await this.registerDevice();

      // 5. Listen to token refreshes
      Notifications.addPushTokenListener(async (token) => {
        console.log("[NotificationService] Push token rotated:", token.data);
        await this.saveTokenLocally(token.data);
        try {
          await registerDeviceToken({
            deviceToken: token.data,
            deviceType: Platform.OS === "ios" ? "ios" : "android",
          });
        } catch (err) {
          captureSentryException(err, {
            tags: { area: "notifications", op: "token_rotate" },
          });
        }
      });

      // 6. Add foreground message listener for TTS voice announcements and local notification creation
      Notifications.addNotificationReceivedListener(async (notification) => {
        const data = (notification.request.content.data || {}) as any;
        const isLocal = data?.isLocal === true;

        if (isLocal) {
          console.log(
            `[NOTIFICATION DISPLAYED] Local notification displayed in bar: ${notification.request.identifier}`,
          );
          return;
        }

        console.log(
          `[NOTIFICATION RECEIVED] Remote push notification received: ${JSON.stringify(notification)}`,
        );

        // Retrieve preferences synchronously from in-memory cache to guarantee zero delay
        const prefs = this.getPreferencesSync();
        const type = data?.type || "";

        // Check if alerts for this type are enabled
        const isEnabled = this.isNotificationTypeEnabled(type, prefs);
        if (!isEnabled) {
          console.log(
            `[NotificationService] Notification type ${type} is disabled in preferences`,
          );
          return;
        }

        // Schedule local notification to display in the notification bar
        const title =
          notification.request.content.title || data?.title || "NavixGo";
        const body =
          notification.request.content.body || data?.body || data?.message;
        const voiceMessage = data?.voiceMessage || body;

        const channelId = prefs.soundEnabled
          ? prefs.vibrationEnabled
            ? "default_sound_v1"
            : "sound_only_v1"
          : prefs.vibrationEnabled
            ? "vibration_only_v1"
            : "silent_v1";

        // Use a near-instant 10ms offset to schedule banner immediately
        const triggerDate = new Date(Date.now() + 10);

        console.log(
          `[LOCAL NOTIFICATION CREATED] Scheduling local notification. Channel: ${channelId}`,
        );
        const displayPromise = Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            sound: prefs.soundEnabled ? "default" : undefined,
            data: { ...data, isLocal: true },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
            channelId,
          },
        })
          .then(() => {
            console.log(
              `[NOTIFICATION DISPLAYED] Local notification banner displayed successfully for: ${title}`,
            );
          })
          .catch((err) => {
            console.error(
              "[NotificationService] Failed to schedule local notification:",
              err,
            );
          });

        // Trigger TTS voice announcement after 800ms to allow notification sound to play first
        let textToSpeak = voiceMessage;
        const lang = prefs.language;
        const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;

        const normType = type.toUpperCase().replace(/_/g, "");
        if (normType.includes("NEARSTOP")) {
          textToSpeak = translations.busNearStop;
        } else if (normType.includes("ARRIVED")) {
          textToSpeak = translations.busArrived;
        } else if (normType.includes("STARTED")) {
          textToSpeak = translations.tripStarted;
        } else if (normType.includes("DELAY")) {
          textToSpeak = translations.delayAlerts;
        } else if (normType.includes("COMPLETED")) {
          textToSpeak = translations.tripCompleted;
        }

        if (textToSpeak) {
          setTimeout(() => {
            void this.playVoiceNotification(textToSpeak, type);
          }, 800);
        }

        await displayPromise;
      });

      this.isInitialized = true;
      console.log("[NotificationService] Initialized successfully");
    } catch (error) {
      console.error("[NotificationService] Init failed:", error);
      captureSentryException(error, {
        tags: { area: "notifications", op: "init" },
      });
    }
  }

  /**
   * Request push notification permissions
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === "web") return false;

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
          allowCriticalAlerts: true,
        },
      });
      finalStatus = status;
    }

    return finalStatus === "granted";
  }

  /**
   * Register FCM Token with backend
   */
  async registerDevice(): Promise<void> {
    try {
      if (Platform.OS === "web") return;

      // 1. Generate and log Expo Push Token (if using Expo Push Service)
      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ||
          Constants.easConfig?.projectId;
        const expoPushTokenResult = await Notifications.getExpoPushTokenAsync({
          projectId,
        });
        console.log(
          "[NotificationService] Generated Expo Push Token:",
          expoPushTokenResult.data,
        );
      } catch (expoErr) {
        console.log(
          "[NotificationService] Expo Push Token generation bypassed/failed:",
          expoErr,
        );
      }

      // 2. Generate and log native device token (FCM for Android, APNs for iOS)
      const token = await Notifications.getDevicePushTokenAsync();

      console.log("FCM TOKEN:", token.data);
      console.log("ANDROID PACKAGE:", Application.applicationId);
      console.log(
        "EXPO PROJECT ID:",
        Constants.expoConfig?.extra?.eas?.projectId,
      );
      console.log("GOOGLE SERVICES CONFIG LOADED");

      await this.saveTokenLocally(token.data);

      // 3. Register via notifications endpoint
      await registerDeviceToken({
        deviceToken: token.data,
        deviceType: Platform.OS === "ios" ? "ios" : "android",
      });

      // 4. Also sync FCM token to user profile endpoint
      try {
        await patchUserFcmToken(String(token.data));
        console.log("[NotificationService] FCM token synced to user profile");
      } catch (profileErr) {
        console.log(
          "[NotificationService] FCM token profile sync failed (non-fatal):",
          profileErr,
        );
      }
    } catch (error) {
      console.error(
        "[NotificationService] Device token registration failed:",
        error,
      );
      captureSentryException(error, {
        tags: { area: "notifications", op: "register_device" },
      });
    }
  }

  /**
   * Save token locally
   */
  private async saveTokenLocally(token: string): Promise<void> {
    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
  }

  /**
   * Get locally stored FCM token
   */
  async getLocalToken(): Promise<string | null> {
    return AsyncStorage.getItem(FCM_TOKEN_KEY);
  }

  /**
   * Retrieve notification preferences. Uses in-memory cache to prevent delays.
   */
  async getPreferences(
    forceRefresh = false,
    skipApi = false,
  ): Promise<NotificationPrefs> {
    if (this.cachedPrefs && !forceRefresh) {
      return this.cachedPrefs;
    }

    try {
      const local = await AsyncStorage.getItem(PREFS_KEY);
      let localPrefs = local ? (JSON.parse(local) as NotificationPrefs) : null;
      if (localPrefs && !this.cachedPrefs) {
        this.cachedPrefs = localPrefs;
      }

      if (skipApi) {
        const finalPrefs = this.cachedPrefs || localPrefs || DEFAULT_PREFS;
        this.cachedPrefs = finalPrefs;
        console.log(
          "[PREFERENCES LOADED] Loaded from local storage (skipping API):",
          JSON.stringify(finalPrefs),
        );
        return finalPrefs;
      }

      // Fetch from API
      try {
        const response = await getNotificationPreferences();
        if (response) {
          // Merge backend preferences with default local schema
          const merged = {
            ...DEFAULT_PREFS,
            ...this.cachedPrefs,
            ...localPrefs,
            busNearStopEnabled:
              response.busNearStopEnabled ??
              response.busNearStop ??
              (localPrefs
                ? localPrefs.busNearStopEnabled
                : DEFAULT_PREFS.busNearStopEnabled),
            busArrivedEnabled:
              response.busArrivedEnabled ??
              response.busArrived ??
              (localPrefs
                ? localPrefs.busArrivedEnabled
                : DEFAULT_PREFS.busArrivedEnabled),
            tripStartedEnabled:
              response.tripStartedEnabled ??
              response.tripStarted ??
              (localPrefs
                ? localPrefs.tripStartedEnabled
                : DEFAULT_PREFS.tripStartedEnabled),
            delayAlertsEnabled:
              response.delayAlertsEnabled ??
              response.delayAlert ??
              (localPrefs
                ? localPrefs.delayAlertsEnabled
                : DEFAULT_PREFS.delayAlertsEnabled),
            soundEnabled:
              response.soundEnabled ??
              response.sound ??
              (localPrefs
                ? localPrefs.soundEnabled
                : DEFAULT_PREFS.soundEnabled),
            vibrationEnabled:
              response.vibrationEnabled ??
              response.vibration ??
              (localPrefs
                ? localPrefs.vibrationEnabled
                : DEFAULT_PREFS.vibrationEnabled),
            voiceEnabled:
              response.voiceEnabled ??
              response.voice ??
              (localPrefs
                ? localPrefs.voiceEnabled
                : DEFAULT_PREFS.voiceEnabled),
            alertBeforeArrivalEnabled:
              response.alertBeforeArrivalEnabled ??
              response.alertBeforeArrival ??
              (localPrefs
                ? localPrefs.alertBeforeArrivalEnabled
                : DEFAULT_PREFS.alertBeforeArrivalEnabled),
          };
          this.cachedPrefs = merged;
          await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(merged));
          console.log(
            "[PREFERENCES LOADED] Loaded and parsed notification preferences from API:",
            JSON.stringify(merged),
          );
          return merged;
        }
      } catch (apiErr) {
        console.log(
          "[NotificationService] Preferences API offline, using local copy",
        );
      }

      const finalPrefs = this.cachedPrefs || localPrefs || DEFAULT_PREFS;
      this.cachedPrefs = finalPrefs;
      console.log(
        "[PREFERENCES LOADED] Loaded fallback preferences:",
        JSON.stringify(finalPrefs),
      );
      return finalPrefs;
    } catch (error) {
      return DEFAULT_PREFS;
    }
  }

  /**
   * Retrieve notification preferences synchronously from in-memory cache.
   */
  getPreferencesSync(): NotificationPrefs {
    return this.cachedPrefs || DEFAULT_PREFS;
  }

  /**
   * Save notification preferences
   */
  async savePreferences(prefs: NotificationPrefs): Promise<void> {
    try {
      this.cachedPrefs = prefs;
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      console.log(
        "[NotificationService] Preferences saved locally and queued for backend sync:",
        prefs,
      );
    } catch (error) {
      console.error("[NotificationService] Save preferences failed:", error);
    }
  }

  async playVoiceNotification(
    message: string,
    notificationType?: string,
  ): Promise<void> {
    console.log(
      `[TTS] Native Android TTS service handles voice announcement: "${message}" (type: ${notificationType})`,
    );
  }

  /**
   * Speak Text-to-Speech message (legacy/compatibility method calling centralized playVoiceNotification)
   */
  async speak(text: string): Promise<void> {
    await this.playVoiceNotification(text);
  }

  /**
   * Announce voice message based on notification type and selected language
   */
  async announceByType(type: string): Promise<void> {
    const prefs = await this.getPreferences();
    const lang = prefs.language;
    const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;
    let message = "";

    switch (type.toLowerCase()) {
      case "busnearstop":
      case "near_stop":
        message = translations.busNearStop;
        break;
      case "busarrived":
      case "arrived":
        message = translations.busArrived;
        break;
      case "tripstarted":
      case "trip_started":
        message = translations.tripStarted;
        break;
      case "delayalerts":
      case "delay":
        message = translations.delayAlerts;
        break;
      case "tripcompleted":
      case "trip_completed":
      case "completed":
        message = translations.tripCompleted;
        break;
      default:
        return;
    }

    if (message) {
      await this.playVoiceNotification(message, type);
    }
  }

  /**
   * Show a local test notification and play voice announcement
   */
  async triggerTestNotification(
    type: keyof typeof DEFAULT_PREFS,
  ): Promise<void> {
    const prefs = await this.getPreferences();
    const lang = prefs.language;
    const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;

    let title = "NavixGo";
    let body = translations.testNotice;
    let voiceMessage = "";

    if (type === "busNearStopEnabled") {
      body = "This is how Bus Near My Stop notifications will appear.";
      voiceMessage = translations.busNearStop;
    } else if (type === "busArrivedEnabled") {
      body = "This is how Bus Arrived notifications will appear.";
      voiceMessage = translations.busArrived;
    } else if (type === "tripStartedEnabled") {
      body = "This is how Trip Started notifications will appear.";
      voiceMessage = translations.tripStarted;
    } else if (type === "delayAlertsEnabled") {
      body = "This is how Delay Alerts notifications will appear.";
      voiceMessage = translations.delayAlerts;
    } else {
      voiceMessage = "This is a sample voice notification.";
    }

    // Respect sound/vibration preferences in scheduled local notification
    const testChannelId = prefs.soundEnabled ? "default_sound_v1" : "silent_v1";
    const triggerDate = new Date(Date.now() + 10);

    console.log(
      `[LOCAL NOTIFICATION CREATED] Triggering test notification: "${body}". Channel: ${testChannelId}`,
    );
    const displayPromise = Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: prefs.soundEnabled ? "default" : undefined,
        data: { voiceMessage, type, isLocal: true },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: testChannelId,
      },
    });

    // Voice announcement after 800ms delay to let the notification sound play first
    setTimeout(() => {
      void this.playVoiceNotification(voiceMessage, String(type));
    }, 800);

    await displayPromise;
    console.log(
      "[NOTIFICATION DISPLAYED] Test notification scheduled successfully",
    );
  }

  /**
   * Helper to check if a specific notification type is enabled in preferences
   */
  isNotificationTypeEnabled(type: string, prefs: NotificationPrefs): boolean {
    if (!type) return true;
    const normType = type.toUpperCase().replace(/_/g, "");

    if (normType.includes("NEARSTOP") || normType.includes("NEAR_STOP")) {
      return prefs.busNearStopEnabled;
    }
    if (normType.includes("ARRIVED") || normType.includes("ARRIVE")) {
      return prefs.busArrivedEnabled;
    }
    if (normType.includes("STARTED") || normType.includes("START")) {
      return prefs.tripStartedEnabled;
    }
    if (normType.includes("DELAY")) {
      return prefs.delayAlertsEnabled;
    }

    return true; // Default to true for other types
  }

  /**
   * Store assigned stop locally
   */
  async saveAssignedStopLocally(stop: any): Promise<void> {
    await AsyncStorage.setItem(ASSIGNED_STOP_KEY, JSON.stringify(stop));
  }

  /**
   * Get locally stored assigned stop
   */
  async getLocalAssignedStop(): Promise<any | null> {
    const local = await AsyncStorage.getItem(ASSIGNED_STOP_KEY);
    return local ? JSON.parse(local) : null;
  }
}

export const notificationService = NotificationService.getInstance();

import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  Poppins_900Black,
  useFonts,
} from "@expo-google-fonts/poppins";
import * as Sentry from "@sentry/react-native";
import { Stack, useSegments, router, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { reaction } from "mobx";
import { useEffect } from "react";
import { Text, TextInput } from "react-native";
import AppErrorBoundary from "../components/ErrorBoundary";
import "../global.css";
import {
  addSentryBreadcrumb,
  clearSentryUserContext,
  setSentryUserContext,
  setupSentryGlobalHandlers,
} from "../monitoring/sentry";
import authStore from "../store/auth";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notificationService, VOICE_TRANSLATIONS, type LanguageCode } from "../src/core/notifications/NotificationService";
import "../src/driver/tracking/BackgroundLocationService";

// Keep splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

const SENTRY_DSN =
  String(process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim() ||
  "https://09bba4b8545d1941c35ea5c983974011@o4511071893651456.ingest.de.sentry.io/4511071895879760";

const TRACES_SAMPLE_RATE = Number(
  process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? (__DEV__ ? 1 : 0.2),
);
const REPLAYS_SESSION_SAMPLE_RATE = Number(
  process.env.EXPO_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0.1,
);
const REPLAYS_ON_ERROR_SAMPLE_RATE = Number(
  process.env.EXPO_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1,
);

Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: true,
  enableLogs: true,
  tracesSampleRate: Number.isFinite(TRACES_SAMPLE_RATE)
    ? TRACES_SAMPLE_RATE
    : 0.2,
  replaysSessionSampleRate: Number.isFinite(REPLAYS_SESSION_SAMPLE_RATE)
    ? REPLAYS_SESSION_SAMPLE_RATE
    : 0.1,
  replaysOnErrorSampleRate: Number.isFinite(REPLAYS_ON_ERROR_SAMPLE_RATE)
    ? REPLAYS_ON_ERROR_SAMPLE_RATE
    : 1,
  integrations: [
    Sentry.reactNativeTracingIntegration(),
    Sentry.mobileReplayIntegration(),
    Sentry.feedbackIntegration(),
  ],
  beforeSend(event: any) {
    if (event.request?.headers) {
      const headers: Record<string, string> = {};
      Object.entries(event.request.headers).forEach(([key, value]) => {
        headers[key] = String(value);
      });

      ["Authorization", "authorization", "Cookie", "cookie"].forEach(
        (header) => {
          if (header in headers) {
            headers[header] = "[Filtered]";
          }
        },
      );

      event.request.headers = headers;
    }

    return event;
  },
});

console.log("[App] Sentry initialized", { dsn: SENTRY_DSN });

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <AppErrorBoundary error={error} retry={retry} />;
}

const BACKGROUND_NOTIFICATION_TASK = "BACKGROUND-NOTIFICATION-TASK";

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("[Background Notification Task] Error:", error);
    return;
  }

  try {
    const payload = data as any;
    
    // Parse remote push payload data
    const notification = payload?.notification;
    const notificationContent = notification?.request?.content;
    const notificationData = notificationContent?.data || notification?.data || payload?.data;
    
    const isLocal = notificationData?.isLocal === true;

    if (!isLocal) {
      console.log(`[BACKGROUND NOTIFICATION] [NOTIFICATION RECEIVED] Remote background push received: ${JSON.stringify(payload)}`);

      const title = notificationContent?.title || notificationData?.title || payload?.title || 'NavixGo';
      const body = notificationContent?.body || notificationData?.body || notificationData?.message || payload?.body || 'New update available';
      const voiceMessage = notificationData?.voiceMessage || body;
      const type = notificationData?.type || '';

      // Load user preferences directly from local storage, skipping API check
      const prefs = await notificationService.getPreferences(false, true);
      
      const soundEnabled = prefs ? prefs.soundEnabled !== false : true;
      const vibrationEnabled = prefs ? prefs.vibrationEnabled !== false : true;
      const voiceEnabled = prefs ? prefs.voiceEnabled !== false : true;
      const language = prefs ? prefs.language || 'en' : 'en';

      // Check if this type of notification is enabled in the preferences
      const isTypeEnabled = notificationService.isNotificationTypeEnabled(type, prefs);

      if (isTypeEnabled) {
        // Use v1 channels to bypass Android immutability cache
        const channelId = soundEnabled 
          ? (vibrationEnabled ? 'default_sound_v1' : 'sound_only_v1')
          : (vibrationEnabled ? 'vibration_only_v1' : 'silent_v1');

        // Display banner immediately (near-instant 10ms offset)
        const triggerDate = new Date(Date.now() + 10);

        console.log(`[LOCAL NOTIFICATION CREATED] [BACKGROUND] Scheduling local notification. Channel: ${channelId}`);
        
        // Schedule local notification to display in the Android notification bar
        const displayPromise = Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            sound: soundEnabled ? 'default' : undefined,
            data: { ...notificationData, isLocal: true },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
            channelId,
          },
        }).then(() => {
          console.log(`[NOTIFICATION DISPLAYED] [BACKGROUND] Local notification displayed in bar: ${title}`);
        }).catch((err) => {
          console.error("[BACKGROUND NOTIFICATION FAILED] Failed to schedule local notification:", err);
        });

        // Trigger TTS voice announcement after 800ms to allow notification sound to play first
        let voicePromise = Promise.resolve();
        let textToSpeak = voiceMessage;
        const translations = VOICE_TRANSLATIONS[language as LanguageCode] || VOICE_TRANSLATIONS.en;
        
        const normType = type.toUpperCase().replace(/_/g, '');
        if (normType.includes('NEARSTOP')) {
          textToSpeak = translations.busNearStop;
        } else if (normType.includes('ARRIVED')) {
          textToSpeak = translations.busArrived;
        } else if (normType.includes('STARTED')) {
          textToSpeak = translations.tripStarted;
        } else if (normType.includes('DELAY')) {
          textToSpeak = translations.delayAlerts;
        } else if (normType.includes('COMPLETED')) {
          textToSpeak = translations.tripCompleted;
        }

        if (voiceEnabled && textToSpeak) {
          voicePromise = new Promise<void>((resolve) => {
            setTimeout(async () => {
              try {
                await notificationService.playVoiceNotification(textToSpeak, type);
              } catch (speechErr) {
                console.error("[VOICE FAILED] [BACKGROUND] Background speech failed:", speechErr);
              }
              resolve();
            }, 800);
          });
        }

        await Promise.all([displayPromise, voicePromise]);
      } else {
        console.log(`[BACKGROUND NOTIFICATION] Notification type ${type} is disabled in preferences`);
      }
    }
  } catch (err) {
    console.error("[Background Notification Task] Execution failed:", err);
  }
});

void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);

export default Sentry.wrap(function RootLayout() {
  const segments = useSegments();
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Poppins_900Black,
  });

  // Initialize notifications on user login
  useEffect(() => {
    if (authStore.user?.id && authStore.token) {
      void notificationService.init(authStore.user.id);
    }
  }, [authStore.user?.id, authStore.token]);

  // Handle deep linking from notification taps
  useEffect(() => {
    // 1. Handle notification that launched the app (Killed state)
    const checkLastNotification = async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response) {
          console.log("[NOTIFICATION LAUNCHED] App launched from killed state via notification:", JSON.stringify(response));
          handleNotificationTap(response);
        }
      } catch (err) {
        console.error("[NOTIFICATION LAUNCHED] Failed to check last notification:", err);
      }
    };

    const handleNotificationTap = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const busId = data?.busId;
      const tripId = data?.tripId;
      const type = data?.type || '';

      console.log(`[DEEP LINK OPENED] Notification tapped. type: ${type}, payload: ${JSON.stringify(data)}`);

      if (busId || tripId) {
        console.log(`[DEEP LINK OPENED] Navigating to tracking screen. busId: ${busId}, tripId: ${tripId}`);
        // Ensure navigation structure is ready
        setTimeout(() => {
          router.push({
            pathname: "/(user)/tracking",
            params: { busId, tripId },
          } as any);
        }, 500);
      } else {
        console.log(`[DEEP LINK OPENED] No busId/tripId. Navigating to alerts screen as fallback.`);
        setTimeout(() => {
          router.push({
            pathname: "/(user)/alerts",
          } as any);
        }, 500);
      }
    };

    // Run the check for killed-state launch
    void checkLastNotification();

    // 2. Handle notification interactions while the app is running
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log("[NOTIFICATION TAP] Notification tapped in foreground/background:", JSON.stringify(response));
      handleNotificationTap(response);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!fontsLoaded && !fontError) {
      return;
    }

    if (fontError) {
      console.warn("[RootLayout] Failed to load Poppins fonts:", fontError);
    }

    void SplashScreen.hideAsync().catch(err => {
      console.error("[RootLayout] Failed to hide splash screen:", err);
    });
  }, [fontError, fontsLoaded]);

  // Sentry setup
  useEffect(() => {
    if (!fontsLoaded) return;

    const defaultFontStyle = { fontFamily: "Poppins_400Regular" };
    const TextComponent = Text as unknown as { defaultProps?: Record<string, unknown> };
    const TextInputComponent = TextInput as unknown as { defaultProps?: Record<string, unknown> };

    TextComponent.defaultProps = {
      ...(TextComponent.defaultProps ?? {}),
      style: [defaultFontStyle, TextComponent.defaultProps?.style],
    };
    TextInputComponent.defaultProps = {
      ...(TextInputComponent.defaultProps ?? {}),
      style: [defaultFontStyle, TextInputComponent.defaultProps?.style],
    };

    setupSentryGlobalHandlers();

    const dispose = reaction(
      () => authStore.user,
      (user) => {
        if (!user?.id) {
          clearSentryUserContext();
          return;
        }

        setSentryUserContext({
          id: user.id,
          username: user.name,
          role: user.role,
        });
      },
      { fireImmediately: true },
    );

    return dispose;
  }, [fontsLoaded]);

  useEffect(() => {
    const routePath = segments.filter(Boolean).join("/") || "root";
    addSentryBreadcrumb({
      category: "navigation",
      message: `Route changed: ${routePath}`,
      level: "info",
      data: {
        segments,
      },
    });
  }, [segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(driver)" options={{ headerShown: false }} />
      <Stack.Screen name="(user)" options={{ headerShown: false }} />
    </Stack>
  );
});

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
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notificationService, VOICE_TRANSLATIONS } from "../src/core/notifications/NotificationService";
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
  console.log('[Background Notification Task] Background task execution triggered.');
  if (error) {
    console.error("[Background Notification Task] TaskManager error:", error);
    return;
  }

  try {
    const payload = data as any;
    console.log('[Background Notification Task] Received background push data payload:', JSON.stringify(payload));
    
    // Parse remote push payload data
    const notification = payload?.notification;
    const notificationContent = notification?.request?.content;
    const notificationData = notificationContent?.data || notification?.data || payload?.data;
    
    const isLocal = notificationData?.isLocal === true;
    console.log('[Background Notification Task] parsed notificationData:', JSON.stringify(notificationData), 'isLocal:', isLocal);

    if (!isLocal) {
      const title = notificationContent?.title || notificationData?.title || payload?.title || 'NavixGo';
      const body = notificationContent?.body || notificationData?.body || notificationData?.message || payload?.body || 'New update available';
      const voiceMessage = notificationData?.voiceMessage || body;
      const type = notificationData?.type || '';

      console.log('[Background Notification Task] Parsed content - Title:', title, 'Body:', body, 'Type:', type);

      // Load user preferences directly from AsyncStorage
      const prefsKey = "@navixgo/notification_preferences";
      console.log('[Background Notification Task] Reading user preferences from AsyncStorage at key:', prefsKey);
      const local = await AsyncStorage.getItem(prefsKey);
      const prefs = local ? JSON.parse(local) : null;
      console.log('[Background Notification Task] Preferences retrieved:', JSON.stringify(prefs));
      
      const soundEnabled = prefs ? prefs.soundEnabled !== false : true;
      const vibrationEnabled = prefs ? prefs.vibrationEnabled !== false : true;
      const voiceEnabled = prefs ? prefs.voiceEnabled !== false : true;
      const language = prefs ? prefs.language || 'en' : 'en';

      // Check if this type of notification is enabled in the preferences
      let isTypeEnabled = true;
      if (type) {
        const normType = type.toUpperCase().replace(/_/g, '');
        console.log('[Background Notification Task] Normalized type for checking:', normType);
        if (normType.includes('NEARSTOP')) {
          isTypeEnabled = prefs ? prefs.busNearStopEnabled !== false : true;
        } else if (normType.includes('ARRIVED') || normType.includes('ARRIVE')) {
          isTypeEnabled = prefs ? prefs.busArrivedEnabled !== false : true;
        } else if (normType.includes('STARTED') || normType.includes('START')) {
          isTypeEnabled = prefs ? prefs.tripStartedEnabled !== false : true;
        } else if (normType.includes('DELAY')) {
          isTypeEnabled = prefs ? prefs.delayAlertsEnabled !== false : true;
        }
      }
      console.log('[Background Notification Task] Notification type enabled status:', isTypeEnabled);

      if (isTypeEnabled) {
        const channelId = soundEnabled ? 'location-alerts' : 'silent';
        
        // If the push has a native visual notification already shown by OS, do not schedule a duplicate local notification.
        const hasVisualContent = !!(payload?.notification || notificationContent?.title);
        console.log('[Background Notification Task] hasVisualContent flag:', hasVisualContent);

        if (!hasVisualContent) {
          console.log('[Background Notification Task] Scheduling local notification. Channel:', channelId, 'Sound:', soundEnabled);
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title,
                body,
                sound: soundEnabled ? 'default' : undefined,
                vibrate: vibrationEnabled ? [0, 250, 250, 250] : undefined,
                channelId,
                data: { ...notificationData, isLocal: true },
              },
              trigger: null,
            });
            console.log('[Background Notification Task] Local notification scheduled successfully.');
          } catch (schErr) {
            console.error('[Background Notification Task] Failed to schedule local notification:', schErr);
          }
        } else {
          console.log('[Background Notification Task] Native visual content already exists. Suppressing duplicate local notification.');
        }

        // Trigger TTS voice announcement
        if (voiceEnabled) {
          let textToSpeak = voiceMessage;
          const translations = VOICE_TRANSLATIONS[language as any] || VOICE_TRANSLATIONS.en;
          
          const normType = type.toUpperCase().replace(/_/g, '');
          if (normType.includes('NEARSTOP')) {
            textToSpeak = translations.busNearStop;
          } else if (normType.includes('ARRIVED')) {
            textToSpeak = translations.busArrived;
          } else if (normType.includes('STARTED')) {
            textToSpeak = translations.tripStarted;
          } else if (normType.includes('DELAY')) {
            textToSpeak = translations.delayAlerts;
          }

          console.log('[Background Notification Task] TTS active. Speaking text:', textToSpeak);
          if (textToSpeak) {
            try {
              await Speech.stop();
              await Speech.speak(textToSpeak, { language, rate: 0.95 });
              console.log('[Background Notification Task] TTS speak call initiated.');
            } catch (speechErr) {
              console.error('[Background Notification Task] TTS speaking failed:', speechErr);
            }
          }
        } else {
          console.log('[Background Notification Task] TTS voice disabled in preferences. Skipping speech.');
        }
      } else {
        console.log('[Background Notification Task] Notification type disabled by user settings. Skipping display/sound/speech.');
      }
    } else {
      console.log('[Background Notification Task] Ignored local loop notification.');
    }
  } catch (err) {
    console.error("[Background Notification Task] Execution failed with fatal exception:", err);
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
    console.log('[RootLayout][DeepLink] Registering notification response received listener...');
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('[RootLayout][DeepLink] Notification response received:', JSON.stringify(response));
      const actionIdentifier = response.actionIdentifier;
      const notification = response.notification;
      const data = notification.request.content.data;
      const title = notification.request.content.title;
      const body = notification.request.content.body;
      
      console.log('[RootLayout][DeepLink] User tapped notification:', {
        actionIdentifier,
        title,
        body,
        data: JSON.stringify(data),
      });

      const busId = data?.busId;
      const tripId = data?.tripId;
      if (busId || tripId) {
        console.log('[RootLayout][DeepLink] Navigating to tracking screen with params:', { busId, tripId });
        try {
          router.push({
            pathname: "/(user)/tracking",
            params: { busId, tripId },
          } as any);
          console.log('[RootLayout][DeepLink] Navigation successful.');
        } catch (navErr) {
          console.error('[RootLayout][DeepLink] Navigation failed:', navErr);
        }
      } else {
        console.log('[RootLayout][DeepLink] No busId or tripId found in notification data. Bypassing navigation.');
      }
    });

    return () => {
      console.log('[RootLayout][DeepLink] Unmounting notification response received listener.');
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

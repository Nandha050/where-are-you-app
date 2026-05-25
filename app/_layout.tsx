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
import { Stack, useSegments, type ErrorBoundaryProps } from "expo-router";
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

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <AppErrorBoundary error={error} retry={retry} />;
}

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

  useEffect(() => {
    if (!fontsLoaded && !fontError) {
      return;
    }

    if (fontError) {
      console.warn("[RootLayout] Failed to load Poppins fonts:", fontError);
    }

    void SplashScreen.hideAsync();
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

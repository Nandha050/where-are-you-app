import { Redirect, Tabs, useSegments } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function DriverLayout() {
  useSentryScreen("driver/layout");

  const { isHydrated, isAuthenticated, user } = useAuth();
  const segments = useSegments();

  if (!isHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  // Allow the login screen to render without authentication.
  // Without this check the layout redirects to /(driver)/login,
  // which is inside this group, creating an infinite redirect loop.
  const isLoginRoute = segments[segments.length - 1] === "login";

  if (!isAuthenticated && !isLoginRoute) {
    return <Redirect href="/(driver)/login" />;
  }

  if (isAuthenticated && isLoginRoute) {
    return (
      <Redirect
        href={user?.role === "driver" ? "/(driver)/home" : "/(user)/home"}
      />
    );
  }

  if (isAuthenticated && user?.role !== "driver") {
    return <Redirect href="/(user)/home" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1e40af",
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: { fontSize: 12, textTransform: "capitalize" },
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="login" options={{ href: null }} />
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="tracking" options={{ href: null }} />
    </Tabs>
  );
}

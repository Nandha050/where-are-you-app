import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function UserLayout() {
  useSentryScreen("user/layout");

  const { isHydrated, isAuthenticated, user } = useAuth();

  if (!isHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(driver)/login" />;
  }

  if (user?.role !== "user") {
    return <Redirect href="/(driver)/home" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="home" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="tracking" />
    </Stack>
  );
}

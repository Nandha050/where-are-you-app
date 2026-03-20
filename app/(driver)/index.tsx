import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function DriverIndexRedirect() {
  useSentryScreen("driver/index");

  const { isAuthenticated, isHydrated } = useAuth();

  if (!isHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-100">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  return (
    <Redirect href={isAuthenticated ? "/(driver)/home" : "/(driver)/login"} />
  );
}

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function AuthLogin() {
  useSentryScreen("auth/login");

  const { isHydrated, isAuthenticated, user } = useAuth();

  if (!isHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  if (isAuthenticated) {
    return (
      <Redirect
        href={user?.role === "driver" ? "/(driver)/home" : "/(user)/home"}
      />
    );
  }

  return <Redirect href="/(driver)/login" />;
}

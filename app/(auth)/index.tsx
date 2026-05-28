import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function AuthIndex() {
  useSentryScreen("auth/index");

  const { isHydrated, isAuthenticated, user } = useAuth();

  if (!isHydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  if (!isAuthenticated || !user) {
    return <Redirect href="/(driver)/login" />;
  }

  // Default to driver if role is not set
  const role = user.role || "driver";
  const redirectPath = role === "driver" ? "/(driver)/home" : "/(user)/home";

  console.log("[AuthIndex] Redirecting to", { role, path: redirectPath });

  return <Redirect href={redirectPath} />;
}

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logoutUser } from "../../api/auth";
import { patchUserFcmToken } from "../../api/user";
import { useAuth } from "../../hooks/useAuth";

export default function UserProfileScreen() {
  const { user, logout } = useAuth();
  const [fcmToken, setFcmToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const saveToken = async () => {
    if (!fcmToken.trim()) return;
    setSavingToken(true);
    setTokenError(null);
    try {
      await patchUserFcmToken(fcmToken.trim());
    } catch (err: any) {
      console.error("[UserProfile][saveToken]", err);
      setTokenError(
        err?.response?.data?.message ?? err?.message ?? "Failed to save FCM token",
      );
    } finally {
      setSavingToken(false);
    }
  };

  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
    } catch {
      // best effort
    }
    await logout();
    setLoggingOut(false);
    router.replace("/(driver)/login" as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F2F4F8]">
      <View className="flex-row items-center px-4 py-3 border-b border-slate-200 bg-white">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-base font-extrabold text-slate-900">Profile</Text>
      </View>

      <View className="p-4">
        <View className="rounded-xl bg-white p-4">
          <Text className="text-base font-bold text-slate-900">
            {user?.name ?? "User"}
          </Text>
          <Text className="mt-1 text-sm text-slate-500">
            ID: {user?.id ?? "-"}
          </Text>
          <Text className="text-sm text-slate-500">
            Role: {user?.role ?? "user"}
          </Text>
        </View>

        <View className="mt-4 rounded-xl bg-white p-4">
          <Text className="text-sm font-semibold text-slate-800">
            FCM Token
          </Text>
          <TextInput
            className="mt-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            placeholder="Paste device FCM token"
            value={fcmToken}
            onChangeText={setFcmToken}
            autoCapitalize="none"
          />
          <Pressable
            className="mt-3 items-center rounded-lg bg-[#1847BA] py-2.5"
            onPress={saveToken}
            disabled={savingToken || !fcmToken.trim()}
          >
            {savingToken ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-sm font-bold text-white">Save Token</Text>
            )}
          </Pressable>

          {tokenError ? (
            <Text className="mt-2 text-xs text-red-600">{tokenError}</Text>
          ) : null}
        </View>

        <Pressable
          className="mt-6 items-center rounded-lg bg-red-600 py-3"
          onPress={doLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-sm font-bold text-white">Logout</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

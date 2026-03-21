import {
  Entypo,
  Feather,
  FontAwesome5,
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import { addSentryBreadcrumb } from "../../monitoring/sentry";

export default function DriverLoginScreen() {
  useSentryScreen("driver/login");

  const [organizationSlug, setOrganizationSlug] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [secureText, setSecureText] = useState(true);
  const [role, setRole] = useState<"user" | "driver">("driver");
  const { login, loading, error } = useAuth();

  const roleOptions = useMemo(
    () => [
      { key: "user", label: "User" },
      { key: "driver", label: "Driver" },
    ],
    [],
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
      >
        <View className="rounded-3xl bg-white p-6 shadow-sm">
          <View className="items-center">
            <View className="h-28 w-28 items-center justify-center rounded-full bg-indigo-100">
              <MaterialCommunityIcons name="bus" size={44} color="#1d4ed8" />
            </View>

            <Text className="mt-6 text-2xl font-extrabold text-slate-900">
              CityTrack
            </Text>
            <Text className="mt-2 text-base text-slate-500">
              Bus Driver Portal
            </Text>
          </View>

          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&w=1200&q=80",
            }}
            className="mt-8 h-72 w-full rounded-3xl"
            resizeMode="cover"
          />

          <Text className="mt-10 text-2xl font-extrabold text-slate-900">
            Welcome back
          </Text>

          <View className="mt-8">
            <Text className="mb-2 text-sm font-semibold text-slate-800">
              Organization Slug
            </Text>
            <View className="h-12 flex-row items-center rounded-xl border border-slate-200 px-3">
              <Entypo name="briefcase" size={16} color="#94a3b8" />
              <TextInput
                className="ml-3 flex-1 text-sm text-slate-700"
                placeholder="Enter your organization slug"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                value={organizationSlug}
                onChangeText={setOrganizationSlug}
              />
            </View>
          </View>

          <View className="mt-8">
            <Text className="mb-2 text-sm font-semibold text-slate-800">
              Employee ID
            </Text>
            <View className="h-12 flex-row items-center rounded-xl border border-slate-200 px-3">
              <FontAwesome5 name="id-badge" size={16} color="#94a3b8" />
              <TextInput
                className="ml-3 flex-1 text-sm text-slate-700"
                placeholder="Enter your employee ID"
                placeholderTextColor="#94a3b8"
                value={employeeId}
                onChangeText={setEmployeeId}
              />
            </View>
          </View>

          <View className="mt-6">
            <Text className="mb-2 text-sm font-semibold text-slate-800">
              Password
            </Text>
            <View className="h-12 flex-row items-center rounded-xl border border-slate-200 px-3">
              <Ionicons name="lock-closed" size={18} color="#94a3b8" />
              <TextInput
                className="ml-3 flex-1 text-sm text-slate-700"
                placeholder="••••••••"
                placeholderTextColor="#94a3b8"
                secureTextEntry={secureText}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable onPress={() => setSecureText((prev) => !prev)}>
                <Feather
                  name={secureText ? "eye" : "eye-off"}
                  size={22}
                  color="#94a3b8"
                />
              </Pressable>
            </View>
          </View>

          <View className="mt-6">
            <Text className="mb-2 text-sm font-semibold text-slate-800">
              Role
            </Text>
            <View className="flex-row gap-3">
              {roleOptions.map((option) => {
                const isActive = role === option.key;
                return (
                  <Pressable
                    key={option.key}
                    className={`flex-1 items-center rounded-xl border px-4 py-3 ${
                      isActive
                        ? "border-blue-700 bg-blue-50"
                        : "border-slate-200 bg-white"
                    }`}
                    onPress={() => setRole(option.key as "user" | "driver")}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        isActive ? "text-blue-700" : "text-slate-600"
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error && (
            <View className="mt-4 rounded-lg bg-red-50 p-3">
              <Text className="text-sm font-semibold text-red-700">
                {error}
              </Text>
            </View>
          )}

          <Pressable className="mt-5 self-end">
            <Text className="text-sm font-semibold text-blue-700">
              Forgot Password?
            </Text>
          </Pressable>

          <Pressable
            className="mt-8 flex-row items-center justify-center rounded-xl bg-blue-700 py-4"
            onPress={async () => {
              addSentryBreadcrumb({
                category: "auth",
                message: "Driver login button tapped",
                level: "info",
                data: {
                  role,
                  hasOrganizationSlug: Boolean(organizationSlug.trim()),
                  hasEmployeeId: Boolean(employeeId.trim()),
                },
              });

              await login({
                role,
                organizationSlug: organizationSlug.trim().toLowerCase(),
                memberId: employeeId.trim(),
                password: password.trim(),
              });
            }}
            disabled={
              loading ||
              !organizationSlug.trim() ||
              !employeeId.trim() ||
              !password.trim()
            }
          >
            {loading && (
              <ActivityIndicator
                color="white"
                size="small"
                style={{ marginRight: 8 }}
              />
            )}
            <Text className="text-base font-bold text-white">
              {loading ? "Logging in..." : "Login to Dashboard"}
            </Text>
          </Pressable>

          <View className="mt-8 border-t border-slate-200 pt-6">
            <Text className="text-center text-sm text-slate-500">
              Need technical assistance?{" "}
              <Text className="font-semibold text-blue-700">
                Contact Support
              </Text>
            </Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center justify-center gap-6">
          <View className="flex-row items-center gap-2">
            <Entypo name="globe" size={14} color="#94a3b8" />
            <Text className="text-sm text-slate-400">v4.2.0</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Ionicons name="shield-checkmark" size={14} color="#94a3b8" />
            <Text className="text-sm text-slate-400">Secure Access</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

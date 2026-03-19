import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Pressable, Text, View } from "react-native";
import "../global.css";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  console.error("[GlobalErrorBoundary] Unhandled app error", error);

  return (
    <View className="flex-1 items-center justify-center bg-slate-100 px-6">
      <Text className="text-2xl font-extrabold text-slate-900">Something went wrong</Text>
      <Text className="mt-3 text-center text-sm text-slate-600">
        {error?.message ?? "Unexpected runtime error"}
      </Text>
      <Pressable className="mt-6 rounded-xl bg-blue-700 px-5 py-3" onPress={retry}>
        <Text className="text-sm font-bold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(driver)" options={{ headerShown: false }} />
      <Stack.Screen name="(user)" options={{ headerShown: false }} />
    </Stack>
  );
}

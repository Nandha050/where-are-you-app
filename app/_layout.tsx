import { Stack } from "expo-router";
import "../global.css";

export default function RootLayout() {
  const isLoggedIn = true; // later connect to auth

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {!isLoggedIn ? (
        <Stack.Screen name="(auth)" />
      ) : (
        <Stack.Screen name="(tabs)" />
      )}
    </Stack>
  );
}

import { Stack } from "expo-router";
import "../global.css";

export default function RootLayout() {
  const isLoggedIn = false; // Replace with actual authentication logic

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {!isLoggedIn ? (
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      ) : (
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      )}
    </Stack>
  );
}

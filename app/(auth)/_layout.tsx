import { Stack } from "expo-router";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function AuthLayout() {
    useSentryScreen("auth/layout");

    return <Stack screenOptions={{ headerShown: false }} />;
}

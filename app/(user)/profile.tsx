import { NotificationSettingsScreen } from "@/components";
import { useSentryScreen } from "../../hooks/useSentryScreen";

export default function UserProfileScreen() {
  useSentryScreen("user/profile");

  return <NotificationSettingsScreen />;
}

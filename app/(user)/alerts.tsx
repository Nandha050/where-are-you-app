import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UserNotification } from "../../api/types";
import { getUserNotifications, markUserNotificationRead } from "../../api/user";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import { captureSentryException } from "../../monitoring/sentry";

export default function UserAlertsScreen() {
  useSentryScreen("user/alerts");

  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const list = await getUserNotifications();
        setNotifications(list);
      } catch (error) {
        captureSentryException(error, {
          tags: {
            area: "user_alerts",
            operation: "load_notifications",
          },
        });
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const markAsRead = async (notificationId: string) => {
    try {
      await markUserNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notificationId
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (error) {
      captureSentryException(error, {
        tags: {
          area: "user_alerts",
          operation: "mark_as_read",
        },
        extra: {
          notificationId,
        },
        level: "warning",
      });
      // best-effort
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F2F4F8]">
      <View className="flex-row items-center px-4 py-3 border-b border-slate-200 bg-white">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-base font-extrabold text-slate-900">Alerts</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1847BA" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        >
          {notifications.length === 0 ? (
            <View className="rounded-xl bg-white p-5">
              <Text className="text-sm text-slate-500">
                No notifications yet
              </Text>
            </View>
          ) : (
            notifications.map((item) => {
              const unread = !(item.isRead ?? Boolean(item.readAt));
              return (
                <Pressable
                  key={item.id}
                  className="mb-3 rounded-xl bg-white p-4"
                  onPress={() => {
                    if (unread) {
                      markAsRead(item.id);
                    }
                  }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-2">
                      <Text className="text-sm font-bold text-slate-900">
                        {item.title ?? "Bus Notification"}
                      </Text>
                      <Text className="mt-1 text-xs text-slate-600">
                        {item.message ?? item.body ?? "New update available"}
                      </Text>
                    </View>
                    {unread && (
                      <View className="mt-1 h-2.5 w-2.5 rounded-full bg-[#1847BA]" />
                    )}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

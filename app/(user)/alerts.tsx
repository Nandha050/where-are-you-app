import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
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

const formatTime = (isoString?: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  
  // Format as e.g. "10:30 AM • Jun 4"
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${time} • ${day}`;
};

const getTypeLabel = (type?: string) => {
  if (!type) return 'Update';
  switch (type.toLowerCase()) {
    case 'busnearstop':
    case 'near_stop':
      return 'Near Stop';
    case 'busarrived':
    case 'arrived':
      return 'Arrived';
    case 'tripstarted':
    case 'trip_started':
      return 'Trip Started';
    case 'delayalerts':
    case 'delay':
      return 'Delay';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

const getTypeColors = (type?: string) => {
  if (!type) return { bg: '#F1F5F9', text: '#475569', border: '#E2E8F0' };
  switch (type.toLowerCase()) {
    case 'busnearstop':
    case 'near_stop':
      return { bg: '#EFF6FF', text: '#2563EB', border: '#DBEAFE' };
    case 'busarrived':
    case 'arrived':
      return { bg: '#ECFDF5', text: '#059669', border: '#D1FAE5' };
    case 'tripstarted':
    case 'trip_started':
      return { bg: '#F5F3FF', text: '#7C3AED', border: '#EDE9FE' };
    case 'delayalerts':
    case 'delay':
      return { bg: '#FFFBEB', text: '#D97706', border: '#FEF3C7' };
    default:
      return { bg: '#F8FAFC', text: '#64748B', border: '#F1F5F9' };
  }
};

export default function UserAlertsScreen() {
  useSentryScreen("user/alerts");

  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const list = await getUserNotifications();
      // Sort new ones first
      const sorted = [...list].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setNotifications(sorted);
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

  useEffect(() => {
    void loadNotifications();
  }, []);

  const markAsRead = async (notificationId: string) => {
    // Optimistic Update UI instantly
    setNotifications((prev) =>
      prev.map((item) =>
        item.id === notificationId
          ? { ...item, isRead: true, readAt: new Date().toISOString() }
          : item
      )
    );

    try {
      await markUserNotificationRead(notificationId);
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
      // Rollback on failure
      void loadNotifications();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F8FAFC]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
        <View className="flex-row items-center">
          <Pressable 
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()} 
            className="mr-3 p-1"
          >
            <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </Pressable>
          <Text className="text-base font-extrabold text-slate-900">Alerts</Text>
        </View>
        
        {/* Refresh button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh alerts"
          onPress={loadNotifications}
          className="p-1"
          disabled={loading}
        >
          <Ionicons name="refresh" size={20} color={loading ? "#94A3B8" : "#0F172A"} />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563EB" />
          <Text className="text-sm text-slate-500 mt-2">Loading alerts...</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        >
          {notifications.length === 0 ? (
            <View className="rounded-2xl bg-white p-8 items-center justify-center border border-slate-100">
              <Ionicons name="notifications-off-outline" size={48} color="#94A3B8" />
              <Text className="text-sm text-slate-500 mt-3 font-semibold">
                No notifications yet
              </Text>
              <Text className="text-xs text-slate-400 mt-1 text-center">
                We&apos;ll notify you when there&apos;s an update regarding your bus trip.
              </Text>
            </View>
          ) : (
            notifications.map((item) => {
              const unread = !(item.isRead ?? Boolean(item.readAt));
              const colors = getTypeColors(item.type);

              return (
                <Pressable
                  key={item.id}
                  className={`mb-3 rounded-2xl bg-white p-4 border ${
                    unread ? 'border-blue-100 shadow-sm shadow-blue-50' : 'border-slate-100'
                  }`}
                  onPress={() => {
                    if (unread) {
                      void markAsRead(item.id);
                    }
                  }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-2">
                      <View className="flex-row items-center flex-wrap mb-2">
                        {/* Type Badge */}
                        <View 
                          style={{ backgroundColor: colors.bg, borderColor: colors.border }} 
                          className="px-2 py-0.5 rounded border mr-2"
                        >
                          <Text style={{ color: colors.text }} className="text-[10px] font-bold tracking-wide uppercase">
                            {getTypeLabel(item.type)}
                          </Text>
                        </View>
                        
                        {/* Timestamp */}
                        {item.createdAt && (
                          <Text className="text-[11px] text-slate-400">
                            {formatTime(item.createdAt)}
                          </Text>
                        )}
                      </View>

                      <Text className={`text-[15px] ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                        {item.title ?? "Bus Notification"}
                      </Text>
                      
                      <Text className="mt-1 text-xs text-slate-500 leading-relaxed">
                        {item.message ?? item.body ?? "New update available"}
                      </Text>
                    </View>

                    {unread && (
                      <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-600" />
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

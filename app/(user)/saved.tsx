import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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
import { UserSubscription } from "../../api/types";
import {
  deleteUserSubscription,
  getUserBusLive,
  getUserSubscriptions,
} from "../../api/user";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import { captureSentryException } from "../../monitoring/sentry";

type SavedSubscriptionItem = {
  subscription: UserSubscription;
  tripStatus?: string | null;
  lastUpdated?: string | null;
};

const USER_TRIP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Start soon",
  STARTED: "Trip started",
  RUNNING: "Bus moving",
  STOPPED: "Bus stopped",
  COMPLETED: "Trip ended",
  CANCELLED: "Trip cancelled",
};

const getTripStatusLabel = (status?: string | null): string => {
  if (!status || !status.trim()) {
    return "No active trip";
  }

  const normalized = status.trim().toUpperCase();
  return USER_TRIP_STATUS_LABELS[normalized] ?? normalized;
};

const getFreshnessLabel = (timestamp?: string | null): string => {
  if (!timestamp) {
    return "No updates";
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return "No updates";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (elapsedSeconds < 60) {
    return `Updated ${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `Updated ${elapsedMinutes}m ago`;
};

export default function SavedBusesScreen() {
  useSentryScreen("user/saved");

  const [items, setItems] = useState<SavedSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      try {
        const subscriptions = await getUserSubscriptions();
        const enriched = await Promise.all(
          subscriptions.map(async (subscription) => {
            try {
              const live = await getUserBusLive(String(subscription.busId));
              return {
                subscription,
                tripStatus: live.trip?.status ?? live.tripStatus ?? null,
                lastUpdated: live.lastUpdated ?? null,
              };
            } catch (error) {
              captureSentryException(error, {
                tags: {
                  area: "user_saved",
                  operation: "get_user_bus_live",
                },
                extra: {
                  busId: String(subscription.busId),
                },
                level: "warning",
              });
              return { subscription };
            }
          }),
        );

        setItems(enriched);
      } catch (error) {
        captureSentryException(error, {
          tags: {
            area: "user_saved",
            operation: "load_saved_buses",
          },
        });
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const remove = async (subscriptionId: string) => {
    try {
      await deleteUserSubscription(subscriptionId);
      setItems((previous) =>
        previous.filter((item) => item.subscription.id !== subscriptionId),
      );
    } catch (error) {
      captureSentryException(error, {
        tags: {
          area: "user_saved",
          operation: "delete_subscription",
        },
        extra: {
          subscriptionId,
        },
        level: "warning",
      });
      // keep existing state if delete fails
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <View className="flex-row items-center border-b border-slate-200 bg-white px-4 py-3">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </Pressable>
        <Text className="text-base font-extrabold text-slate-900">My Subscriptions</Text>
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
          {items.length === 0 ? (
            <View className="rounded-xl bg-white p-5">
              <Text className="text-sm text-slate-500">No subscriptions yet.</Text>
            </View>
          ) : (
            items.map((item) => {
              const subscription = item.subscription;

              return (
                <Pressable
                  key={subscription.id}
                  className="mb-3 rounded-xl bg-white p-4"
                  onPress={() =>
                    router.push({
                      pathname: "/(user)/tracking",
                      params: {
                        busId: String(subscription.busId),
                        plate: subscription.bus?.numberPlate,
                        route: subscription.bus?.routeName,
                        routeId: subscription.bus?.routeId,
                      },
                    } as any)
                  }
                >
                  <View className="flex-row items-center">
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                      <MaterialCommunityIcons name="bus" size={22} color="#1847BA" />
                    </View>

                    <View className="ml-3 flex-1">
                      <Text className="text-base font-bold text-slate-900">
                        {subscription.bus?.routeName ?? "Route"}
                      </Text>
                      <Text className="text-sm text-slate-500">
                        Plate: {subscription.bus?.numberPlate ?? "-"}
                      </Text>
                      <View className="mt-2 flex-row items-center gap-2">
                        <View className="rounded-full bg-blue-50 px-2.5 py-1">
                          <Text className="text-[11px] font-semibold text-blue-700">
                            {getTripStatusLabel(item.tripStatus)}
                          </Text>
                        </View>
                        <Text className="text-[11px] text-slate-500">
                          {getFreshnessLabel(item.lastUpdated)}
                        </Text>
                      </View>
                    </View>

                    <Pressable onPress={() => remove(subscription.id)}>
                      <Ionicons name="trash-outline" size={24} color="#EF4444" />
                    </Pressable>
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

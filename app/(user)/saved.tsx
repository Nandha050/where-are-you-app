import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UserSubscription } from "../../api/types";
import { deleteUserSubscription, getUserSubscriptions } from "../../api/user";

export default function SavedBusesScreen() {
  const [items, setItems] = useState<UserSubscription[]>([]);

  useEffect(() => {
    getUserSubscriptions()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const remove = async (subscriptionId: string) => {
    try {
      await deleteUserSubscription(subscriptionId);
      setItems((prev) => prev.filter((item) => item.id !== subscriptionId));
    } catch {
      // best-effort
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F2F4F8]">
      <View className="flex-row items-center px-4 py-3 border-b border-slate-200 bg-white">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-base font-extrabold text-slate-900">
          Saved Buses
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
      >
        {items.length === 0 ? (
          <View className="rounded-xl bg-white p-5">
            <Text className="text-sm text-slate-500">No saved buses yet</Text>
          </View>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              className="mb-3 rounded-xl bg-white p-4"
              onPress={() =>
                router.push({
                  pathname: "/(user)/tracking",
                  params: {
                    busId: item.busId,
                    plate: item.bus?.numberPlate,
                    route: item.bus?.routeName,
                    routeId: item.bus?.routeId,
                  },
                } as any)
              }
            >
              <View className="flex-row items-center">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                  <MaterialCommunityIcons
                    name="bus"
                    size={22}
                    color="#1847BA"
                  />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-base font-bold text-slate-900">
                    {item.bus?.routeName ?? "Route"}
                  </Text>
                  <Text className="text-sm text-slate-500">
                    Plate: {item.bus?.numberPlate ?? "-"}
                  </Text>
                </View>
                <Pressable onPress={() => remove(item.id)}>
                  <Ionicons name="trash-outline" size={24} color="#EF4444" />
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

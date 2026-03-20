import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BusSearchResult, UserSubscription } from "../../api/types";
import {
  createUserSubscription,
  deleteUserSubscription,
  getUserBusLive,
  getUserNotifications,
  getUserSubscriptions,
  searchUserBuses,
} from "../../api/user";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import { addSentryBreadcrumb, captureSentryException } from "../../monitoring/sentry";

interface SavedBusCard {
  subscriptionId: string;
  busId: string;
  numberPlate: string;
  routeName: string;
  routeId?: string;
  tripStatus?: string | null;
  lastUpdated?: string | null;
  nextStop?: string;
  etaLabel?: string;
}

const FALLBACK_MAP_IMAGE =
  "https://images.unsplash.com/photo-1577086664693-894d8405334a?auto=format&fit=crop&w=1400&q=80";

const USER_TRIP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Start soon",
  STARTED: "Trip started",
  RUNNING: "Bus moving",
  STOPPED: "Bus stopped",
  COMPLETED: "Trip ended",
  CANCELLED: "Trip cancelled",
};

const getTripStatusLabel = (status: unknown): string => {
  if (typeof status !== "string" || !status.trim()) {
    return "No active trip";
  }

  const normalized = status.trim().toUpperCase();
  return USER_TRIP_STATUS_LABELS[normalized] ?? normalized;
};

const getFreshnessLabel = (timestamp?: string | null): string => {
  if (!timestamp) {
    return "No updates yet";
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return "No updates yet";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));

  if (elapsedSeconds < 60) {
    return `Updated ${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `Updated ${elapsedMinutes}m ago`;
};

const extractSavedBus = (
  subscription: UserSubscription,
): SavedBusCard | null => {
  const busId = subscription.busId ?? subscription.bus?.id;
  const subscriptionId = subscription.id;

  if (!subscriptionId) return null;
  if (!busId) return null;

  return {
    subscriptionId,
    busId,
    numberPlate: subscription.bus?.numberPlate ?? "BUS",
    routeName: subscription.bus?.routeName ?? "Route",
    routeId: subscription.bus?.routeId,
    tripStatus: null,
    lastUpdated: null,
    nextStop: subscription.stop?.name,
    etaLabel: subscription.notifyOnNearStop ? "Near Stop" : "Bus Start",
  };
};

export default function UserHome() {
  useSentryScreen("user/home");

  const { isAuthenticated, isHydrated } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BusSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [savedBuses, setSavedBuses] = useState<SavedBusCard[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);

  const loadSavedAndNotifications = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setLoadingSaved(true);
    try {
      const [subscriptions, notifications] = await Promise.all([
        getUserSubscriptions(),
        getUserNotifications(),
      ]);

      const mapped = subscriptions
        .map(extractSavedBus)
        .filter((item): item is SavedBusCard => Boolean(item));

      const enriched = await Promise.all(
        mapped.map(async (item) => {
          try {
            const live = await getUserBusLive(item.busId);
            return {
              ...item,
              tripStatus: live.trip?.status ?? live.tripStatus ?? null,
              lastUpdated: live.lastUpdated ?? null,
            };
          } catch (liveErr) {
            console.warn("[UserHome][getUserBusLive]", {
              busId: item.busId,
              error: liveErr,
            });
            captureSentryException(liveErr, {
              tags: {
                area: "user_home",
                operation: "get_user_bus_live",
              },
              extra: {
                busId: item.busId,
              },
              level: "warning",
            });
            return item;
          }
        }),
      );

      setSavedBuses(enriched);
      setNotificationCount(
        notifications.filter((n) => !(n.isRead ?? Boolean(n.readAt))).length,
      );
    } catch (loadErr) {
      console.error("[UserHome][loadSavedAndNotifications]", loadErr);
      captureSentryException(loadErr, {
        tags: {
          area: "user_home",
          operation: "load_saved_and_notifications",
        },
      });

      // Backend unreachable – keep UI usable with empty data
      setSavedBuses([]);
      setNotificationCount(0);
    } finally {
      setLoadingSaved(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(
    useCallback(() => {
      loadSavedAndNotifications();
    }, [loadSavedAndNotifications]),
  );

  const doSearch = async (raw: string) => {
    const numberPlate = raw.trim().toUpperCase();
    if (!numberPlate) {
      setResults([]);
      return;
    }

    setQuery(numberPlate);

    setSearching(true);
    setHasSearched(true);
    setSearchError(null);

    addSentryBreadcrumb({
      category: "user_home",
      message: "Bus search requested",
      level: "info",
      data: {
        numberPlate,
      },
    });

    try {
      const list = await searchUserBuses(numberPlate);
      setResults(list);
      if (list.length === 0) {
        setSearchError("No buses found for this number plate");
      }
      setRecentSearches((prev) => {
        const deduped = prev.filter(
          (item) => item.toLowerCase() !== numberPlate.toLowerCase(),
        );
        return [numberPlate, ...deduped].slice(0, 8);
      });
    } catch (error: any) {
      console.error("[UserHome][doSearch]", {
        numberPlate,
        error,
      });
      captureSentryException(error, {
        tags: {
          area: "user_home",
          operation: "search_buses",
        },
        extra: {
          numberPlate,
        },
      });

      setSearchError(
        error?.response?.data?.message ?? error?.message ?? "Search failed",
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const savedMap = useMemo(
    () => new Map(savedBuses.map((item) => [item.busId, item])),
    [savedBuses],
  );

  const toggleSaved = async (bus: BusSearchResult) => {
    try {
      if (!bus?.busId) {
        return;
      }

      const existing = savedMap.get(bus.busId);

      addSentryBreadcrumb({
        category: "user_home",
        message: existing ? "Removing bus subscription" : "Creating bus subscription",
        level: "info",
        data: {
          busId: bus.busId,
          numberPlate: bus.numberPlate,
        },
      });

      if (existing) {
        await deleteUserSubscription(existing.subscriptionId);
        setSavedBuses((prev) => prev.filter((b) => b.busId !== bus.busId));
        return;
      }

      const created = await createUserSubscription({
        busId: bus.busId,
        notifyOnBusStart: true,
        notifyOnNearStop: true,
        nearRadiusMeters: 150,
      });

      const mapped = extractSavedBus(created);
      if (mapped) {
        setSavedBuses((prev) => [
          {
            ...mapped,
            numberPlate: bus.numberPlate,
            routeName: bus.routeName,
          },
          ...prev,
        ]);
      }
    } catch (saveErr) {
      console.error("[UserHome][toggleSaved]", {
        busId: bus?.busId,
        error: saveErr,
      });
      captureSentryException(saveErr, {
        tags: {
          area: "user_home",
          operation: "toggle_saved",
        },
        extra: {
          busId: bus?.busId ?? null,
        },
        level: "warning",
      });

      // best-effort – keep UI usable
    }
  };

  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(driver)/login" />;
  }

  return (
    <SafeAreaView className="flex-1 bg-[#F2F4F8]">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 18 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-200 bg-white">
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="bus" size={22} color="#1847BA" />
            <Text className="text-xl font-extrabold text-slate-900">
              BusTracker
            </Text>
          </View>
          <Pressable onPress={() => router.push("/(user)/alerts" as any)}>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
              <Ionicons
                name="notifications-outline"
                size={20}
                color="#475569"
              />
            </View>
            {notificationCount > 0 && (
              <View className="absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full bg-red-500 px-1 items-center justify-center">
                <Text className="text-[9px] font-bold text-white">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Search hero card */}
        <View className="px-4 pt-4">
          <View className="rounded-2xl bg-[#1E43B8] px-5 py-5 shadow-sm">
            <Text className="text-xl font-extrabold text-white">
              Where is your bus?
            </Text>
            <View className="mt-3 flex-row items-center rounded-xl bg-white px-3">
              <Feather name="search" size={18} color="#95A2B7" />
              <TextInput
                className="ml-2 flex-1 py-3 text-sm text-slate-800"
                placeholder="Search by plate (e.g., ABC-1234)"
                placeholderTextColor="#95A2B7"
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => doSearch(query)}
                autoCapitalize="characters"
                returnKeyType="search"
              />
              {searching ? (
                <ActivityIndicator size="small" color="#1847BA" />
              ) : (
                <Pressable onPress={() => doSearch(query)}>
                  <Ionicons
                    name="arrow-forward-circle"
                    size={22}
                    color="#1847BA"
                  />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Search results */}
        {hasSearched && (
          <View className="mt-3 px-4">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-bold text-slate-900">
                Search Results
              </Text>
              <Text className="text-xs font-semibold text-slate-500">
                {results.length} found
              </Text>
            </View>

            {results.length === 0 ? (
              <View className="rounded-xl border border-slate-200 bg-white p-4">
                <Text className="text-sm text-slate-600">
                  No buses found. Please check the plate number and try again.
                </Text>
              </View>
            ) : (
              results.map((bus) => {
                const isSaved = savedMap.has(bus.busId);
                return (
                  <Pressable
                    key={`top-${bus.busId}`}
                    className="mb-3 rounded-xl border border-slate-200 bg-white p-4"
                    onPress={() => {
                      router.push({
                        pathname: "/(user)/tracking",
                        params: {
                          busId: String(bus.busId),
                          plate: bus.numberPlate,
                          route: bus.routeName,
                          routeId: bus.routeId,
                        },
                      } as any);
                    }}
                  >
                    <View className="flex-row items-center">
                      <View className="h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <MaterialCommunityIcons
                          name="bus"
                          size={24}
                          color="#1847BA"
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-base font-bold text-slate-900">
                          {bus.routeName}
                        </Text>
                        <Text className="text-sm text-slate-500">
                          Plate: {bus.numberPlate}
                        </Text>
                        <View className="mt-2 flex-row items-center gap-2">
                          <View className="rounded-full bg-blue-50 px-2.5 py-1">
                            <Text className="text-[11px] font-semibold text-blue-700">
                              {getTripStatusLabel(bus.tripStatus)}
                            </Text>
                          </View>
                          <Text className="text-[11px] text-slate-500">
                            {getFreshnessLabel(bus.lastUpdated)}
                          </Text>
                        </View>
                      </View>
                      <Pressable onPress={() => toggleSaved(bus)}>
                        <Ionicons
                          name={isSaved ? "star" : "star-outline"}
                          size={22}
                          color="#1847BA"
                        />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {/* Map preview */}
        <View className="px-4 pt-4">
          <ImageBackground
            source={{ uri: FALLBACK_MAP_IMAGE }}
            imageStyle={{ borderRadius: 16 }}
            className="h-40 overflow-hidden rounded-2xl"
          >
            <View className="absolute inset-0 bg-black/25" />
            <View className="absolute bottom-3 left-3 flex-row items-center">
              <View className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <Text className="ml-2 text-sm font-semibold text-white">
                Live Transit View
              </Text>
            </View>
          </ImageBackground>
        </View>

        {/* Search error */}
        {searchError && (
          <View className="mx-4 mt-3 rounded-xl bg-red-50 px-4 py-3">
            <Text className="text-sm text-red-700">{searchError}</Text>
          </View>
        )}

        {/* Saved Buses */}
        <View className="mt-4 px-4">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-slate-900">
              Saved Buses
            </Text>
            <Pressable onPress={() => router.push("/(user)/saved" as any)}>
              <Text className="text-sm font-semibold text-[#1847BA]">
                View All
              </Text>
            </Pressable>
          </View>

          {loadingSaved ? (
            <View className="items-center py-6">
              <ActivityIndicator size="small" color="#1847BA" />
            </View>
          ) : savedBuses.length === 0 ? (
            <View className="rounded-xl border border-slate-200 bg-white p-4">
              <Text className="text-sm text-slate-500">No saved buses yet</Text>
            </View>
          ) : (
            savedBuses.slice(0, 2).map((item) => (
              <Pressable
                key={item.subscriptionId}
                className="mb-3 rounded-xl border border-slate-200 bg-white p-4"
                onPress={() =>
                  router.push({
                    pathname: "/(user)/tracking",
                    params: {
                      busId: String(item.busId),
                      plate: item.numberPlate,
                      route: item.routeName,
                      routeId: item.routeId,
                    },
                  } as any)
                }
              >
                <View className="flex-row items-center">
                  <View className="h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                    <MaterialCommunityIcons
                      name="bus"
                      size={24}
                      color="#1847BA"
                    />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-base font-bold text-slate-900">
                      {item.routeName}
                    </Text>
                    <Text className="text-sm text-slate-500">
                      Plate: {item.numberPlate}
                      {item.nextStop ? ` · Next: ${item.nextStop}` : ""}
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
                  <View className="items-end gap-1">
                    <View className="rounded-full bg-emerald-100 px-2.5 py-1">
                      <Text className="text-xs font-bold text-emerald-700">
                        {item.etaLabel ?? "Notify"}
                      </Text>
                    </View>
                    <Ionicons name="star" size={20} color="#1847BA" />
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </View>

        {/* Recent Searches */}
        <View className="mt-2 px-4 pb-2">
          <Text className="mb-3 text-lg font-bold text-slate-900">
            Recent Searches
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {recentSearches.map((term) => (
              <Pressable
                key={term}
                className="flex-row items-center rounded-full border border-slate-300 bg-[#EAF0F6] px-4 py-2"
                onPress={() => {
                  setQuery(term);
                  doSearch(term);
                }}
              >
                <Feather name="clock" size={14} color="#334155" />
                <Text className="ml-2 text-sm text-slate-700">{term}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Bottom navigation */}
      <View className="flex-row items-center justify-around border-t border-slate-200 bg-white py-2.5">
        <Pressable
          className="items-center"
          onPress={() => router.replace("/(user)/home" as any)}
        >
          <Ionicons name="home" size={22} color="#1847BA" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-[#1847BA]">
            HOME
          </Text>
        </Pressable>
        <Pressable
          className="items-center"
          onPress={() => router.push("/(user)/alerts" as any)}
        >
          <Ionicons name="notifications-outline" size={22} color="#94A3B8" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-slate-400">
            ALERTS
          </Text>
        </Pressable>
        <Pressable
          className="items-center"
          onPress={() => router.push("/(user)/profile" as any)}
        >
          <Ionicons name="person-outline" size={22} color="#94A3B8" />
          <Text className="mt-0.5 text-[11px] font-bold tracking-wide text-slate-400">
            PROFILE
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

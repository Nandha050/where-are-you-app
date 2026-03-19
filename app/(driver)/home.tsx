import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logoutGeneric } from "../../api/auth";
import {
  DriverMeSnapshot,
  getActiveTrip,
  getDriverMe,
  startTrip,
  stopTrip,
} from "../../api/driver";
import { ActiveTrip } from "../../api/types";
import { useAuth } from "../../hooks/useAuth";

type LocalTripHistoryItem = {
  id: string;
  endedAt: string;
  status: string;
};

const DEFAULT_ME: DriverMeSnapshot = {
  driver: null,
  bus: null,
  route: null,
  stops: [],
};

const DRIVER_TRIP_LABELS: Record<string, string> = {
  PENDING: "Ready to start",
  STARTED: "Trip started",
  RUNNING: "Bus moving",
  STOPPED: "Bus stopped",
  COMPLETED: "Trip completed",
  CANCELLED: "Trip cancelled",
};

const getTripLabel = (status: unknown): string => {
  if (typeof status !== "string" || !status.trim()) {
    return "Ready to start";
  }

  const normalized = status.trim().toUpperCase();
  return DRIVER_TRIP_LABELS[normalized] ?? normalized;
};

const isAlreadyActiveTripError = (error: unknown): boolean => {
  const e = error as {
    response?: {
      status?: number;
      data?: {
        message?: string;
        code?: string;
      };
    };
  };

  if (e?.response?.status === 409) {
    return true;
  }

  const message = (e?.response?.data?.message ?? "").toLowerCase();
  const code = (e?.response?.data?.code ?? "").toLowerCase();

  return (
    message.includes("active trip") ||
    message.includes("already") ||
    code.includes("active_trip")
  );
};

export default function DriverHome() {
  const { isAuthenticated, isHydrated, user, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<DriverMeSnapshot>(DEFAULT_ME);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [history, setHistory] = useState<LocalTripHistoryItem[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);

  const hasAssignment = Boolean(me.bus?.id && me.route?.id);

  const startDisabledReason = useMemo(() => {
    if (hasAssignment) {
      return null;
    }

    if (!me.bus?.id && !me.route?.id) {
      return "No assigned bus and no assigned route.";
    }

    if (!me.bus?.id) {
      return "No assigned bus.";
    }

    return "No assigned route.";
  }, [hasAssignment, me.bus?.id, me.route?.id]);

  const loadDashboard = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [driverMe, trip] = await Promise.all([getDriverMe(), getActiveTrip()]);
      setMe(driverMe);
      setActiveTrip(trip);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err?.message ?? "Failed to load dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutGeneric();
    } catch {
      // best effort
    }

    await logout();
    setLoggingOut(false);
    router.replace("/(driver)/login" as any);
  };

  const handleStartTrip = async () => {
    if (actionLoading || !hasAssignment) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const started = await startTrip();
      setActiveTrip(started ?? (await getActiveTrip()));
      router.push("/(driver)/tracking" as any);
    } catch (err: any) {
      if (isAlreadyActiveTripError(err)) {
        try {
          const current = await getActiveTrip();
          setActiveTrip(current);
          router.push("/(driver)/tracking" as any);
        } catch (fallbackErr: any) {
          setError(
            fallbackErr?.response?.data?.message ??
            fallbackErr?.message ??
            "Trip appears active, but failed to fetch its latest state",
          );
        }
      } else {
        setError(
          err?.response?.data?.message ?? err?.message ?? "Unable to start trip",
        );
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopTrip = async () => {
    if (actionLoading || !activeTrip) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      await stopTrip();
      const latest = await getActiveTrip();

      if (!latest) {
        setHistory((previous) => [
          {
            id: activeTrip?.id ?? new Date().toISOString(),
            endedAt: new Date().toISOString(),
            status: activeTrip?.status ?? "COMPLETED",
          },
          ...previous,
        ].slice(0, 8));
      }

      setActiveTrip(latest);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err?.message ?? "Unable to stop trip",
      );
    } finally {
      setActionLoading(false);
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

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-100">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Driver Home
            </Text>
            <Text className="mt-1 text-2xl font-extrabold text-slate-900">
              {user?.name ?? "Driver"}
            </Text>
          </View>

          <Pressable
            onPress={handleLogout}
            disabled={loggingOut}
            className="h-12 w-12 items-center justify-center rounded-xl bg-white"
          >
            {loggingOut ? (
              <ActivityIndicator size="small" color="#1d4ed8" />
            ) : (
              <MaterialIcons name="logout" size={20} color="#ef4444" />
            )}
          </Pressable>
        </View>

        <View className="mt-4 rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              My Bus and Route
            </Text>
            <MaterialCommunityIcons name="bus" size={24} color="#1d4ed8" />
          </View>

          <Text className="mt-2 text-xl font-extrabold text-slate-900">
            {me.bus?.numberPlate ?? "No bus assigned"}
          </Text>
          <Text className="mt-1 text-sm text-slate-600">
            {me.route?.name ?? "No route assigned"}
          </Text>
          <Text className="mt-2 text-xs text-slate-500">
            Stops: {me.stops.length}
          </Text>
        </View>

        <View className="mt-4 rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Trip
            </Text>
            <View
              className={`rounded-full px-3 py-1 ${activeTrip ? "bg-emerald-100" : "bg-slate-200"
                }`}
            >
              <Text
                className={`text-xs font-bold ${activeTrip ? "text-emerald-700" : "text-slate-600"
                  }`}
              >
                {activeTrip ? "In progress" : "Ready"}
              </Text>
            </View>
          </View>

          <Text className="mt-2 text-lg font-extrabold text-slate-900">
            {activeTrip ? getTripLabel(activeTrip.status) : "Ready to start"}
          </Text>

          {error ? (
            <View className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          ) : null}

          {!activeTrip && startDisabledReason ? (
            <Text className="mt-3 text-sm text-amber-700">{startDisabledReason}</Text>
          ) : null}

          <View className="mt-4 gap-3">
            {activeTrip ? (
              <Pressable
                className={`items-center rounded-xl py-4 ${actionLoading ? "bg-slate-300" : "bg-red-600"
                  }`}
                onPress={handleStopTrip}
                disabled={actionLoading}
              >
                <Text className="text-base font-extrabold text-white">
                  {actionLoading ? "Stopping..." : "Stop Trip"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                className={`items-center rounded-xl py-4 ${actionLoading || !hasAssignment ? "bg-slate-300" : "bg-blue-700"
                  }`}
                onPress={handleStartTrip}
                disabled={actionLoading || !hasAssignment}
              >
                <Text className="text-base font-extrabold text-white">
                  {actionLoading ? "Starting..." : "Start Trip"}
                </Text>
              </Pressable>
            )}

            <Pressable
              className="items-center rounded-xl border border-slate-300 bg-slate-50 py-4"
              onPress={() => router.push("/(driver)/tracking" as any)}
            >
              <Text className="text-base font-bold text-slate-800">
                Open Live Map and Telemetry
              </Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4 rounded-2xl bg-white p-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Trip History (Local)
          </Text>

          {history.length === 0 ? (
            <Text className="mt-3 text-sm text-slate-500">No local trip history yet.</Text>
          ) : (
            history.map((item) => (
              <View key={`${item.id}-${item.endedAt}`} className="mt-3 rounded-xl bg-slate-100 p-3">
                <Text className="text-sm font-semibold text-slate-800">{getTripLabel(item.status)}</Text>
                <Text className="mt-1 text-xs text-slate-500">Ended at {new Date(item.endedAt).toLocaleString()}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

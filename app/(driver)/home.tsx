import {
    Entypo,
    Feather,
    Ionicons,
    MaterialCommunityIcons,
    MaterialIcons,
} from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { Redirect, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logoutGeneric } from "../../api/auth";
import apiClient from "../../api/client";
import { DriverMyRouteResponse } from "../../api/types";
import RouteMap from "../../components/RouteMap";
import { useAuth } from "../../hooks/useAuth";

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function DriverHome() {
  const { isAuthenticated, isHydrated, user, logout } = useAuth();
  const [routeData, setRouteData] = useState<DriverMyRouteResponse | null>(
    null,
  );
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapPath, setMapPath] = useState<MapCoordinate[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutGeneric();
    } catch {
      /* best-effort */
    }
    await logout();
    setLoggingOut(false);
    router.replace("/(driver)/login" as any);
  };

  useEffect(() => {
    const fetchMyRoute = async () => {
      if (!isAuthenticated) {
        setLoadingRoute(false);
        return;
      }

      setLoadingRoute(true);
      setRouteError(null);

      try {
        const response = await apiClient.get<
          DriverMyRouteResponse | { data?: DriverMyRouteResponse }
        >("/api/driver/my-route");
        const payload =
          (response.data as { data?: DriverMyRouteResponse }).data ??
          (response.data as DriverMyRouteResponse);

        if (!payload?.route || !payload?.bus) {
          throw new Error("Route details not available");
        }

        setRouteData(payload);
      } catch (error: any) {
        setRouteError(
          error?.response?.data?.message ||
            error?.message ||
            "Failed to load route details",
        );
      } finally {
        setLoadingRoute(false);
      }
    };

    if (isHydrated) {
      fetchMyRoute();
    }
  }, [isAuthenticated, isHydrated]);

  useEffect(() => {
    const decodeEncodedPolyline = (encoded: string): MapCoordinate[] => {
      const points = polyline.decode(encoded) as [number, number][];
      return points.map(([latitude, longitude]) => ({ latitude, longitude }));
    };

    const enrichWithGoogleDirections = async (coords: MapCoordinate[]) => {
      if (Platform.OS === "web" || !GOOGLE_MAPS_API_KEY || coords.length < 2) {
        return coords;
      }

      const origin = coords[0];
      const destination = coords[coords.length - 1];

      const url =
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}` +
        `&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;

      const response = await fetch(url);
      const json = await response.json();
      const encoded = json?.routes?.[0]?.overview_polyline?.points as
        | string
        | undefined;

      if (!encoded) {
        return coords;
      }

      return decodeEncodedPolyline(encoded);
    };

    const buildMapPath = async () => {
      const encodedPolyline = routeData?.route?.encodedPolyline;
      if (!encodedPolyline) {
        setMapPath([]);
        return;
      }

      try {
        const decoded = decodeEncodedPolyline(encodedPolyline);
        if (decoded.length === 0) {
          setMapPath([]);
          return;
        }

        const enhanced = await enrichWithGoogleDirections(decoded);
        setMapPath(enhanced);
      } catch {
        setMapPath([]);
      }
    };

    buildMapPath();
  }, [routeData]);

  const statusLabel = useMemo(() => {
    if (!routeData?.route) {
      return "NO ROUTE";
    }
    return routeData.route.isActive ? "ACTIVE" : "INACTIVE";
  }, [routeData]);

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
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 bg-white">
          <View className="flex-row items-center gap-3">
            <Entypo name="menu" size={24} color="#1e293b" />
            <Text className="text-xl font-bold text-slate-900">
              Driver Dashboard
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Feather name="bell" size={20} color="#1f2937" />
            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              className="h-9 w-9 items-center justify-center rounded-full bg-slate-100"
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color="#1d4ed8" />
              ) : (
                <MaterialIcons name="logout" size={18} color="#ef4444" />
              )}
            </Pressable>
          </View>
        </View>

        {/* Profile */}
        <View className="flex-row items-center gap-4 px-4 py-5 bg-white">
          <View className="h-18 w-18 items-center justify-center rounded-full border-[3px] border-slate-200 bg-indigo-100">
            <MaterialCommunityIcons name="bus" size={34} color="#1d4ed8" />
          </View>
          <View className="flex-1">
            <Text className="text-2xl font-extrabold text-slate-900">
              {user?.name || "Driver"}
            </Text>
            <Text className="mt-1 text-sm text-slate-600">
              {user?.id || "-"} · {user?.role || "driver"}
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <View
                className={`h-2.5 w-2.5 rounded-full ${
                  routeData?.route?.isActive ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              <Text className="text-xs font-semibold uppercase tracking-widest text-slate-600">
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* Assignment card */}
        <View className="mt-4 px-4">
          <Text className="text-xs font-bold tracking-[0.18em] text-slate-500">
            ACTIVE ASSIGNMENT
          </Text>

          <View className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
            {loadingRoute ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="large" color="#1d4ed8" />
              </View>
            ) : routeError ? (
              <View className="rounded-2xl bg-red-50 px-4 py-4">
                <Text className="text-base font-semibold text-red-700">
                  {routeError}
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-bold text-blue-800">
                    ROUTE
                  </Text>
                  <View className="rounded-2xl bg-indigo-100 px-4 py-2">
                    <Text className="text-base font-bold text-indigo-800">
                      {routeData?.bus?.numberPlate || "-"}
                    </Text>
                  </View>
                </View>

                <Text className="mt-2 text-2xl font-extrabold text-slate-900">
                  {routeData?.route?.name || "No Route Assigned"}
                </Text>

                <View className="mt-3 flex-row items-center gap-2">
                  <MaterialCommunityIcons
                    name="bus"
                    size={20}
                    color="#475569"
                  />
                  <Text className="text-sm text-slate-600">
                    Bus {routeData?.bus?.numberPlate || "-"}
                  </Text>
                </View>

                <View className="mt-3 rounded-xl bg-slate-100 px-4 py-3">
                  <Text className="text-sm text-slate-700">
                    Distance:{" "}
                    {routeData?.route?.totalDistanceText ||
                      `${routeData?.route?.totalDistanceMeters || 0} m`}
                  </Text>
                  <Text className="mt-1 text-sm text-slate-700">
                    ETA:{" "}
                    {routeData?.route?.etaToDestinationText ||
                      routeData?.route?.estimatedDurationText ||
                      `${Math.round(
                        (routeData?.route?.estimatedDurationSeconds || 0) / 60,
                      )} min`}
                  </Text>
                  <Text className="mt-1 text-sm text-slate-700">
                    Remaining:{" "}
                    {routeData?.route?.distanceToDestinationText || "-"}
                  </Text>
                  <Text className="mt-1 text-sm text-slate-700">
                    Stops: {routeData?.stops?.length || 0}
                  </Text>
                </View>

                {mapPath.length > 0 && (
                  <View className="mt-3 h-52 overflow-hidden rounded-xl">
                    <RouteMap coordinates={mapPath} />
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* Go online */}
        <View className="mt-6 px-4">
          <Pressable
            className="flex-row items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-4 shadow-md"
            onPress={() => router.push("/(driver)/tracking")}
          >
            <Ionicons name="power" size={20} color="white" />
            <Text className="text-lg font-extrabold text-white">Go Online</Text>
          </Pressable>

          <Text className="mt-3 text-center text-sm text-slate-600">
            Go online to start tracking your route and notify dispatch that
            you&apos;re in service.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

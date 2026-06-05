import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getRouteStops,
  getAssignedStop,
  saveAssignedStop,
  getUserSubscriptions,
  getUserActiveTrip,
} from '../../api/user';
import { notificationService } from '../../src/core/notifications/NotificationService';
import { captureSentryException } from '../../monitoring/sentry';

interface RouteStop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sequenceOrder: number;
}

export default function SelectStopScreen() {
  const params = useLocalSearchParams<{ routeId?: string }>();
  const [routeId, setRouteId] = useState<string | null>(params.routeId || null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [assignedStopId, setAssignedStopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve Route ID from multiple sources: param -> assignedStop -> subscriptions -> active trip
  useEffect(() => {
    const resolveRouteAndLoad = async () => {
      setLoading(true);
      setError(null);
      try {
        let resolvedRouteId = routeId;
        let resolvedAssignedStopId = null;

        // 1. Fetch current assigned stop
        try {
          const assigned = await getAssignedStop();
          if (assigned) {
            resolvedAssignedStopId = assigned.stopId || assigned.stop?.id || assigned.id;
            setAssignedStopId(resolvedAssignedStopId);
            if (!resolvedRouteId && assigned.routeId) {
              resolvedRouteId = assigned.routeId;
            }
          }
        } catch (err) {
          // Fallback to local storage if API is offline
          const localAssigned = await notificationService.getLocalAssignedStop();
          if (localAssigned) {
            resolvedAssignedStopId = localAssigned.stopId || localAssigned.stop?.id || localAssigned.id;
            setAssignedStopId(resolvedAssignedStopId);
            if (!resolvedRouteId && localAssigned.routeId) {
              resolvedRouteId = localAssigned.routeId;
            }
          }
        }

        // 2. If no route ID resolved yet, fallback to subscriptions
        if (!resolvedRouteId) {
          try {
            const subscriptions = await getUserSubscriptions();
            if (subscriptions && subscriptions.length > 0) {
              resolvedRouteId = subscriptions[0].bus?.routeId || null;
            }
          } catch (err) {
            console.log('[SelectStop] Failed to fetch subscriptions for fallback:', err);
          }
        }

        // 3. Fallback to active trip
        if (!resolvedRouteId) {
          try {
            const activeTrip = await getUserActiveTrip();
            if (activeTrip && activeTrip.data?.route?.id) {
              resolvedRouteId = activeTrip.data.route.id;
            }
          } catch (err) {
            console.log('[SelectStop] Failed to fetch active trip for fallback:', err);
          }
        }

        if (!resolvedRouteId) {
          setError('No active route found. Please subscribe to a bus first.');
          setLoading(false);
          return;
        }

        setRouteId(resolvedRouteId);

        // Fetch stops for the route
        const routeStops = await getRouteStops(resolvedRouteId);
        
        // Ensure stops are ordered by sequenceOrder
        const sorted = [...routeStops].sort((a, b) => {
          const seqA = a.sequenceOrder ?? 0;
          const seqB = b.sequenceOrder ?? 0;
          return seqA - seqB;
        });

        setStops(sorted);
      } catch (err: any) {
        captureSentryException(err, { tags: { area: 'select_stop', op: 'resolve_route' } });
        setError(err.message || 'Failed to load route stops.');
      } finally {
        setLoading(false);
      }
    };

    resolveRouteAndLoad();
  }, []);

  const handleSelectStop = async (stop: RouteStop) => {
    if (!routeId) return;
    setSavingId(stop.id);
    setError(null);
    try {
      await saveAssignedStop(routeId, stop.id);
      
      // Save locally
      await notificationService.saveAssignedStopLocally({
        routeId,
        stopId: stop.id,
        stop: { id: stop.id, name: stop.name, latitude: stop.latitude, longitude: stop.longitude },
      });

      setAssignedStopId(stop.id);
      
      // Return back
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(user)/profile');
      }
    } catch (err: any) {
      captureSentryException(err, {
        tags: { area: 'select_stop', op: 'save_assigned_stop' },
        extra: { routeId, stopId: stop.id },
      });
      setError(err.message || 'Failed to save assigned stop. Please try again.');
    } finally {
      setSavingId(null);
    }
  };

  const renderStopItem = ({ item }: { item: RouteStop }) => {
    const isSelected = assignedStopId === item.id;
    const isSaving = savingId === item.id;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select stop: ${item.name}`}
        onPress={() => !isSaving && handleSelectStop(item)}
        disabled={isSaving || savingId !== null}
        className={`flex-row items-center justify-between p-4 mb-3 rounded-xl border ${
          isSelected 
            ? 'border-blue-600 bg-blue-50/50' 
            : 'border-slate-100 bg-white'
        }`}
      >
        <View className="flex-row items-center flex-1 pr-3">
          <View className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
            isSelected ? 'bg-blue-600' : 'bg-slate-100'
          }`}>
            <Text className={`text-xs font-semibold ${
              isSelected ? 'text-white' : 'text-slate-600'
            }`}>
              {item.sequenceOrder}
            </Text>
          </View>
          <View className="flex-1">
            <Text className={`text-sm font-semibold ${
              isSelected ? 'text-blue-900' : 'text-slate-900'
            }`}>
              {item.name}
            </Text>
            <Text className="text-xs text-slate-400 mt-0.5">
              Lat: {item.latitude.toFixed(4)}, Lng: {item.longitude.toFixed(4)}
            </Text>
          </View>
        </View>

        {isSaving ? (
          <ActivityIndicator size="small" color="#1d4ed8" />
        ) : isSelected ? (
          <Ionicons name="checkmark-circle" size={24} color="#2563eb" />
        ) : (
          <Feather name="circle" size={20} color="#cbd5e1" />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
        <Pressable 
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()} 
          className="p-1"
        >
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </Pressable>
        <Text className="text-base font-bold text-slate-900">Select Pickup Stop</Text>
        <View className="w-6" />
      </View>

      {/* Info Card */}
      <View className="m-4 p-4 rounded-xl bg-blue-50 border border-blue-100 flex-row items-start">
        <Feather name="info" size={18} color="#1d4ed8" style={{ marginTop: 2, marginRight: 8 }} />
        <View className="flex-1">
          <Text className="text-xs leading-5 text-blue-800 font-semibold">
            All bus arrival notifications are based on your assigned stop, NOT your live GPS location. Make sure you select the correct pickup stop.
          </Text>
        </View>
      </View>

      {error && (
        <View className="mx-4 p-3 rounded-lg bg-red-50 border border-red-200">
          <Text className="text-xs text-red-700 font-medium">{error}</Text>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563eb" />
          <Text className="text-sm text-slate-500 mt-3">Loading route stops...</Text>
        </View>
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(item) => item.id}
          renderItem={renderStopItem}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View className="items-center justify-center p-8 bg-white rounded-xl border border-slate-100">
              <Feather name="map-pin" size={40} color="#94a3b8" />
              <Text className="text-sm text-slate-500 mt-2">No stops found on this route.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

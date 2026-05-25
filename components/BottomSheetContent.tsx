import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { BottomSheetState } from "./BottomSheet";
import { NextStopCard } from "./NextStopCard";
import { StopsTimeline, TimelineStop } from "./StopsTimeline";
import { TripHeader } from "./TripHeader";

interface BottomSheetContentProps {
    state: BottomSheetState;
    tripStatusBadge: string;
    tripStatusLabel: string;
    trackingStatusLabel: string;
    nextStop: string;
    nextStopEta: string;
    tripEtaToDestination: string;
    destinationDistance: string;
    routeName: string;
    routeStart: string;
    routeEnd: string;
    stops: TimelineStop[];
    currentStopId?: string | null;
    nextStopId?: string | null;
    busApproaching: boolean;
    isSubscribed: boolean;
    onSubscribePress: () => void;
    submittingSubscription: boolean;
    freshnessLabel: string;
}

const RouteInfo = ({ start, end }: { start: string; end: string }) => (
    <View className="rounded-[24px] bg-slate-50 px-4 py-4">
        <Text className="text-xs font-medium text-slate-500">
            Route info
        </Text>
        <View className="mt-3 flex-row items-center">
            <Text className="flex-1 text-[15px] font-semibold text-slate-900" numberOfLines={1}>
                {start}
            </Text>
            <View className="mx-3 h-px flex-1 bg-slate-200" />
            <Text className="flex-1 text-right text-[15px] font-semibold text-slate-900" numberOfLines={1}>
                {end}
            </Text>
        </View>
    </View>
);

export const BottomSheetContent: React.FC<BottomSheetContentProps> = ({
    state,
    tripStatusBadge,
    tripStatusLabel,
    trackingStatusLabel,
    nextStop,
    nextStopEta,
    tripEtaToDestination,
    destinationDistance,
    routeName,
    routeStart,
    routeEnd,
    stops,
    currentStopId,
    nextStopId,
    busApproaching,
    isSubscribed,
    onSubscribePress,
    submittingSubscription,
    freshnessLabel,
}) => {
    const collapsedDetail = `${routeName} • ${String(trackingStatusLabel || "Upcoming").toLowerCase()}`;

    if (state === "collapsed") {
        return (
            <View className="px-4 pb-5 pt-1">
                <NextStopCard
                    variant="bottom-sheet-collapsed"
                    stopName={nextStop}
                    etaLabel={nextStopEta}
                    busApproaching={busApproaching}
                    detailLabel={collapsedDetail}
                />
            </View>
        );
    }

    if (state === "half") {
        return (
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
                className="flex-1"
            >
                <TripHeader
                    statusBadge={tripStatusBadge}
                    routeTitle={routeName}
                    etaToDestination={tripEtaToDestination}
                    freshnessLabel={freshnessLabel}
                />

                <View className="mb-4 rounded-[24px] bg-white/90 px-4 py-4 shadow-sm">
                    <Text className="text-xs font-medium text-slate-500">
                        Trip status
                    </Text>
                    <Text className="mt-2 text-base font-semibold text-slate-950">
                        {tripStatusLabel}
                    </Text>
                    <Text className="mt-1 text-sm font-medium text-slate-700">
                        Tracking: {trackingStatusLabel}
                    </Text>
                    <Text className="mt-1 text-sm text-slate-500">{freshnessLabel}</Text>
                </View>

                <View className="mb-4 rounded-[24px] bg-white/90 px-4 py-4 shadow-sm">
                    <Text className="text-xs font-medium text-slate-500">
                        Destination
                    </Text>
                    <View className="mt-2 flex-row items-center justify-between">
                        <Text className="text-sm font-medium text-slate-700">ETA</Text>
                        <Text className="text-base font-semibold text-blue-700">{tripEtaToDestination}</Text>
                    </View>
                    <View className="mt-1 flex-row items-center justify-between">
                        <Text className="text-sm font-medium text-slate-700">Distance</Text>
                        <Text className="text-base font-semibold text-slate-900">{destinationDistance}</Text>
                    </View>
                </View>

                <RouteInfo start={routeStart} end={routeEnd} />

                <View className="mt-4">
                    <NextStopCard
                        stopName={nextStop}
                        etaLabel={nextStopEta}
                        busApproaching={busApproaching}
                        detailLabel="Tap or swipe up for the full stop list"
                    />
                </View>

                <Pressable
                    className={`mt-4 flex-row items-center justify-center rounded-[22px] px-4 py-4 shadow-sm ${isSubscribed ? "bg-emerald-100" : "bg-blue-600"}`}
                    onPress={onSubscribePress}
                    disabled={submittingSubscription || isSubscribed}
                >
                    {submittingSubscription ? (
                        <ActivityIndicator size="small" color={isSubscribed ? "#047857" : "white"} />
                    ) : (
                        <>
                            <Ionicons
                                name={isSubscribed ? "notifications" : "notifications-outline"}
                                size={18}
                                color={isSubscribed ? "#047857" : "white"}
                            />
                            <Text
                                className={`ml-2 text-sm font-semibold ${isSubscribed ? "text-emerald-700" : "text-white"}`}
                            >
                                {isSubscribed ? "Subscribed for alerts" : "Subscribe for alerts"}
                            </Text>
                        </>
                    )}
                </Pressable>
            </ScrollView>
        );
    }

    const passedCount = stops.filter((stop) => stop.status === "passed").length;

    return (
        <View className="flex-1 px-4 pb-4">
            <View className="mb-4 rounded-[26px] bg-white px-4 py-4 shadow-sm">
                <View className="flex-row items-start justify-between">
                    <View className="mr-3 flex-1">
                        <Text className="text-[30px] font-bold leading-[34px] text-slate-950" numberOfLines={2}>
                            {routeName}
                        </Text>

                        <View className="mt-3 flex-row items-center">
                            <View className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                            <Text className="ml-2 text-[15px] font-semibold text-emerald-700">
                                {tripStatusLabel}
                            </Text>
                            <Text className="ml-3 text-[15px] text-slate-600">ETA {nextStopEta}</Text>
                        </View>
                    </View>

                    <View className="h-[84px] w-[84px] items-center justify-center rounded-[18px] bg-blue-600">
                        <Text className="text-[34px] font-bold leading-[36px] text-white">
                            {String(nextStopEta).match(/\d+/)?.[0] ?? "-"}
                        </Text>
                        <Text className="text-[10px] font-medium tracking-[0.12em] text-blue-100">min</Text>
                    </View>
                </View>

                <Text className="mt-3 text-xs text-slate-500">
                    {passedCount}/{stops.length} stops passed • {freshnessLabel}
                </Text>
            </View>

            <StopsTimeline
                stops={stops}
                currentStopId={currentStopId}
                nextStopId={nextStopId}
                sheetPosition={state}
            />
        </View>
    );
};

import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

export type NextStopCardProps = {
    stopName: string;
    etaLabel: string;
    busApproaching?: boolean;
    detailLabel?: string;
    onPress?: () => void;
    compact?: boolean;
    variant?: "default" | "bottom-sheet-collapsed";
};

export const NextStopCard: React.FC<NextStopCardProps> = ({
    stopName,
    etaLabel,
    busApproaching = false,
    detailLabel,
    onPress,
    compact = false,
    variant = "default",
}) => {
    if (variant === "bottom-sheet-collapsed") {
        const collapsedContent = (
            <>
                <View className="flex-row items-center justify-between">
                    <View className="min-w-0 flex-1 flex-row items-center pr-3">
                        <View className="mr-3 items-center" style={{ width: 14 }}>
                            <View className="h-2.5 w-0.5 bg-blue-300" />
                            <View className="-mt-0.5 h-3.5 w-3.5 rounded-full bg-blue-600" />
                            <View className="h-4 w-0.5 bg-blue-200" />
                        </View>

                        <View className="min-w-0 flex-1">
                            <Text className="text-[17px] font-semibold leading-[22px] text-slate-900" numberOfLines={1}>
                                Next Stop: {stopName}
                            </Text>
                            {detailLabel ? (
                                <Text className="mt-0.5 text-[13px] font-medium text-slate-600" numberOfLines={1}>
                                    {detailLabel}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    <View className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2.5">
                        <Text className="text-[15px] font-semibold leading-[18px] text-blue-700" numberOfLines={1}>
                            ETA: {etaLabel}
                        </Text>
                    </View>
                </View>

                {busApproaching ? (
                    <View className="mt-3 flex-row items-center rounded-xl bg-emerald-50 px-3 py-2">
                        <MaterialCommunityIcons name="radar" size={16} color="#2563EB" />
                        <Text className="ml-2 text-xs font-semibold text-emerald-700">
                            Bus is near your stop
                        </Text>
                    </View>
                ) : null}
            </>
        );

        if (onPress) {
            return (
                <Pressable
                    onPress={onPress}
                    className={`rounded-[24px] border border-slate-300 bg-[#E7ECF1] px-4 py-4 ${busApproaching ? "border-emerald-200" : ""}`}
                >
                    {collapsedContent}
                </Pressable>
            );
        }

        return (
            <View className={`rounded-[24px] border border-slate-300 bg-[#E7ECF1] px-4 py-4 ${busApproaching ? "border-emerald-200" : ""}`}>
                {collapsedContent}
            </View>
        );
    }

    const content = (
        <>
            <View className="flex-row items-start justify-between">
                <View className="min-w-0 flex-1 flex-row items-start pr-3">
                    <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                        <MaterialCommunityIcons name="bus-marker" size={24} color="#2563EB" />
                    </View>

                    <View className="min-w-0 flex-1">
                        <Text className="text-xs font-medium text-slate-500">
                            Next stop
                        </Text>
                        <Text
                            className={`mt-1 font-bold leading-[25px] text-slate-950 ${compact ? "text-[18px]" : "text-[20px]"}`}
                            numberOfLines={2}
                        >
                            {stopName}
                        </Text>
                        {detailLabel ? (
                            <Text className="mt-1 text-[13px] text-slate-600" numberOfLines={1}>
                                {detailLabel}
                            </Text>
                        ) : null}
                    </View>
                </View>

                <View className="min-w-[82px] items-center rounded-2xl bg-slate-50 px-3 py-2">
                    <Text className="text-[11px] font-medium text-slate-500">
                        ETA
                    </Text>
                    <Text className="mt-1 text-[18px] font-bold text-blue-700" numberOfLines={1}>
                        {etaLabel}
                    </Text>
                </View>
            </View>

            {busApproaching ? (
                <View className="mt-3 flex-row items-center rounded-xl bg-blue-50 px-3 py-2">
                    <MaterialCommunityIcons name="radar" size={16} color="#2563EB" />
                    <Text className="ml-2 text-xs font-semibold text-blue-700">
                        Bus is near your stop
                    </Text>
                </View>
            ) : null}
        </>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                className={`rounded-[24px] bg-white/90 px-4 py-4 shadow-sm ${busApproaching ? "border border-blue-100" : ""}`}
            >
                {content}
            </Pressable>
        );
    }

    return (
        <View className={`rounded-[24px] bg-white/90 px-4 py-4 shadow-sm ${busApproaching ? "border border-blue-100" : ""}`}>
            {content}
        </View>
    );
};

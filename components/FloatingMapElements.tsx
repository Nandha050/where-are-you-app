import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

export interface FloatingTransitCardProps {
    nextStop: string;
    subtitle: string;
    eta: string;
    onPress?: () => void;
}

export const FloatingTransitCard: React.FC<FloatingTransitCardProps> = ({
    nextStop,
    subtitle,
    eta,
    onPress,
}) => {
    return (
        <Pressable
            onPress={onPress}
            className="rounded-3xl border border-white/40 bg-white/85 px-4 py-3 shadow-lg"
            style={{
                shadowColor: "#000",
                shadowOpacity: 0.12,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 3 },
                elevation: 8,
            }}
        >
            <View className="flex-row items-center justify-between">
                {/* Left: Live indicator + Stop info */}
                <View className="flex-row flex-1 items-center gap-3">
                    <View className="relative items-center justify-center">
                        <View
                            className="h-3 w-3 rounded-full bg-blue-500"
                            style={{
                                shadowColor: "#3B82F6",
                                shadowOpacity: 0.6,
                                shadowRadius: 4,
                                elevation: 3,
                            }}
                        />
                        <View className="absolute inset-0 animate-pulse rounded-full bg-blue-400 opacity-20" />
                    </View>

                    <View className="flex-1 min-w-0">
                        <Text className="text-[13px] font-semibold text-slate-900" numberOfLines={1}>
                            Next Stop: <Text className="font-bold text-blue-600">{nextStop}</Text>
                        </Text>
                        <Text className="mt-0.5 text-[11px] text-slate-500" numberOfLines={1}>
                            {subtitle}
                        </Text>
                    </View>
                </View>

                {/* Right: ETA pill */}
                <View className="ml-3 items-end justify-center rounded-2xl bg-blue-50 px-3 py-2">
                    <Text className="text-[12px] font-semibold text-blue-600">
                        ETA: <Text className="font-bold">{eta}</Text>
                    </Text>
                </View>
            </View>
        </Pressable>
    );
};

export interface FloatingSearchBarProps {
    placeholder?: string;
    onPress?: () => void;
}

export const FloatingSearchBar: React.FC<FloatingSearchBarProps> = ({
    placeholder = "Search locations",
    onPress,
}) => {
    return (
        <Pressable
            onPress={onPress}
            className="mx-4 flex-row items-center gap-2 rounded-2xl border border-white/40 bg-white/80 px-3 py-2.5 shadow"
            style={{
                shadowColor: "#000",
                shadowOpacity: 0.08,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 4,
            }}
        >
            <MaterialCommunityIcons name="magnify" size={18} color="#94a3b8" />
            <Text className="flex-1 text-[14px] text-slate-400">
                {placeholder}
            </Text>
        </Pressable>
    );
};

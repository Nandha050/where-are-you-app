import React from "react";
import { Text, View } from "react-native";

export type TripHeaderProps = {
    statusBadge: string;
    routeTitle: string;
    etaToDestination: string;
    freshnessLabel: string;
    compact?: boolean;
};

const badgeStyles: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
};

const resolveBadgeStyle = (statusBadge: string) => {
    const normalized = statusBadge.trim().toUpperCase();

    if (normalized.includes("RUNNING")) {
        return badgeStyles.green;
    }

    if (normalized.includes("ON TIME")) {
        return badgeStyles.blue;
    }

    if (normalized.includes("STOP") || normalized.includes("OFFLINE") || normalized.includes("PENDING")) {
        return badgeStyles.amber;
    }

    if (normalized.includes("RECONNECT")) {
        return badgeStyles.amber;
    }

    return badgeStyles.slate;
};

export const TripHeader: React.FC<TripHeaderProps> = ({
    statusBadge,
    routeTitle,
    etaToDestination,
    freshnessLabel,
    compact = false,
}) => {
    const badgeStyle = resolveBadgeStyle(statusBadge);

    return (
        <View className={compact ? "mb-4" : "mb-5"}>
            <View className="mb-3 flex-row items-center justify-between">
                <View className={`rounded-full px-3 py-1 ${badgeStyle}`}>
                    <Text className="text-xs font-semibold" style={{ fontFamily: "Poppins_600SemiBold" }}>
                        {statusBadge}
                    </Text>
                </View>
                <Text className="text-xs font-medium text-slate-500" style={{ fontFamily: "Poppins_500Medium" }}>
                    {freshnessLabel}
                </Text>
            </View>

            <View className="flex-row items-end justify-between">
                <View className="flex-1 pr-3">
                    <Text
                        className={`font-bold text-slate-950 ${compact ? "text-[22px]" : "text-[24px]"}`}
                        style={{ fontFamily: "Poppins_700Bold" }}
                        numberOfLines={2}
                    >
                        {routeTitle}
                    </Text>
                </View>

                <View className="items-end">
                    <Text className="text-xs font-medium text-slate-500" style={{ fontFamily: "Poppins_500Medium" }}>
                        ETA to destination
                    </Text>
                    <Text className="mt-1 text-[24px] font-bold text-blue-700" style={{ fontFamily: "Poppins_700Bold" }}>
                        {etaToDestination}
                    </Text>
                </View>
            </View>
        </View>
    );
};

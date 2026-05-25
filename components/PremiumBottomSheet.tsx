import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StopItem, StopItemStatus } from "./StopItem";

export type TimelineStop = {
    id: string;
    name: string;
    status: "passed" | "current" | "upcoming";
    time?: string;
    eta?: string;
    helperText?: string;
    sequenceOrder?: number;
};

export interface PremiumBottomSheetProps {
    routeOrigin: string;
    routeDestination: string;
    stops: TimelineStop[];
    expandedHeight?: number;
    onClose?: () => void;
}

const DragHandle = ({ onPress }: { onPress?: () => void }) => (
    <Pressable onPress={onPress} className="flex-col items-center justify-center py-3">
        <View
            className="h-1 rounded-full bg-gray-300"
            style={{ width: 48 }}
        />
    </Pressable>
);

const RouteHeader = ({ origin, destination }: { origin: string; destination: string }) => (
    <View className="flex-col items-center justify-center px-4 py-2">
        <Text
            className="text-center text-base font-semibold text-gray-900"
            style={{ fontFamily: "Poppins_600SemiBold" }}
        >
            <Text className="font-bold" style={{ fontFamily: "Poppins_700Bold" }}>{origin}</Text>
            <Text className="mx-2 font-light text-gray-400" style={{ fontFamily: "Poppins_400Regular" }}>→</Text>
            <Text className="font-semibold text-gray-700" style={{ fontFamily: "Poppins_600SemiBold" }}>{destination}</Text>
        </Text>
    </View>
);

export const PremiumBottomSheet = React.forwardRef<View, PremiumBottomSheetProps>(
    (
        {
            routeOrigin,
            routeDestination,
            stops,
            expandedHeight = 720,
            onClose,
        },
        ref,
    ) => {
        return (
            <View
                ref={ref}
                className="flex-1 overflow-hidden"
                style={{
                    backgroundColor: "#F7F7F8",
                    borderTopLeftRadius: 32,
                    borderTopRightRadius: 32,
                    shadowColor: "#000",
                    shadowOpacity: 0.12,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: -8 },
                    elevation: 20,
                }}
            >
                <DragHandle onPress={onClose} />

                <RouteHeader origin={routeOrigin} destination={routeDestination} />

                <View className="mx-4 mb-4 h-px bg-gray-200" />

                <ScrollView
                    scrollEnabled={true}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 32, paddingTop: 8 }}
                    className="flex-1"
                    nestedScrollEnabled={true}
                >
                    {stops.map((stop, index) => (
                        <StopItem
                            key={stop.id}
                            name={stop.name}
                            status={stop.status as StopItemStatus}
                            leftSubLabel={stop.helperText}
                            rightPrimaryLabel={stop.time || stop.eta}
                            rightSecondaryLabel={stop.status === "current" ? "CURRENT" : undefined}
                            sequence={stop.sequenceOrder}
                            isLast={index === stops.length - 1}
                        />
                    ))}
                </ScrollView>
            </View>
        );
    },
);

PremiumBottomSheet.displayName = "PremiumBottomSheet";

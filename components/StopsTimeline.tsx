import React, { useEffect, useMemo, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { BottomSheetState } from "./BottomSheet";
import { StopItem, StopItemStatus } from "./StopItem";

export type TimelineStop = {
    id?: string;
    name: string;
    status: StopItemStatus;
    sequence?: number;
    leftSubLabel?: string;
    rightPrimaryLabel?: string;
    rightSecondaryLabel?: string;
};

export type StopsTimelineProps = {
    stops: TimelineStop[];
    currentStopId?: string | null;
    nextStopId?: string | null;
    sheetPosition: BottomSheetState;
};

export const StopsTimeline: React.FC<StopsTimelineProps> = ({
    stops,
    currentStopId,
    nextStopId,
    sheetPosition,
}) => {
    const scrollRef = useRef<ScrollView>(null);
    const positionsRef = useRef<Record<string, number>>({});

    const activeStopId = useMemo(() => {
        return currentStopId ?? nextStopId ?? null;
    }, [currentStopId, nextStopId]);

    useEffect(() => {
        if (sheetPosition !== "full" || !activeStopId) {
            return;
        }

        const timer = setTimeout(() => {
            const y = positionsRef.current[activeStopId];
            if (typeof y === "number") {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
            }
        }, 120);

        return () => clearTimeout(timer);
    }, [activeStopId, sheetPosition, stops.length]);

    if (!stops.length) {
        return (
            <View className="items-center justify-center py-10">
                <Text
                    className="text-sm text-gray-500"
                    style={{ fontFamily: "Poppins_500Medium" }}
                >
                    No stops available
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32, paddingTop: 8 }}
            className="flex-1"
            style={{ backgroundColor: "#F7F7F8" }}
        >
            <Text
                className="mb-4 px-4 text-xs font-medium text-gray-600"
                style={{ fontFamily: "Poppins_600SemiBold" }}
            >
                Route Stops
            </Text>

            {stops.map((stop, index) => (
                <StopItem
                    key={stop.id ?? `${stop.name}-${index}`}
                    name={stop.name}
                    status={stop.status}
                    leftSubLabel={stop.leftSubLabel}
                    rightPrimaryLabel={stop.rightPrimaryLabel}
                    rightSecondaryLabel={stop.rightSecondaryLabel}
                    sequence={stop.sequence}
                    isLast={index === stops.length - 1}
                    onLayout={(y) => {
                        if (stop.id) {
                            positionsRef.current[stop.id] = y;
                        }
                    }}
                />
            ))}
        </ScrollView>
    );
};

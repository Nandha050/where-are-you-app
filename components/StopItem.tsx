import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";

export type StopItemStatus = "passed" | "current" | "upcoming";

export type StopItemProps = {
    name: string;
    status: StopItemStatus;
    leftSubLabel?: string;
    rightPrimaryLabel?: string;
    rightSecondaryLabel?: string;
    sequence?: number;
    isLast?: boolean;
    onLayout?: (y: number) => void;
};

export const StopItem: React.FC<StopItemProps> = ({
    name,
    status,
    leftSubLabel,
    rightPrimaryLabel,
    rightSecondaryLabel,
    sequence,
    isLast = false,
    onLayout,
}) => {
    const scaleAnim = useRef(new Animated.Value(status === "current" ? 1 : 0)).current;
    const opacityAnim = useRef(new Animated.Value(status === "current" ? 1 : 0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(scaleAnim, {
                toValue: status === "current" ? 1 : 0,
                useNativeDriver: true,
                tension: 80,
                friction: 12,
            }),
            Animated.timing(opacityAnim, {
                toValue: status === "current" ? 1 : 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start();
    }, [scaleAnim, opacityAnim, status]);

    const isPassed = status === "passed";
    const isCurrent = status === "current";
    const isUpcoming = status === "upcoming";

    return (
        <View
            onLayout={(event) => onLayout?.(event.nativeEvent.layout.y)}
            className="py-0.5"
        >
            <View className="flex-row gap-5 px-4">
                {/* Timeline Column */}
                <View className="w-7 items-center pt-1">
                    {/* Status Indicator */}
                    <View className="relative">
                        {isPassed && (
                            <View
                                className="h-5 w-5 items-center justify-center rounded-full bg-green-700"
                                style={{
                                    shadowColor: "#000",
                                    shadowOpacity: 0.12,
                                    shadowRadius: 3,
                                    shadowOffset: { width: 0, height: 1 },
                                    elevation: 2,
                                }}
                            >
                                <Ionicons name="checkmark-sharp" size={11} color="white" />
                            </View>
                        )}

                        {isCurrent && (
                            <>
                                {/* Glow effect */}
                                <Animated.View
                                    style={{
                                        opacity: opacityAnim,
                                        transform: [{
                                            scale: scaleAnim.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [0.5, 1.4]
                                            })
                                        }],
                                    }}
                                    className="absolute inset-0 rounded-full border-2 border-blue-500"
                                    pointerEvents="none"
                                />
                                {/* Outer ring */}
                                <View className="h-6 w-6 items-center justify-center rounded-full border-3 border-white" style={{
                                    backgroundColor: "#2563EB",
                                    shadowColor: "#2563EB",
                                    shadowOpacity: 0.3,
                                    shadowRadius: 6,
                                    shadowOffset: { width: 0, height: 2 },
                                    elevation: 4,
                                }}>
                                    <View className="h-2.5 w-2.5 rounded-full bg-white" />
                                </View>
                            </>
                        )}

                        {isUpcoming && (
                            <View className="h-3 w-3 rounded-full bg-gray-300" />
                        )}
                    </View>

                    {/* Timeline Connector */}
                    {!isLast && (
                        <View
                            className={`w-0.5 flex-1 ${isPassed || isCurrent ? "bg-blue-500" : "bg-gray-300"
                                }`}
                            style={{ minHeight: 42, marginTop: 3 }}
                        />
                    )}
                </View>

                {/* Content Column */}
                <Animated.View
                    style={
                        isCurrent
                            ? {
                                transform: [{
                                    scale: scaleAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.95, 1]
                                    })
                                }],
                                backgroundColor: "#EEF4FF",
                                shadowColor: "#2563EB",
                                shadowOpacity: 0.08,
                                shadowRadius: 8,
                                shadowOffset: { width: 0, height: 2 },
                                elevation: 2,
                            }
                            : {}
                    }
                    className={`flex-1 py-2 ${isCurrent
                        ? "rounded-xl px-4 py-3"
                        : ""
                        }`}
                >
                    <View className="flex-row items-start justify-between gap-3">
                        {/* Left: Stop name & subtitle */}
                        <View className="flex-1">
                            <Text
                                className={`text-base font-bold leading-tight ${isPassed
                                    ? "text-gray-600"
                                    : isCurrent
                                        ? "text-blue-900"
                                        : "text-gray-900"
                                    }`}
                                style={{ fontFamily: "Poppins_700Bold" }}
                                numberOfLines={1}
                            >
                                {name}
                            </Text>

                            <Text
                                className={`mt-1 text-xs leading-tight ${isPassed
                                    ? "text-gray-500"
                                    : isCurrent
                                        ? "text-blue-600"
                                        : "text-gray-600"
                                    }`}
                                style={{ fontFamily: "Poppins_600SemiBold" }}
                                numberOfLines={1}
                            >
                                {leftSubLabel ??
                                    (isPassed
                                        ? "Departed 12:45 PM"
                                        : isCurrent
                                            ? "Arriving Now"
                                            : "In 6 mins")}
                            </Text>
                        </View>

                        {/* Right: Time & status */}
                        <View className="items-end">
                            <Text
                                className={`text-base font-bold ${isPassed
                                    ? "text-gray-500"
                                    : isCurrent
                                        ? "text-blue-600"
                                        : "text-gray-700"
                                    }`}
                                style={{ fontFamily: "Poppins_700Bold" }}
                                numberOfLines={1}
                            >
                                {rightPrimaryLabel ?? (isCurrent ? "1:04 PM" : "1:10 PM")}
                            </Text>

                            {isCurrent && (
                                <Text
                                    className="mt-1 text-xs font-semibold tracking-wider text-blue-600"
                                    style={{ fontFamily: "Poppins_600SemiBold" }}
                                    numberOfLines={1}
                                >
                                    CURRENT
                                </Text>
                            )}

                            {isPassed && (
                                <Text
                                    className="mt-1 text-xs font-medium text-gray-500"
                                    style={{ fontFamily: "Poppins_600SemiBold" }}
                                    numberOfLines={1}
                                >
                                    Passed
                                </Text>
                            )}
                        </View>
                    </View>
                </Animated.View>
            </View>
        </View>
    );
};

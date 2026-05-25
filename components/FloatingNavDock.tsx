import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

export type NavItem = "home" | "alerts" | "settings" | "label";

export interface FloatingNavDockProps {
    active: NavItem;
    onPress: (item: NavItem) => void;
    badgeCount?: number;
}

const NAV_ITEMS: Array<{ id: NavItem; icon: string; label: string; family: "material" | "ionicons" }> = [
    { id: "home", icon: "home-variant", label: "Home", family: "material" },
    { id: "alerts", icon: "alert-circle-outline", label: "Alerts", family: "material" },
    { id: "settings", icon: "cog-outline", label: "Settings", family: "material" },
    { id: "label", icon: "pricetag-outline", label: "Label", family: "ionicons" },
];

export const FloatingNavDock: React.FC<FloatingNavDockProps> = ({
    active,
    onPress,
    badgeCount = 0,
}) => {
    return (
        <View
            className="flex-row items-center justify-between rounded-full border border-white/40 bg-white/75 px-2 py-3 shadow-lg"
            style={{
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 4 },
                elevation: 12,
                backdropFilter: "blur(20px)",
                backgroundColor: "rgba(255, 255, 255, 0.78)",
            }}
        >
            {NAV_ITEMS.map((item) => {
                const isActive = active === item.id;

                const IconComponent = item.family === "ionicons" ? Ionicons : MaterialCommunityIcons;

                return (
                    <Pressable
                        key={item.id}
                        onPress={() => onPress(item.id)}
                        className="flex-1 items-center justify-center py-2"
                    >
                        <View
                            className={`relative flex-col items-center justify-center rounded-full p-2.5 transition-all ${isActive ? "bg-blue-100/80" : "bg-transparent"
                                }`}
                        >
                            <IconComponent
                                name={item.icon}
                                size={22}
                                color={isActive ? "#3B82F6" : "#475569"}
                                style={{
                                    opacity: isActive ? 1 : 0.6,
                                }}
                            />

                            {item.id === "alerts" && badgeCount > 0 && (
                                <View className="absolute -right-1 -top-0.5 flex-col items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5">
                                    <Text className="text-[10px] font-bold text-white">
                                        {badgeCount > 9 ? "9+" : badgeCount}
                                    </Text>
                                </View>
                            )}

                            <Text className={`mt-1 text-[10px] font-medium ${isActive ? "text-blue-600" : "text-slate-600"}`}>
                                {item.label}
                            </Text>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
};

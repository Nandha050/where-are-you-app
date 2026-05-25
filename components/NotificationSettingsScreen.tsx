import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    SafeAreaView,
    ScrollView,
    Switch,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { logoutUser } from "../api/auth";
import { useAuth } from "../hooks/useAuth";
import { captureSentryException } from "../monitoring/sentry";

type NotificationSettings = {
    busNearStop: boolean;
    busArrived: boolean;
    tripStarted: boolean;
    delayAlerts: boolean;
    sound: boolean;
    vibration: boolean;
    alertBeforeArrival: boolean;
};

export interface NotificationSettingsScreenProps { }

const PALETTE = {
    darkAccent: "#1F2937",
};

const SettingRow = ({
    title,
    description,
    value,
    onToggle,
}: {
    title: string;
    description: string;
    value: boolean;
    onToggle: (value: boolean) => void;
}) => (
    <Pressable
        onPress={() => onToggle(!value)}
        style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: "transparent",
        }}
    >
        <View style={{ flex: 1, paddingRight: 16 }}>
            <Text
                style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: "#000000",
                    marginBottom: 4,
                    lineHeight: 20,
                    fontFamily: "Poppins_600SemiBold",
                }}
            >
                {title}
            </Text>
            <Text
                style={{
                    fontSize: 13,
                    color: "#8E8E93",
                    lineHeight: 18,
                    fontWeight: "400",
                    fontFamily: "Poppins_400Regular",
                }}
                numberOfLines={3}
            >
                {description}
            </Text>
        </View>

        <View style={{ justifyContent: "flex-start", paddingTop: 0 }}>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: "#D1D5DB", true: "#424242" }}
                thumbColor={value ? "#FFFFFF" : "#FFFFFF"}
                ios_backgroundColor="#D1D5DB"
                style={{
                    width: 51,
                    height: 31,
                }}
            />
        </View>
    </Pressable>
);

const SectionHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12, alignItems: "center" }}>
        <Text
            style={{
                fontSize: 16,
                fontWeight: "600",
                color: "#000000",
                marginBottom: subtitle ? 4 : 0,
                textAlign: "center",
                fontFamily: "Poppins_600SemiBold",
            }}
        >
            {title}
        </Text>
        {subtitle && (
            <Text
                style={{
                    fontSize: 12,
                    color: "#8E8E93",
                    textAlign: "center",
                    lineHeight: 16,
                    fontFamily: "Poppins_400Regular",
                }}
            >
                {subtitle}
            </Text>
        )}
    </View>
);


export const NotificationSettingsScreen: React.FC<
    NotificationSettingsScreenProps
> = () => {
    const insets = useSafeAreaInsets();
    const { logout } = useAuth();
    const [settings, setSettings] = useState<NotificationSettings>({
        busNearStop: true,
        busArrived: true,
        tripStarted: true,
        delayAlerts: true,
        sound: true,
        vibration: false,
        alertBeforeArrival: true,
    });
    const [loggingOut, setLoggingOut] = useState(false);

    const toggleSetting = (
        key: keyof NotificationSettings,
        value: boolean
    ) => {
        setSettings((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            await logoutUser();
        } catch (error) {
            captureSentryException(error, {
                tags: {
                    area: "notification_settings",
                    operation: "logout_user_api",
                },
                level: "warning",
            });
        }
        await logout();
        setLoggingOut(false);
        router.replace("/(driver)/login" as any);
    };

    return (
        <SafeAreaView
            style={{
                flex: 1,
                backgroundColor: "#F5F5F7",
            }}
        >
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                style={{ flex: 1 }}
            >
                {/* Back Button */}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    onPress={() => {
                        if (router.canGoBack()) {
                            router.back();
                            return;
                        }
                        router.replace("/(user)/index" as never);
                    }}
                    style={{
                        position: "absolute",
                        left: 16,
                        top: insets.top + 12,
                        zIndex: 20,
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 50,
                        borderWidth: 1,
                        borderColor: "rgba(0, 0, 0, 0.1)",
                    }}
                >
                    <Ionicons name="chevron-back" size={20} color={PALETTE.darkAccent} />
                </Pressable>

                {/* Header Section */}
                <View style={{ alignItems: "center", paddingTop: 48, paddingBottom: 8, paddingHorizontal: 16 }}>
                    <Text
                        style={{
                            fontSize: 20,
                            fontWeight: "600",
                            color: "#000000",
                            textAlign: "center",
                            lineHeight: 28,
                            fontFamily: "Poppins_600SemiBold",
                        }}
                    >
                        Notifications
                    </Text>
                </View>

                {/* Description */}
                <View style={{ alignItems: "center", paddingHorizontal: 16, paddingBottom: 20 }}>
                    <Text
                        style={{
                            fontSize: 13,
                            color: "#8E8E93",
                            textAlign: "center",
                            lineHeight: 18,
                            fontWeight: "400",
                            fontFamily: "Poppins_400Regular",
                        }}
                    >
                        Stay updated with real-time alerts about your bus, stops, and journey. Customize what you want to be notified about.
                    </Text>
                </View>

                {/* Transit Alerts - First Group (No Section Header) */}
                <View style={{ paddingBottom: 8 }}>
                    <SettingRow
                        title="Bus Near My Stop"
                        description="Get notified when your bus is approaching your stop."
                        value={settings.busNearStop}
                        onToggle={(value) =>
                            toggleSetting("busNearStop", value)
                        }
                    />

                    <SettingRow
                        title="Bus Arrived"
                        description="Receive an alert when the bus reaches your stop."
                        value={settings.busArrived}
                        onToggle={(value) =>
                            toggleSetting("busArrived", value)
                        }
                    />

                    <SettingRow
                        title="Trip Started"
                        description="Get notified when your bus begins its journey."
                        value={settings.tripStarted}
                        onToggle={(value) =>
                            toggleSetting("tripStarted", value)
                        }
                    />

                    <SettingRow
                        title="Delay Alerts"
                        description="Stay informed if the bus is delayed or off schedule."
                        value={settings.delayAlerts}
                        onToggle={(value) =>
                            toggleSetting("delayAlerts", value)
                        }
                    />
                </View>

                {/* Sound & Feedback Section */}
                <SectionHeader
                    title="Sound & Feedback"
                    subtitle="Control how you receive alerts."
                />

                <View style={{ paddingBottom: 8 }}>
                    <SettingRow
                        title="Sound"
                        description="Stay informed if the bus is delayed or off schedule."
                        value={settings.sound}
                        onToggle={(value) => toggleSetting("sound", value)}
                    />

                    <SettingRow
                        title="Vibration"
                        description="Stay informed if the bus is delayed or off schedule."
                        value={settings.vibration}
                        onToggle={(value) =>
                            toggleSetting("vibration", value)
                        }
                    />
                </View>

                {/* Advanced Section */}
                <SectionHeader title="Advanced" />

                <View style={{ paddingBottom: 32 }}>
                    <SettingRow
                        title="Alert before arrival"
                        description="Stay informed if the bus is delayed or off schedule."
                        value={settings.alertBeforeArrival}
                        onToggle={(value) =>
                            toggleSetting("alertBeforeArrival", value)
                        }
                    />
                </View>

                {/* Logout Button */}
                <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                    <Pressable
                        onPress={handleLogout}
                        disabled={loggingOut}
                        style={{
                            backgroundColor: "#DC2626",
                            borderRadius: 12,
                            paddingVertical: 16,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: loggingOut ? 0.7 : 1,
                        }}
                    >
                        {loggingOut ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <Text
                                style={{
                                    fontSize: 15,
                                    fontWeight: "600",
                                    color: "#FFFFFF",
                                    fontFamily: "Poppins_600SemiBold",
                                }}
                            >
                                Logout
                            </Text>
                        )}
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useState, useCallback } from "react";
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
import { getAssignedStop } from "../api/user";
import { useAuth } from "../hooks/useAuth";
import { captureSentryException } from "../monitoring/sentry";
import {
    notificationService,
    NotificationPrefs,
    DEFAULT_PREFS,
    LanguageCode,
} from "../src/core/notifications/NotificationService";

const PALETTE = {
    darkAccent: "#0F172A",
    primaryBlue: "#2563EB",
    borderSlate: "#E2E8F0",
    bgSlate: "#F8FAFC",
};

interface SettingRowProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    value: boolean;
    onToggle: (value: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({
    icon,
    title,
    description,
    value,
    onToggle,
}) => (
    <Pressable
        onPress={() => onToggle(!value)}
        style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderColor: "#F1F5F9",
        }}
    >
        <View style={{ marginRight: 12, marginTop: 2 }}>
            {icon}
        </View>
        <View style={{ flex: 1, paddingRight: 16 }}>
            <Text
                style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: "#1E293B",
                    marginBottom: 4,
                    fontFamily: "Poppins_600SemiBold",
                }}
            >
                {title}
            </Text>
            <Text
                style={{
                    fontSize: 12,
                    color: "#64748B",
                    lineHeight: 16,
                    fontWeight: "400",
                    fontFamily: "Poppins_400Regular",
                }}
            >
                {description}
            </Text>
        </View>

        <View style={{ justifyContent: "center" }}>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: "#CBD5E1", true: "#3B82F6" }}
                thumbColor={value ? "#FFFFFF" : "#FFFFFF"}
                ios_backgroundColor="#CBD5E1"
            />
        </View>
    </Pressable>
);

const SectionHeader = ({ title }: { title: string }) => (
    <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
        <Text
            style={{
                fontSize: 12,
                fontWeight: "700",
                color: "#94A3B8",
                textTransform: "uppercase",
                letterSpacing: 1,
                fontFamily: "Poppins_700Bold",
            }}
        >
            {title}
        </Text>
    </View>
);

export const NotificationSettingsScreen: React.FC = () => {
    const insets = useSafeAreaInsets();
    const { logout } = useAuth();
    
    const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
    const [assignedStopName, setAssignedStopName] = useState<string | null>(null);
    const [assignedStopRouteId, setAssignedStopRouteId] = useState<string | null>(null);
    
    const [loadingPrefs, setLoadingPrefs] = useState(true);
    const [loggingOut, setLoggingOut] = useState(false);

    // Fetch preferences and assigned stop details on focus
    useFocusEffect(
        useCallback(() => {
            const loadData = async () => {
                try {
                    const savedPrefs = await notificationService.getPreferences();
                    setPrefs(savedPrefs);

                    // Fetch assigned stop
                    try {
                        const assigned = await getAssignedStop();
                        if (assigned) {
                            setAssignedStopName(assigned.stopName || assigned.stop?.name || assigned.name || null);
                            setAssignedStopRouteId(assigned.routeId || null);
                        } else {
                            setAssignedStopName(null);
                        }
                    } catch (apiErr) {
                        // Fallback to local storage if API fails
                        const local = await notificationService.getLocalAssignedStop();
                        if (local) {
                            setAssignedStopName(local.stop?.name || local.name || null);
                            setAssignedStopRouteId(local.routeId || null);
                        } else {
                            setAssignedStopName(null);
                        }
                    }
                } catch (error) {
                    captureSentryException(error, { tags: { area: "settings", op: "load" } });
                } finally {
                    setLoadingPrefs(false);
                }
            };

            loadData();
        }, [])
    );

    const updatePreference = async (key: keyof NotificationPrefs, value: any) => {
        const nextPrefs = {
            ...prefs,
            [key]: value,
        };
        setPrefs(nextPrefs);
        await notificationService.savePreferences(nextPrefs);

        // Feature 4: Trigger actual notification and TTS voice feedback when preference enabled
        if (value === true && [
            'busNearStopEnabled',
            'busArrivedEnabled',
            'tripStartedEnabled',
            'delayAlertsEnabled',
            'voiceEnabled'
        ].includes(key)) {
            await notificationService.triggerTestNotification(key as any);
        }
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

    if (loadingPrefs) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: "#F8FAFC", justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator size="large" color={PALETTE.primaryBlue} />
                <Text style={{ marginTop: 12, color: "#64748B", fontFamily: "Poppins_400Regular" }}>Loading settings...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
            {/* Header */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderColor: PALETTE.borderSlate,
                    backgroundColor: "#FFFFFF",
                }}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    onPress={() => {
                        if (router.canGoBack()) {
                            router.back();
                            return;
                        }
                        router.replace("/(user)/home" as any);
                    }}
                    style={{
                        width: 36,
                        height: 36,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 18,
                        backgroundColor: "#F1F5F9",
                    }}
                >
                    <Ionicons name="chevron-back" size={20} color={PALETTE.darkAccent} />
                </Pressable>
                <Text
                    style={{
                        fontSize: 16,
                        fontWeight: "600",
                        color: PALETTE.darkAccent,
                        fontFamily: "Poppins_600SemiBold",
                    }}
                >
                    Settings & Profile
                </Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                
                {/* Profile Information & Pickup Stop Selector */}
                <SectionHeader title="Assigned Pickup Stop" />
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: PALETTE.borderSlate, overflow: "hidden", padding: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 8 }}>
                            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                                <Feather name="map-pin" size={20} color={PALETTE.primaryBlue} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, color: "#64748B", fontFamily: "Poppins_400Regular" }}>
                                    Your Assigned Stop
                                </Text>
                                <Text style={{ fontSize: 16, fontWeight: "700", color: assignedStopName ? "#1E3A8A" : "#EF4444", fontFamily: "Poppins_700Bold", marginTop: 2 }}>
                                    {assignedStopName || "Not Selected"}
                                </Text>
                            </View>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Change assigned stop"
                            onPress={() => router.push({
                                pathname: "/(user)/select-stop",
                                params: assignedStopRouteId ? { routeId: assignedStopRouteId } : {}
                            })}
                            style={{
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: 20,
                                backgroundColor: PALETTE.primaryBlue,
                            }}
                        >
                            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600", fontFamily: "Poppins_600SemiBold" }}>
                                {assignedStopName ? "Change" : "Select"}
                            </Text>
                        </Pressable>
                    </View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 12, lineHeight: 16, fontFamily: "Poppins_400Regular" }}>
                        Arrival alerts are calculated strictly using this assigned stop, not your device's live GPS.
                    </Text>
                </View>

                {/* Transit Alerts */}
                <SectionHeader title="Transit Alerts" />
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: PALETTE.borderSlate, overflow: "hidden" }}>
                    <SettingRow
                        icon={<Feather name="bell" size={20} color={PALETTE.primaryBlue} />}
                        title="Bus Near My Stop"
                        description="Get notified when your bus is approaching your stop."
                        value={prefs.busNearStopEnabled}
                        onToggle={(val) => updatePreference('busNearStopEnabled', val)}
                    />
                    <SettingRow
                        icon={<Feather name="check-circle" size={20} color={PALETTE.primaryBlue} />}
                        title="Bus Arrived"
                        description="Receive an alert when the bus reaches your stop."
                        value={prefs.busArrivedEnabled}
                        onToggle={(val) => updatePreference('busArrivedEnabled', val)}
                    />
                    <SettingRow
                        icon={<Feather name="play" size={20} color={PALETTE.primaryBlue} />}
                        title="Trip Started"
                        description="Get notified when your bus begins its journey."
                        value={prefs.tripStartedEnabled}
                        onToggle={(val) => updatePreference('tripStartedEnabled', val)}
                    />
                    <SettingRow
                        icon={<Feather name="alert-triangle" size={20} color={PALETTE.primaryBlue} />}
                        title="Delay Alerts"
                        description="Stay informed if the bus is delayed or off schedule."
                        value={prefs.delayAlertsEnabled}
                        onToggle={(val) => updatePreference('delayAlertsEnabled', val)}
                    />
                </View>

                {/* Sound & Haptics */}
                <SectionHeader title="Sound & Feedback" />
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: PALETTE.borderSlate, overflow: "hidden" }}>
                    <SettingRow
                        icon={<Feather name="volume-2" size={20} color={PALETTE.primaryBlue} />}
                        title="Sound"
                        description="Play sound notifications for bus updates."
                        value={prefs.soundEnabled}
                        onToggle={(val) => updatePreference('soundEnabled', val)}
                    />
                    <SettingRow
                        icon={<MaterialCommunityIcons name="vibrate" size={20} color="#64748B" />}
                        title="Vibration"
                        description="Vibrate device when new alerts are received."
                        value={prefs.vibrationEnabled}
                        onToggle={(val) => updatePreference('vibrationEnabled', val)}
                    />
                </View>

                {/* Voice Announcements Settings */}
                <SectionHeader title="Voice Announcements" />
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: PALETTE.borderSlate, overflow: "hidden", paddingBottom: 16 }}>
                    <SettingRow
                        icon={<Feather name="mic" size={20} color={PALETTE.primaryBlue} />}
                        title="Voice Notifications"
                        description="Speak real-time bus alerts out loud (TTS)."
                        value={prefs.voiceEnabled}
                        onToggle={(val) => updatePreference('voiceEnabled', val)}
                    />

                    {/* Language Selector (Feature 10: Future Language Support) */}
                    <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: "#475569", fontFamily: "Poppins_600SemiBold", marginBottom: 8 }}>
                            Announcement Language
                        </Text>
                        <View style={{ flexDirection: "row" }}>
                            {(['en', 'te', 'hi'] as LanguageCode[]).map((lang) => {
                                const labels: Record<LanguageCode, string> = {
                                    en: "English",
                                    te: "తెలుగు",
                                    hi: "हिन्दी",
                                };
                                const isSelected = prefs.language === lang;

                                return (
                                    <Pressable
                                        key={lang}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Select language ${labels[lang]}`}
                                        onPress={() => updatePreference('language', lang)}
                                        style={{
                                            flex: 1,
                                            marginRight: lang !== 'hi' ? 8 : 0,
                                            paddingVertical: 10,
                                            borderRadius: 8,
                                            alignItems: "center",
                                            borderWidth: 1,
                                            borderColor: isSelected ? PALETTE.primaryBlue : "#E2E8F0",
                                            backgroundColor: isSelected ? "#EFF6FF" : "#FFFFFF",
                                        }}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: isSelected ? "700" : "500", color: isSelected ? PALETTE.primaryBlue : "#475569", fontFamily: isSelected ? "Poppins_700Bold" : "Poppins_500Medium" }}>
                                            {labels[lang]}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                </View>

                {/* Advanced Preferences */}
                <SectionHeader title="Advanced Settings" />
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: PALETTE.borderSlate, overflow: "hidden", paddingBottom: 16 }}>
                    <SettingRow
                        icon={<Feather name="clock" size={20} color={PALETTE.primaryBlue} />}
                        title="Alert Before Arrival"
                        description="Notify me a specified number of minutes before arrival."
                        value={prefs.alertBeforeArrivalEnabled}
                        onToggle={(val) => updatePreference('alertBeforeArrivalEnabled', val)}
                    />

                    {/* Alert Before Arrival Duration Selector (Feature 7) */}
                    {prefs.alertBeforeArrivalEnabled && (
                        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                            <Text style={{ fontSize: 13, fontWeight: "600", color: "#475569", fontFamily: "Poppins_600SemiBold", marginBottom: 8 }}>
                                Alert Duration Before Bus Arrival
                              </Text>
                              <View style={{ flexDirection: "row" }}>
                                  {[1, 3, 5, 10].map((minutes) => {
                                      const isSelected = prefs.alertBeforeArrivalMinutes === minutes;
                                      return (
                                          <Pressable
                                              key={minutes}
                                              accessibilityRole="button"
                                              accessibilityLabel={`Notify ${minutes} minutes before arrival`}
                                              onPress={() => updatePreference('alertBeforeArrivalMinutes', minutes)}
                                              style={{
                                                  flex: 1,
                                                  marginRight: minutes !== 10 ? 8 : 0,
                                                  paddingVertical: 10,
                                                  borderRadius: 8,
                                                  alignItems: "center",
                                                  borderWidth: 1,
                                                  borderColor: isSelected ? PALETTE.primaryBlue : "#E2E8F0",
                                                  backgroundColor: isSelected ? "#EFF6FF" : "#FFFFFF",
                                              }}
                                          >
                                              <Text style={{ fontSize: 12, fontWeight: isSelected ? "700" : "500", color: isSelected ? PALETTE.primaryBlue : "#475569", fontFamily: isSelected ? "Poppins_700Bold" : "Poppins_500Medium" }}>
                                                  {minutes} Min
                                              </Text>
                                          </Pressable>
                                      );
                                  })}
                              </View>
                          </View>
                    )}
                </View>

                {/* Logout Button */}
                <View style={{ paddingHorizontal: 16, marginTop: 32 }}>
                    <Pressable
                        onPress={handleLogout}
                        disabled={loggingOut}
                        style={{
                            backgroundColor: "#EF4444",
                            borderRadius: 12,
                            paddingVertical: 14,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: loggingOut ? 0.7 : 1,
                            shadowColor: "#EF4444",
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.2,
                            shadowRadius: 8,
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

import { Feather, Ionicons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Animated,
    Easing,
    PanResponder,
    Platform,
    Pressable,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BusLiveStatus, DriverStop, UserSubscription } from "../../api/types";
import { getUserBusLive, getUserNotifications, getUserSubscriptions } from "../../api/user";
import { PremiumBottomSheet, type TimelineStop } from "../../components/PremiumBottomSheet";
import RouteMap from "../../components/RouteMap";
import { useAuth } from "../../hooks/useAuth";
import { useSentryScreen } from "../../hooks/useSentryScreen";
import { captureSentryException } from "../../monitoring/sentry";

type Coord = { latitude: number; longitude: number };
type StopStatus = "passed" | "next" | "upcoming";

type SavedBusCard = {
    subscriptionId: string;
    busId: string;
    numberPlate: string;
    routeName: string;
    routeId?: string;
    nextStop?: string;
};

const PALETTE = {
    primaryBackground: "#F1F5F9",
    secondaryBackground: "#E2E8F0",
    darkAccent: "#1F2937",
    mutedText: "#64748B",
    warning: "#C2410C",
    success: "#4D7C0F",
    activeBlue: "#3B82F6",
};

const isFiniteCoord = (point?: Partial<Coord> | null): point is Coord => {
    if (!point) return false;
    return (
        typeof point.latitude === "number" &&
        Number.isFinite(point.latitude) &&
        typeof point.longitude === "number" &&
        Number.isFinite(point.longitude)
    );
};

const toStopCoord = (
    stop: DriverStop,
):
    | {
        latitude: number;
        longitude: number;
        name?: string;
        sequenceOrder?: number;
        status?: StopStatus;
    }
    | null => {
    const latitude =
        typeof stop.lat === "number"
            ? stop.lat
            : typeof stop.latitude === "number"
                ? stop.latitude
                : null;

    const longitude =
        typeof stop.lng === "number"
            ? stop.lng
            : typeof stop.longitude === "number"
                ? stop.longitude
                : null;

    if (latitude == null || longitude == null) {
        return null;
    }

    return {
        latitude,
        longitude,
        name: stop.name,
        sequenceOrder: stop.sequenceOrder,
        status: stop.status === "passed" ? "passed" : stop.status === "current" ? "next" : "upcoming",
    };
};

const formatEtaLabel = (eta?: string | null, etaSeconds?: number): string => {
    if (typeof eta === "string" && eta.trim()) {
        const normalized = eta.trim();
        if (normalized.toLowerCase().includes("min")) {
            return normalized;
        }
    }

    if (typeof etaSeconds === "number" && Number.isFinite(etaSeconds) && etaSeconds > 0) {
        const minutes = Math.max(1, Math.round(etaSeconds / 60));
        return `${minutes} min`;
    }

    return "2 min";
};

const extractSavedBus = (subscription: UserSubscription): SavedBusCard | null => {
    const busId = subscription.busId ?? subscription.bus?.id;
    const subscriptionId = subscription.id;

    if (!busId || !subscriptionId) {
        return null;
    }

    return {
        subscriptionId,
        busId,
        numberPlate: subscription.bus?.numberPlate ?? "BUS",
        routeName: subscription.bus?.routeName ?? "Route",
        routeId: subscription.bus?.routeId,
        nextStop: subscription.stop?.name,
    };
};

const GlassCard = ({ children, style }: { children: React.ReactNode; style?: any }) => (
    <View
        className="absolute left-4 right-4 flex-row items-center rounded-2xl border border-white/30 bg-slate-100/70 px-4 py-2.5 shadow"
        style={style}
    >
        {children}
    </View>
);

export default function UserHome() {
    useSentryScreen("user/home");

    const { isAuthenticated, isHydrated } = useAuth();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();

    const [savedBuses, setSavedBuses] = useState<SavedBusCard[]>([]);
    const [loadingSaved, setLoadingSaved] = useState(true);
    const [notificationCount, setNotificationCount] = useState(0);
    const [live, setLive] = useState<BusLiveStatus | null>(null);
    const [loadingLive, setLoadingLive] = useState(true);
    const [reduceMotion, setReduceMotion] = useState(false);
    const [sheetVisible, setSheetVisible] = useState(false);

    const pulse = useRef(new Animated.Value(0)).current;
    const cardTranslateY = useRef(new Animated.Value(42)).current;
    const cardOpacity = useRef(new Animated.Value(0)).current;
    const sheetAnimY = useRef(new Animated.Value(windowHeight)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        AccessibilityInfo.isReduceMotionEnabled()
            .then(setReduceMotion)
            .catch(() => setReduceMotion(false));

        const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
        return () => {
            listener.remove();
        };
    }, []);

    useEffect(() => {
        if (reduceMotion) {
            pulse.stopAnimation();
            pulse.setValue(0);
            return;
        }

        const pulseLoop = Animated.loop(
            Animated.timing(pulse, {
                toValue: 1,
                duration: 2000,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
        );

        pulse.setValue(0);
        pulseLoop.start();

        return () => {
            pulseLoop.stop();
            pulse.setValue(0);
        };
    }, [pulse, reduceMotion]);

    useEffect(() => {
        if (reduceMotion) {
            cardTranslateY.setValue(0);
            cardOpacity.setValue(1);
            return;
        }

        cardTranslateY.setValue(42);
        cardOpacity.setValue(0);

        Animated.parallel([
            Animated.timing(cardTranslateY, {
                toValue: 0,
                duration: 400,
                easing: Easing.bezier(0.4, 0, 0.2, 1),
                useNativeDriver: true,
            }),
            Animated.timing(cardOpacity, {
                toValue: 1,
                duration: 400,
                easing: Easing.bezier(0.4, 0, 0.2, 1),
                useNativeDriver: true,
            }),
        ]).start();
    }, [cardOpacity, cardTranslateY, live?.nextStop, reduceMotion]);

    const loadSavedAndNotifications = useCallback(async () => {
        if (!isAuthenticated) {
            return;
        }

        setLoadingSaved(true);
        try {
            const [subscriptions, notifications] = await Promise.all([
                getUserSubscriptions(),
                getUserNotifications(),
            ]);

            const mapped = subscriptions
                .map(extractSavedBus)
                .filter((item): item is SavedBusCard => Boolean(item));

            setSavedBuses(mapped);
            setNotificationCount(
                notifications.filter((n) => !(n.isRead ?? Boolean(n.readAt))).length,
            );
        } catch (error) {
            captureSentryException(error, {
                tags: {
                    area: "user_home",
                    operation: "load_saved_and_notifications",
                },
            });
            setSavedBuses([]);
            setNotificationCount(0);
        } finally {
            setLoadingSaved(false);
        }
    }, [isAuthenticated]);

    const activeBus = savedBuses[0] ?? null;

    const loadLiveForActiveBus = useCallback(async () => {
        if (!activeBus?.busId) {
            setLive(null);
            setLoadingLive(false);
            return;
        }

        setLoadingLive(true);
        try {
            const snapshot = await getUserBusLive(activeBus.busId);
            setLive(snapshot);
        } catch (error) {
            captureSentryException(error, {
                tags: {
                    area: "user_home",
                    operation: "load_live_home",
                },
                extra: {
                    busId: activeBus.busId,
                },
            });
            setLive(null);
        } finally {
            setLoadingLive(false);
        }
    }, [activeBus?.busId]);

    // Transform stops to TimelineStop format for premium sheet
    const timelineStops = useMemo<TimelineStop[]>(() => {
        // Dummy data for demonstration and testing
        const dummyStops: TimelineStop[] = [
            {
                id: "stop-1",
                name: "Hitech City Metro Station",
                status: "passed",
                time: "9:45 AM",
                eta: "9:45 AM",
                helperText: "Completed",
            },
            {
                id: "stop-2",
                name: "Cyber Towers",
                status: "passed",
                time: "10:12 AM",
                eta: "10:12 AM",
                helperText: "Completed",
            },
            {
                id: "stop-3",
                name: "Tech Park Main Gate",
                status: "current",
                time: "10:28 AM",
                eta: "10:28 AM",
                helperText: "Arriving Now",
            },
            {
                id: "stop-4",
                name: "Innovation Hub",
                status: "upcoming",
                eta: "10:45 AM",
                helperText: "3 min away",
            },
            {
                id: "stop-5",
                name: "Business District",
                status: "upcoming",
                eta: "11:02 AM",
                helperText: "20 min away",
            },
            {
                id: "stop-6",
                name: "Downtown Station",
                status: "upcoming",
                eta: "11:25 AM",
                helperText: "43 min away",
            },
            {
                id: "stop-7",
                name: "Central Park Stop",
                status: "upcoming",
                eta: "11:42 AM",
                helperText: "60 min away",
            },
        ];

        // Use live API data if available, otherwise use dummy data
        if (!live?.stops) return dummyStops;

        return live.stops
            .map((stop, idx) => ({
                id: stop.id || `stop-${idx}`,
                name: stop.name || "Unknown Stop",
                status: (stop.status === "passed" ? "passed" :
                    stop.status === "current" ? "current" :
                        "upcoming") as "passed" | "current" | "upcoming",
                time: stop.departedClockTimeText || stop.arrivalClockTimeText,
                eta: stop.arrivalClockTimeText,
                helperText: stop.status === "passed" ? "Completed" :
                    stop.status === "current" ? "Arriving Now" :
                        "Upcoming",
            }))
            .sort((a, b) => {
                const order = { passed: 0, current: 1, upcoming: 2 };
                return order[a.status] - order[b.status];
            });
    }, [live?.stops]);

    // Pan responder for sheet gestures
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => sheetVisible,
            onMoveShouldSetPanResponder: (_, { dy }) => sheetVisible && Math.abs(dy) > 10,
            onPanResponderMove: (_, { dy }) => {
                if (sheetVisible) {
                    const newY = Math.max(80, Math.min(windowHeight - 20, windowHeight - 140 + dy));
                    sheetAnimY.setValue(newY);
                }
            },
            onPanResponderRelease: (_, { dy, vy }) => {
                if (sheetVisible) {
                    if (vy > 0.5 || dy > 100) {
                        closeSheet();
                    } else {
                        expandSheet();
                    }
                }
            },
        }),
    ).current;

    const cardPanResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => !sheetVisible,
            onMoveShouldSetPanResponder: (_, { dy }) => !sheetVisible && Math.abs(dy) > 8,
            onPanResponderRelease: (_, { dy, vy }) => {
                if (sheetVisible || !activeBus) {
                    return;
                }

                if (dy < -24 || vy < -0.45) {
                    openSheet();
                }
            },
        }),
    ).current;

    const expandSheet = useCallback(() => {
        Animated.parallel([
            Animated.spring(sheetAnimY, {
                toValue: 80,
                useNativeDriver: false,
                tension: 50,
                friction: 10,
            }),
            Animated.timing(backdropOpacity, {
                toValue: 0.4,
                duration: 250,
                useNativeDriver: false,
            }),
        ]).start();
    }, [sheetAnimY, backdropOpacity]);

    const closeSheet = useCallback(() => {
        Animated.parallel([
            Animated.spring(sheetAnimY, {
                toValue: windowHeight,
                useNativeDriver: false,
                tension: 50,
                friction: 10,
            }),
            Animated.timing(backdropOpacity, {
                toValue: 0,
                duration: 250,
                useNativeDriver: false,
            }),
        ]).start(() => {
            setSheetVisible(false);
        });
    }, [sheetAnimY, backdropOpacity, windowHeight]);

    const openSheet = useCallback(() => {
        setSheetVisible(true);
        expandSheet();
    }, [expandSheet]);

    useFocusEffect(
        useCallback(() => {
            void loadSavedAndNotifications();
        }, [loadSavedAndNotifications]),
    );

    useEffect(() => {
        void loadLiveForActiveBus();

        if (!activeBus?.busId) {
            return;
        }

        const timer = setInterval(() => {
            void loadLiveForActiveBus();
        }, 10000);

        return () => {
            clearInterval(timer);
        };
    }, [activeBus?.busId, loadLiveForActiveBus]);

    const routeCoordinates = useMemo<Coord[]>(() => {
        if (live?.encodedPolyline) {
            try {
                const decoded = polyline.decode(live.encodedPolyline) as [number, number][];
                const mapped = decoded.map(([latitude, longitude]) => ({ latitude, longitude }));
                if (mapped.length > 1) {
                    return mapped;
                }
            } catch {
                // Fallback to stop-based path.
            }
        }

        const points: Coord[] = [];

        const startCandidate = {
            latitude: live?.routeStartLat ?? undefined,
            longitude: live?.routeStartLng ?? undefined,
        };

        if (isFiniteCoord(startCandidate)) {
            points.push({ latitude: startCandidate.latitude, longitude: startCandidate.longitude });
        }

        (live?.stops ?? [])
            .map(toStopCoord)
            .filter((stop): stop is NonNullable<ReturnType<typeof toStopCoord>> => Boolean(stop))
            .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER))
            .forEach((stop) => {
                points.push({ latitude: stop.latitude, longitude: stop.longitude });
            });

        const endCandidate = {
            latitude: live?.routeEndLat ?? undefined,
            longitude: live?.routeEndLng ?? undefined,
        };

        if (isFiniteCoord(endCandidate)) {
            points.push({ latitude: endCandidate.latitude, longitude: endCandidate.longitude });
        }

        return points.filter((point, index) => {
            if (index === 0) {
                return true;
            }
            const prev = points[index - 1];
            return (
                Math.abs(prev.latitude - point.latitude) > 1e-6 ||
                Math.abs(prev.longitude - point.longitude) > 1e-6
            );
        });
    }, [live]);

    const mapStops = useMemo(() => {
        return (live?.stops ?? [])
            .map(toStopCoord)
            .filter((stop): stop is NonNullable<ReturnType<typeof toStopCoord>> => Boolean(stop))
            .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER));
    }, [live?.stops]);

    const currentLocation = useMemo(() => {
        const candidate = {
            latitude: live?.currentLat ?? undefined,
            longitude: live?.currentLng ?? undefined,
        };
        return isFiniteCoord(candidate)
            ? { latitude: candidate.latitude, longitude: candidate.longitude }
            : undefined;
    }, [live?.currentLat, live?.currentLng]);

    const topLocationLabel = useMemo(() => {
        return live?.routeStartName?.trim() || activeBus?.nextStop || "Tech park";
    }, [activeBus?.nextStop, live?.routeStartName]);

    const nextStopTitle = useMemo(() => {
        return live?.nextStop?.trim() || activeBus?.nextStop || "bvrit";
    }, [activeBus?.nextStop, live?.nextStop]);

    const etaLabel = useMemo(() => {
        return formatEtaLabel(live?.estimatedArrival, live?.etaToDestinationSeconds);
    }, [live?.estimatedArrival, live?.etaToDestinationSeconds]);

    const nextStopSubtitle = useMemo(() => {
        const location = live?.routeEndName?.trim() || live?.routeName || activeBus?.routeName || "Sangareddy";
        return `${location} • Upcoming`;
    }, [activeBus?.routeName, live?.routeEndName, live?.routeName]);

    const pulseScale = pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.3],
    });

    const pulseOpacity = pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.8, 0],
    });

    if (!isHydrated) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center bg-slate-100">
                <ActivityIndicator size="large" color={PALETTE.activeBlue} />
            </SafeAreaView>
        );
    }

    if (!isAuthenticated) {
        return <Redirect href="/(driver)/login" />;
    }

    return (
        <SafeAreaView className="flex-1 bg-slate-100">
            <View className="absolute inset-0">
                <RouteMap
                    coordinates={routeCoordinates}
                    stops={mapStops}
                    currentLocation={currentLocation}
                    encodedPolyline={live?.encodedPolyline}
                />
                <View pointerEvents="none" className="absolute inset-0 bg-slate-100/20" />
            </View>

            <View items-center className="absolute left-0 right-0 top-0 z-10">
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
                    className="absolute left-4 z-20 h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-white/80 shadow active:opacity-60"
                    style={{ top: insets.top + 14 }}
                >
                    <Ionicons name="chevron-back" size={20} color={PALETTE.darkAccent} />
                </Pressable>

                <GlassCard style={{ top: insets.top + 14, left: 68, right: 16 }}>
                    <Feather name="map-pin" size={18} color={PALETTE.darkAccent} />
                    <Text numberOfLines={1} className="ml-2 shrink text-[15px] font-medium text-slate-800">
                        {topLocationLabel}
                    </Text>
                </GlassCard>
            </View>

            <View
                className="absolute left-4 right-4"
                style={{ bottom: insets.bottom + 82 }}
            >
                <Animated.View
                    style={{
                        transform: [{ translateY: cardTranslateY }],
                        opacity: cardOpacity,
                    }}
                >
                    <Pressable
                        {...cardPanResponder.panHandlers}
                        accessibilityRole="button"
                        accessibilityLabel="Open live trip tracking"
                        onPress={() => {
                            // if (!activeBus) {
                            //     return;

                            // }

                            openSheet();
                        }}
                        className="min-h-[46px] mb-12 flex-row items-center justify-between rounded-[44px] border border-white/45 bg-white/85 px-6 py-4 shadow active:scale-95 active:opacity-60"
                    >
                        <View className="flex-1 flex-row items-center pr-3">
                            <View className="mr-3 w-[16px] items-center justify-center">
                                <Animated.View
                                    style={[
                                        {
                                            position: "absolute",
                                            width: 18,
                                            height: 18,
                                            borderRadius: 9,
                                            backgroundColor: "rgba(59,130,246,0.35)",
                                        },
                                        {
                                            transform: [{ scale: pulseScale }],
                                            opacity: reduceMotion ? 0 : pulseOpacity,
                                        },
                                    ]}
                                />
                                <View className="h-[10px] w-[10px] rounded-full bg-blue-500" />
                                <View className="absolute top-[10px] h-7 w-[1px] bg-blue-300" />
                            </View>

                            <View className="shrink flex-1">
                                <Text numberOfLines={1} className="text-[16px] font-semibold leading-[22px] text-slate-800">
                                    Next Stop: {nextStopTitle}
                                </Text>
                                <Text numberOfLines={1} className="mt-0.5 text-[12px] leading-[20px] text-slate-600">
                                    {nextStopSubtitle.split("•")[0]?.trim()}
                                    <Text className="text-[12px] leading-[20px] text-orange-700">• Upcoming</Text>
                                </Text>
                            </View>
                        </View>

                        <View className="rounded-[18px] bg-slate-200/80 px-5 py-3">
                            <Text className="text-[14px] font-semibold leading-[22px] text-slate-800">ETA: {etaLabel}</Text>
                        </View>
                    </Pressable>
                </Animated.View>
            </View>

            <View
                className="absolute mb-8 left-4 right-4 flex-row items-center justify-between rounded-[44px] border border-white/40 bg-white/80 px-1 pt-1.5 shadow"
                style={{
                    bottom: insets.bottom + 2,
                    minHeight: 72 + Math.max(insets.bottom, 8),
                    paddingBottom: Math.max(insets.bottom, 8),
                }}
            >
                <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel="Home tab"
                    onPress={() => router.replace("/(user)/home" as never)}
                    className="min-h-11 min-w-[78px] items-center justify-center rounded-[28px] bg-slate-200/90 px-6 py-2 active:scale-95 active:opacity-60"
                >
                    <Ionicons name="home" size={24} color={PALETTE.activeBlue} />
                    <Text className="mt-1 text-[10px] font-semibold leading-[12px] text-blue-500">Home</Text>
                </Pressable>

                <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel="Alerts tab"
                    onPress={() => router.push("/(user)/alerts" as never)}
                    className="relative min-h-11 min-w-[72px] items-center justify-center px-2 py-2 active:scale-95 active:opacity-60"
                >
                    <Ionicons name="notifications-outline" size={24} color={PALETTE.darkAccent} />
                    <Text className="mt-1 text-[10px] font-medium leading-[12px] text-slate-800">Alerts</Text>
                    {notificationCount > 0 && (
                        <View className="absolute -right-1 -top-0.5 h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-700 px-1">
                            <Text className="text-[9px] font-bold text-white">
                                {notificationCount > 9 ? "9+" : notificationCount}
                            </Text>
                        </View>
                    )}
                </Pressable>

                <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel="Settings tab"
                    onPress={() => router.push("/(user)/profile" as never)}
                    className="min-h-11 min-w-[72px] items-center justify-center px-2 py-2 active:scale-95 active:opacity-60"
                >
                    <Ionicons name="settings-outline" size={24} color={PALETTE.darkAccent} />
                    <Text className="mt-1 text-[10px] font-medium leading-[12px] text-slate-800">Settings</Text>
                </Pressable>

                <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel="Saved buses tab"
                    onPress={() => router.push("/(user)/saved" as never)}
                    className="min-h-11 min-w-[72px] items-center justify-center px-2 py-2 active:scale-95 active:opacity-60"
                >
                    <Ionicons name="bookmark-outline" size={24} color={PALETTE.darkAccent} />
                    <Text className="mt-1 text-[10px] font-medium leading-[12px] text-slate-800">Label</Text>
                </Pressable>
            </View>

            {(loadingSaved || loadingLive) && (
                <View
                    pointerEvents="none"
                    className="absolute self-center flex-row items-center rounded-full border border-white/50 bg-white/85 px-3 py-2"
                    style={{ top: Platform.OS === "ios" ? 72 : 56 }}
                >
                    <ActivityIndicator size="small" color={PALETTE.darkAccent} />
                    <Text className="ml-2 text-xs font-medium text-slate-800">Syncing live route...</Text>
                </View>
            )}

            {!loadingSaved && savedBuses.length === 0 && (
                <View
                    className="absolute self-center flex-row items-center rounded-full border border-white/45 bg-slate-100/80 px-3 py-2"
                    style={{ top: insets.top + 96 }}
                >
                    <Ionicons name="bus-outline" size={16} color={PALETTE.mutedText} />
                    <Text className="ml-1.5 text-xs font-medium text-slate-500">Save a bus to start real-time tracking</Text>
                </View>
            )}

            {/* Backdrop overlay */}
            <Animated.View
                pointerEvents={sheetVisible ? "auto" : "none"}
                className="absolute inset-0 bg-slate-900"
                style={{
                    opacity: backdropOpacity,
                }}
            />

            {/* Bottom Sheet Overlay */}
            {sheetVisible && (
                <Animated.View
                    {...panResponder.panHandlers}
                    className="absolute bottom-0 left-0 right-0 z-50"
                    style={{
                        transform: [{ translateY: sheetAnimY }],
                        height: windowHeight,
                    }}
                >
                    <PremiumBottomSheet
                        routeOrigin={live?.routeStartName || topLocationLabel}
                        routeDestination={live?.routeEndName || nextStopSubtitle.split("•")[0] || "End"}
                        stops={timelineStops}
                        expandedHeight={80}
                        onClose={closeSheet}
                    />

                    {/* Close button overlay for accessibility */}
                    <Pressable
                        onPress={closeSheet}
                        className="absolute right-4 top-4 z-10 h-10 w-10 items-center justify-center rounded-full bg-white/80"
                    >
                        <Ionicons name="close" size={24} color={PALETTE.darkAccent} />
                    </Pressable>
                </Animated.View>
            )}
        </SafeAreaView>
    );
}

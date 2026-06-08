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
import usePassengerTrackingData from "../../hooks/useTrackingData";
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
    const trackingData = usePassengerTrackingData();

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

    const activeTripLive = useMemo<BusLiveStatus | null>(() => {
        if (!trackingData.route && !trackingData.trip && !trackingData.bus) {
            return null;
        }

        const orderedStops = [...(trackingData.stops ?? [])].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        const currentIndex = trackingData.currentStopId
            ? orderedStops.findIndex((stop) => stop.id === trackingData.currentStopId)
            : -1;
        const nextIndex = trackingData.nextStopId
            ? orderedStops.findIndex((stop) => stop.id === trackingData.nextStopId)
            : -1;

        const routeEtaText = trackingData.route?.estimatedDurationSeconds != null
            ? formatEtaLabel(null, trackingData.route.estimatedDurationSeconds)
            : null;
        const etaToDestinationText = trackingData.etaToDestinationText ?? routeEtaText;
        const nextStop = trackingData.nextStopId
            ? orderedStops.find((stop) => stop.id === trackingData.currentStopId)?.name ?? orderedStops.find((stop) => stop.id === trackingData.nextStopId)?.name ?? null
            : trackingData.currentStopId
                ? orderedStops.find((stop) => stop.id === trackingData.currentStopId)?.name ?? null
                : orderedStops[0]?.name ?? null;

        const mappedStops = orderedStops.map((stop, index) => {
            const status =
                stop.status === "passed"
                    ? "passed"
                    : stop.status === "current"
                        ? "current"
                        : stop.status === "upcoming"
                            ? "upcoming"
                            : currentIndex >= 0
                                ? index < currentIndex
                                    ? "passed"
                                    : index === currentIndex
                                        ? "current"
                                        : "upcoming"
                                : nextIndex >= 0
                                    ? index < nextIndex
                                        ? "passed"
                                        : index === nextIndex
                                            ? "current"
                                            : "upcoming"
                                    : index === 0
                                        ? "current"
                                        : "upcoming";

            return {
                id: stop.id,
                name: stop.name,
                lat: stop.latitude,
                lng: stop.longitude,
                latitude: stop.latitude,
                longitude: stop.longitude,
                sequenceOrder: stop.sequenceOrder,
                radiusMeters: stop.radiusMeters ?? undefined,
                status,
                isPassed: stop.isPassed,
                leftSubLabel: stop.leftSubLabel,
                rightPrimaryLabel: stop.rightPrimaryLabel,
                rightSecondaryLabel: stop.rightSecondaryLabel,
                arrivalClockTimeText: stop.arrivalClockTimeText,
                departedClockTimeText: stop.departedClockTimeText,
                distanceFromCurrentText: stop.distanceFromCurrentText,
                distanceFromCurrentMeters: stop.distanceFromCurrentMeters,
                etaFromCurrentText: stop.etaFromCurrentText,
                etaFromCurrentSeconds: stop.etaFromCurrentSeconds,
                segmentDistanceText: stop.segmentDistanceText,
                segmentEtaText: stop.segmentEtaText,
                segmentEtaSeconds: stop.segmentEtaSeconds,
            };
        });

        return {
            busId: trackingData.bus?.id ?? "",
            numberPlate: trackingData.bus?.numberPlate ?? "",
            routeName: trackingData.route?.name ?? "Route",
            routeId: trackingData.route?.id,
            trip: trackingData.trip
                ? {
                    id: trackingData.trip.id,
                    status: trackingData.trip.status,
                }
                : undefined,
            encodedPolyline: trackingData.route?.encodedPolyline ?? "",
            routeStartLat: trackingData.route?.startLat ?? null,
            routeStartLng: trackingData.route?.startLng ?? null,
            routeStartName: trackingData.route?.startName ?? null,
            routeEndLat: trackingData.route?.endLat ?? null,
            routeEndLng: trackingData.route?.endLng ?? null,
            routeEndName: trackingData.route?.endName ?? null,
            stops: mappedStops,
            currentLat: trackingData.currentLocation?.latitude ?? null,
            currentLng: trackingData.currentLocation?.longitude ?? null,
            nextStop,
            estimatedArrival: etaToDestinationText,
            fleetStatus: trackingData.bus?.status ?? null,
            tripStatus: trackingData.trip?.status ?? null,
            status: trackingData.trip?.status ?? trackingData.bus?.status ?? null,
            trackingStatus: trackingData.connectionStatus,
            lastUpdated: trackingData.lastUpdatedAt,
            totalDistanceMeters: trackingData.route?.totalDistanceMeters,
            estimatedDurationSeconds: trackingData.route?.estimatedDurationSeconds,
            totalDistanceText: undefined,
            estimatedDurationText: routeEtaText ?? undefined,
            etaToDestinationSeconds: trackingData.etaToDestinationSeconds ?? undefined,
            etaToDestinationText: etaToDestinationText ?? undefined,
            distanceToDestinationMeters: undefined,
            distanceToDestinationText: undefined,
            isActive: Boolean(trackingData.trip),
        } as BusLiveStatus;
    }, [trackingData]);

    const liveData = useMemo<BusLiveStatus | null>(() => {
        if (!activeTripLive && !live) {
            return null;
        }

        if (!activeTripLive) {
            return live;
        }

        return {
            ...live,
            ...activeTripLive,
            currentLat: activeTripLive.currentLat ?? live?.currentLat ?? null,
            currentLng: activeTripLive.currentLng ?? live?.currentLng ?? null,
            currentLocation: undefined,
            stops: activeTripLive.stops?.length ? activeTripLive.stops : live?.stops ?? [],
            encodedPolyline: activeTripLive.encodedPolyline || live?.encodedPolyline || "",
            etaToDestinationSeconds:
                activeTripLive.etaToDestinationSeconds ?? live?.etaToDestinationSeconds,
            etaToDestinationText:
                activeTripLive.etaToDestinationText ?? live?.etaToDestinationText ?? undefined,
            nextStop: activeTripLive.nextStop ?? live?.nextStop ?? null,
            routeStartName: activeTripLive.routeStartName ?? live?.routeStartName ?? null,
            routeEndName: activeTripLive.routeEndName ?? live?.routeEndName ?? null,
            routeName: activeTripLive.routeName ?? live?.routeName ?? "Route",
            lastUpdated: activeTripLive.lastUpdated ?? live?.lastUpdated,
            trackingStatus: trackingData.connectionStatus,
            tripStatus: trackingData.trip?.status ?? activeTripLive.tripStatus ?? live?.tripStatus ?? null,
            status: trackingData.trip?.status ?? activeTripLive.status ?? live?.status ?? null,
            isActive: Boolean(trackingData.trip),
        } as BusLiveStatus;
    }, [activeTripLive, live, trackingData.connectionStatus, trackingData.trip]);

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

    const timelineStops = useMemo<TimelineStop[]>(() => {
        if (!liveData?.stops) return [];

        return liveData.stops
            .map((stop, idx) => ({
                id: stop.id || `stop-${idx}`,
                name: stop.name || "Unknown Stop",
                status: (stop.status === "passed" ? "passed" :
                    stop.status === "current" ? "current" :
                        "upcoming") as "passed" | "current" | "upcoming",
                time: stop.departedClockTimeText || stop.arrivalClockTimeText,
                eta: stop.etaFromCurrentText || stop.arrivalClockTimeText,
                helperText: stop.status === "passed" ? "Completed" :
                    stop.status === "current" ? stop.leftSubLabel || "Arriving Now" :
                        stop.leftSubLabel || "Upcoming",
            }))
            .sort((a, b) => {
                const order = { passed: 0, current: 1, upcoming: 2 };
                return order[a.status] - order[b.status];
            });
    }, [liveData?.stops]);

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
    }, [activeBus?.busId, loadLiveForActiveBus, trackingData.hasActiveTrip]);

    const routeCoordinates = useMemo<Coord[]>(() => {
        if (liveData?.encodedPolyline) {
            try {
                const decoded = polyline.decode(liveData.encodedPolyline) as [number, number][];
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
            latitude: liveData?.routeStartLat ?? undefined,
            longitude: liveData?.routeStartLng ?? undefined,
        };

        if (isFiniteCoord(startCandidate)) {
            points.push({ latitude: startCandidate.latitude, longitude: startCandidate.longitude });
        }

        (liveData?.stops ?? [])
            .map(toStopCoord)
            .filter((stop): stop is NonNullable<ReturnType<typeof toStopCoord>> => Boolean(stop))
            .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER))
            .forEach((stop) => {
                points.push({ latitude: stop.latitude, longitude: stop.longitude });
            });

        const endCandidate = {
            latitude: liveData?.routeEndLat ?? undefined,
            longitude: liveData?.routeEndLng ?? undefined,
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
    }, [liveData]);

    const mapStops = useMemo(() => {
        return (liveData?.stops ?? [])
            .map(toStopCoord)
            .filter((stop): stop is NonNullable<ReturnType<typeof toStopCoord>> => Boolean(stop))
            .sort((a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER));
    }, [liveData?.stops]);

    const currentLocation = useMemo(() => {
        const candidate = {
            latitude: liveData?.currentLat ?? undefined,
            longitude: liveData?.currentLng ?? undefined,
        };
        return isFiniteCoord(candidate)
            ? { latitude: candidate.latitude, longitude: candidate.longitude }
            : undefined;
    }, [liveData?.currentLat, liveData?.currentLng]);

    const topLocationLabel = useMemo(() => {
        return liveData?.routeStartName?.trim() || activeBus?.nextStop || "-";
    }, [activeBus?.nextStop, liveData?.routeStartName]);

    const nextStopTitle = useMemo(() => {
        return liveData?.nextStop?.trim() || activeBus?.nextStop || "-";
    }, [activeBus?.nextStop, liveData?.nextStop]);

    const etaLabel = useMemo(() => {
        return formatEtaLabel(liveData?.estimatedArrival, liveData?.etaToDestinationSeconds);
    }, [liveData?.estimatedArrival, liveData?.etaToDestinationSeconds]);

    const nextStopSubtitle = useMemo(() => {
        const location = liveData?.routeEndName?.trim() || liveData?.routeName || activeBus?.routeName || "-";
        return location === "-" ? "-" : `${location} • Upcoming`;
    }, [activeBus?.routeName, liveData?.routeEndName, liveData?.routeName]);

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
                    encodedPolyline={liveData?.encodedPolyline}
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

            {(loadingSaved || loadingLive || trackingData.loading) && (
                <View
                    pointerEvents="none"
                    className="absolute self-center flex-row items-center rounded-full border border-white/50 bg-white/85 px-3 py-2"
                    style={{ top: Platform.OS === "ios" ? 72 : 56 }}
                >
                    <ActivityIndicator size="small" color={PALETTE.darkAccent} />
                    <Text className="ml-2 text-xs font-medium text-slate-800">Syncing live route...</Text>
                </View>
            )}

            {!loadingSaved && !trackingData.loading && !trackingData.hasActiveTrip && savedBuses.length === 0 && (
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
                        routeOrigin={liveData?.routeStartName || topLocationLabel}
                        routeDestination={liveData?.routeEndName || nextStopSubtitle.split("•")[0] || "End"}
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

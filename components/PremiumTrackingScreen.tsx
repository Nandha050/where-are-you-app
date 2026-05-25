import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    PanResponder,
    SafeAreaView,
    Text,
    useWindowDimensions,
    View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingSearchBar, FloatingTransitCard } from "./FloatingMapElements";
import { FloatingNavDock } from "./FloatingNavDock";
import { PremiumBottomSheet, type TimelineStop } from "./PremiumBottomSheet";
import RouteMap from "./RouteMap";

type NavItem = "home" | "alerts" | "settings" | "label";
type SheetState = "collapsed" | "half" | "expanded";

export interface PremiumTrackingScreenProps {
    routeOrigin: string;
    routeDestination: string;
    stops: TimelineStop[];
    currentLocation?: { latitude: number; longitude: number };
    coordinates: Array<{ latitude: number; longitude: number }>;
    encodedPolyline?: string;
    onNavPress?: (item: NavItem) => void;
}

export const PremiumTrackingScreen: React.FC<PremiumTrackingScreenProps> = ({
    routeOrigin,
    routeDestination,
    stops,
    currentLocation,
    coordinates,
    encodedPolyline,
    onNavPress,
}) => {
    const { height: windowHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const [sheetState, setSheetState] = useState<SheetState>("collapsed");
    const [activeNav, setActiveNav] = useState<NavItem>("home");
    const [notificationCount] = useState(3);

    const sheetAnimY = useRef(new Animated.Value(windowHeight - 140)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const snapPositions = {
        collapsed: windowHeight - 140,
        half: Math.round(windowHeight * 0.45),
        expanded: Math.round(windowHeight * 0.18),
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 10,
            onPanResponderMove: (_, { dy }) => {
                const newY = Math.max(snapPositions.expanded, snapPositions.collapsed + dy);
                sheetAnimY.setValue(newY);
            },
            onPanResponderRelease: (_, { dy, vy }) => {
                const currentY = snapPositions.collapsed + dy;
                const threshold = (snapPositions.half - snapPositions.expanded) / 2;
                const nextState: SheetState = vy < -0.5 ? "expanded" : vy > 0.5 ? "collapsed" : currentY < snapPositions.half ? "expanded" : "collapsed";

                animateToState(nextState);
            },
        }),
    ).current;

    const animateToState = useCallback((state: SheetState) => {
        setSheetState(state);

        Animated.parallel([
            Animated.spring(sheetAnimY, {
                toValue: snapPositions[state],
                useNativeDriver: false,
                tension: 50,
                friction: 10,
            }),
            Animated.timing(backdropOpacity, {
                toValue: state === "expanded" ? 0.3 : 0,
                duration: 250,
                useNativeDriver: false,
            }),
        ]).start();
    }, [sheetAnimY, backdropOpacity, snapPositions]);

    useEffect(() => {
        animateToState("collapsed");
    }, [animateToState]);

    const handleNavPress = (item: NavItem) => {
        setActiveNav(item);
        onNavPress?.(item);
    };

    const collapsedHeight = 140;

    return (
        <SafeAreaView className="flex-1 bg-slate-100">
            {/* Background Map */}
            <View className="absolute inset-0">
                <RouteMap
                    coordinates={coordinates}
                    stops={stops.map((s) => ({
                        latitude: s.id as any,
                        longitude: s.id as any,
                        name: s.name,
                        status: s.status as "passed" | "next" | "upcoming",
                    }))}
                    currentLocation={currentLocation}
                    encodedPolyline={encodedPolyline}
                />
                <View pointerEvents="none" className="absolute inset-0 bg-slate-100/15" />
            </View>

            {/* Backdrop (shown when sheet expanded) */}
            <Animated.View
                pointerEvents={sheetState === "collapsed" ? "none" : "auto"}
                className="absolute inset-0 bg-slate-900"
                style={{
                    opacity: backdropOpacity,
                }}
            />

            {/* Top Info Overlay */}
            <View className="absolute left-4 right-4 top-0 z-20 flex-row items-center justify-between pt-4">
                <View className="flex-col gap-1">
                    <Text className="text-xs font-medium uppercase tracking-widest text-slate-500">
                        Live Tracking
                    </Text>
                    <Text className="text-lg font-bold text-slate-900">
                        {routeOrigin}
                    </Text>
                </View>

                {/* Status Indicator */}
                <View className="flex-col items-end gap-1 rounded-full border border-white/40 bg-white/70 px-3 py-1.5 shadow-sm">
                    <View className="flex-row items-center gap-1">
                        <View className="h-2 w-2 rounded-full bg-emerald-500" />
                        <Text className="text-[11px] font-semibold text-emerald-700">
                            On Time
                        </Text>
                    </View>
                </View>
            </View>

            {/* Search Bar (appears when sheet collapsed) */}
            {sheetState === "collapsed" && (
                <View className="absolute left-0 right-0 z-20" style={{ top: insets.top + 72 }}>
                    <FloatingSearchBar />
                </View>
            )}

            {/* Bottom Sheet Container */}
            <Animated.View
                {...panResponder.panHandlers}
                className="absolute bottom-0 left-0 right-0 z-50"
                style={{
                    transform: [{ translateY: sheetAnimY }],
                    height: windowHeight,
                }}
            >
                <PremiumBottomSheet
                    routeOrigin={routeOrigin}
                    routeDestination={routeDestination}
                    stops={stops}
                    expandedHeight={snapPositions.expanded}
                />
            </Animated.View>

            {/* Floating Transit Info Card (Map Variant) */}
            {sheetState === "collapsed" && (
                <View
                    className="absolute left-4 right-4 z-40"
                    style={{
                        bottom: collapsedHeight + 20,
                    }}
                >
                    <FloatingTransitCard
                        nextStop={stops.find((s) => s.status === "current")?.name || "Unknown"}
                        subtitle={`${routeDestination} • Upcoming`}
                        eta={stops.find((s) => s.status === "current")?.eta || "2 min"}
                        onPress={() => animateToState("expanded")}
                    />
                </View>
            )}

            {/* Floating Navigation Dock */}
            <View
                className="absolute left-4 right-4 z-50"
                style={{
                    bottom: insets.bottom + 12,
                }}
            >
                <FloatingNavDock
                    active={activeNav}
                    onPress={handleNavPress}
                    badgeCount={notificationCount}
                />
            </View>
        </SafeAreaView>
    );
};

export default PremiumTrackingScreen;

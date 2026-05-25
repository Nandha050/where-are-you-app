import React, { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, View, useWindowDimensions } from "react-native";

export type BottomSheetState = "collapsed" | "half" | "full";

type BottomSheetHandle = {
    snapToPosition: (state: BottomSheetState) => void;
};

interface BottomSheetProps {
    children: ReactNode;
    collapsedHeight?: number;
    halfHeightRatio?: number;
    fullHeightRatio?: number;
    initialState?: BottomSheetState;
    onStateChange?: (state: BottomSheetState) => void;
}

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

const resolveNearestState = (
    value: number,
    positions: Record<BottomSheetState, number>,
): BottomSheetState => {
    const entries = Object.entries(positions) as Array<[
        BottomSheetState,
        number,
    ]>;

    return entries.reduce((nearest, current) => {
        const nearestDistance = Math.abs(value - positions[nearest]);
        const currentDistance = Math.abs(value - current[1]);
        return currentDistance < nearestDistance ? current[0] : nearest;
    }, "half" as BottomSheetState);
};

export const BottomSheet = React.forwardRef<BottomSheetHandle, BottomSheetProps>(
    (
        {
            children,
            collapsedHeight = 106,
            halfHeightRatio = 0.56,
            fullHeightRatio = 0.9,
            initialState = "half",
            onStateChange,
        },
        ref,
    ) => {
        const { height: windowHeight } = useWindowDimensions();

        const snapHeights = useMemo(() => {
            const collapsedVisible = collapsedHeight;
            const halfVisible = Math.max(
                Math.round(windowHeight * halfHeightRatio),
                collapsedVisible + 260,
            );
            const fullVisible = Math.max(
                Math.round(windowHeight * fullHeightRatio),
                halfVisible + 120,
            );

            return {
                collapsed: collapsedVisible,
                half: halfVisible,
                full: fullVisible,
            } satisfies Record<BottomSheetState, number>;
        }, [collapsedHeight, fullHeightRatio, halfHeightRatio, windowHeight]);

        const sheetHeight = useRef(new Animated.Value(snapHeights[initialState])).current;
        const sheetHeightRef = useRef(snapHeights[initialState]);
        const dragStartRef = useRef(snapHeights[initialState]);
        const currentStateRef = useRef<BottomSheetState>(initialState);

        const animateToState = useCallback(
            (state: BottomSheetState) => {
                const target = snapHeights[state];
                currentStateRef.current = state;
                sheetHeightRef.current = target;

                Animated.spring(sheetHeight, {
                    toValue: target,
                    useNativeDriver: false,
                    tension: 58,
                    friction: 11,
                }).start();

                onStateChange?.(state);
            },
            [onStateChange, sheetHeight, snapHeights],
        );

        useEffect(() => {
            const nextTarget = snapHeights[currentStateRef.current];
            sheetHeight.setValue(nextTarget);
            sheetHeightRef.current = nextTarget;
            dragStartRef.current = nextTarget;
        }, [sheetHeight, snapHeights]);

        const panResponder = useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => false,
                    onMoveShouldSetPanResponder: (_, gestureState) =>
                        Math.abs(gestureState.dy) > 1,
                    onShouldBlockNativeResponder: () => true,
                    onPanResponderGrant: () => {
                        sheetHeight.stopAnimation((value) => {
                            dragStartRef.current = value;
                            sheetHeightRef.current = value;
                        });
                    },
                    onPanResponderMove: (_, gestureState) => {
                        const next = clamp(
                            dragStartRef.current - gestureState.dy,
                            snapHeights.collapsed,
                            snapHeights.full,
                        );
                        sheetHeight.setValue(next);
                        sheetHeightRef.current = next;
                    },
                    onPanResponderRelease: (_, gestureState) => {
                        const projected = clamp(
                            sheetHeightRef.current - gestureState.vy * 80,
                            snapHeights.collapsed,
                            snapHeights.full,
                        );

                        const nextState = resolveNearestState(projected, snapHeights);
                        animateToState(nextState);
                    },
                    onPanResponderTerminationRequest: () => false,
                }),
            [animateToState, sheetHeight, snapHeights],
        );

        React.useImperativeHandle(ref, () => ({
            snapToPosition: animateToState,
        }));

        return (
            <Animated.View
                pointerEvents="box-none"
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 1000,
                    elevation: 1000,
                    height: sheetHeight,
                }}
            >
                <View pointerEvents="box-none" className="flex-1 justify-end">
                    <View
                        className="flex-1 overflow-hidden"
                        style={{
                            backgroundColor: "rgba(255,255,255,0.96)",
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            shadowColor: "#000",
                            shadowOpacity: 0.18,
                            shadowRadius: 24,
                            shadowOffset: { width: 0, height: -8 },
                            elevation: 18,
                        }}
                    >
                        <View
                            {...panResponder.panHandlers}
                            className="items-center justify-center px-4 py-3"
                            style={{ minHeight: 50 }}
                        >
                            <View className="h-1.5 w-12 rounded-full bg-slate-300" />
                        </View>
                        <View className="flex-1 min-h-0">{children}</View>
                    </View>
                </View>
            </Animated.View>
        );
    },
);

BottomSheet.displayName = "BottomSheet";

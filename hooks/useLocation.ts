import * as Location from "expo-location";
import { useCallback } from "react";
import { Alert } from "react-native";
import { addSentryBreadcrumb, captureSentryException, withSentrySpan } from "../monitoring/sentry";

type LocationReadiness = {
    ok: boolean;
    reason: "ok" | "permission-denied" | "services-disabled" | "error";
    permission?: Location.LocationPermissionResponse;
    servicesEnabled?: boolean;
};

const LOCATION_PERMISSION_MESSAGE =
    "Location permission is required for live tracking. Please allow location access in app settings.";
const LOCATION_SERVICES_MESSAGE =
    "Location services are turned off. Please enable GPS/location services to continue live tracking.";
const LOCATION_UNAVAILABLE_MESSAGE =
    "We could not read your location right now. Please try again in a few seconds.";

export const useLocation = () => {
    const requestForegroundPermission = useCallback(async (scope: string) => {
        return withSentrySpan(
            {
                op: "location.permission",
                name: `location.permission:${scope}`,
            },
            async () => {
                try {
                    const permission = await Location.requestForegroundPermissionsAsync();
                    console.log("[Location][permission][request]", {
                        scope,
                        status: permission.status,
                        granted: permission.granted,
                        canAskAgain: permission.canAskAgain,
                    });
                    addSentryBreadcrumb({
                        category: "location",
                        message: "Foreground permission requested",
                        level: "info",
                        data: {
                            scope,
                            granted: permission.granted,
                            canAskAgain: permission.canAskAgain,
                        },
                    });

                    return permission;
                } catch (error) {
                    captureSentryException(error, {
                        tags: {
                            area: "location",
                            operation: "request_permission",
                            scope,
                        },
                    });
                    throw error;
                }
            },
        );
    }, []);

    const hasServicesEnabled = useCallback(async (scope: string) => {
        try {
            const enabled = await Location.hasServicesEnabledAsync();
            console.log("[Location][services]", {
                scope,
                enabled,
            });
            return enabled;
        } catch (error) {
            captureSentryException(error, {
                tags: {
                    area: "location",
                    operation: "has_services_enabled",
                    scope,
                },
            });
            return false;
        }
    }, []);

    const ensureForegroundAccess = useCallback(
        async (
            scope: string,
            options?: {
                showAlerts?: boolean;
            },
        ): Promise<LocationReadiness> => {
            const showAlerts = options?.showAlerts ?? true;

            try {
                const currentPermission = await Location.getForegroundPermissionsAsync();
                console.log("[Location][permission][current]", {
                    scope,
                    status: currentPermission.status,
                    granted: currentPermission.granted,
                    canAskAgain: currentPermission.canAskAgain,
                });

                const permission = currentPermission.granted
                    ? currentPermission
                    : await requestForegroundPermission(scope);

                if (!permission.granted) {
                    addSentryBreadcrumb({
                        category: "location",
                        message: "Foreground location permission denied",
                        level: "warning",
                        data: {
                            scope,
                            canAskAgain: permission.canAskAgain,
                        },
                    });

                    if (showAlerts) {
                        Alert.alert("Location permission needed", LOCATION_PERMISSION_MESSAGE);
                    }

                    return {
                        ok: false,
                        reason: "permission-denied",
                        permission,
                    };
                }

                const servicesEnabled = await hasServicesEnabled(scope);
                if (!servicesEnabled) {
                    addSentryBreadcrumb({
                        category: "location",
                        message: "Location services disabled",
                        level: "warning",
                        data: {
                            scope,
                        },
                    });

                    if (showAlerts) {
                        Alert.alert("Turn on location services", LOCATION_SERVICES_MESSAGE);
                    }

                    return {
                        ok: false,
                        reason: "services-disabled",
                        permission,
                        servicesEnabled,
                    };
                }

                return {
                    ok: true,
                    reason: "ok",
                    permission,
                    servicesEnabled,
                };
            } catch (error) {
                captureSentryException(error, {
                    tags: {
                        area: "location",
                        operation: "ensure_foreground_access",
                        scope,
                    },
                });

                if (showAlerts) {
                    Alert.alert("Location unavailable", LOCATION_UNAVAILABLE_MESSAGE);
                }

                return {
                    ok: false,
                    reason: "error",
                };
            }
        },
        [hasServicesEnabled, requestForegroundPermission],
    );

    const getCurrentPositionSafe = useCallback(
        async (
            scope: string,
            options?: Location.LocationOptions,
        ): Promise<Location.LocationObject | null> => {
            return withSentrySpan(
                {
                    op: "location.current",
                    name: `location.current_safe:${scope}`,
                },
                async () => {
                    try {
                        const current = await Location.getCurrentPositionAsync(options ?? {});
                        console.log("[Location][current]", {
                            scope,
                            latitude: current.coords.latitude,
                            longitude: current.coords.longitude,
                            accuracy: current.coords.accuracy ?? null,
                        });
                        return current;
                    } catch (error) {
                        console.warn("[Location][current][failed]", {
                            scope,
                            error,
                        });

                        captureSentryException(error, {
                            tags: {
                                area: "location",
                                operation: "get_current_position",
                                scope,
                            },
                            level: "warning",
                        });

                        try {
                            const fallback = await Location.getLastKnownPositionAsync({
                                maxAge: 60_000,
                                requiredAccuracy: 300,
                            });

                            if (fallback) {
                                console.log("[Location][fallback][last_known]", {
                                    scope,
                                    latitude: fallback.coords.latitude,
                                    longitude: fallback.coords.longitude,
                                    accuracy: fallback.coords.accuracy ?? null,
                                });

                                addSentryBreadcrumb({
                                    category: "location",
                                    message: "Using last known location as fallback",
                                    level: "warning",
                                    data: {
                                        scope,
                                    },
                                });
                            }

                            return fallback;
                        } catch (fallbackError) {
                            captureSentryException(fallbackError, {
                                tags: {
                                    area: "location",
                                    operation: "get_last_known_position",
                                    scope,
                                },
                                level: "warning",
                            });

                            return null;
                        }
                    }
                },
            );
        },
        [],
    );

    const getCurrentPosition = useCallback(
        async (
            scope: string,
            options?: Location.LocationOptions,
        ): Promise<Location.LocationObject> => {
            const location = await getCurrentPositionSafe(scope, options);
            if (location) {
                return location;
            }

            const error = new Error("Location unavailable");
            captureSentryException(error, {
                tags: {
                    area: "location",
                    operation: "get_current_position_hard_fail",
                    scope,
                },
            });
            throw error;
        },
        [getCurrentPositionSafe],
    );

    const watchPosition = useCallback(
        async (
            scope: string,
            options: Location.LocationOptions,
            listener: Location.LocationCallback,
        ): Promise<Location.LocationSubscription> => {
            try {
                return await Location.watchPositionAsync(options, (position) => {
                    console.log("[Location][watch]", {
                        scope,
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy ?? null,
                    });
                    listener(position);
                });
            } catch (error) {
                captureSentryException(error, {
                    tags: {
                        area: "location",
                        operation: "watch_position",
                        scope,
                    },
                });
                throw error;
            }
        },
        [],
    );

    return {
        requestForegroundPermission,
        hasServicesEnabled,
        ensureForegroundAccess,
        getCurrentPositionSafe,
        getCurrentPosition,
        watchPosition,
    };
};

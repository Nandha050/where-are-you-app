import * as Location from "expo-location";
import { useCallback } from "react";
import { addSentryBreadcrumb, captureSentryException, withSentrySpan } from "../monitoring/sentry";

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
            return await Location.hasServicesEnabledAsync();
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

    const getCurrentPosition = useCallback(
        async (
            scope: string,
            options?: Location.LocationOptions,
        ): Promise<Location.LocationObject> => {
            return withSentrySpan(
                {
                    op: "location.current",
                    name: `location.current:${scope}`,
                },
                async () => {
                    try {
                        return await Location.getCurrentPositionAsync(options ?? {});
                    } catch (error) {
                        captureSentryException(error, {
                            tags: {
                                area: "location",
                                operation: "get_current_position",
                                scope,
                            },
                        });
                        throw error;
                    }
                },
            );
        },
        [],
    );

    const watchPosition = useCallback(
        async (
            scope: string,
            options: Location.LocationOptions,
            listener: Location.LocationCallback,
        ): Promise<Location.LocationSubscription> => {
            try {
                return await Location.watchPositionAsync(options, listener);
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
        getCurrentPosition,
        watchPosition,
    };
};

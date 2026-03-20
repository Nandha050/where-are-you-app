import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { addSentryBreadcrumb } from "../monitoring/sentry";

type ScreenContext = Record<string, unknown>;

export const useSentryScreen = (screenName: string, context?: ScreenContext) => {
    useFocusEffect(
        useCallback(() => {
            addSentryBreadcrumb({
                category: "navigation",
                message: `Screen viewed: ${screenName}`,
                level: "info",
                data: context,
            });
        }, [context, screenName]),
    );
};

import type { ErrorBoundaryProps } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { captureSentryException } from "../monitoring/sentry";

export default function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    const didCaptureRef = useRef(false);

    useEffect(() => {
        if (didCaptureRef.current) {
            return;
        }

        didCaptureRef.current = true;
        captureSentryException(error, {
            tags: {
                area: "ui",
                source: "expo_router_error_boundary",
            },
            extra: {
                message: error?.message,
            },
            level: "fatal",
        });
    }, [error]);

    return (
        <View className="flex-1 items-center justify-center bg-slate-100 px-6">
            <Text className="text-2xl font-extrabold text-slate-900">Something went wrong</Text>
            <Text className="mt-3 text-center text-sm text-slate-600">
                {error?.message ?? "Unexpected runtime error"}
            </Text>
            <Pressable className="mt-6 rounded-xl bg-blue-700 px-5 py-3" onPress={retry}>
                <Text className="text-sm font-bold text-white">Try again</Text>
            </Pressable>
        </View>
    );
}

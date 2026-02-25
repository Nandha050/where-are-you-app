

import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function Login() {
    return (
        <View className="flex-1 items-center justify-center bg-white">
            <Text className="text-2xl font-bold mb-4">Login</Text>

            <Pressable
                className="bg-blue-500 px-6 py-3 rounded-xl"
                onPress={() => router.replace("/(tabs)/home")}
            >
                <Text className="text-white">Login</Text>
            </Pressable>
        </View>
    );
}
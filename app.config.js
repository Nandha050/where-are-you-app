const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default {
  expo: {
    name: "where-are-you-application",
    slug: "where-are-you-live",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "whereareyoulive",
    userInterfaceStyle: "automatic",
    owner: "whereareyou",
    extra: {
      eas: {
        projectId: "a002b494-eca3-4a82-b9ea-231745e9212d",
      },
    },
    ios: {
      bundleIdentifier: "com.maruthikummari.whereareyoulive",
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "We need your location to track the bus in real-time",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "We need your location to track the bus even when the app is in the background",
        NSLocationAlwaysUsageDescription:
          "We need your location to track the bus continuously",
        UIBackgroundModes: ["location"],
      },
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      package: "com.maruthikummari.whereareyoulive",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "POST_NOTIFICATIONS",
        "RECEIVE_BOOT_COMPLETED",
      ],
      config: {
        googleMaps: {
          apiKey: GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-font",
      "expo-web-browser",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: "react-native",
          organization: "whereareyou",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow Where Are You to use your location for bus tracking.",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/android-icon-monochrome.png",
          color: "#2563EB",
          sounds: [],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};

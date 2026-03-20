export default {
  "expo": {
    "name": "where-are-you-application",
    "slug": "where-are-you-application",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "whereareyouapplication",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/images/android-icon-foreground.png",
        "backgroundImage": "./assets/images/android-icon-background.png",
        "monochromeImage": "./assets/images/android-icon-monochrome.png"
      },
      "edgeToEdgeEnabled": true,
      "predictiveBackGestureEnabled": false,
      "package": "com.maruthikummari.whereareyouapplication",
      "config": {
        "googleMaps": {
          "apiKey": process.env.GOOGLE_MAPS_API_KEY
        }
      }
    },
    "web": {
      "bundler": "metro",
      "output": "static",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff",
          "dark": {
            "backgroundColor": "#000000"
          }
        }
      ],
      [
        "@sentry/react-native/expo",
        {
          "url": "https://sentry.io/",
          "project": "react-native",
          "organization": "whereareyou"
        }
      ],
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow Where Are You to use your location for bus tracking."
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    },
    "extra": {
      "router": {},
      "eas": {
        "projectId": "598824a5-d7a9-4e70-917b-8824eaddd725"
      }
    },
    "owner": "maruthikummari"
  }
}
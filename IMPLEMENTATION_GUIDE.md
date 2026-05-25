# Premium UI Implementation Guide

## Overview
This guide provides step-by-step instructions for integrating the premium transit tracking UI into your existing tracking.tsx application.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│       PremiumTrackingScreen (Root)          │
├─────────────────────────────────────────────┤
│ ┌───────────────────────────────────────┐   │
│ │   RouteMap (Background)               │   │
│ │   - Custom markers                    │   │
│ │   - Polylines with custom styling     │   │
│ │   - Street-level zoom (18)            │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │   FloatingMapElements (Overlay)       │   │
│ │   - FloatingSearchBar (Top)           │   │
│ │   - FloatingTransitCard (Top-Center)  │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │   Animated PremiumBottomSheet         │   │
│ │   - Timeline with stops              │   │
│ │   - Swipe gestures                    │   │
│ │   - Real-time updates                 │   │
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │   FloatingNavDock (Bottom)            │   │
│ │   - 4 navigation items                │   │
│ │   - Active state highlighting         │   │
│ └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Step-by-Step Integration

### Step 1: Update `app/(user)/tracking.tsx`

Replace the existing tracking component with the premium version:

```typescript
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, View, ActivityIndicator } from "react-native";
import { useRouteTracking } from "@/hooks";
import {
  PremiumTrackingScreen,
  ErrorBoundary,
} from "@/components";

export default function TrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  const tripId = params.tripId as string;
  const { loading, error, tracking } = useRouteTracking({
    tripId,
  });

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-100">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !tracking) {
    return (
      <ErrorBoundary
        onRetry={() => router.back()}
        message="Unable to load tracking data"
      />
    );
  }

  // Transform tracking data to premium component format
  const stops = tracking.upcomingStops?.map((stop) => ({
    id: stop.stopId,
    name: stop.name || "Unknown Stop",
    status: getStopStatus(stop, tracking),
    time: stop.departedClockTimeText || stop.arrivalClockTimeText,
    eta: stop.arrivalClockTimeText,
    helperText: getHelperText(stop, tracking),
  })) || [];

  const handleNavPress = (item: string) => {
    // Handle navigation dock press
    switch (item) {
      case "home":
        router.navigate("/(user)/home");
        break;
      case "alerts":
        router.navigate("/(user)/alerts");
        break;
      case "profile":
        router.navigate("/(user)/profile");
        break;
      case "saved":
        router.navigate("/(user)/saved");
        break;
    }
  };

  return (
    <ErrorBoundary>
      <PremiumTrackingScreen
        routeOrigin={tracking.routeStartName || "Start"}
        routeDestination={tracking.routeEndName || "End"}
        stops={stops}
        currentLocation={
          tracking.busLocation
            ? {
                latitude: tracking.busLocation.latitude,
                longitude: tracking.busLocation.longitude,
              }
            : null
        }
        coordinates={tracking.routeCoordinates || []}
        encodedPolyline={tracking.encodedPolyline || ""}
        onNavPress={handleNavPress}
      />
    </ErrorBoundary>
  );
}

// Helper function to determine stop status
function getStopStatus(
  stop: any,
  tracking: any
): "passed" | "current" | "upcoming" {
  if (stop.status === "Reached") return "passed";
  if (stop.stopId === tracking.nextStopId) return "current";
  return "upcoming";
}

// Helper function for status text
function getHelperText(stop: any, tracking: any): string {
  if (stop.status === "Reached") return "Completed";
  if (stop.stopId === tracking.nextStopId) return "Arriving Now";
  
  // Calculate time remaining
  const arrivalTime = new Date(`2024-01-01 ${stop.arrivalClockTimeText}`);
  const now = new Date(`2024-01-01 ${tracking.currentTime}`);
  const diffMinutes = Math.round((arrivalTime.getTime() - now.getTime()) / 60000);
  
  if (diffMinutes <= 0) return "Soon";
  if (diffMinutes === 1) return "In 1 min";
  return `In ${diffMinutes} mins`;
}
```

### Step 2: Verify Component Imports

Ensure your `components/index.ts` exports all premium components:

```typescript
// Existing exports...
export { PremiumBottomSheet } from "./PremiumBottomSheet";
export { FloatingNavDock } from "./FloatingNavDock";
export { FloatingMapElements, FloatingSearchBar, FloatingTransitCard } from "./FloatingMapElements";
export { PremiumTrackingScreen } from "./PremiumTrackingScreen";
```

### Step 3: Verify Font Configuration

Ensure Poppins font is properly configured in `app.json`:

```json
{
  "plugins": [
    [
      "expo-font",
      {
        "fonts": ["./assets/fonts/Poppins-Regular.ttf", "./assets/fonts/Poppins-Bold.ttf", "./assets/fonts/Poppins-SemiBold.ttf"]
      }
    ]
  ]
}
```

And in your Tailwind config (`tailwind.config.js`):

```javascript
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "system-ui"],
      },
    },
  },
};
```

### Step 4: Test on Multiple Devices

Create a test plan for different scenarios:

#### Scenario 1: Normal Route with Multiple Stops
```typescript
// Test with complete route data
const mockTracking = {
  routeStartName: "Sangareddy",
  routeEndName: "Bvrit",
  busLocation: { latitude: 17.35, longitude: 78.47 },
  nextStopId: "stop-2",
  upcomingStops: [
    // 5-10 realistic stops
  ],
};
```

#### Scenario 2: Last Stop Approaching
```typescript
// Test with bus near final destination
const mockTracking = {
  nextStopId: "stop-5",
  upcomingStops: [
    // Only 1-2 stops remaining
  ],
};
```

#### Scenario 3: Network Disconnected
```typescript
// Test resilience to socket disconnection
// Verify UI gracefully handles stale data
// Check error boundary renders correctly
```

### Step 5: Performance Optimization

Add memoization to prevent unnecessary re-renders:

```typescript
// In app/(user)/tracking.tsx
import { useMemo, useCallback } from "react";

export default function TrackingScreen() {
  // ... existing code ...

  // Memoize transformed stops
  const stops = useMemo(() => {
    return tracking.upcomingStops?.map((stop) => ({
      id: stop.stopId,
      name: stop.name || "Unknown Stop",
      status: getStopStatus(stop, tracking),
      time: stop.departedClockTimeText || stop.arrivalClockTimeText,
      eta: stop.arrivalClockTimeText,
      helperText: getHelperText(stop, tracking),
    })) || [];
  }, [tracking.upcomingStops, tracking.nextStopId, tracking.currentTime]);

  // Memoize nav press handler
  const handleNavPress = useCallback((item: string) => {
    switch (item) {
      case "home":
        router.navigate("/(user)/home");
        break;
      // ... other cases ...
    }
  }, [router]);

  return (
    <PremiumTrackingScreen
      stops={stops}
      onNavPress={handleNavPress}
      // ... other props ...
    />
  );
}
```

### Step 6: Add Error Handling

Implement graceful error boundaries:

```typescript
// Create a component wrapper for error handling
import { ErrorBoundary } from "@/components";

function TrackingScreenWithErrorBoundary() {
  const router = useRouter();

  return (
    <ErrorBoundary
      onRetry={() => router.refresh()}
      fallback={(error) => (
        <View className="flex-1 items-center justify-center bg-slate-100">
          <Text className="text-red-600 text-center px-4">
            {error?.message || "Something went wrong"}
          </Text>
          <Button
            title="Go Back"
            onPress={() => router.back()}
            className="mt-4"
          />
        </View>
      )}
    >
      <TrackingScreen />
    </ErrorBoundary>
  );
}
```

### Step 7: Add Accessibility Features

Enhance component accessibility:

```typescript
// In PremiumBottomSheet, add testID and accessibility labels
<View
  testID="premium-bottom-sheet"
  accessible={true}
  accessibilityRole="list"
  accessibilityLabel="Route stops timeline"
>
  {stops.map((stop) => (
    <View
      key={stop.id}
      testID={`stop-${stop.id}`}
      accessible={true}
      accessibilityRole="listitem"
      accessibilityLabel={`${stop.name}, ${getAccessibilityLabel(stop)}`}
    >
      {/* Stop UI */}
    </View>
  ))}
</View>

function getAccessibilityLabel(stop: any): string {
  if (stop.status === "passed") return "Completed";
  if (stop.status === "current") return "Current stop, arriving now";
  return `Upcoming stop at ${stop.eta}`;
}
```

## Data Flow Diagram

```
useRouteTracking Hook
    ↓
    ├─ busLocation (live)
    ├─ nextStopId (current)
    ├─ upcomingStops[] (timeline)
    └─ routeCoordinates[]
    
    ↓ (transform via useMemo)
    
Premium Component Props
    ├─ stops (formatted for timeline)
    ├─ currentLocation (for map)
    ├─ coordinates (for polyline)
    └─ encoded Polyline
    
    ↓ (render)
    
PremiumTrackingScreen
    ├─ RouteMap (map + custom markers + polylines)
    ├─ FloatingMapElements (search + transit card)
    ├─ PremiumBottomSheet (timeline + details)
    └─ FloatingNavDock (navigation)
```

## Configuration Checklist

- [x] Premium components created
- [ ] tracking.tsx updated with PremiumTrackingScreen
- [ ] Data transformation logic implemented
- [ ] Navigation handlers connected
- [ ] Font system verified
- [ ] Tailwind utilities available
- [ ] Error boundaries in place
- [ ] Performance optimizations applied
- [ ] Accessibility labels added
- [ ] Testing completed on iOS and Android

## Troubleshooting

### Issue: Sheet doesn't expand on Android
**Solution**: Check if gesture responder is properly initialized. May need to enable experimental gesture handling in components.

### Issue: Blur effects not showing
**Solution**: Ensure @react-native-community/blur or equivalent is installed. On web, blur falls back to opacity.

### Issue: Map markers appear blurry
**Solution**: Verify custom marker SVG resolution. Increase size multiplier if needed.

### Issue: Timeline updates are slow
**Solution**: Check useRouteTracking hook debounce settings. May need to reduce debounce delay (default: 500ms).

## Next Steps

1. Implement the integration in tracking.tsx
2. Test on iOS simulator
3. Test on Android emulator
4. Test on physical devices
5. Gather user feedback
6. Make final adjustments
7. Deploy to production

---

**Status**: Ready for Implementation  
**Last Updated**: May 2026  
**Estimated Integration Time**: 2-3 hours

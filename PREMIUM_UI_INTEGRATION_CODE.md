# Premium UI - Integration Code

This file contains the exact code changes needed to integrate premium components into `app/(user)/tracking.tsx`.

## Current State vs. Premium State

### BEFORE: Current tracking.tsx Structure
```typescript
<SafeAreaView className="flex-1 bg-white">
  <View className="flex-1 flex-col">
    {/* Header */}
    <TripHeader tracking={tracking} />
    
    {/* Map */}
    <RouteMap {...mapProps} />
    
    {/* Bottom Sheet with basic BottomSheetContent */}
    <BottomSheetContent 
      stops={tracking.upcomingStops}
      trackingState={tracking}
    />
  </View>
</SafeAreaView>
```

### AFTER: Premium tracking.tsx Structure
```typescript
<SafeAreaView className="flex-1 bg-slate-900">
  <PremiumTrackingScreen
    routeOrigin={tracking.routeStartName}
    routeDestination={tracking.routeEndName}
    stops={formattedStops}
    currentLocation={tracking.busLocation}
    coordinates={tracking.routeCoordinates}
    encodedPolyline={tracking.encodedPolyline}
    onNavPress={handleNavigation}
  />
</SafeAreaView>
```

## Code Changes Required

### Change 1: Import Premium Components

**Location**: Top of `app/(user)/tracking.tsx`

```typescript
// EXISTING IMPORTS (keep these)
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { SafeAreaView, View, ActivityIndicator, Platform } from "react-native";
import { useRouteTracking } from "@/hooks/useRouteTracking";

// ADD THESE PREMIUM COMPONENT IMPORTS
import {
  PremiumTrackingScreen,
  PremiumBottomSheet,
  FloatingNavDock,
  FloatingMapElements,
  ErrorBoundary,
} from "@/components";

// KEEP EXISTING IMPORTS
import { RouteMap, TripHeader, BottomSheetContent } from "@/components";
```

### Change 2: Add Helper Functions

**Location**: Below imports, before component definition

```typescript
/**
 * Determines the visual status of a stop
 */
function getStopStatus(
  stop: any,
  nextStopId?: string
): "passed" | "current" | "upcoming" {
  if (stop.status === "Reached" || stop.status === "reached") {
    return "passed";
  }
  if (stop.stopId === nextStopId) {
    return "current";
  }
  return "upcoming";
}

/**
 * Gets human-readable helper text for a stop
 */
function getHelperText(
  stop: any,
  nextStopId?: string,
  currentTime?: string
): string {
  const status = getStopStatus(stop, nextStopId);

  switch (status) {
    case "passed":
      return "Completed";
    case "current":
      return "Arriving Now";
    case "upcoming":
      // Calculate minutes remaining if current time available
      if (currentTime && stop.arrivalClockTimeText) {
        try {
          const arrival = new Date(`2024-01-01 ${stop.arrivalClockTimeText}`);
          const now = new Date(`2024-01-01 ${currentTime}`);
          const diffMinutes = Math.round(
            (arrival.getTime() - now.getTime()) / 60000
          );

          if (diffMinutes <= 0) return "Soon";
          if (diffMinutes === 1) return "In 1 min";
          return `In ${diffMinutes} mins`;
        } catch {
          return "Upcoming";
        }
      }
      return "Upcoming";
    default:
      return "";
  }
}

/**
 * Transforms raw tracking stops to premium timeline format
 */
function transformStopsForPremium(
  tracking: any
): Array<{
  id: string;
  name: string;
  status: "passed" | "current" | "upcoming";
  time?: string;
  eta?: string;
  helperText: string;
}> {
  if (!tracking?.upcomingStops) return [];

  return tracking.upcomingStops.map((stop: any) => ({
    id: stop.stopId || stop.id || `stop-${Math.random()}`,
    name: stop.name || "Unknown Stop",
    status: getStopStatus(stop, tracking.nextStopId),
    time: stop.departedClockTimeText || stop.arrivalClockTimeText || "",
    eta: stop.arrivalClockTimeText || "",
    helperText: getHelperText(stop, tracking.nextStopId, tracking.currentTime),
  }));
}
```

### Change 3: Replace Component Logic

**Location**: Replace the main component return

```typescript
export default function TrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Extract trip ID from params
  const tripId =
    typeof params.tripId === "string" ? params.tripId : params.tripId?.[0];

  // Use tracking hook
  const { loading, error, tracking } = useRouteTracking({
    tripId,
  });

  // Handle loading state
  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-100">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      </SafeAreaView>
    );
  }

  // Handle error state
  if (error || !tracking) {
    return (
      <ErrorBoundary
        onRetry={() => router.back()}
        message={
          error?.message || "Unable to load tracking information. Please try again."
        }
      />
    );
  }

  // Transform stops for premium component
  const premiumStops = transformStopsForPremium(tracking);

  // Handle navigation from dock
  const handleNavPress = (item: string) => {
    switch (item) {
      case "home":
        router.push("/(user)/home");
        break;
      case "alerts":
        router.push("/(user)/alerts");
        break;
      case "profile":
        router.push("/(user)/profile");
        break;
      case "saved":
        router.push("/(user)/saved");
        break;
      default:
        break;
    }
  };

  // Format current location
  const currentLocation = tracking.busLocation
    ? {
        latitude: tracking.busLocation.latitude,
        longitude: tracking.busLocation.longitude,
      }
    : null;

  // Extract coordinates for map
  const coordinates = tracking.routeCoordinates || [];
  const encodedPolyline = tracking.encodedPolyline || "";

  // PREMIUM UI RENDER
  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <ErrorBoundary>
        <PremiumTrackingScreen
          routeOrigin={tracking.routeStartName || "Start Location"}
          routeDestination={tracking.routeEndName || "End Location"}
          stops={premiumStops}
          currentLocation={currentLocation}
          coordinates={coordinates}
          encodedPolyline={encodedPolyline}
          onNavPress={handleNavPress}
        />
      </ErrorBoundary>
    </SafeAreaView>
  );
}
```

## Optional: Keep Legacy UI as Fallback

If you want to keep the old UI temporarily for comparison:

```typescript
// Add this to export a "LegacyTrackingScreen" component
export function LegacyTrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const tripId =
    typeof params.tripId === "string" ? params.tripId : params.tripId?.[0];
  const { loading, error, tracking } = useRouteTracking({ tripId });

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#000" />
        </View>
      </SafeAreaView>
    );
  }

  // ... old implementation ...
}
```

Then switch between implementations:

```typescript
// In tracking.tsx, at the very bottom:
const USE_PREMIUM_UI = true; // Toggle this flag

export default USE_PREMIUM_UI
  ? TrackingScreen // New premium component
  : LegacyTrackingScreen; // Old fallback
```

## Testing the Integration

### Test 1: Basic Render
```typescript
// Press into a route and verify:
// ✓ Map displays with street-level zoom (18)
// ✓ No TypeScript errors in console
// ✓ No red screen errors
// ✓ Loading state briefly shows ActivityIndicator
```

### Test 2: Data Display
```typescript
// Verify premium components receive data:
// ✓ Origin/Destination names shown in sheet header
// ✓ Timeline shows all stops with correct status colors
// ✓ Current stop has blue highlight
// ✓ Passed stops show green checkmarks
// ✓ Upcoming stops show gray dots
```

### Test 3: Interactions
```typescript
// Test user interactions:
// ✓ Swipe up on sheet expands it fully
// ✓ Swipe down on sheet collapses it
// ✓ Tap on nav dock items navigates
// ✓ Tap search bar (future: opens search)
// ✓ Transit card shows current stop info
```

### Test 4: Real-Time Updates
```typescript
// With live socket data:
// ✓ Timeline updates when bus arrives at next stop
// ✓ Current stop status changes from "upcoming" to "current"
// ✓ Previously current stop now shows as "passed"
// ✓ Bus marker updates smoothly on map
// ✓ ETA/timing values update in real-time
```

### Test 5: Edge Cases
```typescript
// Test error scenarios:
// ✓ No internet: Error boundary shows gracefully
// ✓ Invalid tripId: Error message displays
// ✓ Empty stops: Component handles empty array
// ✓ Very long stop names: Text truncates properly
// ✓ Very short route: Only 1-2 stops display correctly
```

## Performance Tips

After integration, check performance:

```typescript
// Add this to monitor performance
if (Platform.OS === "web") {
  // Use React DevTools to check component re-renders
  console.log("PremiumTrackingScreen rendered");
}

// Use memoization to prevent unnecessary updates
import { useMemo, useCallback } from "react";

const handleNavPress = useCallback((item: string) => {
  // Navigation handler
}, []);

const premiumStops = useMemo(() => {
  return transformStopsForPremium(tracking);
}, [tracking]);
```

## Rollback Plan

If premium UI causes issues, quickly revert:

```typescript
// Change this line in tracking.tsx
const USE_PREMIUM_UI = false; // Instantly switch to legacy UI
```

## Migration Timeline

**Recommended rollout**:
1. Day 1: Deploy premium UI to dev/staging
2. Day 2: Gather internal feedback
3. Day 3: Deploy to 10% of users (gradual rollout)
4. Day 4-5: Monitor crash reports, battery usage, performance
5. Day 6: Full rollout if stable

**Success criteria**:
- ✓ No crash rate increase
- ✓ Frame rate >50 FPS on test devices
- ✓ User engagement stays same or increases
- ✓ No battery drain complaints

---

**Ready for Integration**: Yes ✅  
**Estimated Integration Time**: 30 minutes  
**Risk Level**: Low (modular, isolated changes)

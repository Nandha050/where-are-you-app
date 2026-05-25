# Premium UI - Quick Reference Card

## 🚀 Integration in 5 Minutes

### 1. Copy Helper Functions (app/(user)/tracking.tsx)
```typescript
function getStopStatus(stop: any, nextStopId?: string) {
  if (stop.status === "Reached") return "passed";
  if (stop.stopId === nextStopId) return "current";
  return "upcoming";
}

function getHelperText(stop: any, nextStopId?: string) {
  const status = getStopStatus(stop, nextStopId);
  if (status === "passed") return "Completed";
  if (status === "current") return "Arriving Now";
  return "Upcoming";
}

function transformStopsForPremium(tracking: any) {
  return tracking.upcomingStops?.map((stop: any) => ({
    id: stop.stopId,
    name: stop.name || "Unknown",
    status: getStopStatus(stop, tracking.nextStopId),
    eta: stop.arrivalClockTimeText,
    helperText: getHelperText(stop, tracking.nextStopId),
  })) || [];
}
```

### 2. Update Imports
```typescript
import { PremiumTrackingScreen } from "@/components";
```

### 3. Replace Component Return
```typescript
export default function TrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const tripId = typeof params.tripId === "string" ? params.tripId : params.tripId?.[0];
  const { loading, error, tracking } = useRouteTracking({ tripId });

  if (loading) return <ActivityIndicator />;
  if (error || !tracking) return <ErrorBoundary />;

  const stops = transformStopsForPremium(tracking);
  const handleNavPress = (item: string) => router.push(`/(user)/${item}`);

  return (
    <SafeAreaView className="flex-1">
      <PremiumTrackingScreen
        routeOrigin={tracking.routeStartName}
        routeDestination={tracking.routeEndName}
        stops={stops}
        currentLocation={tracking.busLocation}
        coordinates={tracking.routeCoordinates}
        encodedPolyline={tracking.encodedPolyline}
        onNavPress={handleNavPress}
      />
    </SafeAreaView>
  );
}
```

## 📦 Component Props Cheat Sheet

### PremiumTrackingScreen
```typescript
<PremiumTrackingScreen
  routeOrigin="string"           // "Sangareddy"
  routeDestination="string"      // "Bvrit"
  stops={TimelineStop[]}         // Array of stops
  currentLocation={{ latitude: #, longitude: # }}
  coordinates={LatLng[]}         // Route waypoints
  encodedPolyline="string"       // Encoded polyline
  onNavPress={(item: string) => {}} // Nav handler
/>
```

### TimelineStop Interface
```typescript
{
  id: string;              // "stop-1"
  name: string;            // "Tech Park"
  status: "passed" | "current" | "upcoming";
  time?: string;           // "12:45 PM"
  eta?: string;            // "1:04 PM"
  helperText: string;      // "In 6 mins"
}
```

### FloatingNavDock
```typescript
<FloatingNavDock
  active="home"                    // Active tab
  onPress={(item) => {}}          // Press handler
  badgeCount={3}                  // Optional badge
/>
// Items: home, alerts, profile, saved
```

## 🎨 Design System Quick Lookup

### Colors (Hex Codes)
```
#F7F7F8    Off-white (primary bg)
#F1F5F9    Light slate (secondary bg)
#3B82F6    Modern blue (accent)
#10B981    Emerald green (success)
#0F172A    Dark slate (text)
#64748B    Muted slate (secondary text)
#E2E8F0    Light gray (borders)
```

### Spacing (Tailwind)
```
gap-1      4px     minimal
gap-2      8px     small
gap-3      12px    medium
gap-4      16px    standard
gap-6      24px    large
gap-8      32px    xlarge
```

### Border Radius
```
Cards:     28-32px  (rounded-3xl to rounded-4xl)
Buttons:   16-20px  (rounded-2xl)
Pills:     24-28px  (rounded-full, full height)
```

### Shadows
```
shadow-sm    Subtle (2px)
shadow-md    Default (4px)
shadow-lg    Elevated (8px)
shadow-xl    High (12px+)
```

## 🧪 Quick Test Checklist

- [ ] App compiles without errors
- [ ] Map displays with custom markers
- [ ] Bottom sheet visible and closable
- [ ] Swipe up expands sheet
- [ ] Timeline shows stops with correct colors
- [ ] Navigation dock items respond to tap
- [ ] Transit card shows next stop
- [ ] Real-time data updates appear
- [ ] No console errors
- [ ] Frame rate smooth (60 FPS)

## 📁 File Locations

```
Components:
  components/PremiumBottomSheet.tsx
  components/FloatingNavDock.tsx
  components/FloatingMapElements.tsx
  components/PremiumTrackingScreen.tsx

Integration Point:
  app/(user)/tracking.tsx

Documentation:
  PREMIUM_UI_GUIDE.md              (Design system)
  INTEGRATION_CHECKLIST.md         (Implementation roadmap)
  IMPLEMENTATION_GUIDE.md          (Architecture guide)
  PREMIUM_UI_INTEGRATION_CODE.md   (Code examples)
  DESIGN_SPECS.md                  (Exact measurements)
  PREMIUM_UI_SUMMARY.md            (Overview)
  PREMIUM_UI_QUICK_REF.md          (This file)
```

## 🐛 Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "Module not found" | Check components/index.ts exports |
| PropTypes error | Verify prop names match interface |
| Blur not visible | Expected on some Android devices |
| Sheet won't swipe | May need gesture handler library |
| Performance lag | Use memoization for transforms |
| Safe area wrong | Use useSafeAreaInsets() hook |
| Colors look off | Check Tailwind config content paths |

## 🎯 Navigation Item Values
```typescript
"home"      // Navigate to /(user)/home
"alerts"    // Navigate to /(user)/alerts
"profile"   // Navigate to /(user)/profile
"saved"     // Navigate to /(user)/saved
```

## 💾 Stop Status Examples

```typescript
// Passed Stop
{
  id: "stop-1",
  name: "Grand Central Terminal",
  status: "passed",        // ✓ Green checkmark
  time: "12:45 PM",
  helperText: "Completed"
}

// Current Stop
{
  id: "stop-2",
  name: "Tech Park",
  status: "current",       // ⊙ Blue glow circle
  eta: "1:04 PM",
  helperText: "Arriving Now"
}

// Upcoming Stop
{
  id: "stop-3",
  name: "Tech District",
  status: "upcoming",      // ○ Gray dot
  eta: "1:10 PM",
  helperText: "In 6 mins"
}
```

## 🔄 Data Transform Pattern

```typescript
// From socket data → To premium format
{
  // RAW from socket
  upcomingStops: [
    { stopId: "1", name: "Stop A", status: "Reached", ... }
  ],
  nextStopId: "2",
  busLocation: { latitude: ..., longitude: ... }
}

// TRANSFORM using helper functions
↓ transformStopsForPremium()

// TO premium format
stops: [
  {
    id: "1",
    name: "Stop A",
    status: "passed",
    helperText: "Completed"
  }
]
```

## ✨ Animation Timings

```
Sheet expand/collapse:  300ms  (spring dynamics)
Nav item select:        200ms  (ease-out)
Glow pulse:             1500ms (loop)
Text fade:              250ms  (ease-in-out)
```

## 📊 Component Sizes

```
PremiumBottomSheet:
  Collapsed:  h - 140px
  Half:       h × 0.45
  Expanded:   h × 0.18

FloatingNavDock:
  Width:  200px (4 items)
  Height: 56px

FloatingTransitCard:
  Width:  w - 32px
  Height: 64px

Stop Item:
  Height: 72px
```

## 🎯 Import Pattern

```typescript
// In any file, use:
import {
  PremiumTrackingScreen,
  PremiumBottomSheet,
  FloatingNavDock,
  FloatingMapElements,
} from "@/components";
```

## 📋 Deployment Checklist

- [ ] All imports updated
- [ ] Helper functions copied
- [ ] tracking.tsx logic replaced
- [ ] No TypeScript errors
- [ ] Compiled successfully
- [ ] Tested on iOS simulator
- [ ] Tested on Android emulator
- [ ] Real-time data verified
- [ ] Gestures working smoothly
- [ ] Performance baseline OK
- [ ] Ready for production

---

## 🎓 Learn More

**Design System**: See [PREMIUM_UI_GUIDE.md](PREMIUM_UI_GUIDE.md)  
**Architecture**: See [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)  
**Code Examples**: See [PREMIUM_UI_INTEGRATION_CODE.md](PREMIUM_UI_INTEGRATION_CODE.md)  
**Measurements**: See [DESIGN_SPECS.md](DESIGN_SPECS.md)  
**Roadmap**: See [INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md)  

## 💡 Pro Tips

1. **Memoize**: Use `useMemo` for `transformStopsForPremium()` to avoid re-renders
2. **Error Boundary**: Wrap PremiumTrackingScreen in `<ErrorBoundary />`
3. **Safe Area**: Always use `SafeAreaView` as root
4. **Platform**: Different blur handling on iOS vs Android (expected)
5. **Testing**: Test with real socket data, not mocks

---

**Quick Ref Version**: 1.0  
**Print This**: Yes ✅  
**Last Updated**: May 2026

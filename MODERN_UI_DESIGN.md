# Modern Immersive Map UI - Design Documentation

## Overview
A production-ready, full-screen immersive map experience with a draggable bottom sheet for real-time bus tracking. The UI prioritizes the map as the primary interactive element with minimal static overlays.

---

## Architecture

### 1. **Core Layout Structure**
```
┌─────────────────────────────────────┐
│   Full-Screen Map (Absolute Layer)  │
│   - Route polyline (blue)           │
│   - Stop markers (color-coded)      │
│   - Live bus marker (animated)      │
└─────────────────────────────────────┘
│   ┌───────────────────────────────┐ │
│   │ Floating Top Header (Z-index) │ │
│   │ Back | Bus# TS-01-AB-1234 Live│ │
│   └───────────────────────────────┘ │
│                                       │
│     Map remains fully interactive    │
│                                       │
│ ┌─────────────────────────────────┐ │
│ │  Draggable Bottom Sheet (Z-10)  │ │
│ │  Swipe up/down with 3 states    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 2. **Component Hierarchy**
- **BottomSheet** (`BottomSheet.tsx`)
  - Animated container with PanResponder for drag gestures
  - Manages 3 snap positions (collapsed, half, full)
  - Handles spring animation and threshold detection
  
- **BottomSheetContent** (`BottomSheetContent.tsx`)
  - Responsive content adapter for different sheet states
  - Shows different layouts per state
  - Handles all trip/stop information

- **UserTrackingScreen** (`app/(user)/tracking.tsx`)
  - Main orchestrator integrating map + bottom sheet
  - Manages socket.io real-time updates
  - Subscription flow integration

---

## Bottom Sheet States

### State 1: COLLAPSED (Peek)
**Height:** ~100px  
**Purpose:** Minimal info, map remains primary focus

**Content:**
- Next Stop name (left column)
- ETA countdown (right column)
- Optional "Bus approaching" badge

**Gesture:** Swipe up to expand

**Visual:**
- Drag handle indicator
- Glass/blur background (20% black overlay)
- Smooth rounded top (24px radius)

### State 2: HALF (50% screen)
**Height:** ~50% of screen  
**Purpose:** Trip details + route management

**Content:**
```
┌─────────────────────────────────┐
│ [Drag Handle]                   │
├─────────────────────────────────┤
│ Trip Status Card                │
│ └─ "Ready to start"             │
│ └─ Updated 45s ago              │
│                                  │
│ [50/50 Grid]                    │
│ ┌──────────────┬──────────────┐ │
│ │ ETA to Dest  │ Route Name   │ │
│ │ 25 min       │ b-s          │ │
│ └──────────────┴──────────────┘ │
│                                  │
│ Route Points Card               │
│ Start: bvrit → Destination: ... │
│                                  │
│ Next Stop Highlight             │
│ (Gradient blue card)             │
│ │ Next Stop: bvrit              │
│ │ ETA: 0s  [! Approaching]      │
│                                  │
│ [Subscribe for Alerts Button]   │
└─────────────────────────────────┘
```

### State 3: FULL (90% screen)
**Height:** ~90% of screen  
**Purpose:** Complete route timeline with all stops

**Content:**
```
Timeline view with animated stops:
┌─ O  [Stop 1] - Passed ✓
│  │  
├─ O  [Stop 2] - Next (highlighted, pulse animation)
│  │  
├─ O  [Stop 3] - Upcoming
│  │  
└─ O  [Stop 4] - Upcoming

Each stop shows:
- Sequence number
- Stop name
- Status badge
- ETA countdown
- Connector line to next stop
```

---

## Color System

| Element | Color | Usage |
|---------|-------|-------|
| Primary | #2563EB (Blue) | Next stop, CTA buttons |
| Success | #10B981 (Green) | Passed stops, subscribed state |
| Warning | #F59E0B (Orange) | Upcoming stops, warnings |
| Danger | #EF4444 (Red) | Errors, alerts |
| Connected | #10B981 | Live status |
| Reconnecting | #F59E0B | Unstable connection |
| Offline | #6B7280 | No connection |
| Background | #F8FAFC | Light neutral |
| Dark BG | #0F172A | Slate-900 for map area |

---

## Typography

- **Bus Number Header:** SF Pro / Inter Bold 16px
- **Section Labels:** Uppercase, 12px, tracking-wide, semi-bold
- **Card Titles:** 18-24px, bold
- **Body Text:** 14px regular
- **Meta Info:** 12px, slate-500

---

## Interaction Design

### Swipe Gestures
1. **Collapsed → Half:** Swipe up ~40% of sheet height
2. **Half → Full:** Swipe up past 50% threshold
3. **Full → Half:** Swipe down past threshold
4. **Any → Collapsed:** Swipe down to minimum

**Animation:** Spring curve (tension: 50, friction: 8)  
**Snap Threshold:** 1/3 of available space

### Touch Feedback
- Animated spring to snap points
- Drag handle visual feedback
- Pressable button states (opacity + scale)
- Loading states with spinners

### Map Interaction
- Map remains interactive behind sheet
- Pan/zoom enabled at all sheet states
- Pinch zoom for detail level
- Double-tap to recenter

---

## Animation Details

### Sheet Movement
```typescript
Animated.spring(position, {
  toValue: targetPos,
  useNativeDriver: false,  // Required for height animation
  tension: 50,             // Bounciness
  friction: 8,             // Resistance
}).start()
```

### Stop Timeline
- Enter: 200ms ease-in with 16ms delay per item
- Pulse animation on "next stop"
- Connector lines appear with staggered timing

### Bus Marker
- Continuous rotation/pulse when approaching next stop
- Smooth position updates from socket

---

## Responsive Behavior

| Breakpoint | Map Height | Sheet Height Collapsed |
|------------|-----------|------------------------|
| Mobile (< 600px) | Full screen | 100px |
| Tablet (600-1024px) | Full screen | 120px |
| Large (> 1024px) | Full screen | 140px |

---

## Real-Time Data Integration

### Socket.io Events
The component listens to:
- `stopUpdate` → Next stop changes, timeline updates
- `etaUpdate` → ETA countdown refresh
- `busLocationUpdate` → Bus marker position
- `connectionStatus` → Live/Reconnecting/Offline badge

### State Update Flow
```
Socket Event → useRouteTracking hook
    ↓
Updates: currentStopId, nextStopId, etaMap, busLocation
    ↓
Memoized stop status + computed labels
    ↓
Sheet content re-renders (only if state changes)
    ↓
Map markers update reactively
```

---

## Accessibility

- **Touch Targets:** Min 44x44pt
- **Color Contrast:** WCAG AA compliant
- **Drag Handle:** High-contrast indicator
- **Status Badges:** Icon + text labels
- **Keyboard Support:** Back button keyboard accessible
- **VoiceOver:** Semantic labels on all interactive elements

---

## Performance Optimization

### Memoization
```typescript
- stopsWithStatus: Recalculated only when tracking.nextStopId changes
- Sheet content: Only re-renders on state changes
- Bottom sheet: Native driver = 60fps animations
```

### Throttling
- Location updates: No more than 1/sec from socket
- Map re-renders: Debounced to 500ms
- Sheet state changes: Snapped to 3 positions only

### Code Splitting
- BottomSheet loaded with route
- RouteMap lazy-loads Google Maps API
- Route timeline rendered on-demand

---

## Testing Checklist

- [ ] Swipe interactions smooth across all sheet states
- [ ] Spring animation feels natural (not bouncy)
- [ ] Map remains interactive while dragging sheet
- [ ] Real-time data updates reflect immediately
- [ ] Bus approaching indicator shows/hides correctly
- [ ] Subscribe button disables when already subscribed
- [ ] Connection status badge updates live
- [ ] Timeline renders 20+ stops without lag
- [ ] Animations don't stutter on low-end devices

---

## Future Enhancements

1. **Haptic Feedback:** Vibration on snap points
2. **Route History:** Swipe left/right to switch buses
3. **Favorites:** Save tracked buses
4. **Custom Alerts:** Set stop-specific notifications
5. **Analytics:** Track engagement with each sheet state
6. **Dark Mode:** Automatic dark UI for night mode

---

## Maintenance Notes

### Key Files
- `components/BottomSheet.tsx` - Core dragging logic
- `components/BottomSheetContent.tsx` - State-based layouts
- `app/(user)/tracking.tsx` - Screen orchestration
- `hooks/useRouteTracking.ts` - Real-time data

### Common Customizations
- Snap heights: Adjust `collapsedHeight`, `halfHeight`, `fullHeight`
- Colors: Update Tailwind class strings
- Animation spring: Modify `tension` and `friction` values
- Threshold sensitivity: Adjust threshold calculations in `onPanResponderRelease`

---

## Browser Compatibility

- **iOS:** 13+
- **Android:** 7+
- **Native Maps:** react-native-maps 5.0+
- **Web Maps:** Google Maps JS API 3


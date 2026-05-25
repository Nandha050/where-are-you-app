# Premium Transit Tracking UI - Design System

## 🎨 Design Philosophy

This premium UI system combines:
- **Glassmorphism**: Frosted glass effects with backdrop blur
- **Neumorphism**: Soft shadows and subtle elevation
- **Apple Design Language**: Clean typography, generous spacing, and hierarchical layout
- **Modern Transit Aesthetics**: Inspired by Apple Maps, Uber, and Citymapper

## 📦 Components

### 1. PremiumBottomSheet
**Purpose**: Expandable bottom sheet displaying live transit journey progress

**Features**:
- Smooth drag-to-expand interaction
- Timeline visualization with stop statuses
- Glassmorphic design with soft shadows
- Route header with origin → destination
- Real-time stop tracking with visual indicators

**Usage**:
```typescript
import { PremiumBottomSheet } from "@/components";

const stops: TimelineStop[] = [
  {
    id: "stop-1",
    name: "Grand Central Terminal",
    status: "passed",
    time: "12:45 PM",
  },
  {
    id: "stop-2",
    name: "Tech Park",
    status: "current",
    eta: "1:04 PM",
    helperText: "Arriving Now",
  },
  {
    id: "stop-3",
    name: "Tech District East",
    status: "upcoming",
    eta: "1:10 PM",
    helperText: "In 6 mins",
  },
];

<PremiumBottomSheet
  routeOrigin="Sangareddy"
  routeDestination="Bvrit"
  stops={stops}
/>
```

### 2. FloatingNavDock
**Purpose**: Floating navigation bar with iOS-style dock appearance

**Features**:
- Glassmorphic pill-shaped container
- 4 navigation items: Home, Alerts, Settings, Label
- Active state highlighting
- Badge support for notifications
- Soft shadows and blur effects

**Usage**:
```typescript
import { FloatingNavDock } from "@/components";

<FloatingNavDock
  active="home"
  onPress={(item) => navigateTo(item)}
  badgeCount={3}
/>
```

### 3. FloatingMapElements
**Purpose**: Contextual floating cards for map interaction

#### FloatingSearchBar
- Minimalist search input
- Icon support
- Glassmorphic styling

#### FloatingTransitCard
- Live bus indicator with glow effect
- Next stop information
- ETA display in pill format
- Tap to expand functionality

**Usage**:
```typescript
import { FloatingSearchBar, FloatingTransitCard } from "@/components";

<FloatingSearchBar placeholder="Search locations" />

<FloatingTransitCard
  nextStop="Tech Park"
  subtitle="Sangareddy • Upcoming"
  eta="2 min"
  onPress={onCardPress}
/>
```

### 4. PremiumTrackingScreen
**Purpose**: Full-featured transit tracking screen integrating all premium components

**Features**:
- Live map background with custom street styling
- Expandable bottom sheet with gesture handling
- Floating search bar and info cards
- Premium navigation dock
- Smooth animations and state management
- Real-time tracking visualization

**Usage**:
```typescript
import { PremiumTrackingScreen } from "@/components";

<PremiumTrackingScreen
  routeOrigin="Sangareddy"
  routeDestination="Bvrit"
  stops={stops}
  currentLocation={{ latitude: 17.35, longitude: 78.47 }}
  coordinates={routeCoordinates}
  encodedPolyline={polyline}
  onNavPress={(item) => handleNavigation(item)}
/>
```

## 🎯 Design Specifications

### Color Palette
- **Primary Background**: `#F7F7F8` (soft off-white)
- **Secondary Background**: `#F1F5F9` (light slate)
- **Primary Accent**: `#3B82F6` (modern blue)
- **Success**: `#10B981` (emerald green)
- **Text Primary**: `#0F172A` (dark slate)
- **Text Secondary**: `#64748B` (muted slate)

### Typography
- **Font Family**: SF Pro / Inter (via Poppins fallback)
- **Headers**: Bold, 28px–32px
- **Labels**: Semibold, 16px–18px
- **Body**: Regular, 13px–15px
- **Small**: Regular, 11px–12px

### Spacing System
- **Base Unit**: 4px
- **Minimal**: 4px (gap-1)
- **Small**: 8px (gap-2)
- **Medium**: 12px (gap-3)
- **Large**: 16px (gap-4)

### Shadows & Elevation
- **Subtle**: `shadow-sm` (elevation: 2)
- **Default**: `shadow-md` (elevation: 4)
- **Elevated**: `shadow-lg` (elevation: 8)
- **High**: `shadow-xl` (elevation: 12+)

### Border Radius
- **Cards**: 28px–32px
- **Buttons**: 16px–20px
- **Pills**: 24px–28px
- **Sheet Top**: 32px–36px

## 🔄 Interaction Patterns

### Bottom Sheet States
1. **Collapsed**: Shows minimal info, bottom of screen
2. **Half**: Shows summary, mid-screen position
3. **Expanded**: Full view of timeline, near top

### Gesture Handling
- Swipe up: Expand sheet
- Swipe down: Collapse sheet
- Tap search: Open search interface
- Tap nav: Navigate to section
- Tap transit card: Expand sheet

## ✨ Animation Principles

- **Spring Animations**: Natural, iOS-style feel
- **Duration**: 250–400ms for transitions
- **Easing**: Bezier curves for smooth interpolation
- **Feedback**: Subtle pulse effects on active elements

## 🌐 Platform Considerations

### iOS
- Native safe area handling
- Smooth spring animations
- Translucent blur effects
- Platform-specific gesture support

### Android
- Material Design elevation
- Proper shadow rendering
- Haptic feedback integration
- Status bar theming

## 🚀 Integration Guide

### Step 1: Replace Tracking Screen
```typescript
// In app/(user)/tracking.tsx
import { PremiumTrackingScreen } from "@/components";

// Replace existing tracking screen with:
<PremiumTrackingScreen
  routeOrigin={tracking.routeStartName}
  routeDestination={tracking.routeEndName}
  stops={timelineStops}
  currentLocation={busLocation}
  coordinates={routeCoordinates}
  encodedPolyline={track ing.encodedPolyline}
/>
```

### Step 2: Update Theme (if needed)
Ensure your Tailwind config includes:
- Proper shadow definitions
- Blur/backdrop support
- Custom animations
- Rounded corner utilities

### Step 3: Test on Device
- Test on iOS and Android
- Verify gesture interactions
- Check animation smoothness
- Validate map rendering

## 🎓 Best Practices

1. **Performance**: Memoize expensive computations
2. **Accessibility**: Include semantic labels and touch targets
3. **Testing**: Test gesture interactions on real devices
4. **Polish**: Fine-tune shadow and blur values
5. **Animation**: Keep spring animations natural (tension 50, friction 10)

## 📊 Component Hierarchy

```
PremiumTrackingScreen
├── Background Map (RouteMap)
├── Top Info Overlay
├── Animated Bottom Sheet
│   ├── DragHandle
│   ├── RouteHeader
│   └── TimelineList
│       └── StopCard (multiple)
│           └── TimelineIndicator
├── FloatingSearchBar
├── FloatingTransitCard
└── FloatingNavDock
    └── NavItem (4×)
```

## 🔧 Customization

### Adjust Sheet Heights
```typescript
const snapPositions = {
  collapsed: windowHeight - 140,
  half: Math.round(windowHeight * 0.45),
  expanded: Math.round(windowHeight * 0.18),
};
```

### Modify Colors
Update the color values in component files or create a theme context.

### Add Animations
Enhance with additional Animated values for new interactions.

## 📝 Notes

- All components use React Native standards
- Compatible with Expo projects
- Tailwind CSS (NativeWind) for styling
- TypeScript for type safety
- Fully customizable and extensible

---

**Version**: 1.0.0  
**Last Updated**: May 2026  
**Status**: Production-Ready ✅

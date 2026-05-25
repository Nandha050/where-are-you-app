# Premium UI - Design Specifications & Measurements

## 🎨 Component Dimensions & Metrics

### PremiumBottomSheet

#### Overall Structure
```
┌─────────────────────────────────────────┐
│         Drag Handle (Indicator)         │  Height: 4px
│                                         │  Width: 32px
├─────────────────────────────────────────┤
│     Route Header (Origin → Dest)        │  Height: 56px
│                                         │  Padding: 16px
├─────────────────────────────────────────┤
│                                         │
│      Timeline List (Scrollable)         │  Height: Remaining
│      ├─ Stop Item (Passed)              │  Height: 72px
│      ├─ Stop Item (Current)             │  Height: 72px
│      └─ Stop Item (Upcoming)            │  Height: 72px
│                                         │
└─────────────────────────────────────────┘

Sheet Heights (Snap Positions):
- Collapsed:  windowHeight - 140px  (minimal info)
- Half:       windowHeight × 0.45   (mid-screen)
- Expanded:   windowHeight × 0.18   (near top)
```

#### Drag Handle
```
Position: Top center
Width: 32px
Height: 4px
Background: rgba(0, 0, 0, 0.3)
Border Radius: 2px
Top Margin: 12px
```

#### Route Header
```
┌─────────────────────────────────────────┐
│ 🔴 Sangareddy    →    Bvrit 🔴         │
│    Origin Route End                    │
└─────────────────────────────────────────┘

Height: 56px
Padding: 16px horizontal, 12px vertical
Background: #F7F7F8 (off-white)
Border Bottom: 1px solid #E2E8F0
Font: Poppins Bold 18px
Text Color: #0F172A (dark slate)
Accent Circles: 8px diameter
```

#### Timeline Stop Item
```
┌─────────────────────────────────────────┐
│ ✓  ├─ Grand Central Terminal             │ (Passed)
│ ⊙  │  Tech Park (CURRENT)        1:04 PM │ (Current)
│ ○  └─ Tech District East         In 6min │ (Upcoming)
│                                         │
└─────────────────────────────────────────┘

Height: 72px
Padding: 16px horizontal, 12px vertical
Border Radius: 16px
Background: #F1F5F9 (light slate)
Separator: 1px solid #E2E8F0

Indicator Column (Left):
- Width: 24px
- Passed (✓):     Green circle, 12px
- Current (⊙):    Blue glow circle, 14px
- Upcoming (○):   Gray circle, 10px

Content Column (Center):
- Stop Name: Poppins SemiBold 16px #0F172A
- Helper Text: Poppins Regular 12px #64748B
- Flex: 1 (grows)

Time Column (Right):
- ETA: Poppins SemiBold 14px #3B82F6
- Background: Pill shape, #DFF7FF (light blue)
- Padding: 6px 12px
- Border Radius: 20px
- Min Width: 60px
```

### FloatingNavDock

#### Dock Container
```
Position: Bottom (above safe area)
Width: 200px (fits 4 items)
Height: 56px
Background: rgba(255, 255, 255, 0.8) (frosted)
Backdrop Filter: blur(16px)
Border Radius: 28px
Shadow: 0 8px 24px rgba(0, 0, 0, 0.12)
Bottom Margin: Safe area + 16px
Horizontal Center

Items: 4 equal width sections
├─ Home:        34px × 34px icon
├─ Alerts:      34px × 34px icon
├─ Profile:     34px × 34px icon
└─ Saved:       34px × 34px icon

Active State:
- Background: rgba(59, 130, 246, 0.15) (light blue)
- Border Radius: 16px
- Icon Color: #3B82F6 (blue)
- Inactive Icon Color: #94A3B8 (muted)
```

#### Tab States
```
Normal:  Icon only, 24px size, gray color
Active:  Capsule highlight, blue icon, soft shadow
```

### FloatingMapElements

#### Floating Search Bar
```
Position: Top-left (map overlay)
Width: windowWidth - 32px (16px margins)
Height: 44px
Margin: 16px + safeArea top
Background: rgba(255, 255, 255, 0.9)
Border Radius: 24px
Padding: 12px 16px
Shadow: 0 4px 12px rgba(0, 0, 0, 0.1)

Icon: Magnifying glass, 18px, gray
Text: "Search locations"
Font: Poppins Regular 14px
```

#### Floating Transit Card
```
Position: Center-bottom (above dock)
Width: windowWidth - 32px
Height: 64px
Margin: 16px horizontal, 16px bottom (above dock)
Background: rgba(255, 255, 255, 0.95)
Border Radius: 20px
Padding: 12px 16px
Shadow: 0 8px 20px rgba(0, 0, 0, 0.15)

Layout:
┌─────────────────────────────────────────┐
│ ● Next Stop: Tech Park                  │
│   Sangareddy • Upcoming    ETA: 2 min    │
└─────────────────────────────────────────┘

Left Indicator:
- Circle: 12px, #3B82F6
- Glow: 20px outer ring, #3B82F6 at 30% opacity

Content:
- Label: "Next Stop" (11px Poppins Regular, muted)
- Name: "Tech Park" (16px Poppins SemiBold, dark)
- Subtitle: "Sangareddy • Upcoming" (12px Regular, muted)

ETA Pill (Right):
- Text: "2 min"
- Background: #DFF7FF
- Color: #3B82F6
- Padding: 6px 12px
- Border Radius: 18px
- Font: Poppins SemiBold 12px
```

### PremiumTrackingScreen

#### Full Layout
```
┌─────────────────────────────────────────┐
│                                         │
│    RouteMap (Background - Full Screen)  │
│                                         │
│    ┌─────────────────────────────────┐  │
│    │  FloatingSearchBar (Overlay)    │  │
│    └─────────────────────────────────┘  │
│                                         │
│    ┌─────────────────────────────────┐  │
│    │  FloatingTransitCard (Overlay)  │  │
│    └─────────────────────────────────┘  │
│                                         │
│    ┌─────────────────────────────────┐  │
│    │  PremiumBottomSheet (Animated)  │  │
│    │  - Swipeable                    │  │
│    │  - Timeline inside              │  │
│    └─────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │   FloatingNavDock (Bottom)        │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘

Z-Index Stack:
Level 0: RouteMap (background)
Level 10: FloatingSearchBar
Level 20: FloatingTransitCard
Level 30: PremiumBottomSheet
Level 40: FloatingNavDock
```

## 🎨 Color Specifications

### Palette
```
Off-white (Primary Background):
  Hex: #F7F7F8
  RGB: rgb(247, 247, 248)
  HSL: hsl(200, 3%, 97%)
  Use: Sheet bg, main surfaces

Light Slate (Secondary):
  Hex: #F1F5F9
  RGB: rgb(241, 245, 249)
  HSL: hsl(210, 40%, 96%)
  Use: Card backgrounds, dividers

Modern Blue (Primary Accent):
  Hex: #3B82F6
  RGB: rgb(59, 130, 246)
  HSL: hsl(217, 91%, 60%)
  Use: Active states, CTAs, highlights

Emerald Green (Success):
  Hex: #10B981
  RGB: rgb(16, 185, 129)
  HSL: hsl(160, 84%, 39%)
  Use: Passed stops, success states

Dark Slate (Primary Text):
  Hex: #0F172A
  RGB: rgb(15, 23, 42)
  HSL: hsl(217, 48%, 11%)
  Use: Headers, body text

Muted Slate (Secondary Text):
  Hex: #64748B
  RGB: rgb(100, 116, 139)
  HSL: hsl(215, 13%, 47%)
  Use: Labels, helper text

Light Gray (Borders):
  Hex: #E2E8F0
  RGB: rgb(226, 232, 240)
  HSL: hsl(210, 16%, 91%)
  Use: Dividers, borders

Light Blue (Pill Backgrounds):
  Hex: #DFF7FF
  RGB: rgb(223, 247, 255)
  HSL: hsl(195, 100%, 94%)
  Use: ETA pills, info badges
```

### Color Usage Examples
```
Stop Status Colors:
- Passed:    Green (#10B981) with checkmark
- Current:   Blue (#3B82F6) with glow
- Upcoming:  Gray (#94A3B8) with dot

Text Hierarchy:
- Headings:     #0F172A (dark slate) - Bold/SemiBold
- Body:         #0F172A (dark slate) - Regular
- Labels:       #64748B (muted) - Regular
- Placeholders: #CBD5E1 (lighter muted) - Regular

Backgrounds:
- Primary:   #F7F7F8 (off-white)
- Secondary: #F1F5F9 (light slate)
- Overlay:   rgba(0, 0, 0, 0.3) (dark transparent)

Accents:
- Active/Hover:  #3B82F6 (blue)
- Success:       #10B981 (green)
- Warning:       #F59E0B (amber - if needed)
- Error:         #EF4444 (red - if needed)
```

## 🔤 Typography Specifications

### Font Family
```
Primary: SF Pro Display / SF Pro Text (iOS/macOS style)
Fallback: Poppins
Tertiary: System Font

Applied via:
- Font loading: expo-font plugin
- CSS: Tailwind fontFamily utilities
- RN: Platform.select() for font names
```

### Font Sizes & Weights
```
Heading 1 (H1):
- Size: 32px
- Weight: Bold (700)
- Line Height: 40px
- Letter Spacing: -0.5px
- Use: Screen titles

Heading 2 (H2):
- Size: 28px
- Weight: Bold (700)
- Line Height: 36px
- Letter Spacing: -0.3px
- Use: Route info, main sections

Heading 3 (H3):
- Size: 24px
- Weight: SemiBold (600)
- Line Height: 32px
- Use: Stop names, cards

Subheading (SH):
- Size: 18px
- Weight: SemiBold (600)
- Line Height: 26px
- Use: Labels, nav items

Body (B):
- Size: 16px
- Weight: Regular (400)
- Line Height: 24px
- Letter Spacing: 0.2px
- Use: Main content

Body Small (BS):
- Size: 14px
- Weight: Regular (400)
- Line Height: 20px
- Use: Secondary content

Caption (C):
- Size: 12px
- Weight: Regular (400)
- Line Height: 18px
- Use: Helper text, timestamps

Micro (M):
- Size: 11px
- Weight: Medium (500)
- Line Height: 16px
- Use: Badges, tags
```

### Text Hierarchy Example
```
┌─────────────────────────────────────────┐
│ Sangareddy → Bvrit               (H2)   │
│ Bus Route 234 • 45 mins          (BS)   │
├─────────────────────────────────────────┤
│                                         │
│ Next Stop: Tech Park             (H3)   │
│ Arriving in 6 minutes            (SH)   │
│                                         │
│ ✓ Grand Central Terminal          (H3)  │
│   Departed 12:45 PM              (C)    │
│                                         │
└─────────────────────────────────────────┘
```

## 📐 Spacing System (8px Base)

```
Reference Grid: 8px base unit

Padding / Margin Scale:
2px    (0.25×)   - gap-0
4px    (0.5×)    - gap-px (minimal)
8px    (1×)      - gap-2 (small)
12px   (1.5×)    - gap-3 (medium)
16px   (2×)      - gap-4 (standard)
20px   (2.5×)    - gap-5 (large)
24px   (3×)      - gap-6 (extra large)
32px   (4×)      - gap-8 (massive)

Common Combinations:
Interior Padding:   16px (all sides)
Card Padding:       16px horizontal, 12px vertical
Button Padding:     12px horizontal, 8px vertical
Component Spacing:  16px (between items)
Section Spacing:    24px (between sections)
Screen Padding:     16px safe area
```

## 🎭 Shadow & Elevation

### Shadow Values
```
Subtle Shadow (shadow-sm):
  iOS: shadow offset (0, 1), radius 2, opacity 0.08
  Android: elevation 2
  Web: 0 1px 2px rgba(0, 0, 0, 0.08)

Default Shadow (shadow-md):
  iOS: shadow offset (0, 2), radius 4, opacity 0.12
  Android: elevation 4
  Web: 0 4px 6px rgba(0, 0, 0, 0.12)

Elevated Shadow (shadow-lg):
  iOS: shadow offset (0, 4), radius 8, opacity 0.15
  Android: elevation 8
  Web: 0 10px 15px rgba(0, 0, 0, 0.15)

High Shadow (shadow-xl):
  iOS: shadow offset (0, 8), radius 12, opacity 0.2
  Android: elevation 12
  Web: 0 20px 25px rgba(0, 0, 0, 0.2)
```

### Elevation/Depth Guide
```
Level 0 (Background):     No shadow
Level 1 (Cards):          shadow-sm or shadow-md
Level 2 (Floating):       shadow-md or shadow-lg
Level 3 (Modal/Sheet):    shadow-lg or shadow-xl
Level 4 (Popup/Tooltip):  shadow-xl
```

## ✨ Blur & Transparency

### Backdrop Blur
```
Subtle Blur:
  Filter: blur(4px)
  Use: Navigation dock, light overlays

Standard Blur:
  Filter: blur(8px)
  Use: Sheet backgrounds, modals

Strong Blur:
  Filter: blur(16px)
  Use: Heavy glassmorphism effects

Implementation:
- Web: backdrop-filter: blur(X)
- iOS: Material/BlurView
- Android: Limitation - use opacity instead
```

### Background Opacity
```
Very Light:    rgba(..., 0.7)  (30% opaque)
Light:         rgba(..., 0.8)  (20% opaque)
Medium:        rgba(..., 0.85) (15% opaque)
Dark:          rgba(..., 0.9)  (10% opaque)
Very Dark:     rgba(..., 0.95) (5% opaque)

Overlay Guidelines:
- Sheet background: rgba(255, 255, 255, 0.95)
- Floating cards:   rgba(255, 255, 255, 0.9)
- Nav dock:        rgba(255, 255, 255, 0.8)
- Dim overlay:     rgba(0, 0, 0, 0.3)
```

## 🔄 Animation Specifications

### Duration
```
Quick Actions:    150ms  (taps, state changes)
Standard:         250ms  (transitions, reveals)
Smooth:           350ms  (gestures, expansions)
Slow:             500ms  (complex animations)
```

### Easing Functions
```
Spring (iOS style):
  Tension: 50
  Friction: 10
  Mass: 1
  Damping: 0.7
  Creates natural, bouncy feel

Cubic Bezier:
  Linear:        cubic-bezier(0, 0, 1, 1)
  Ease-in:       cubic-bezier(0.4, 0, 1, 1)
  Ease-out:      cubic-bezier(0, 0, 0.2, 1)
  Ease-in-out:   cubic-bezier(0.4, 0, 0.2, 1)
```

### Animation Examples
```
Sheet Expansion:
  Duration: 300ms
  Easing: Spring dynamics
  From: windowHeight - 140px
  To: windowHeight * 0.18

Stop Indicator Glow:
  Duration: 1500ms (loop)
  Easing: ease-in-out
  Opacity: 0.5 → 1 → 0.5

Nav Item Active:
  Duration: 200ms
  Easing: ease-out
  Scale: 1 → 1.1 (brief pulse)
```

## 🎯 Touch Target Sizes

```
Minimum Touch Target (iOS HIG):
  Width: 44px
  Height: 44px

Minimum Touch Target (Android):
  Width: 48dp
  Height: 48dp

Comfortable Touch Target:
  Width: 56-64px
  Height: 56-64px

Icon Size Inside Target:
  Small: 16-20px
  Medium: 20-24px
  Large: 24-32px

Spacing Between Targets:
  Minimum: 8px
  Comfortable: 12-16px
```

## 📱 Safe Area & Layout Guides

### iPhone
```
Notch Height (top safe area):
  iPhone X/11/12 Pro: 47px
  iPhone 12/13: 47px
  iPhone 14 Pro: 59px
  iPhone SE: 0px

Home Indicator (bottom safe area):
  All models: 34px
  X/11/12/13: 34px
  SE (2nd gen): 0px
```

### Android
```
Status Bar (top safe area):
  Standard: 24-25dp
  With notch: 24-32dp

Navigation Bar (bottom safe area):
  Standard: 48dp
  Gesture nav: 0dp (overlay)
  Visible nav: 48dp
```

### Implementation
```typescript
// Use SafeAreaView or get safe area insets:
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const insets = useSafeAreaInsets();
// insets.top, insets.bottom, insets.left, insets.right
```

---

**Document Version**: 1.0.0  
**Status**: Complete Specifications ✅  
**Last Updated**: May 2026

This document should be used as reference during implementation and QA to ensure pixel-perfect design accuracy.

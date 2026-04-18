# Weather Widget Animated Background Spec (UI Only)

## Scope
This document defines the frontend-only weather animation system for the weather hero widget.

- No backend changes
- No API schema changes
- No new weather service logic
- Implementation target: React UI + global CSS

## Source Conditions From Current System
Current condition labels (as used in the weather page):

1. Clear
2. Mostly Clear
3. Partly Cloudy
4. Mostly Cloudy
5. Cloudy
6. Fog
7. Light Fog
8. Drizzle
9. Rain
10. Light Rain
11. Heavy Rain
12. Snow
13. Light Snow
14. Heavy Snow
15. Thunderstorm
16. Unknown

## Weather Token Mapping Table
Map raw condition strings into stable visual tokens. These tokens drive the widget background theme and animation.

| Raw Condition | Weather Token | Visual Family | Intensity |
| --- | --- | --- | --- |
| Clear | clear | Sunny | low |
| Mostly Clear | clear | Sunny | low |
| Partly Cloudy | partly-cloudy | Cloud + sun mix | medium |
| Mostly Cloudy | cloudy | Cloud | medium |
| Cloudy | cloudy | Cloud | medium |
| Fog | fog | Fog | medium |
| Light Fog | fog | Fog | low |
| Drizzle | drizzle | Rain | low |
| Light Rain | rain | Rain | medium |
| Rain | rain | Rain | medium |
| Heavy Rain | heavy-rain | Rain | high |
| Thunderstorm | thunderstorm | Storm | very-high |
| Light Snow | snow | Snow | low |
| Snow | snow | Snow | medium |
| Heavy Snow | snow-heavy | Snow | high |
| Unknown | unknown | Neutral fallback | low |

## Token Priority and Fallback Rules
Use the following order for conflict resolution if future payloads include mixed labels:

1. thunderstorm
2. heavy-rain
3. rain
4. drizzle
5. snow-heavy
6. snow
7. fog
8. cloudy
9. partly-cloudy
10. clear
11. unknown

Fallback behavior:

- If condition is missing or empty, use unknown.
- If condition is unrecognized, use unknown.
- Unknown keeps text readable and uses subtle motion only.

## Visual Layer Architecture
The weather hero background is built as composited layers.

Layer order (back to front):

1. Layer A: Sky Gradient Base
2. Layer B: Atmosphere Tint Overlay
3. Layer C: Cloud Bands (if applicable)
4. Layer D: Precipitation (rain or snow)
5. Layer E: Special FX (sun glow, lightning, fog drift)
6. Layer F: Readability Scrim (very subtle, always on)
7. Layer G: Foreground Content (temperature, labels, stats)

Recommended implementation primitives:

- Hero root element for token class attachment
- ::before and ::after for two cheap always-available FX layers
- 2 to 4 child spans/divs for cloud and precipitation layers
- Transform and opacity animation only
- Avoid animating layout-affecting properties

## Animation Spec by Token

### clear
- Intent: Warm bright sky with gentle sun pulse
- Layers active: A, B, E, F
- Animations:
  - sun-pulse: 8s ease-in-out infinite
  - sky-shift: 18s linear infinite
- Opacity:
  - sun glow: 0.22 to 0.36
  - atmosphere tint: 0.12 to 0.18

### partly-cloudy
- Intent: Mixed cloud movement and visible sun
- Layers active: A, B, C, E, F
- Animations:
  - cloud-drift-slow: 20s linear infinite
  - cloud-drift-medium: 14s linear infinite
  - sun-pulse-soft: 10s ease-in-out infinite
- Opacity:
  - cloud band 1: 0.18 to 0.28
  - cloud band 2: 0.12 to 0.2
  - sun glow: 0.14 to 0.24

### cloudy
- Intent: Overcast moving cloud texture
- Layers active: A, B, C, F
- Animations:
  - cloud-drift-slow: 18s linear infinite
  - cloud-drift-medium: 12s linear infinite
  - cloud-breath: 6s ease-in-out infinite
- Opacity:
  - cloud band primary: 0.24 to 0.34
  - cloud band secondary: 0.16 to 0.24

### fog
- Intent: Soft drifting haze with low contrast
- Layers active: A, B, E, F
- Animations:
  - fog-drift: 16s linear infinite
  - fog-breath: 7s ease-in-out infinite
- Opacity:
  - fog layer 1: 0.22 to 0.34
  - fog layer 2: 0.12 to 0.2

### drizzle
- Intent: Light rain streaks and wet atmosphere
- Layers active: A, B, C, D, F
- Animations:
  - rain-fall-light: 1.25s linear infinite
  - cloud-drift-slow: 22s linear infinite
- Opacity:
  - precipitation: 0.14 to 0.24
  - cloud layer: 0.2 to 0.3

### rain
- Intent: Moderate rain, clearly visible streaks
- Layers active: A, B, C, D, F
- Animations:
  - rain-fall-medium: 0.95s linear infinite
  - rain-sway: 2.8s ease-in-out infinite
  - cloud-drift-medium: 14s linear infinite
- Opacity:
  - precipitation: 0.22 to 0.36
  - cloud layer: 0.24 to 0.34

### heavy-rain
- Intent: Dense fast rain, darker atmosphere
- Layers active: A, B, C, D, F
- Animations:
  - rain-fall-heavy: 0.72s linear infinite
  - rain-sway-strong: 2.1s ease-in-out infinite
  - cloud-drift-fast: 9s linear infinite
- Opacity:
  - precipitation: 0.3 to 0.5
  - cloud layer: 0.3 to 0.42

### thunderstorm
- Intent: Heavy rain + lightning pulse
- Layers active: A, B, C, D, E, F
- Animations:
  - rain-fall-heavy: 0.68s linear infinite
  - cloud-drift-fast: 8s linear infinite
  - lightning-flash: 7s steps(1, end) infinite
  - lightning-glow-decay: 900ms ease-out on flash
- Lightning behavior:
  - Randomized via staggered animation delays per pseudo-layer
  - Keep flash alpha low to avoid discomfort
- Opacity:
  - precipitation: 0.32 to 0.54
  - lightning flash: peak 0.18 (light), 0.22 (dark)

### snow
- Intent: Calm floating flakes
- Layers active: A, B, D, F
- Animations:
  - snow-fall: 6.5s linear infinite
  - snow-drift: 5s ease-in-out infinite
- Opacity:
  - flake field: 0.18 to 0.32

### snow-heavy
- Intent: Denser snowfall with stronger drift
- Layers active: A, B, D, F
- Animations:
  - snow-fall-heavy: 4.2s linear infinite
  - snow-drift-strong: 3.4s ease-in-out infinite
- Opacity:
  - flake field: 0.26 to 0.44

### unknown
- Intent: Neutral, non-distracting fallback
- Layers active: A, B, F
- Animations:
  - background-breathe: 12s ease-in-out infinite
- Opacity:
  - atmosphere tint: 0.1 to 0.16

## Light and Dark Mode Palette Spec
Define token color variables for both themes. Values below are recommended baselines.

### clear
- Light:
  - sky-start: #dff4ff
  - sky-end: #fff9db
  - tint: #fff3b0
  - accent: #f59e0b
- Dark:
  - sky-start: #0b2438
  - sky-end: #19304a
  - tint: #7c5a1f
  - accent: #fbbf24

### partly-cloudy
- Light: #dceffd -> #f5f9ff, cloud #ffffff, sun #ffd76a
- Dark: #10263b -> #1d3248, cloud #9fb7cd, sun #f6c86f

### cloudy
- Light: #dde6ee -> #edf2f7, cloud #cfd8e3
- Dark: #1a2530 -> #273341, cloud #6f8399

### fog
- Light: #edf1f5 -> #f7f9fb, haze #dfe7ef
- Dark: #202a33 -> #2b3744, haze #7f92a7

### drizzle
- Light: #d8e8f5 -> #edf4fa, rain #6f9fc8
- Dark: #142536 -> #223649, rain #7aa2c8

### rain
- Light: #cfe2f1 -> #e4edf6, rain #4f83af
- Dark: #102234 -> #1f3245, rain #6f97bc

### heavy-rain
- Light: #b7cedf -> #d2e0ec, rain #3f6d93
- Dark: #0c1b2a -> #18293a, rain #79a5cb

### thunderstorm
- Light: #a9bfd2 -> #cad9e7, flash #eef6ff
- Dark: #081522 -> #122335, flash #d7e8ff

### snow and snow-heavy
- Light: #e8f1fa -> #f6fbff, flake #ffffff
- Dark: #1a2735 -> #28384b, flake #d8e6f5

### unknown
- Light: #e9eef3 -> #f4f7fa
- Dark: #1c2732 -> #2a3644

## Timing, Density, and Performance Budget

### Frame budget targets
- Mid-range mobile: 55 to 60 fps
- Low-end fallback: keep above 40 fps

### Limits
- Max cloud layers: 2
- Max precipitation layers: 2
- Max particles per precipitation layer:
  - drizzle: 18
  - rain: 28
  - heavy-rain and thunderstorm: 36
  - snow: 22
  - snow-heavy: 30

### Animation constraints
- Animate only:
  - transform
  - opacity
  - background-position
- Do not animate:
  - width
  - height
  - top, left, right, bottom
  - box-shadow blur radius at high frequency

### Motion reduction
When user prefers reduced motion:

- Disable precipitation and lightning keyframes
- Keep static themed gradient only
- Optional very slow 30s background shift maximum

## Content Readability Rules
Always preserve foreground readability over animated backgrounds.

- Text contrast target: minimum WCAG AA against the scrimmed background
- Permanent readability scrim layer opacity:
  - light mode: 0.12 to 0.16
  - dark mode: 0.18 to 0.24
- Keep metric chips and badges on semi-opaque surfaces

## Suggested CSS Class Contract
Use token class on hero root:

- pg-weather-hero is-clear
- pg-weather-hero is-partly-cloudy
- pg-weather-hero is-cloudy
- pg-weather-hero is-fog
- pg-weather-hero is-drizzle
- pg-weather-hero is-rain
- pg-weather-hero is-heavy-rain
- pg-weather-hero is-thunderstorm
- pg-weather-hero is-snow
- pg-weather-hero is-snow-heavy
- pg-weather-hero is-unknown

Suggested internal layers:

- pg-weather-fx pg-weather-fx-sky
- pg-weather-fx pg-weather-fx-clouds
- pg-weather-fx pg-weather-fx-precip
- pg-weather-fx pg-weather-fx-special
- pg-weather-fx pg-weather-fx-scrim

## QA Checklist

1. Every raw condition resolves to one token.
2. Token-specific animation appears on the hero card.
3. Light mode and dark mode both keep content readable.
4. Reduced-motion mode disables major animation.
5. No backend or API code changed.
6. Widget stays performant on mobile viewport.

## Explicit Non-Goals

- No weather logic changes on backend
- No adding new weather endpoints
- No adding Three.js or canvas rendering for this phase
- No matrix-style effect for this feature

## Phase 2 Optional Enhancements (UI Only)

1. Time-of-day tint override (morning, noon, dusk, night)
2. Wind-reactive rain angle from existing wind direction
3. Soft parallax based on device motion (with opt-in)
4. Dynamic cloud density from humidity if available in payload

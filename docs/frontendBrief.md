# PadiGuard AI Frontend Breif

**React + Vite | Mobile-Style PWA | Website First, App-Like After Install**

---

## 1. Purpose

This frontend should feel like a **real mobile application**, not a traditional website.
The experience must support two entry modes:

1. **Website mode** — everytime users open the link in browser and see a launch animation similar to mobile application one (but compatible to both laptop and mobile version website looks),then see a landing page, install prompt, and sign-in flow only triggered then after user chose to sign in/sign up.
2. **Installed app mode** — after installation, users open the app directly into a **launch animation → auth page → main app**, with no landing page.

After sign-in, the UI should be **identical for both entry modes**.

---

## 2. Experience Strategy

### 2.1 Two Entry Experiences

#### A. Website Mode

Used when the user opens the public link in a browser.

Flow:

* Landing page
* Install prompt
* Optional “Continue in browser” "If installed,can choose also open application"
* Auth / OTP triggered after user chose to sign up/sign in
* Main app

#### B. Installed PWA Mode

Used when the user launches the app from home screen.

Flow:

* App launch animation
* Auth / OTP
* Main app

### 2.2 Key UX Rule

The app must **detect launch context** and render the correct entry experience without confusing the user.

Use:

* `beforeinstallprompt`
* `window.matchMedia('(display-mode: standalone)')`
* `navigator.standalone` on iOS
* route guards for onboarding/auth states

---

## 3. Recommended Frontend Stack

## 3.1 Core Stack

* **React + Vite**
* **React Router** for navigation
* **Tailwind CSS** for fast mobile UI building
* **CSS variables** for theme control
* **Framer Motion** for transitions and launch animation
* **Zustand or Context API** for lightweight app state
* **React Hook Form + Zod** for auth and forms

## 3.2 Why this stack

* **Vite** gives fast refresh and a smooth mobile development workflow
* **Tailwind** makes it easy to create consistent mobile layouts quickly
* **CSS variables** make dark mode / light mode easy to manage
* **Framer Motion** supports polished motion like splash, page transitions, and micro-interactions

---

## 4. Visual Design Direction

## 4.1 Core Style

The interface should feel:

* clean
* professional
* modern
* calm
* farmer-friendly
* visually informative

Avoid:

* dense text blocks
* heavy borders
* overly technical dashboards
* too many colors in one screen

## 4.2 Theme Concept

Use a **green-blue gradient theme** to represent:

* agriculture
* growth
* trust
* intelligence
* water / weather awareness

### Suggested Primary Gradient

* `emerald → teal`
* `green → cyan`
* `blue-green hybrid` for highlights

Example direction:

* **Light mode:** soft gradient backgrounds with white cards
* **Dark mode:** deep navy/forest base with teal-green accents

---

## 5. Color System

## 5.1 Theme Tokens

Use CSS variables instead of hardcoded colors.

```css
:root {
  --bg: 255 255 255;
  --surface: 248 250 252;
  --text: 15 23 42;
  --muted: 100 116 139;
  --primary: 16 185 129;
  --secondary: 20 184 166;
  --accent: 59 130 246;
  --danger: 239 68 68;
  --warning: 245 158 11;
  --success: 34 197 94;
}
```

```css
.dark {
  --bg: 2 6 23;
  --surface: 15 23 42;
  --text: 226 232 240;
  --muted: 148 163 184;
  --primary: 45 212 191;
  --secondary: 34 197 94;
  --accent: 96 165 250;
  --danger: 248 113 113;
  --warning: 251 191 36;
  --success: 74 222 128;
}
```

## 5.2 Usage Rules

* Use **primary green** for main actions
* Use **teal/blue** for intelligence, climate, and analytics
* Use **red/orange** only for warnings and risks
* Do not change alert colors based on aesthetic preference; they must remain consistent

---

## 6. Typography Rules

## 6.1 Font Choice

Use one clean sans-serif family only:

* **Inter**
* or **Roboto**
* or **system UI fallback**

## 6.2 Type Scale

* Page title: 24–28px
* Section title: 18–20px
* Body: 14–16px
* Helper text: 12–13px

## 6.3 Rules

* Keep headings short
* Use readable line height
* Avoid long paragraphs on mobile
* Use numbers, labels, and concise copy where possible

---

## 7. Layout System

## 7.1 Mobile-First

Design the mobile layout first, then expand to tablet and desktop.

## 7.2 Spacing

Use an 8px spacing scale:

* 8
* 16
* 24
* 32

## 7.3 Surface Rules

* Use rounded cards
* Use soft shadows
* Separate content into logical panels
* Keep primary action visible without excessive scrolling

## 7.4 Safe Area Handling

Because this is mobile-style:

* respect notches
* respect rounded corners
* respect bottom gesture areas

Use:

```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

---

## 8. Navigation Design

## 8.1 Bottom Tab Navigation

For the installed app and authenticated experience, use a **bottom tab bar** instead of a side menu.

Recommended tabs:

* Home
* Map
* Scanner
* History
* Profile

## 8.2 Navigation Rules

* Keep the primary actions within thumb reach
* Use icons + labels together
* Highlight the active tab clearly
* Avoid hidden navigation for main app areas

## 8.3 When to Use Top Navigation

Use top bars only for:

* page titles
* back buttons
* contextual actions
* filters

Do not rely on top nav as the only way to move through the app.

---

## 9. Page Structure and Routing Rules

## 9.1 Public Website Mode Pages

### 1. Landing / Install Page

**Purpose:** first impression and PWA install conversion

Must include:

* product value proposition
* install call-to-action
* continue in browser option
* simple feature preview
* trust signal / benefits

Design:

* hero section
* gradient background
* clean CTA button
* concise supporting copy
* screenshots or mock mobile preview

---

### 2. Auth / OTP Page

**Purpose:** secure entry without friction

Must include:

* login / sign-up options
* OTP verification
* phone or email input
* clear loading state
* resend OTP logic

Design:

* centered mobile card
* very few fields
* one primary CTA
* helper text that explains the step

---

### 3. First-Time Onboarding

**Purpose:** collect only essential setup data

Must include:

* farm name
* farm location
* crop type / padi variety
* preferred language
* optional notification permission

Design:

* stepper or progress bar
* one task per screen
* skip where possible
* save progress automatically

---

## 9.2 Installed PWA Mode Pages

### 1. App Launch Animation

**Purpose:** brand reveal and context shift into app mode

Must include:

* logo animation
* product name animation
* short duration
* smooth exit to auth page

Design inspiration:

* use a polished logo reveal similar in feel to premium app launch motion
* animate opacity, scale, and slight vertical movement
* keep it under 2 seconds for usability

Rules:

* should not feel like a loading screen
* should feel like a branded launch moment
* should be subtle, premium, and non-distracting

---

### 2. Auth / OTP Page

Same as website mode, but shown immediately after launch animation.

---

### 3. Main App

Same experience for installed and non-installed users after sign-in.

---

## 10. Page-by-Page Frontend Guideline

## 10.1 Landing / Install Page

### Goal

Convert browser users into app users.

### Design Requirements

* bold headline
* short value summary
* install button
* browser continue button
* app preview mockup
* minimal scrolling

### Suggested Sections

* Hero
* Benefits
* Core features
* Install CTA
* Trust / support note

### Style

* gradient hero background
* floating cards
* subtle motion
* clean typography

---

## 10.2 Auth / OTP Page

### Goal

Fast and low-friction account access.

### Design Requirements

* simple phone/email field
* OTP box UI
* resend timer
* clear error messages
* success states

### Style

* single-column mobile card
* centered layout
* strong primary button
* no clutter

---

## 10.3 Dashboard / Home

### Goal

Show the user what matters immediately.

### Must Display

* farm health summary
* weather risk
* critical alerts
* quick actions
* latest scan status

### Design Pattern

Use:

* top summary cards
* one large map/health card
* action tiles below
* bottom nav for movement

---

## 10.4 Farm Mapper

### Goal

Let users define farm area and grid sections clearly.

### UI Needs

* map container as the dominant element
* draw polygon tool
* grid overlay toggle
* area counter
* plant density helper
* save/export action

### Design Pattern

* map first
* controls in a floating panel
* mobile-friendly tool buttons
* bottom sheet for settings

---

## 10.5 AI Scanner

### Goal

Guide image capture and diagnosis clearly.

### UI Needs

* camera preview
* capture button
* upload alternative
* detection progress state
* scan result preview

### Design Pattern

* camera occupies most of screen
* capture button fixed at bottom
* scan instructions collapsed into helper text

---

## 10.6 Diagnosis Report

### Goal

Translate AI output into understandable action.

### UI Needs

* disease name
* severity meter
* spread risk
* confidence indicator
* affected area
* action button to treatment

### Design Pattern

Use:

* large severity badge
* color-coded risk card
* chart or progress bar
* short explanation in simple language

---

## 10.7 Treatment Plan

### Goal

Convert diagnosis into practical next steps.

### UI Needs

* recommended treatment
* dosage
* timing
* safety instructions
* ROI / cost impact
* chatbot toggle

### Design Pattern

* segmented layout:

  * What is wrong
  * What to do
  * How much it costs
  * When to apply
* chatbot can be opened as a slide-over panel or tab switch

---

## 10.8 History / Logs

### Goal

Track progress over time.

### UI Needs

* scan history
* treatment history
* before/after comparison
* growth timeline

### Design Pattern

* list or timeline view
* filter by date / farm section
* compact cards
* comparison viewer

---

## 11. Animation and Motion Guidelines

## 11.1 Motion Principles

Motion should:

* guide attention
* confirm actions
* improve perceived quality

Motion should not:

* slow users down
* distract from farm tasks
* create lag on low-end devices

## 11.2 Required Animations

* app launch logo reveal
* page transitions
* card expand/collapse
* alert pulse for urgent warnings
* loading shimmer or skeleton states
* button press feedback

## 11.3 Best Practice

Use motion only where it improves understanding.

---

## 12. CSS Styling Guidelines

## 12.1 Recommended Styling Approach

Use a hybrid system:

* **Tailwind CSS** for layout and spacing
* **CSS variables** for theme tokens
* **component-level classes** for repeated UI elements
* **Framer Motion** for animation

This gives:

* speed
* consistency
* easy dark mode support
* maintainable design system

## 12.2 Component Style Rules

Use reusable styles for:

* buttons
* cards
* badges
* inputs
* bottom tabs
* modal sheets
* alert banners

## 12.3 Button Design

* Primary button: solid gradient or strong green fill
* Secondary button: outline or subtle surface
* Destructive button: red
* Disabled button: muted and clearly inactive

## 12.4 Card Design

* rounded corners
* soft shadow
* clean spacing
* icon + title + summary
* one primary action only

---

## 13. Dark Mode / Light Mode Strategy

## 13.1 Mode Behavior

* Default to system preference if available
* Allow manual toggle
* Persist preference in local storage
* Support theme transitions smoothly

## 13.2 Color Logic by Mode

### Light Mode

* white or soft gray surfaces
* green-blue accent gradient
* darker text for readability

### Dark Mode

* deep navy / forest background
* teal/green highlight surfaces
* muted text for hierarchy
* avoid pure black if it feels harsh

## 13.3 Theme Consistency

Important UI meanings must remain stable in both modes:

* red = risk
* green = healthy / success
* orange = caution
* blue = info / weather / system

---

## 14. Responsive Behavior

## 14.1 Mobile

* single column
* bottom navigation
* full-screen modules
* bottom sheets for settings

## 14.2 Tablet

* two-column cards
* larger map and report areas
* more visible side summary panels

## 14.3 Desktop

* dashboard split layout
* persistent left nav only if necessary
* wider map and analytic panels
* still maintain mobile-style simplicity

---

## 15. Accessibility Standards

## 15.1 Minimum Requirements

* contrast ratio should remain readable
* touch targets should be large enough
* icons must have labels
* form fields must have clear helper text
* do not rely on color alone to communicate severity

## 15.2 Text Rules

* minimum body size 14px
* avoid low-contrast gray text
* use plain language

## 15.3 Interaction Rules

* support keyboard navigation
* visible focus states
* clear error messages
* avoid tiny controls

---

## 16. Offline and PWA Rules

## 16.1 Offline UX

When offline:

* show a visible offline indicator
* allow access to cached data
* save actions for sync later
* do not block the user with dead screens

## 16.2 Install Behavior

* show install prompt only when appropriate
* do not force install too early
* explain value before prompting
* once installed, skip landing on future launches

---

## 17. Recommended Route Structure

```txt
/                → Landing / Install Page (web only)
/auth            → Login / OTP
/onboarding      → First-time setup
/app             → Main dashboard
/app/map         → Farm mapper
/app/scan        → AI scanner
/app/report      → Diagnosis report
/app/treatment   → Treatment plan
/app/history     → Logs and comparison
```

---

## 18. State Logic Summary

| User State                       | Entry Screen      | Next Step       |
| -------------------------------- | ----------------- | --------------- |
| First-time browser visitor       | Landing / Install | Auth or install |
| Browser visitor skipping install | Auth / OTP        | Onboarding      |
| Installed app launch             | Launch animation  | Auth / OTP      |
| Logged-in first-time user        | Onboarding        | Dashboard       |
| Logged-in returning user         | Dashboard         | Main app        |
| Offline user                     | Cached app view   | Sync later      |

---

## 19. UI Quality Checklist

### Interface Design

* [ ] consistent typography
* [ ] green-blue gradient theme applied well
* [ ] clean spacing and layout
* [ ] cards, buttons, and banners follow one system

### UX Flow

* [ ] landing only appears in browser mode
* [ ] installed app opens with animation then auth
* [ ] clear progression from auth → onboarding → dashboard
* [ ] one main action per screen

### Accessibility & Responsiveness

* [ ] readable contrast in light and dark modes
* [ ] buttons are touch-friendly
* [ ] all pages work on mobile, tablet, desktop
* [ ] safe area padding is respected

### PWA Quality

* [ ] install flow works
* [ ] offline state is handled well
* [ ] cached screens still feel usable
* [ ] launch feels like a real app

---

## 20. Final Frontend Direction

The frontend should feel like a **premium mobile farming assistant**:

* fast
* simple
* intelligent
* visual
* trustworthy


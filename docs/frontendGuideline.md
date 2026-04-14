**developer-ready implementation guide** **React + Vite PWA**
---

# ⚙️ PadiGuard AI – Frontend Implementation Guide (React + Vite)

---

## 1. 📁 Frontend Project Structure 

```bash
frontend/src/
├── app/                     # App entry logic (routing, providers)
│   ├── App.tsx
│   ├── routes.tsx
│   └── providers.tsx
│
├── pages/                   # Page-level components
│   ├── public/
│   │   ├── Landing.tsx
│   │   └── Auth.tsx
│   │
│   ├── onboarding/
│   │   └── Onboarding.tsx
│   │
│   └── app/
│       ├── Dashboard.tsx
│       ├── Map.tsx
│       ├── Scanner.tsx
│       ├── Report.tsx
│       ├── Treatment.tsx
│       └── History.tsx
│
├── components/              # Reusable UI components
│   ├── ui/                  # Generic UI (buttons, cards)
│   ├── layout/              # Layout (Navbar, BottomTabs)
│   ├── map/                 # Map-related components
│   ├── scanner/             # Camera components
│   └── feedback/            # Alerts, loaders
│
├── hooks/                   # Custom hooks
│   ├── useAuth.ts
│   ├── usePWA.ts
│   ├── useTheme.ts
│   └── useOffline.ts
│
├── store/                   # Global state (Zustand)
│   ├── authStore.ts
│   ├── appStore.ts
│   └── farmStore.ts
│
├── styles/
│   ├── globals.css
│   └── theme.css
│
├── utils/
│   ├── constants.ts
│   ├── format.ts
│   └── helpers.ts
│
└── assets/
    └── logo/
```

---

## 2. 🧠 Core Architecture Logic

### 2.1 App Entry Logic

```tsx
// App.tsx (simplified logic)
if (isPWAInstalled()) {
  return <AppLaunchFlow />
} else {
  return <WebFlow />
}
```

---

### 2.2 State Flow

```txt
User enters →
  Detect mode (web / PWA) →
    Not installed → Landing
    Installed → Launch Animation

Then →
  Auth →
  Onboarding (if new) →
  Dashboard
```

---

## 3. 🧭 Routing Setup (React Router)

```tsx
// routes.tsx
<Route path="/" element={<Landing />} />

<Route path="/auth" element={<Auth />} />
<Route path="/onboarding" element={<Onboarding />} />

<Route path="/app" element={<AppLayout />}>
  <Route index element={<Dashboard />} />
  <Route path="map" element={<Map />} />
  <Route path="scan" element={<Scanner />} />
  <Route path="report" element={<Report />} />
  <Route path="treatment" element={<Treatment />} />
  <Route path="history" element={<History />} />
</Route>
```

---

## 4. 🔐 Route Guards (CRITICAL)

```tsx
// ProtectedRoute.tsx
if (!isAuthenticated) return <Navigate to="/auth" />
if (!isOnboarded) return <Navigate to="/onboarding" />
```

---

## 5. 📱 PWA Detection Hook

```tsx
export const usePWA = () => {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  const isInstalled = isStandalone || (window.navigator as any).standalone

  return { isInstalled }
}
```

---

## 6. 🎬 Launch Animation (App Mode Only)

### 6.1 Component

```tsx
// LaunchScreen.tsx
import { motion } from "framer-motion"

export default function LaunchScreen() {
  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-green-500 to-cyan-500">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1 }}
        className="text-white text-2xl font-bold"
      >
        PadiGuard AI
      </motion.div>
    </div>
  )
}
```

### 6.2 Flow

```tsx
<LaunchScreen />
→ delay 1.5s
→ redirect to /auth
```

---

## 7. 🎨 Tailwind + Theme Setup

## 7.1 Tailwind Config

```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      primary: "rgb(var(--primary) / <alpha-value>)",
      bg: "rgb(var(--bg) / <alpha-value>)",
    }
  }
}
```

---

## 7.2 Global Theme

```css
/* globals.css */
body {
  background: rgb(var(--bg));
  color: rgb(var(--text));
}
```

---

## 7.3 Dark Mode Hook

```tsx
export const useTheme = () => {
  const toggle = () => {
    document.documentElement.classList.toggle("dark")
  }

  return { toggle }
}
```

---

## 8. 🧩 Core UI Components

---

## 8.1 Button Component

```tsx
export function Button({ children, variant = "primary" }) {
  return (
    <button
      className={`
        w-full py-3 rounded-xl font-medium
        ${variant === "primary" && "bg-green-500 text-white"}
        ${variant === "secondary" && "border border-gray-300"}
      `}
    >
      {children}
    </button>
  )
}
```

---

## 8.2 Card Component

```tsx
export function Card({ children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm">
      {children}
    </div>
  )
}
```

---

## 8.3 Bottom Navigation (CRITICAL)

```tsx
export function BottomTabs() {
  return (
    <div className="fixed bottom-0 w-full bg-white border-t flex justify-around py-2">
      <Tab icon="🏠" label="Home" />
      <Tab icon="🗺" label="Map" />
      <Tab icon="📸" label="Scan" />
      <Tab icon="📊" label="History" />
    </div>
  )
}
```

---

## 9. 🧱 Layout System

## 9.1 App Layout

```tsx
export default function AppLayout() {
  return (
    <div className="pb-20"> {/* space for bottom tabs */}
      <Outlet />
      <BottomTabs />
    </div>
  )
}
```

---

## 10. 📸 Scanner Implementation

```tsx
<input type="file" accept="image/*" capture="environment" />
```

Enhance with:

* preview
* loading state
* API call

---

## 11. 🌍 Map Integration (Mapbox)

```tsx
<Map
  initialViewState={{ longitude, latitude, zoom: 15 }}
  mapStyle="mapbox://styles/mapbox/satellite-v9"
/>
```

Add:

* polygon drawing
* grid overlay
* heatmap layer

---

## 12. 🔄 API Layer Structure

```bash
src/api/
├── auth.ts
├── scan.ts
├── weather.ts
├── treatment.ts
```

---

## 13. 📦 State Management (Zustand)

```tsx
export const useAuthStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))
```

---

## 14. ⚡ Performance Optimization

* Lazy load pages:

```tsx
const Dashboard = lazy(() => import('./Dashboard'))
```

* Use image compression before upload
* Cache API responses
* Enable service worker caching

---

## 15. 📡 Offline Support

## 15.1 Service Worker (Vite PWA)

Use:

```bash
vite-plugin-pwa
```

## 15.2 Config

```js
VitePWA({
  registerType: "autoUpdate",
  workbox: {
    runtimeCaching: [
      {
        urlPattern: /api/,
        handler: "NetworkFirst",
      },
    ],
  },
})
```

---

## 16. 🔔 Install Prompt Logic

```tsx
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault()
  setInstallPrompt(e)
})
```

---

## 17. 📱 Mobile UX Enhancements

* Use **bottom sheets instead of modals**
* Use **swipe gestures for navigation**
* Use **sticky action buttons**
* Use **skeleton loaders**

---

## 18. 🧪 Dev Workflow

### Run locally:

```bash
npm run dev
```

### Test mobile:

* Chrome DevTools (device mode)
* Real phone via local network

---

## 19. 🚀 Deployment

* Frontend: Vercel / Firebase Hosting
* Backend: Cloud Run
* Enable HTTPS (required for PWA)

---

## 20. 🔥 Final Developer Checklist

### Structure

* [ ] Clean folder structure
* [ ] Reusable components

### UX

* [ ] Mobile-first layout
* [ ] Bottom navigation working
* [ ] Smooth transitions

### PWA

* [ ] Install prompt works
* [ ] Offline mode works
* [ ] Launch animation works

### Performance

* [ ] Fast load (<3s)
* [ ] Lazy loading enabled

---

## ✅ Final Note

If you implement this correctly, your app will feel like:

👉 A **real mobile app (not a website)**
👉 Fast, smooth, and intuitive
👉 Strong enough to score **full UI/UX + Technical marks**

---


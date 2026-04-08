# Map Feature Implementation Plan

Implementation of the Synchronized Spatial Grid System mapping feature for PadiGuard AI. This plan incorporates the UI/UX design standard (mobile-first, bottom tab spacing) and delegates external service provisioning to the developer via placeholder environment variables.

## User Review Required
> [!IMPORTANT]
> - **Action Required Before Proceeding**: Please read through the "Prerequisite Setup Steps" and create the necessary service configurations on Mapbox and Firebase.
> - **Notification Required**: I will wait for you to complete your manual setup. **Strictly notify me (the coding agent) once you have inserted your keys and are ready for me to begin writing code.**

## Prerequisite Setup Steps (To be completed by USER)

> [!NOTE]
> Please follow these steps. Do not worry about coding; I will handle all code file modifications when you tell me to proceed!

### 1. Mapbox Setup
1. Go to [Mapbox](https://www.mapbox.com/) and register/log in to your account.
2. Navigate to your Account Dashboard and generate an **Access Token**.
3. Keep this token handy. I will provide a `.env` file where you should paste this.

### 2. Firebase Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Go to **Firestore Database** and create a database (start in "test mode" for now).
3. If applicable to your workflow, upgrade to the Blaze plan and enable **Functions** setup. (If you opt not to, we can use local emulators).
4. Register a Web App in **Project Settings -> General -> Your Apps**.
5. Keep your `firebaseConfig` variables handy (API Key, Auth Domain, Project ID, etc.). I will prepare matching dummy variables in a `.env` file for you.

---

## Proposed Changes

### Configuration Hookup (Dummy Insert Areas)

#### [NEW] `frontend/.env`
I will create a dummy environment file. When code generation begins, you will paste your generated service keys here:
```env
VITE_MAPBOX_TOKEN="YOUR_MAPBOX_API_KEY_HERE"
VITE_FIREBASE_API_KEY="YOUR_FIREBASE_API_KEY_HERE"
VITE_FIREBASE_AUTH_DOMAIN="YOUR_FIREBASE_AUTH_DOMAIN_HERE"
VITE_FIREBASE_PROJECT_ID="YOUR_FIREBASE_PROJECT_ID_HERE"
VITE_FIREBASE_STORAGE_BUCKET="YOUR_FIREBASE_STORAGE_BUCKET_HERE"
VITE_FIREBASE_MESSAGING_SENDER_ID="YOUR_FIREBASE_MESSAGING_SENDER_ID_HERE"
VITE_FIREBASE_APP_ID="YOUR_FIREBASE_APP_ID_HERE"
```

### Backend Setup (Firebase Functions & Firestore)

#### [NEW] `backend/functions/package.json`
- Initialize node environment. Include: `firebase-admin`, `firebase-functions`, and `@turf/turf`.

#### [NEW] `backend/functions/index.js`
- Generate Firestore trigger functions.
- `updateGridStatus`: Trigger that observes any new/updated disease reports and links it to update the parent polygon `grid` document's `healthState` to "Infected".
- `spatialPropagationAnalysis` (Optional): A logic handler that uses Turf.js to estimate and flag adjacent polygons within a specific distance threshold as "At-Risk".

### Frontend Setup (React, Mapbox & Turf.js)

#### [MODIFY] `frontend/package.json`
- Append and install `mapbox-gl`, `@mapbox/mapbox-gl-draw`, `@turf/turf`, and `firebase`.

#### [NEW] `frontend/src/firebase.ts`
- Implement robust Firebase logic pointing to the import.meta.env dummy variables.
- Guarantee offline-first mapping capability by forcefully enabling Firestore's `enableIndexedDbPersistence`.

#### [NEW] `frontend/src/pages/app/Map.tsx`
- Follow `frontendGuideline.md` UI/UX directives:
  - Adhere to PWA layouts incorporating the `pb-20` standard margin spacing to prevent bottom tab overlap.
  - Implement full-screen mobile-first map rendering that aligns with green/blue gradients and tailwind defaults.
- Mapbox/Turf logic:
  - Render base layer securely sourcing the `VITE_MAPBOX_TOKEN`.
  - Add draw controls via `@mapbox/mapbox-gl-draw` allowing users to plot area parameters.
  - Wire draw events to calculate `turf.area()` and `turf.centroid()`, immediately persisting geometric data and coordinates back to Firestore via custom hooks.
  - Tie the active mapbox `fill` layer colors directly to reactive Firestore states (`'Healthy' -> #00FF00`, `'At-Risk' -> #FFA500`, `'Infected' -> #FF0000`).

#### [NEW] `frontend/src/hooks/useGrids.ts`
- Separate concerns by isolating the Firestore listener in a custom hook. Manages dynamic streaming of the spatial map polygons over changing connectivity statuses.

## Open Questions

- Just to confirm: Should we strictly defer all Firebase Functions hosting configurations and simply focus on the `.js` node execution logic inside `backend/functions`? 
- Take your time setting up Mapbox and Firebase. Reply back here whenever you are ready!

## Verification Plan
1. Validate environmental keys load securely prior to Map component mounting.
2. Confirm UI renders map layer unobscured above Bottom Navigation tabs (via guidelines).
3. Validate Turf.js reliably writes correct Area (hectares/meters) and Centroids to Firestore test collections.
4. Test offline map caching persistence (Chrome Network tab disconnected).

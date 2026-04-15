# 🌾 PadiGuard AI Frontend PRD: Dashboard, Scanner & Inventory Refactor

**Document Type:** Detailed Frontend Implementation Specification
**Platform:** React + Vite (Mobile-First PWA)
**Scope Focus:** Home Page (Dashboard) Rework, New Scanner Interface, New Inventory Page
**Exclusions:** Map mapping module, Spatial Propagation UI, Auth/Onboarding flows (Strictly untouched).

---

## 1. 📌 Executive Summary
This document outlines the detailed frontend architecture and UI/UX implementation plan for the redesigned PadiGuard AI Dashboard, the Full-Screen Scanner Interface, and the newly introduced Inventory Management Page.

To align with the transition to a **Multi-Agent Swarm backend architecture** (as detailed in the `yxfinalPRD.md`), the frontend must present actionable, agent-driven intelligence immediately upon login. The dashboard is being stripped of generic elements in favor of a strict 3-card layout. The Scanner is elevated to a primary Floating Action Button (FAB). Finally, the space previously occupied by the "History" tab is now repurposed for the Inventory Page, interfacing directly with the Resource Manager Agent to track physical stock and low-stock alerts.

---

## 2. 🧭 Global Navigation Updates & Component Structure

The primary navigation system requires modification to elevate the scanning action, accommodate the new layout, and introduce the Inventory tab.

### 2.1 File Structure Changes
The React frontend structure (previously defined in `frontendGuideline.md`) will receive the following page-level updates:
```text
frontend/src/pages/app/
 ├── Dashboard.tsx    (Refactored for 3-card grid layout)
 ├── Map.tsx          (Untouched)
 ├── Scanner.tsx      (Refactored for full-screen z-index overlay)
 ├── Inventory.tsx    (NEW - Replaces History on bottom nav)
 └── History.tsx      (Moved to be accessed via Scanner overlay)
```

### 2.2 Bottom Tab Bar Restructure
The History tab must be completely removed from the bottom navigation bar and replaced with the Inventory tab.

**Updated Tab Configuration:**
1. Home (Dashboard)
2. Map (Untouched)
3. **[ FAB Space (Scanner) ]** (Elevated above the bar)
4. Inventory (Replaces the old History slot)
5. Profile

### 2.3 The Scanner FAB (Floating Action Button)
The Scanner entry point is moved to an elevated FAB positioned explicitly above the navigation bar's center point.

* **UI/UX Strategy:** Must use a bold `emerald → teal` gradient to stand out as the primary call-to-action (CTA).
* **Styling Specification:** 
  * Large circular bubble button (e.g., `h-16 w-16` or `h-20 w-20`).
  * Drop shadow (`shadow-xl`) to ensure depth above the tab bar.
  * Centered horizontally, translated up by 30-50% of its height to break the tab bar line (`relative -top-6` or similar).
* **Routing:** `onClick={() => navigate('/app/scan')}`

---

## 3. 🏠 Dashboard (Home Page) Implementation

The Home Page acts as the "Financial and Climate Command Center". It will utilize a strict, unscrollable (or minimally scrollable) CSS Grid layout containing exactly three actionable widget cards.

### 3.1 Layout Architecture
* **Top Row:** Two medium-sized square widgets (50% width each, accounting for grid gaps).
* **Bottom Row:** One large, flexible rectangular card stretching from the bottom of the top row down to the top of the navigation bar/FAB safe area.
* **Padding:** Strict adherence to mobile safe areas (`env(safe-area-inset-*)`) to prevent overlap with the newly elevated FAB.

### 3.2 Card 1: Weather Intelligence Widget (Top Left)
* **Purpose:** Display hyper-local precipitation windows and spray safety.
* **Data Provider:** The Meteorologist Agent (`Tomorrow.io` API).
* **UI Elements:**
  * Contextual Icon (Sun, Rain Cloud, etc.).
  * Temperature & Wind Speed/Direction.
  * **Critical Metric:** `safeToSpray` boolean indicator (e.g., Red "DELAY" badge if rain < 4hrs, Green "CLEAR" badge otherwise).
* **Interaction:** Clickable. Routes to a detailed 7-day climate view.
* **Styling:** Light blue/cyan hue background or accent border to indicate weather context.

### 3.3 Card 2: Zone Health Summary (Top Right)
* **Purpose:** Provide a high-level summary of the spatial farm health.
* **Data Provider:** Aggregated Firestore Grid Data (Health States).
* **UI Elements:**
  * Total Area Scanned.
  * Pie chart or stacked bar indicating Healthy (Green), At-Risk (Amber), and Infected (Red) zones.
  * Simple text summary (e.g., "2 Zones Require Attention").
* **Backend Hook:** Re-renders dynamically when Swarm Agent 4 (Spatial Propagation) outputs new `spatial_risk` parameters (e.g., `PredictedBufferZone`) via Firestore.
* **Interaction:** Clickable. Routes directly to `/app/map` to visualize the specific affected polygons and containment rings.

### 3.4 Card 3: Financial Command Center (Bottom Large Card)
* **Purpose:** Display real-time, actionable financial decisions based on the latest scans.
* **Data Provider:** The Universal Economist Agent (`ManaMurah MCP` & Firestore Inventory).
* **UI Elements:**
  * **ROI Metric:** Large typography displaying the calculated ROI percentage or RM value (incorporating the `farmGatePrice = retailPrice * 0.45` logic from the backend).
  * **Cost vs. Benefit Breakdown:** Small horizontal bar or list showing Potential Yield Gain vs. Treatment Cost (`fetch_inventory_cost`).
  * **Inventory Alert:** Red warning text if `manage_inventory` tool flags chemical stock `< 5`.
  * **Primary Action:** "View Treatment Plan" button.
* **Interaction:** Card acts as a touch target routing to `/app/treatment`.
* **Styling:** Use the primary gradient theme (`emerald → teal`) with white text to establish hierarchy as the most important card on the screen.

---

## 4. 📸 Scanner Page Implementation

The Scanner must feel like a native mobile camera application. It completely overtakes the screen, hiding the bottom navigation bar and rendering over the safe areas.

### 4.1 Layout & Overlay Architecture
* **Z-Index Strategy:** The camera feed acts as the base background layer (`z-0`), with all UI controls layered on top (`z-10`) with absolute positioning.
* **Background:** Black (`bg-black`) to ensure contrast while the camera initializes.
* **Video Feed:** `object-cover` forced to `100vh` and `100vw`.

### 4.2 Top Navigation Overlay (Absolute Top)
* **Top Left: History Button**
  * **Context:** Relocated from the old bottom nav bar.
  * **UI:** Circular icon button (Clock or Log icon) with a frosted glass effect (`backdrop-blur-md bg-black/30`).
  * **Routing:** `onClick={() => navigate('/app/history')}`.
* **Top Right: Swarm Analysis Report Button**
  * **Context:** Navigates to the generated Swarm Analysis (combining Weather, Finance, Inventory, and Spread risk), replacing generic open-ended chat to align with the deterministic backend.
  * **UI:** Circular icon button (Sparkles/Gemini logo) matching the frosted glass effect of the history button.
  * **Routing:** `onClick={() => navigate('/app/report')}`.

### 4.3 Bottom Action Overlay (Absolute Bottom)
* **Capture Button**
  * **Context:** The main interaction point for the Live Vision Scanner.
  * **Backend Trigger:** Submits image to upstream image-recognition engine to extract `cropType, disease, severity`, feeding these as `SwarmInput` to the Firebase Genkit backend for continuous swarm analysis.
  * **UI:** A large, distinct white circle centered at the bottom of the screen.
  * **Styling:** `w-20 h-20 bg-white rounded-full border-4 border-gray-300 shadow-xl`.
  * **Feedback:** Must include a scaling animation on touch (`active:scale-90 transition-transform`).

---

## 5. 📦 Inventory Page Implementation

The Inventory page replaces the old History tab and serves as the physical stock management interface. It acts as the frontend visualization for the Resource Manager Agent and queries Firestore explicitly.

### 5.1 Layout & UI Architecture
* **Header & Quick Stats:** 
  * Page Title: "Chemical Inventory".
  * A horizontal scroll or grid of 2-3 metric cards (e.g., "Total Items: 12", "Low Stock: 2").
* **Category Filter Pills:** 
  * A horizontal, scrollable row of pill-shaped toggle buttons to filter the list.
  * Categories: All, Pesticides, Fungicides, Fertilizers.
* **Inventory List View:**
  * A vertically scrollable list of product cards.
* **Product Card UI Elements:**
  * **Visual:** A small thumbnail or material icon representing the chemical type.
  * **Title:** Product Name (e.g., "Amistar Top").
  * **Stock Level Indicator:** A visual progress bar showing remaining volume (e.g., filling up based on a 10L max capacity).
  * **Numeric Value:** Text showing exact quantity (e.g., "3 Liters").
  * **Status Badge:** A dynamic pill. If stock `< 5`, it renders as a red "Low Stock" warning. Otherwise, a green "In Stock" badge. This directly supports the `manage_inventory` thresholds alerting users via FCM in the background.
  * **Add Action:** A secondary FAB or top-right header button (`+`) allowing the farmer to manually log a restock into Firestore.

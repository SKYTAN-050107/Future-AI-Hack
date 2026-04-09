# 🌾 PadiGuard AI – Product Requirements Document (PRD)

**Track:** Padi & Plates (Agrotech & Food Security)
**Target Users:** Malaysian Smallholder Padi Farmers (Johor Focus)
**Platform:** Mobile-First Progressive Web App (PWA)

---

# 1. 📌 Product Overview

## 1.1 Product Summary

**PadiGuard AI** is a **mobile-style, offline-first Progressive Web App (PWA)** designed to help smallholder farmers **detect crop diseases early, optimize pesticide usage, and make climate-aware decisions**.

The platform combines:

* **Multimodal AI (image + context)**
* **Agent-based decision-making via Google ADK**
* **RAG (Retrieval-Augmented Generation) using agricultural data from Vertex AI**
* **Mobile-native UI/UX design inside a web app**
* **Real-time agentic ecosystem driven by Firebase Genkit orchestration**

PadiGuard AI is evolving from a static diagnostic app into a full **Decision Intelligence Platform for Agriculture** — combining spatial farm monitoring, real-time AI-assisted scanning, predictive financial planning, and climate-aware action scheduling.

---

## 1.2 Key Differentiation

Unlike traditional agrotech tools, PadiGuard AI:

* Works **offline-first (critical for rural areas)**
* Provides **ROI-based decisions (not just diagnosis)**
* Uses **multi-agent orchestration via Google ADK (not static outputs)**
* Delivers a **mobile app experience inside browser + PWA install**
* Features a **Synchronized Spatial Grid** that links farm sections to AI diagnostic outputs
* Employs **Gemini 2.0 Flash** for real-time edge-assisted multimodal analysis

---

## 1.3 Value Proposition

* 🌾 Reduce crop loss via **early detection**
* 💰 Optimize cost using **ROI-driven treatment**
* 📱 Enable access through **mobile-first PWA**
* 🌦️ Improve timing via **weather-aware intelligence**
* 🗺️ Enable spatial risk understanding through **dynamic farm grid mapping**
* 🤖 Leverage agentic AI for **proactive recommendations, not reactive responses**

---

# 2. 🎯 Objectives & Success Metrics

## 2.1 Objectives

* Increase yield survival rate
* Reduce pesticide waste
* Provide simple, actionable AI insights
* Ensure usability for rural farmers
* Enable spatial farm monitoring and health state propagation tracking

---

## 2.2 KPIs

| Metric              | Target         |
| ------------------- | -------------- |
| Disease Accuracy    | ≥ 90%          |
| Yield Improvement   | +20%           |
| Cost Reduction      | -30% pesticide |
| Weekly Active Users | ≥ 80%          |
| App Load Time       | < 3s           |

---

# 3. 👤 Target Users & Personas

## 3.1 Primary Persona: Smallholder Farmer

**Profile:**

* Owns 1–5 hectares
* Uses smartphone (Android dominant)
* Limited digital literacy

**Needs:**

* Simple UI
* Clear actions (not analysis-heavy)
* Offline usability

---

## 3.2 Pain Points

* Late disease detection
* Inefficient pesticide usage
* Poor weather planning
* No centralized tracking

---

# 4. 📱 Product Experience Design (CRITICAL SECTION)

## 4.1 Dual-Mode Experience Architecture

### A. Website Mode (First Entry)

**Trigger:** User opens URL in browser

**Flow:**

1. Landing Page
2. Install Prompt
3. Continue in Browser (optional)
4. Auth / OTP
5. Main App

---

### B. Installed App Mode (PWA)

**Trigger:** User opens app from home screen

**Flow:**

1. Launch Animation
2. Auth / OTP
3. Main App

---

## 4.2 UX Principle

👉 After login, **experience MUST be identical** across both modes.

---

## 4.3 Launch Context Detection

System must detect mode using:

* `beforeinstallprompt`
* `display-mode: standalone`
* `navigator.standalone`
* Route guards

---

## 4.4 UI Design System (MANDATORY)

### Theme

* Green → Blue gradient (Agriculture + Intelligence)

### Modes

* Light Mode → white + soft gradient
* Dark Mode → navy + teal accents

### Design Principles

* Minimal text
* Card-based layout
* Mobile-first spacing
* Large touch targets

---

## 4.5 Navigation Structure

### Bottom Tab Navigation

| Tab     | Function     |
| ------- | ------------ |
| Home    | Overview     |
| Map     | Farm mapping |
| Scanner | AI scan      |
| History | Logs         |
| Profile | Settings     |

---

## 4.6 Route Structure

```
/              → Landing
/auth          → Login
/onboarding    → Setup
/app           → Dashboard
/app/map       → Mapping
/app/scan      → Scanner
/app/report    → Diagnosis
/app/treatment → Treatment
/app/history   → Logs
```

---

# 5. ⚙️ Core Features & Functional Requirements

---

# 5.1 🌍 Farm Layout Mapping

## Description

The mapping interface is built as a **Synchronized Spatial Grid** — a living map that links each farm section directly to real-time AI diagnostic outputs. Each grid section is a unique data object in Firestore, tied to scanner output and health state transitions.

## Expected flow of app

* User enables GPS → browser gives coordinates
* Map centers on their location (Mapbox)
* User uses drawing tool → creates polygon
* Polygon saved as GeoJSON → processed by Turf.js
* Turf.js calculates area (hectares) and centroid
* Firestore stores GridID object with polygon, area, centroid
* Map renders polygon with color based on health state
* Scanner updates GridID status to "Alert" upon confirmed abnormality
* Firestore Trigger updates GridID status to "Alert", immediately changing the grid color on the map to red
* Spatial Propagation Agent evaluates proximity of infected grids to healthy ones and suggests buffer zones for preventative spraying
* Gemini-powered Spatial Advisor compares real-time GPS coordinates and visual landmarks (from camera) to suggest the correct grid section when the farmer is unsure of their location

1. Map Rendering

Engine: Mapbox GL JS renders high-resolution satellite tiles.

User Experience: The interface provides a full-screen view of the farm area for immersive navigation.

2. Polygon Drawing

Interaction: Utilizes Mapbox Draw to enable users to create boundaries via touch or click.

Accuracy: Incorporates snap-to-grid and validation logic to ensure geometric precision.

3. Geospatial Calculations

Once a polygon is finalized, Turf.js performs real-time computations:

Area: Calculated in hectares for agricultural reporting.

Centroid: Generated as a reference point for AI processing and GPS coordinate matching.

4. Data Persistence (Firestore)

Spatial data is archived in a grids collection within Firestore. Each document includes:

GridID: Unique identifier for the plot.

areaHectares: The computed physical size.

centroid: The geometric center coordinates.

healthState: Current status of the vegetation.

5. Real-Time Map Synchronisation

A custom React hook, useGrids.ts, acts as a listener for the Firestore collection. Map polygon fills update dynamically based on the healthState:

Healthy → Green

At-Risk → Amber

Infected → Red

6. Automated Backend Processing

Cloud Functions (specifically updateGridStatus) trigger upon Firestore updates:

Automatically detects abnormalities and modifies the healthState.

Utilizes Turf.js server-side to compute optional buffer zones around infected areas.

7. Spatial Intelligence & AI Advisor

Vertex AI: Analyzes spatial patterns to flag neighboring polygons as "At-Risk" based on proximity and historical data.

Gemini Advisor: Leverages GPS data and camera-identified landmarks to provide location-aware guidance. It suggests which specific polygon the user is currently standing in, facilitating accurate navigation in large-scale, multi-grid environments.
## User Story

> As a farmer, I want to map my farm so I can monitor specific sections and see which areas are at risk.

## Functional Requirements

* Mapbox satellite view with tile caching for offline use
* Polygon drawing via Turf.js generating interactive GeoJSON polygons
* Area calculation (hectares) per polygon
* Grid segmentation with unique GridID per section
* Plant density estimator
* **Health State per grid:** Healthy → At-Risk → Infected
* **Spatial Propagation Agent:** Vertex AI Agent Engine evaluates proximity of infected grids to healthy ones and suggests buffer zones for preventative spraying
* **Gemini-powered Spatial Advisor:** Compares real-time GPS coordinates and visual landmarks (from camera) to suggest the correct grid section when the farmer is unsure of their location
* Firestore Trigger updates GridID status to "Alert" upon confirmed abnormality, immediately changing the grid color on the map to red
* Offline caching of map tiles and grid data

## Inputs

* GPS location
* Drawn polygons
* Scanner-linked GridID selection

## Outputs

* Color-coded grid farm map (green / amber / red per health state)
* Area metrics (hectares per section)
* Buffer zone recommendations

## Acceptance Criteria

* Map usable offline
* ≥ 95% area accuracy
* UI supports touch gestures smoothly
* Grid color updates in real-time upon disease detection
* Spatial Advisor correctly identifies the grid in ≥ 90% of test cases

## Page Technologies

| Technology | Role |
|---|---|
| React + Vite | Component structure and routing |
| Mapbox GL JS | Satellite base layer, tile rendering, offline tile caching |
| Turf.js | GeoJSON polygon creation, hectare calculation, grid segmentation |
| Cloud Firestore | Stores GridID objects, health states, and scanner linkage in real-time |
| Vertex AI Agent Engine | Spatial Propagation Agent — analyzes inter-grid proximity and suggests buffer zones |
| Gemini 2.0 Flash | Spatial Advisor — compares GPS + camera landmarks to confirm grid selection |
| Firebase Genkit | Orchestrates the Spatial Advisor flow connecting GPS, camera, and Gemini |

---

# 5.2 📸 Abnormality Detection (AI Scanner Entry)

## Description

The scanner has evolved into a **Live Vision Scanner** powered by edge-assisted object detection. Gemini 2.0 Flash's spatial understanding identifies Regions of Interest (ROI) within the live camera frame — such as brown planthopper clusters or yellowing leaf tips indicating nutrient deficiency — and renders bounding boxes in real-time before the farmer captures.

Upon image capture, the scanner transitions into a **Genkit-powered Agronomy Chat** where the image and its metadata (weather, grid location, growth phase) are passed as persistent context for follow-up questions.

## User Story

> I want to quickly scan crops and detect problems before they spread, and then ask follow-up questions about what I see.

## Functional Requirements

* Live camera feed with real-time ROI bounding boxes (Gemini 2.0 Flash spatial reasoning)
* Upload fallback for non-live scanning
* AI anomaly detection with heatmap overlay
* Growth stage awareness injected into the AI prompt context
* Automatic association of the captured image to the current GridID
* Transition to Agronomy Chat post-capture with full metadata context (weather, grid, growth phase)
* Persistent diagnosis logs stored in Firestore History module for chronological record and future drone-path planning

## Outputs

* Highlighted abnormal zones with bounding boxes
* Severity indicators
* Agronomy Chat session linked to captured image

## Acceptance Criteria

* Detection < 5 seconds
* Clear visual bounding boxes and severity indicators
* Agronomy Chat preserves image and metadata context
* History log is updated per scan

## Page Technologies

| Technology | Role |
|---|---|
| React + Vite | Camera UI, upload fallback, chat interface |
| Gemini 2.0 Flash | Real-time multimodal vision — ROI detection, bounding boxes, spatial understanding |
| Firebase Genkit | Orchestrates the Scanner-to-Chat flow, passes image + metadata to Gemini |
| Cloud Firestore | Stores scan sessions, diagnosis logs, and chat history |
| Google ADK – Diagnostician Agent | Specialized vision agent for disease and pest identification |
| Vertex AI Vector Search | RAG lookup triggered by detected anomalies for contextual advice |

---

# 5.3 🦠 Disease Scanning & Severity

## Description

Identify disease and evaluate risk using Gemini 2.0 Vision classification backed by MARDI agricultural datasets via Vertex AI RAG.

## User Story

> I want to know what disease it is and how serious it is.

## Functional Requirements

* Image classification using Gemini 2.0 Flash
* Supported diseases:
  * Blast
  * Tungro
  * Bacterial blight
  * Sheath blight
  * Brown planthopper
* Severity scoring (0–100%)
* Spread risk calculation
* Before/after tracking linked to GridID history

## Outputs

* Disease name
* Severity %
* Risk level (Low / Medium / High / Critical)

## Acceptance Criteria

* ≥ 90% accuracy
* Visual severity bar
* Simple explanation understandable to a low-literacy farmer

## Page Technologies

| Technology | Role |
|---|---|
| Gemini 2.0 Flash | Multi-modal disease classification from image |
| Vertex AI Vector Search | RAG retrieval of MARDI disease records and treatment literature |
| Firebase Genkit | Orchestrates the RAG flow upon disease detection — fetches dosage and treatment data |
| Cloud Firestore | Stores diagnosis results linked to GridID and timestamp |

---

# 5.4 💊 Treatment & ROI Engine

## Description

The dashboard ROI Engine acts as a **Financial Command Center**. It calculates the cost-benefit of pesticide application and uses agent-driven recommendations rather than static outputs. The ROI formula used is:

```
ROI = ((Potential Yield Gain × Market Price) − Cost of Treatment) / Cost of Treatment
```

This factors in the "Survival Probability" score provided by the Diagnostician Agent.

## User Story

> I want to know what to do and whether it is worth it financially.

## Functional Requirements

* RAG-based treatment retrieval from Vertex AI Vector Search (MARDI pesticide guidelines)
* Dosage calculator (auto-scaled to hectares from GridID polygon area)
* Cost estimation in RM using MARDI-recommended Malaysian pesticides as defaults (reduces data-entry friction)
* ROI calculation incorporating Survival Probability from the AI model
* Organic treatment alternatives
* **Smart Inventory (Resource Management Agent):** Tracks pesticide stock levels, triggers Firebase Cloud Messaging (FCM) push notification when stock is low, prioritized by current field severity

## Outputs

* Treatment plan with step-by-step instructions
* Cost vs yield gain (e.g., RM10 spend → RM80 gain)
* Recommended treatment timing window
* Low-stock push alert via FCM

## Acceptance Criteria

* Clear actionable steps
* ROI displayed simply
* Inventory alerts fired within 30 seconds of threshold crossing

## Page Technologies

| Technology | Role |
|---|---|
| Firebase Genkit | Orchestrates treatment retrieval flow |
| Vertex AI Vector Search | Retrieves MARDI pesticide and dosage data via RAG |
| Google ADK – Economist Agent | Calculates ROI and Survival Probability-weighted cost-benefit |
| Google ADK – Resource Management Agent | Monitors inventory levels and triggers alerts |
| Firebase Cloud Messaging (FCM) | Delivers high-priority push notifications for low stock and severity alerts |
| Cloud Firestore | Stores treatment plans and inventory logs |

---

# 5.5 🌦️ Climate Intelligence

## Description

Prevent poor timing decisions. Provides hyper-local 7-day forecasts and spray timing windows using the **Vertex AI Google Search Extension** within Genkit flows to pull real-time weather data. The system identifies "Spray Windows" — optimal application periods that avoid rain within 4–6 hours post-spraying.

## User Story

> I want to avoid spraying before rain and get recommended spray timing.

## Functional Requirements

* 7-day hyper-local forecast via Vertex AI Google Search Extension (within Genkit flow)
* Rain alerts
* Spray Window recommendations (avoiding rain ≥4 hours post-application)
* Priority ranking of action items by weather risk
* **Meteorologist Agent (Google ADK):** Combines weather data with current disease severity to produce timed action alerts

## Outputs

* Weather alerts
* Ranked action priorities
* Spray Window recommendations

## Acceptance Criteria

* Accurate hyper-local forecasts
* Visible alert system with clear spray/no-spray indicators
* Alerts delivered via FCM for urgent rain warnings

## Page Technologies

| Technology | Role |
|---|---|
| Firebase Genkit | Orchestrates the weather fetch and spray window calculation flow |
| Vertex AI Google Search Extension | Pulls hyper-local real-time weather data within Genkit flows |
| Google ADK – Meteorologist Agent | Cross-references weather data with disease severity for timing alerts |
| Firebase Cloud Messaging (FCM) | Delivers weather-triggered push notifications |
| Cloud Firestore | Stores forecast snapshots and alert logs |

---

# 6. 🧭 End-to-End User Flow

### First-Time User

1. Open website
2. Install or continue in browser
3. Login (OTP via Firebase Authentication)
4. Onboarding (farm name, location, growth stage)
5. Map farm (draw polygons, auto-segment into grid)

---

### Daily Usage Flow

1. Open app
2. Scan plant (select current GridID → live scan → ROI bounding boxes)
3. View diagnosis (disease name, severity %, spread risk)
4. Review ROI and treatment plan
5. Apply treatment within suggested spray window
6. Track results via History module

---

### Mapping-to-Scanner Link Workflow

1. **Grid Initialization:** Farmer draws farm layout; Turf.js calculates hectares and generates a GridID for each section.
2. **Visual Contextualization:** When scanner is active, the ADK Orchestrator pulls the `current_grid_id`.
3. **Safety Check Agent:** If the farmer is uncertain of their location, Gemini analyzes camera orientation and GPS to confirm the correct grid section.
4. **State Update:** Once an abnormality is confirmed, a Firestore Trigger updates the GridID status to "Alert," immediately changing the color of that section on the map to red.

---

# 7. 🎨 UI/UX Requirements (Expanded)

## Must Follow

* Mobile-first layout
* Bottom navigation (5 tabs)
* Card-based UI
* Large CTAs

## Key Screens

* Landing Page
* Auth Page
* Dashboard (Financial Command Center)
* Scanner (Live Vision with Agronomy Chat)
* Map (Synchronized Spatial Grid)
* Diagnosis
* Treatment & ROI
* History

---

## Animation Requirements

* Launch animation (<2s)
* Page transitions (Framer Motion)
* Button feedback
* Alert pulse (red for infected grids)

---

# 8. 🧠 AI & Data Requirements

## AI Components

| Component | Technology | Role |
|---|---|---|
| Vision & Chat | Gemini 2.0 Flash | Real-time disease detection, bounding boxes, Agronomy Chat |
| RAG Knowledge Base | Vertex AI Vector Search | MARDI datasets, pesticide guidelines |
| Agent Orchestration | Google ADK | Multi-agent coordination |
| Flow Orchestration | Firebase Genkit | Pipeline management (Scanner → Chat → RAG → ROI) |
| Weather | Vertex AI Google Search Extension | Hyper-local forecast in Genkit flows |

## Specialized Agents (Google ADK)

| Agent | Specialization |
|---|---|
| Diagnostician Agent | Gemini 2.0 Vision — disease/pest identification and severity scoring |
| Economist Agent | ROI calculation, Survival Probability weighting, cost-benefit analysis |
| Meteorologist Agent | Real-time weather pull via Search Extension, spray window timing |
| Resource Management Agent | Inventory tracking, low-stock detection, FCM alert trigger |
| Spatial Propagation Agent | Grid proximity analysis, buffer zone recommendation |

## Data Sources

* MARDI datasets (stored in Vertex AI Vector Search)
* Hyper-local weather (Vertex AI Google Search Extension)
* User-captured images (stored in Google Cloud Storage)
* Grid and scan history (Cloud Firestore)

---

# 9. 🧩 System Architecture

## Frontend Stack

```
React + Vite (PWA)
Tailwind CSS + Framer Motion
Mapbox GL JS + Turf.js
```

## Backend / Agentic Stack

```
Orchestration Layer: Firebase Genkit
  → Manages all Flows: Scanner-to-Chat, RAG retrieval, Weather fetch

Agent Layer: Google ADK
  → Diagnostician, Economist, Meteorologist, Resource Manager, Spatial Propagation

AI Layer: Gemini 2.0 Flash
  → Multimodal vision, bounding box detection, Agronomy Chat

Knowledge Layer: Vertex AI Vector Search
  → MARDI research papers, pesticide guidelines, disease treatment records

Search Extension: Vertex AI Google Search Extension
  → Hyper-local weather data within Genkit flows
```

## Infrastructure

| Component | Technology | Role |
|---|---|---|
| Frontend | React + Vite + Turf.js | PWA with offline-first capabilities and Mapbox integration |
| Logic / Flow | Firebase Genkit | Manages Scanner-to-Chat transition and RAG flows |
| Agent Logic | Google ADK | Orchestrates ROI, Weather, Diagnosis, and Inventory agents |
| Primary AI | Gemini 2.0 Flash | Fast multimodal vision for real-time object detection and chat |
| Knowledge Base | Vertex AI Vector Search | MARDI agricultural datasets for RAG-based advice |
| Real-Time DB | Cloud Firestore | Grid states, Inventory logs, Scan history |
| File Storage | Google Cloud Storage (GCS) | Captured images and scan media |
| Notifications | Firebase Cloud Messaging (FCM) | High-priority push alerts for rain events and disease severity |
| Auth | Firebase Authentication | OTP-based login |
| Compute | Cloud Run | Serverless backend for Genkit flow execution |

---

# 10. 🚧 Non-Functional Requirements

| Category      | Requirement             |
| ------------- | ----------------------- |
| Performance   | <3s load time           |
| Offline       | Core features available (map tiles, last scan data) |
| Security      | Firebase Auth + secure API gateway |
| Accessibility | Mobile-friendly UI, large touch targets |
| Scalability   | Cloud Run auto-scaling for Genkit flows |

---

# 11. ⚠️ Risks

* Poor image quality from low-end Android cameras
* Connectivity issues in rural areas (mitigated by offline-first design)
* Model inaccuracies (mitigated by RAG grounding with MARDI data)
* Agent orchestration latency (mitigated by Gemini 2.0 Flash speed)

---

# 12. 🚀 Roadmap

### Phase 1
* PWA + UI + Farm Mapping (Mapbox + Turf.js + Firestore Grid)

### Phase 2
* AI Detection + RAG (Gemini 2.0 Flash + Vertex AI Vector Search)

### Phase 3
* Multi-Agent System + ROI Engine (Google ADK + Genkit + FCM)

### Phase 4
* Spatial Propagation + Live Scanner + Agronomy Chat

### Phase 5
* Deployment + Monitoring (Cloud Run + Firebase Analytics)

---

# 13. 🏆 Hackathon Alignment

### Functionality
* End-to-end working system covering scanning, diagnosis, ROI, and mapping

### AI
* Core feature (not add-on) — Gemini 2.0 Flash + Vertex AI + Google ADK fully integrated

### Innovation
* Offline AI + ROI Engine + Multi-Agent Orchestration + Synchronized Spatial Grid

### Google Technology Integration
* Gemini 2.0 Flash, Firebase Genkit, Google ADK, Vertex AI Vector Search, Vertex AI Google Search Extension, Firebase Authentication, Firebase Cloud Messaging, Cloud Firestore, Cloud Run, Google Cloud Storage, Mapbox (satellite layer)

---

# 14. 🌟 Expected Impact

* -25% crop loss
* +20% yield survival
* RM200k savings per farmer/year

---

# 15. 📦 Deliverables

* PWA Demo
* GitHub Repo
* Pitch Deck
* Demo Video

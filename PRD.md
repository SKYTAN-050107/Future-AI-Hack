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
* **Agent-based decision-making**
* **RAG (Retrieval-Augmented Generation) using agricultural data**
* **Mobile-native UI/UX design inside a web app**

---

## 1.2 Key Differentiation

Unlike traditional agrotech tools, PadiGuard AI:

* Works **offline-first (critical for rural areas)**
* Provides **ROI-based decisions (not just diagnosis)**
* Uses **agent orchestration (not static outputs)**
* Delivers a **mobile app experience inside browser + PWA install**

---

## 1.3 Value Proposition

* 🌾 Reduce crop loss via **early detection**
* 💰 Optimize cost using **ROI-driven treatment**
* 📱 Enable access through **mobile-first PWA**
* 🌦️ Improve timing via **weather-aware intelligence**

---

# 2. 🎯 Objectives & Success Metrics

## 2.1 Objectives

* Increase yield survival rate
* Reduce pesticide waste
* Provide simple, actionable AI insights
* Ensure usability for rural farmers

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

Digitally map farm areas into trackable grid zones.

## User Story

> As a farmer, I want to map my farm so I can monitor specific sections.

## Functional Requirements

* Mapbox satellite view
* Polygon drawing (Turf.js)
* Area calculation (hectares)
* Grid segmentation
* Plant density estimator
* Offline caching

## Inputs

* GPS location
* Drawn polygons

## Outputs

* Grid-based farm map
* Area metrics

## Acceptance Criteria

* Map usable offline
* ≥ 95% area accuracy
* UI supports touch gestures smoothly

---

# 5.2 📸 Abnormality Detection (AI Scanner Entry)

## Description

Detect unusual plant conditions early.

## User Story

> I want to quickly scan crops and detect problems before they spread.

## Functional Requirements

* Camera capture UI (mobile-style)
* Upload fallback
* AI anomaly detection
* Growth stage awareness
* Heatmap overlay

## Outputs

* Highlighted abnormal zones
* Severity indicators

## Acceptance Criteria

* Detection < 5 seconds
* Clear visual indicators

---

# 5.3 🦠 Disease Scanning & Severity

## Description

Identify disease and evaluate risk.

## User Story

> I want to know what disease it is and how serious it is.

## Functional Requirements

* Image classification (Gemini)
* Supported diseases:

  * Blast
  * Tungro
  * Bacterial blight
  * Sheath blight
  * Brown planthopper
* Severity scoring (0–100%)
* Spread risk calculation
* Before/after tracking

## Outputs

* Disease name
* Severity %
* Risk level

## Acceptance Criteria

* ≥ 90% accuracy
* Visual severity bar
* Simple explanation

---

# 5.4 💊 Treatment & ROI Engine

## Description

Provide actionable treatment with cost-benefit.

## User Story

> I want to know what to do and whether it is worth it.

## Functional Requirements

* RAG-based treatment retrieval
* Dosage calculator
* Cost estimation (RM)
* ROI calculation
* Survival probability
* Organic alternatives

## Outputs

* Treatment plan
* Cost vs yield gain
* Recommended timing

## Acceptance Criteria

* Clear actionable steps
* ROI shown simply (e.g. RM10 → RM80 gain)

---

# 5.5 🌦️ Climate Intelligence

## Description

Prevent poor timing decisions.

## User Story

> I want to avoid spraying before rain.

## Functional Requirements

* 7-day forecast
* Rain alerts
* Spray timing suggestions
* Priority ranking

## Outputs

* Alerts
* Action priorities

## Acceptance Criteria

* Accurate warnings
* Visible alert system

---

# 6. 🧭 End-to-End User Flow

### First-Time User

1. Open website
2. Install or continue
3. Login (OTP)
4. Onboarding
5. Map farm

---

### Daily Usage Flow

1. Open app
2. Scan plant
3. View diagnosis
4. Apply treatment
5. Track results

---

# 7. 🎨 UI/UX Requirements (Expanded)

## Must Follow

* Mobile-first layout
* Bottom navigation
* Card-based UI
* Large CTAs

## Key Screens

* Landing Page
* Auth Page
* Dashboard
* Scanner
* Map
* Diagnosis
* Treatment
* History

---

## Animation Requirements

* Launch animation (<2s)
* Page transitions
* Button feedback
* Alert pulse

---

# 8. 🧠 AI & Data Requirements

## AI Components

* Gemini 2.0 → vision
* Vertex AI → RAG
* Agent Builder → orchestration

## Data Sources

* MARDI datasets
* Weather API
* User images

---

# 9. 🧩 System Architecture

```
Frontend:
React + Vite (PWA)
Tailwind + Framer Motion

Backend:
Firebase Genkit
Vertex AI
Cloud Run

APIs:
Tomorrow.io

Storage:
GCS
```

---

# 10. 🚧 Non-Functional Requirements

| Category      | Requirement             |
| ------------- | ----------------------- |
| Performance   | <3s load time           |
| Offline       | Core features available |
| Security      | Auth + secure APIs      |
| Accessibility | Mobile-friendly UI      |

---

# 11. ⚠️ Risks

* Poor image quality
* Connectivity issues
* Model inaccuracies

---

# 12. 🚀 Roadmap

### Phase 1

* PWA + UI + Mapping

### Phase 2

* AI Detection + RAG

### Phase 3

* Agent + ROI

### Phase 4

* Deployment

---

# 13. 🏆 Hackathon Alignment

### Functionality

* End-to-end working system

### AI

* Core feature (not add-on)

### Innovation

* Offline AI + ROI engine + agent system

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


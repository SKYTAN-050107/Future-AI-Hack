# Future-AI-Hack Repository Context for AI Chatbot

## 1. Project Identity

Project name: Future-AI-Hack (AcreZen / PadiGuard AI)

Primary purpose:
- Mobile-first and web-accessible AI assistant for padi farming workflows.
- Combines crop diagnosis, weather advisories, treatment planning, inventory tracking, map zones, and financial ROI support.

Core product behavior:
- User authenticates (Firebase Auth), completes onboarding profile, then uses app modules under /app routes.
- Frontend calls backend API through Vite proxy during development.
- Backend diagnosis service aggregates AI services and external data sources.

## 2. Monorepo Layout

Top-level structure:
- frontend: React client application.
- backend/diagnosis: FastAPI service for diagnosis and business endpoints.
- backend/swarm: Python Genkit multi-agent orchestration service.
- backend/cloud-functions: Node Firebase Cloud Functions area.
- docs: Product, architecture, and implementation docs.
- scripts and scratch: utilities and local experiments.

## 3. Frontend Stack and Runtime

Frontend tech stack:
- React 18
- React Router 6
- Vite 5
- Plain global CSS architecture
- Firebase Web SDK
- Mapbox GL + map drawing stack
- Vite PWA plugin for installable app behavior

Evidence:
- [frontend/package.json](frontend/package.json)
- [frontend/vite.config.js](frontend/vite.config.js)

Important frontend characteristics:
- UI styling is largely centralized in [frontend/src/styles/globals.css](frontend/src/styles/globals.css).
- Routing and auth guards are in [frontend/src/app/routes.jsx](frontend/src/app/routes.jsx).
- Session/auth state and onboarding completion status are handled in [frontend/src/hooks/useSession.js](frontend/src/hooks/useSession.js).
- API requests are centralized in [frontend/src/api/gateway.js](frontend/src/api/gateway.js).

## 4. Frontend Route Map

Public and entry routes:
- /
- /landing
- /auth
- /onboarding

Authenticated app routes:
- /app (dashboard home)
- /app/map
- /app/weather
- /app/scan
- /app/report
- /app/treatment
- /app/chatbot
- /app/inventory
- /app/crops
- /app/profile

Source:
- [frontend/src/app/routes.jsx](frontend/src/app/routes.jsx)

Auth flow details:
- RequireAuth gate checks Firebase session.
- RequireOnboarding gate enforces onboarding before /app routes.
- RedirectAuthenticatedEntry decides whether to show auth, onboarding, or resume app path.

## 5. Frontend API Contract Surface

Frontend consumes these backend capabilities via gateway wrapper:
- health checks
- weather outlook
- crop scan diagnosis
- assistant scan and message endpoints
- treatment plan and ROI
- crops CRUD endpoints
- inventory list and updates
- dashboard summary

Source:
- [frontend/src/api/gateway.js](frontend/src/api/gateway.js)

Error handling pattern:
- fetch wrapper with timeout, abort handling, and normalized message extraction.

## 6. Backend Diagnosis Service Context

Service type:
- FastAPI backend in backend/diagnosis.

Major runtime endpoints listed in project docs:
- GET /health
- scan and assistant endpoints under /api
- weather endpoint(s)
- treatment endpoint
- inventory endpoints
- zones summary endpoints
- dashboard summary endpoint
- websocket scan stream

Primary architecture:
- API router layer
- domain services
- shared scan pipeline for embedding, vector match, and reasoning
- Firestore + external providers integration

Sources:
- [backend/diagnosis/README.md](backend/diagnosis/README.md)
- [backend/diagnosis/ARCHITECTURE.md](backend/diagnosis/ARCHITECTURE.md)

## 7. Backend Swarm Service Context

Service type:
- Standalone Python Genkit orchestrator on port 3400.

Role:
- Coordinates specialized agents (meteorologist, economist, resource manager, spatial propagation, yield forecast).
- Registers tools for weather, MCP, inventory, ROI, and FCM.

Source:
- [backend/swarm/main.py](backend/swarm/main.py)

## 8. Development Environment and Commands

Top-level backend dev scripts:
- diagnosis backend launch
- swarm backend launch
- combined backend run (concurrently)

Source:
- [package.json](package.json)

Frontend scripts:
- dev
- dev backend diagnosis
- dev backend swarm
- dev full (frontend + diagnosis + swarm)
- build and preview

Source:
- [frontend/package.json](frontend/package.json)

Vite proxy behavior in dev:
- /api, /health, /ws -> diagnosis backend target
- /swarm-api -> swarm backend target (rewritten to /api)

Source:
- [frontend/vite.config.js](frontend/vite.config.js)

## 9. Authentication and User Profile Model (Frontend Perspective)

Auth provider:
- Firebase Auth

Session model behavior:
- Tracks isAuthenticated, isOnboarded, user, profile, and loading states.
- On sign-in, profile bootstrap and migration path for legacy users.
- completeOnboarding writes onboarding fields and marks onboardingCompleted.

Source:
- [frontend/src/hooks/useSession.js](frontend/src/hooks/useSession.js)

## 10. Current UI Status and Recent State

Known current behavior from latest edits:
- Weather widget testing harness on Home has been removed.
- Weather animated background token system has been removed for now.
- Weather widgets are currently static visual style.
- Profile sign out moved into profile hero area and includes improved click reliability handling.
- Onboarding flow is currently a single-window form (no step-based next/back flow).

Relevant files:
- [frontend/src/pages/app/Dashboard.jsx](frontend/src/pages/app/Dashboard.jsx)
- [frontend/src/pages/app/Weather.jsx](frontend/src/pages/app/Weather.jsx)
- [frontend/src/pages/app/Profile.jsx](frontend/src/pages/app/Profile.jsx)
- [frontend/src/pages/onboarding/Onboarding.jsx](frontend/src/pages/onboarding/Onboarding.jsx)
- [frontend/src/styles/globals.css](frontend/src/styles/globals.css)

## 11. Dependency Summary

Frontend dependencies (high-level):
- react, react-dom, react-router-dom
- firebase
- mapbox-gl, @mapbox/mapbox-gl-draw, @turf/turf
- vite plugin ecosystem

Source:
- [frontend/package.json](frontend/package.json)

Backend Python dependencies (high-level):
- fastapi, uvicorn
- google-genai, google-adk, google-cloud-aiplatform
- google-cloud-firestore, firebase-admin
- genkit
- pydantic
- httpx
- pytest stack

Source:
- [backend/requirements.txt](backend/requirements.txt)

## 12. Suggested Context Prompt for Another AI Chatbot

Use this exact block when bootstrapping another AI assistant:

Project context:
I am working in Future-AI-Hack, a monorepo with a React + Vite frontend and Python backends (FastAPI diagnosis service and Genkit swarm service). Frontend routes are guarded by Firebase auth and onboarding completion, with app pages for dashboard, weather, map, scanner, report, treatment, chatbot, inventory, crops, and profile. API calls are centralized through frontend/src/api/gateway.js and proxied in Vite dev config. Styling is mostly in a single global CSS file. Current state: weather animation experiments and dashboard weather test controls were removed; weather UI is static. Keep backend contracts stable unless explicitly asked.

Primary files to inspect first:
- frontend/src/app/routes.jsx
- frontend/src/api/gateway.js
- frontend/src/hooks/useSession.js
- frontend/src/pages/app/Dashboard.jsx
- frontend/src/pages/app/Weather.jsx
- frontend/src/pages/app/Profile.jsx
- frontend/src/styles/globals.css
- backend/diagnosis/README.md
- backend/diagnosis/ARCHITECTURE.md
- backend/swarm/main.py

Constraints:
- Prefer UI-only changes unless backend work is explicitly requested.
- Preserve existing API contract and route behavior.
- Keep mobile-first layout and dark mode compatibility.

## 13. What This Context Does Not Cover

This context file is repository-level and implementation-oriented. It does not include:
- complete domain logic for every endpoint implementation
- cloud deployment topology details
- full data model schema across every service file

For deeper backend internals, inspect backend service modules directly under diagnosis/services and swarm/agents.

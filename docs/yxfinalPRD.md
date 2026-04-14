📄 Product Requirements Document: PadiGuard AI
Version: 3.0 (Production-First & Agentic Swarm Edition)

Status: Finalized

1. Project Overview & Architecture
PadiGuard AI is a General Agriculture Decision Intelligence Platform. This document defines the backend intelligence layer: a Multi-Agent Swarm orchestrated via Firebase Genkit (Python SDK).

The architecture follows a "Brain & Hands" pattern:

The Brain (LLM): Uses gemini-2.0-flash to reason through biological disease vectors, financial implications, and climate risks.

The Hands (Deterministic Code): Uses @ai.tool functions to perform precise mathematical calculations (ROI, geometry parameters) and execute external integrations (MCP, Firestore, APIs).

2. Technology Stack
Orchestration: Firebase Genkit (Python SDK)

AI Model: googleai/gemini-2.0-flash

Pricing Intelligence: ManaMurah MCP (Model Context Protocol) Server

Weather Intelligence: Tomorrow.io REST API

Infrastructure: Firebase Admin SDK (Firestore, FCM, Cloud Functions)

Data Validation: Pydantic (Strongly-typed schemas)

Concurrency: asyncio for parallel agent execution

3. Strict Project Boundaries (Scope Lock)
To maintain the integrity of the existing mature codebase, the following constraints are absolute:

Backend Only: No modifications to React, Tailwind, or Mapbox frontend files.

No Node.js Changes: Existing Firebase Functions in index.js must remain untouched.

Python-Specific: All swarm logic must reside in a standalone Python service (main.py) utilizing Genkit.

No External RAG Builder Logic: RAG and image classification are treated as upstream inputs.

4. Data Architecture (Pydantic Schemas)
4.1 Orchestrator Schemas
SwarmInput: userId, gridId, lat, lng, cropType, disease, severity, severityScore, survivalProb, farmSize, treatmentPlan, wind_speed_kmh, wind_direction

SwarmOutput: weather (string), economy (string), resources (string), spatial_risk (PredictedBufferZone)

4.2 Sub-Agent Schemas
PredictedBufferZone: * base_radius_meters (int)

wind_direction_degrees (int)

wind_stretch_factor (float)

spread_rate_meters_per_day (float)

advisory_message (string)

5. Multi-Agent Specifications
5.1 Agent 1: The Meteorologist 🌦️
Role: Validates chemical application safety based on precipitation windows.

Tool (fetch_weather): Executes an HTTP GET to Tomorrow.io. Returns safeToSpray (False if rain < 4hrs) and nextClearWindow.

Flow (meteorologist_flow): LLM analyzes weather data. If rain is imminent, it generates a "DELAY" advisory.

5.2 Agent 2: The Universal Economist 💰
Role: Acts as the financial command center utilizing a production-ready MCP (Model Context Protocol) architecture.

Tool 1 (fetch_mcp_market_price): Acts as an MCP Client. Connects to a hosted ManaMurah MCP server via SSE (Server-Sent Events) using a secure HTTPS URL. Fetches current retail prices for the specific cropType.

Tool 2 (fetch_inventory_cost): Queries the user's Firestore inventory collection for the actual cost of the treatmentPlan.

Tool 3 (calculate_roi_deterministic): Strict Python Math. 1. Applies economic markdown: farmGatePrice = retailPrice * 0.45.
2. Calculates roi = ((yieldGain * survivalProb * farmGatePrice) - cost) / cost.

Flow (economist_flow): Orchestrates tools to provide a financial breakdown. It explicitly explains the retail-to-farmgate markdown to the farmer.

5.3 Agent 3: The Resource Manager 📦
Role: Manages physical stock and triggers supply chain alerts.

Tool (manage_inventory): Checks Firestore stock levels. If chemical stock < 5, triggers a Firebase Cloud Message (FCM) to the user's device.

Flow (resource_manager_flow): Summarizes inventory status and confirms if the treatment plan can be executed with current stock.

5.4 Agent 4: The Universal Spatial Propagation Agent 🗺️
Role: Predicts disease spread geometry.

Architecture Note ("Brain to Hands"): LLMs are strictly used for parameter generation. This flow calculates mathematical parameters (the "Brain") so the frontend Turf.js engine can draw the polygon.

Flow (dynamic_spatial_propagation_flow): Accepts EpidemiologistInput. Uses the following strict system prompt logic:

"You are a highly advanced Agricultural Epidemiologist Agent. A farm grid growing {input.cropType} at coordinates ({input.lat}, {input.lng}) has been infected with {input.disease} (Severity: {input.severity_score}). Current weather conditions: Wind is blowing {input.wind_speed_kmh} km/h towards the {input.wind_direction}. Calculate the epidemiological spread parameters. Rules: Dynamically analyze the biological spread vector of {input.disease} specifically affecting {input.cropType}. If it spreads via airborne spores or insects, high wind drastically increases spread rate and the wind_stretch_factor. If it is soil or water-borne, wind has less effect (stretch factor closer to 1.0). Convert the wind direction into degrees (0-360). Output the required mathematical parameters so our mapping software can draw the containment ring."

Enforcement: Output must precisely match the PredictedBufferZone schema.

6. Execution & Production Implementation
6.1 Sub-Orchestrator Logic
The master flow utilizes asyncio.gather to trigger all four agents simultaneously. This ensures the farmer receives a complete "Swarm Analysis" (Weather + Finance + Inventory + Spread) in a single request.

6.2 Production Deployment (MCP)
This implementation skips local stdio transport and targets Production (Live) environments immediately:

MCP Transport: SSE (Server-Sent Events over HTTPS).

Server Hosting: The ManaMurah MCP Server is hosted as a containerized service (e.g., Cloud Run).

Connection Logic: The Python Genkit backend connects via a secure URL (https://...) rather than a local file path.

7. Integration Contract (For Diagnostic Engine)
The following fields must be provided to this swarm by the upstream image-recognition/RAG engine:

cropType (string)

disease (string)

severityScore (0.0 - 1.0)

treatmentPlan (string)

survivalProb (float)
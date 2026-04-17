# PadiGuard AI — Yield Forecasting & Agent Coordination Plan

---

## Table of Contents

1. [Objective](#1-objective)
2. [Current Architecture (Baseline)](#2-current-architecture-baseline)
3. [New System Components](#3-new-system-components)
4. [Shared Agent Context Design](#4-shared-agent-context-design)
5. [YieldForecastAgent Design](#5-yieldforecastagent-design)
6. [SpatialPropagationAgent Fix Plan](#6-spatialpropagationagent-fix-plan)
7. [Cross-Agent Coordination Flow](#7-cross-agent-coordination-flow)
8. [Genkit Chatbot Orchestrator](#8-genkit-chatbot-orchestrator)
9. [Backend Integration Rules](#9-backend-integration-rules)
10. [Frontend Impact](#10-frontend-impact)
11. [Edge Case Handling](#11-edge-case-handling)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. Objective

Enhance the current agentic system by delivering the following improvements:

- Adding a **YieldForecastAgent**
- Fixing and strengthening the **SpatialPropagationAgent**
- Enabling **cross-agent data sharing**
- Integrating everything into the **final Genkit chatbot orchestrator**
- Ensuring **zero breaking changes** to existing frontend and APIs

---

## 2. Current Architecture (Baseline)

### Stable Components — Do Not Modify

The following components are considered stable and must not be altered:

- Diagnosis pipeline (Sequential ADK)
- Swarm orchestrator (Genkit concurrent agents)
- Firestore event loop (grid + buffer zone)
- Frontend flows:
  - **Scanner** — WebSocket
  - **Report** — Swarm trigger
  - **Dashboard** — Aggregated data
  - **Map** — `onSnapshot` real-time

> **Rule:** All new additions must be **additive only** and must not modify existing API contracts.

---

## 3. New System Components

### 3.1 YieldForecastAgent *(New)*

A new swarm agent responsible for:

- Predicting expected yield
- Estimating yield loss
- Feeding the ROI and decision layers

### 3.2 Enhanced SpatialPropagationAgent *(Fix)*

Upgraded from static, weak logic to a **disease-aware, weather-aware, dynamic propagation model**.

### 3.3 Shared Context Layer *(New)*

A lightweight **Agent Context Object** passed across agents to solve the problem of agents operating independently with no shared memory across reasoning steps.

---

## 4. Shared Agent Context Design（add on for any insufficient info only ,do not delete current data format)

### 4.1 Context Schema

```json
{
  "zone_id": "string",
  "crop_type": "paddy",
  "growth_stage": "vegetative | reproductive | maturity",

  "scan": {
    "disease": "blast",
    "severity": 0.7,
    "confidence": 0.85
  },

  "weather": {
    "rainfall": 12,
    "humidity": 85,
    "temperature": 30
  },

  "inventory": {
    "fertilizer_stock": 20,
    "pesticide_stock": 5
  },

  "economy": {
    "market_price": 1.8
  },

  "spatial": {
    "infected": true,
    "neighbor_risk": []
  },

  "yield": null
}
```

### 4.2 Key Rule

Each agent operates under the following contract:

| Step | Action |
|------|--------|
| Input | Reads from shared context |
| Processing | Performs domain-specific reasoning |
| Output | Writes results back to shared context |
| Final layer | Chatbot reads the fully merged context |

---

## 5. YieldForecastAgent Design

### 5.1 Responsibilities

**Predict:**

- `predicted_yield`
- `yield_loss_percent`
- `confidence`

**Feed into:**

- Economist agent (ROI calculations)
- Chatbot explanations

### 5.2 Logic — Phase 1 (Deterministic)

```python
base_yield = get_baseline(crop_type)

health_factor    = 1 - severity
weather_factor   = compute_weather_factor(weather)
treatment_factor = compute_treatment_factor(actions)

predicted_yield  = base_yield * health_factor * weather_factor * treatment_factor
```

### 5.3 Output Schema

```json
{
  "predicted_yield": 4.2,
  "yield_loss_percent": 30,
  "confidence": 0.82,
  "risk_factor": "fungal infection"
}
```

### 5.4 Integration Points

**File location:**

```
backend/swarm/agents/yield_forecast.py
```

**Register in** `backend/swarm/main.py`:

```python
asyncio.gather(
    meteorologist_flow(...),
    economist_flow(...),
    resource_manager_flow(...),
    spatial_flow(...),
    yield_forecast_flow(...)   # <-- Add here
)
```

---

## 6. SpatialPropagationAgent Fix Plan

### 6.1 Current Problem

| Limitation | Description |
|------------|-------------|
| No spread modelling | Lacks real disease-based propagation logic |
| Static buffer zones | No dynamic adjustment based on conditions |
| No weather influence | Ignores environmental factors |

### 6.2 Upgrade Logic

**Inputs:**

- Disease type
- Severity
- Humidity
- Wind *(optional)*
- Grid density

### 6.3 Spread Formula

```python
spread_radius = base_radius * severity * humidity_factor * wind_factor
```

### 6.4 Output Schema

```json
{
  "predicted_spread_radius_km": 1.8,
  "at_risk_zones": ["grid_12", "grid_13"],
  "risk_level": "high"
}
```

### 6.5 Cloud Function Alignment

The following functions must **not** be modified:

- `updateGridStatus`
- `spatialPropagationAnalysis`

Instead, extend their responses by adding **optional fields**:

```json
{
  "predictedSpreadRadius": 1.8,
  "riskLevel": "high"
}
```

---

## 7. Cross-Agent Coordination Flow

### 7.1 Execution Order

| Step | Agent | Writes to Context |
|------|-------|-------------------|
| 1 | Diagnosis | `context.scan` |
| 2 | Meteorologist | `context.weather` |
| 3 | Spatial Agent | `context.spatial` |
| 4 | Yield Agent | `context.yield` |
| 5 | Economist | Reads yield, price, cost → ROI |

### 7.2 Data Dependency Graph

```
Scan ──→ Spatial ──→ Yield ──→ Economist
              ↑          ↑
           Weather ───────
```

---

## 8. Genkit Chatbot Orchestrator

### 8.1 Role

The chatbot acts as the **central reasoning engine (GLM)**, converting the merged agent context into a final, human-readable response.

### 8.2 Orchestration Flow

```
User Query
    ↓
gemini Intent Detection
    ↓
Trigger Relevant Agents
    ↓
Merge Context
    ↓
Generate Response
```

### 8.3 Example Queries and Data Sources

| User Query | Context Fields Used |
|------------|---------------------|
| "Will my yield drop?" | `yield`, `weather`, `scan` |
| "Should I spray now?" | `scan`, `weather`, `inventory`, `ROI` |
| "Which zone is most at risk?" | `spatial`, `yield`, `weather` |

---

## 9. Backend Integration Rules

### 9.1 Do Not Modify

- Existing API routes
- Existing response formats
- Frontend contracts

### 9.2 Permitted Additions

- New agent files
- New optional fields on existing responses
- New internal context layer

### 9.3 Safe Extension Pattern

```python
result["yield"] = yield_output  # optional field — frontend ignores unknown fields
```

> **Note:** Frontend clients safely ignore unknown fields, so adding optional output fields carries zero risk of breakage.

---

## 10. Frontend Impact

No breaking changes are required. The following optional enhancements may be implemented in future iterations:

| Component | Optional Enhancement |
|-----------|----------------------|
| Dashboard | Display predicted yield |
| Report | Include yield loss insight |
| Map | Colour zones by yield loss percentage |

---

## 11. Edge Case Handling

| Scenario | Handling Strategy |
|----------|-------------------|
| Missing input data | Apply fallback defaults |
| Low confidence scan | Return a yield range: `"predicted_yield_range": [3.5, 5.0]` |
| Agent API failure | Isolate the failing agent and continue remaining agents |

---

## 12. Implementation Phases

### Phase 1 — Core

- [ ] Add `YieldForecastAgent`
- [ ] Apply basic `SpatialPropagationAgent` fix
- [ ] Implement shared `AgentContext` layer

### Phase 2 — Integration

- [ ] Connect yield output to ROI (Economist agent)
- [ ] Connect yield and spatial outputs to Genkit chatbot

### Phase 3 — Advanced

- [ ] Replace deterministic yield model with ML-based model
- [ ] Incorporate wind-based spatial spread
- [ ] Add confidence intervals to yield predictions

---

*Document version: 1.0 — PadiGuard AI Engineering Team*
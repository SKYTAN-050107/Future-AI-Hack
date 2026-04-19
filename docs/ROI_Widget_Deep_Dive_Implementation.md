# ROI Widget + Deep Dive Pages Implementation Spec (Repository-Grounded)

## Goal

Implement the requested Home financial widget improvements and deep-dive navigation while keeping implementation strictly within current repository capabilities and without backend changes.

## Hard Constraints

- No backend code or API contract changes.
- No backend logic changes (diagnosis, treatment, swarm orchestration, pricing, forecasting, or data-processing behavior).
- Do not change unrelated pages or shared behavior outside the targeted dashboard/treatment additions.
- Reuse existing frontend API clients, state hooks, and cache utilities.

## Implementation Boundary (Frontend + Connections Only)

This scope is strictly limited to:

1. Frontend page/layout/component updates.
2. Frontend route additions and navigation wiring.
3. Frontend connection wiring to existing endpoints/actions already exposed in the project.

This scope explicitly excludes:

1. Backend service logic updates.
2. New backend endpoints.
3. Changes to backend formulas, ranking, treatment recommendation logic, or forecast internals.

## Current System Reality (Verified)

### Existing pages and routes

- Existing combined page: `/app/treatment` (currently includes treatment inputs, yield forecast pull, ROI output, and breakdown).
- No existing `/app/roi` route.
- No existing `/app/treatment-plan` route.
- No existing `/app/yield-prediction` route.

### Existing APIs already available to frontend

- `POST /api/treatment`
  - Returns treatment recommendation and economic output including `recommendation`, `organic_alternative`, `estimated_cost_rm`, `expected_gain_rm`, `profit_rm`, `roi_percent`, inventory/labor/other cost breakdown, pricing metadata.
- `POST /api/dashboard/summary`
  - Returns `financialSummary`, `zoneHealthSummary`, `weatherSnapshot`.
- `GET /api/crops`, `GET /api/crops/{id}`
  - Returns crop profile including expected yield, area, status, labor/other costs, inventory usage links.
- Swarm action execution through `/swarm-api/*` proxy
  - Existing usage pattern resolves `swarm_orchestrator` and reads `yield_forecast` payload.

Connection rule:

- Frontend may only call the above already-existing APIs/actions and consume their current response fields.

## Feasibility Matrix (No Backend Changes)

1. Home widget with 3 CTA buttons: Feasible.
2. ROI Deep Dive page: Feasible by reusing existing `/app/treatment` logic and optionally aliasing a new route.
3. New Treatment Plan page: Feasible as new frontend page using existing treatment response fields.
4. New Yield Prediction page: Feasible as new frontend page using existing swarm `yield_forecast` fields.
5. Additional "historical" or multi-scenario forecasting from backend: Not feasible without new backend/model support.

## Route Strategy (Two New Pages + Compatibility)

Create exactly two new routes/pages and keep current combined behavior compatible:

- Keep `/app/treatment` as the existing full ROI-capable page (backward compatibility).
- Add `/app/treatment-plan` as new page (new #1).
- Add `/app/yield-prediction` as new page (new #2).
- Optional: add `/app/roi` alias to render the same component as `/app/treatment` for naming clarity.

This satisfies the "two new pages" request while preserving existing flows.

## Home Financial Widget Changes

### Widget intent

Upgrade current financial card into a compact command center summary with three navigations:

1. Treatment Plan Deep Dive -> `/app/treatment-plan`
2. ROI Deep Dive -> `/app/treatment` (or `/app/roi` alias if added)
3. Yield Prediction -> `/app/yield-prediction`

### Summary content (strictly from existing data)

1. ROI summary
  - `financialSummary.roiPercent`
  - `financialSummary.projectedRoiValueRm`
  - `financialSummary.projectedYieldGainRm`
  - `financialSummary.treatmentCostRm`
2. Treatment summary
  - Last computed treatment recommendation from cached treatment ROI snapshot (`recommendation`, `estimated_cost_rm`, `roi_note`).
  - If no snapshot: fallback message with CTA to compute from Treatment page.
3. Yield summary
  - `yield_forecast.predicted_yield_kg`
  - `yield_forecast.confidence`
  - `yield_forecast.yield_loss_percent`
  - If swarm inputs are incomplete: show explicit missing-context guidance (crop/map/latest scan).

## ROI Deep Dive (Existing Treatment Page Reorder)

### Required layout change

On the current treatment page implementation, reorder sections to:

1. Inputs and assumptions (crop, sales channel, costs, yield controls)
2. Revenue and cost metrics tiles
3. Breakdown details (pricing, costs, inventory details, profit)
4. Suggested plan content
5. Live ROI panel at bottom

### Behavior to preserve

- Existing Save-to-recalculate behavior.
- Existing treatment form snapshot and ROI snapshot cache writes.
- Existing yield forecast auto-fill rules (manual input has priority).

## New Page: Treatment Plan Deep Dive

### Purpose

Focus on operational treatment guidance separated from ROI-heavy reading.

### Data sources (existing only)

- `POST /api/treatment` response:
  - `recommendation`
  - `organic_alternative`
  - `estimated_cost_rm`
  - `inventory_cost_rm`, `inventory_breakdown`
  - `labor_cost_rm`, `other_costs_rm`
  - `selling_channel`, `market_condition`

### Mandatory sections

1. Recommended treatment summary
2. Alternative approach (organic alternative)
3. Operational cost composition (inventory/labor/other)
4. Inventory usage detail list
5. Action area (go to ROI page, go to inventory page)

## New Page: Yield Prediction

### Purpose

Isolate forecast interpretation and confidence context.

### Data sources (existing only)

- Swarm orchestrator result block:
  - `yield_forecast.predicted_yield_kg`
  - `yield_forecast.yield_loss_percent`
  - `yield_forecast.confidence`
- Existing request context from current treatment/report patterns:
  - user id, grid id, crop type, disease, severity, survival probability, farm size, treatment plan, centroid lat/lng.

### Mandatory sections

1. Predicted yield headline
2. Confidence and projected loss context
3. Input readiness checklist (what is missing when forecast cannot run)
4. Source transparency (scan-derived vs manual override relationship)
5. Action area (open Treatment ROI page)

## System-Capable but Currently Under-Displayed (Include in New Pages)

The current system already exposes these fields and they should be surfaced in the new page designs:

1. Pricing context from treatment response
  - `retail_price_rm_per_kg`, `farm_price_rm_per_kg`, `price_date`, `used_manual_price_override`.
2. Profitability details
  - `profit_rm`, `roi_percent`, `roi_note`.
3. Inventory cost traceability
  - `inventory_breakdown[]` line-level quantity, unit cost, line cost.
4. Commercial assumptions
  - `selling_channel`, `market_condition`.
5. Crop economic context
  - crop-level `labor_cost_rm`, `other_costs_rm`, `expected_yield_kg`, `area_hectares`, `status`.
6. Dashboard-level risk signal
  - low-stock warning in `financialSummary.lowStockItem` and `financialSummary.lowStockLiters`.

## Explicitly Not Feasible Without Backend Changes

1. True historical yield trend chart based on stored forecast history.
2. Multi-scenario simulation endpoint (best/base/worst generated server-side).
3. Explanatory factor decomposition model for yield confidence beyond current returned values.
4. New economic KPIs that are not derivable from existing response fields.
5. Any request that requires changing backend business logic.

## UI and Motion Direction (Scoped)

Apply improvements only to new/targeted financial, treatment-plan, and yield-prediction surfaces:

1. Clear card hierarchy and stronger section headers.
2. Better contrast in both themes using existing design tokens.
3. More apparent hover/tap states on interactive cards and CTA buttons.
4. Entrance stagger for summary rows/cards with reduced-motion fallback.

Do not alter global behavior of unrelated pages.

## Implementation Plan (Frontend-Only)

1. Routing
  - Add routes for `/app/treatment-plan` and `/app/yield-prediction`.
  - Optionally add `/app/roi` alias to current treatment component.
2. Dashboard widget
  - Expand financial widget content blocks and add 3 CTA buttons.
  - Keep fallback states for missing snapshot/swarm contexts.
3. ROI page reorder
  - Reorder existing treatment sections only; preserve API/state logic.
4. New Treatment Plan page
  - Render from existing treatment response/cache data.
5. New Yield Prediction page
  - Reuse existing swarm forecast request pattern and state handling.
6. Styling
  - Add scoped classes for these pages/components only.

## Acceptance Criteria

1. Home widget has 3 functional buttons and shows compact ROI/treatment/yield summaries.
2. `/app/treatment-plan` and `/app/yield-prediction` pages exist and render meaningful data from current APIs.
3. Existing `/app/treatment` core calculations and cache behavior remain functional.
4. No backend files are modified.
5. No backend logic behavior is changed.
6. No regressions on unrelated pages.
7. Frontend production build passes.

## Backend Safety Gate (Must Pass)

Before merge, verify:

1. No edits under `backend/`.
2. No API contract changes (request/response schema) in backend models or router definitions.
3. All changes are limited to frontend UI, routes, and existing connection usage.

## Validation Checklist

1. Route smoke test for:
  - `/app/treatment`
  - `/app/treatment-plan`
  - `/app/yield-prediction`
2. Dashboard financial widget interactions navigate correctly.
3. Treatment recalculation still updates dashboard snapshot values.
4. Yield prediction page handles missing prerequisites with user-readable guidance.
5. `npm --prefix frontend run build` succeeds.

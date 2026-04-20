# PadiGuard Diagnosis Architecture

This document describes the current implementation in `backend/diagnosis`.

## 1) Architecture Summary

The service is organized as a FastAPI edge layer with domain services and a shared scan pipeline.

- Scan pipeline: crop image region to embedding to vector match to diagnosis result.
- Assistant paths: diagnosis-aware replies for image and text flows.
- Agronomy/business paths: weather, treatment ROI, inventory, dashboard summary.
- Persistence: Firestore for scan records, grid data, and inventory.

## 2) Runtime Topology

```text
Frontend
  |- HTTP /health
  |- HTTP /api/*
  |- WS   /ws/scan
  v
FastAPI Router (api/router.py)
  |- Scan routes
  |- Assistant routes
  |- Weather/treatment/inventory/dashboard routes
  v
Domain Services
  |- LiveScanPipeline (ADK orchestration)
  |- WeatherService (Tomorrow.io)
  |- TreatmentService (MCP + inventory + weather)
  |- InventoryService (Firestore)
  |- DashboardService (aggregates weather + grid + ROI + stock)
  |- AssistantMessageService (scan-history aware text reply)
  v
External Systems
  |- Vertex AI embeddings + vector search
  |- Firestore
  |- Tomorrow.io
  |- MCP market-price endpoint
```

## 3) API Surface

Scanner and assistant:

- `POST /api/scan`
- `POST /api/assistant/scan`
- `POST /api/assistant/scan-multi`
- `POST /api/assistant/message`
- `WS /ws/scan`

Agronomy and business:

- `GET /api/weather`
- `POST /api/treatment`
- `GET /api/inventory`
- `PATCH /api/inventory/{item_id}`
- `POST /api/dashboard/summary`

System:

- `GET /health`

## 4) Scan Pipeline Behavior

For each region:

1. Decode/capture image payload.
2. Generate embedding.
3. Search nearest candidates in vector index.
4. Build diagnosis from candidate + metadata.
5. Return normalized response and optional persistence for abnormal results.

WebSocket mode processes all regions concurrently and returns one `ScanResponse` per frame.

## 5) Domain Service Responsibilities

- `services/weather_service.py`: weather normalization and spray-window forecast.
- `services/treatment_service.py`: treatment recommendation and ROI calculations.
- `services/inventory_service.py`: user inventory listing and quantity patch.
- `services/dashboard_service.py`: combines weather, zone health, and financial summary.
- `services/assistant_message_service.py`: text assistant reply from persisted scan history.

## 6) Data Contracts

Contracts are defined in `models/scan_models.py` and include:

- Scan frame/region/result models for WS.
- HTTP scan and assistant request/response models.
- Weather, treatment, inventory, and dashboard models.
- Assistant text message request/response models.

## 7) Configuration and Dependencies

Configuration source:

- `config/settings.py` (Pydantic settings)

Key runtime variables:

- Google/Vertex: `GCP_PROJECT_ID`, `GCP_REGION`, `VECTOR_SEARCH_INDEX_ENDPOINT`, `VECTOR_SEARCH_DEPLOYED_INDEX_ID`
- Firestore: `FIRESTORE_GRID_COLLECTION`, `FIRESTORE_REPORT_COLLECTION`, `FIRESTORE_CANDIDATE_COLLECTION`
- External APIs: `TOMORROW_IO_API_KEY`, `TOMORROW_IO_BASE_URL`, `MCP_SERVER_URL`

Primary frameworks:

- FastAPI + Uvicorn
- Google ADK
- Vertex AI
- Firestore
- httpx

## 8) Local Development Integration

Frontend development can run against this backend through one command from `frontend`:

```bash
npm run dev:full
```

Vite proxies `/api`, `/health`, and `/ws` to the diagnosis backend target, keeping frontend requests same-origin.

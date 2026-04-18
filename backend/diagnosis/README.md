# PadiGuard Diagnosis Backend

FastAPI backend for crop diagnosis, assistant responses, weather intelligence, treatment ROI, inventory, and dashboard aggregation.

## Runtime Surface

HTTP routes:

- `GET /health`
- `POST /api/scan`
- `POST /api/assistant/scan`
- `POST /api/assistant/scan-multi`
- `POST /api/assistant/message`
- `GET /api/weather`
- `GET /api/v1/weather`
- `POST /api/treatment`
- `POST /api/inventory`
- `POST /api/v1/inventory`
- `GET /api/inventory`
- `GET /api/v1/inventory`
- `PATCH /api/inventory/{item_id}`
- `PATCH /api/v1/inventory/{item_id}`
- `GET /api/zones`
- `GET /api/zones/summary`
- `GET /api/v1/zones/summary`
- `POST /api/dashboard/summary`

WebSocket route:

- `WS /ws/scan`

## Diagnosis Pipeline

Each crop region is processed through the same ADK pipeline:

1. `CropEmbedAgent`: image region to embedding.
2. `VectorMatchAgent`: embedding to nearest candidates from Vector Search.
3. `ReasoningAgent`: top candidate enrichment and diagnosis shaping.

The REST and WebSocket scanner routes both use this pipeline.

## Assistant Flows

- `POST /api/assistant/scan`: photo diagnosis plus generated assistant reply.
- `POST /api/assistant/scan-multi`: multi-region photo diagnosis and consolidated reply.
- `POST /api/assistant/message`: text-only assistant message based on real scan history.

## Agronomy and Business Flows

- `GET /api/weather`: forecast and spray advisory from Tomorrow.io.
- `POST /api/treatment`: treatment recommendation and ROI from market + inventory + weather context.
- `GET /api/inventory`: user inventory from Firestore.
- `PATCH /api/inventory/{item_id}`: update inventory quantity.
- `POST /api/dashboard/summary`: aggregated weather, zone health, and financial summary.

## Key Configuration

Primary settings are in `config/settings.py`.

Core:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `VECTOR_SEARCH_INDEX_ENDPOINT`
- `VECTOR_SEARCH_DEPLOYED_INDEX_ID`

Firestore:

- `FIRESTORE_GRID_COLLECTION`
- `FIRESTORE_REPORT_COLLECTION`
- `FIRESTORE_CANDIDATE_COLLECTION`
- `FIRESTORE_PESTICIDE_COLLECTION`

External services:

- `TOMORROW_IO_API_KEY`
- `TOMORROW_IO_BASE_URL`
- `MCP_SERVER_URL`

## Local Run

Backend only:

```bash
cd backend/diagnosis
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Frontend + backend one command (from frontend workspace):

```bash
cd frontend
npm run dev:full
```

This runs Vite and diagnosis backend together; Vite proxies `/api`, `/health`, and `/ws` to the backend target.

## Firestore Candidate Metadata Upload

Use this script to upload candidate metadata referenced by vector IDs:

```bash
cd backend/diagnosis
python scripts/upload_candidate_metadata.py --input ../../my_metadata.json
```

Optional flags:

- `--collection candidateMetadata`
- `--id-field id`
- `--dry-run`

## Pesticide Catalog Priority

Photo diagnosis treatment guidance now resolves pesticide recommendations in this order:

1. `pesticideCatalog` in Firestore (configurable by `FIRESTORE_PESTICIDE_COLLECTION`).
2. Diagnosis fallback guidance from pipeline defaults when no catalog match is found.

When a catalog match exists, the scan result includes:

- `recommendedPesticides`
- `recommendationSource` (`pesticideCatalog`)
- `matchedPestName`

The `/api/scan` and `/api/assistant/scan` responses expose these fields so frontend and assistant layers can keep recommendations consistent.

To import or refresh the catalog from CSV:

```bash
cd backend/diagnosis
python scripts/import_pesticide_catalog.py --input gs://disease_dataset_pd/Pesticide_Dataset/Pesticides.csv
```

## Module Layout

```text
backend/diagnosis/
├── main.py
├── api/router.py
├── config/settings.py
├── models/scan_models.py
├── orchestration/pipeline.py
├── services/
│   ├── weather_service.py
│   ├── treatment_service.py
│   ├── inventory_service.py
│   ├── dashboard_service.py
│   └── assistant_message_service.py
└── tests/
```

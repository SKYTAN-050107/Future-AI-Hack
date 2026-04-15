# PadiGuard AI Diagnosis Backend

实时病虫害诊断后端（FastAPI + Google ADK + Vertex AI），通过 `WS /ws/scan` 接收前端裁剪图并返回结构化诊断结果。

## Current Diagnosis Flow (最新)

每个 region 走同一条 ADK 顺序流水线：

1. `CropEmbedAgent`：base64 图像解码 -> Vertex AI Multimodal Embedding（1408 维）
2. `VectorMatchAgent`：Vertex AI Vector Search Top-K 检索 + 置信度阈值过滤
3. `ReasoningAgent`：使用最高分候选 `id` 到 Firestore 查询 `cropType`/`disease` 后生成最终诊断

> 当前主路径是 **Vector-first, Firestore-enriched**。`services/llm_service.py` 存在但不在这条线上被调用。

## Runtime Architecture

```text
Frontend (MediaPipe bbox + crop b64)
        |
        |  WS /ws/scan
        v
FastAPI Router
  - parse ScanFrame
  - concurrent per-region pipeline
        |
        v
LiveScanPipeline (Google ADK SequentialAgent)
  CropEmbed -> VectorMatch -> Reasoning
        |
        v
ScanResponse (frame_number + results[])
        |
        +--> if is_abnormal: Firestore scanReports + grids update
```

## WebSocket Contract

### Client -> Server (`ScanFrame`)

```json
{
  "grid_id": "section_A1",
  "frame_number": 120,
  "regions": [
    {
      "cropped_image_b64": "...",
      "bbox": {
        "x": 0.1,
        "y": 0.2,
        "width": 0.3,
        "height": 0.4,
        "mediapipe_label": "leaf",
        "detection_score": 0.9
      }
    }
  ]
}
```

### Server -> Client (`ScanResponse`)

```json
{
  "frame_number": 120,
  "results": [
    {
      "cropType": "Rice",
      "disease": "Rice Blast",
      "severity": "Moderate",
      "severityScore": 0.91,
      "treatmentPlan": "Reference image: gs://...",
      "survivalProb": 0.6,
      "is_abnormal": true,
      "bbox": {
        "x": 0.1,
        "y": 0.2,
        "width": 0.3,
        "height": 0.4,
        "mediapipe_label": "leaf",
        "detection_score": 0.9
      }
    }
  ]
}
```

## Key Env Variables

`config/settings.py` 当前依赖：

- `GCP_PROJECT_ID`
- `GCP_REGION` (default: `us-central1`)
- `GOOGLE_APPLICATION_CREDENTIALS` (optional string path, but usually needed for local run)
- `VECTOR_SEARCH_INDEX_ENDPOINT`
- `VECTOR_SEARCH_DEPLOYED_INDEX_ID`
- `VECTOR_SEARCH_CONFIDENCE_THRESHOLD` (default `0.65`)
- `VECTOR_SEARCH_FAST_MATCH_THRESHOLD` (default `0.85`)
- `FIRESTORE_GRID_COLLECTION` (default `grids`)
- `FIRESTORE_REPORT_COLLECTION` (default `scanReports`)
- `FIRESTORE_CANDIDATE_COLLECTION` (default `candidateMetadata`，文档 ID 需等于 Vector candidate id)
- `DEFAULT_TOP_K` (default `5`)

## Local Run

```bash
cd backend/diagnosis
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /health`

## Upload Metadata To Firestore

When ReasoningAgent receives a Vector Search candidate id, it reads diagnosis labels from Firestore.
You can bulk upload your metadata JSON/JSONL file with:

```bash
cd backend/diagnosis
python scripts/upload_candidate_metadata.py --input ../../my_metadata.json
```

Optional flags:

- `--collection candidateMetadata` (default from `.env` -> `FIRESTORE_CANDIDATE_COLLECTION`)
- `--id-field id` (field used as Firestore document id)
- `--dry-run` (validate without writing)

Required data rule:

- Every item must include `id`, and that value must match Vector Search neighbor id.

## Project Structure (Diagnosis Module)

```text
backend/diagnosis/
├── main.py
├── api/router.py
├── orchestration/pipeline.py
├── agents/
│   ├── crop_embed_agent.py
│   ├── vector_match_agent.py
│   └── reasoning_agent.py
├── services/
│   ├── embedding_service.py
│   ├── vector_search_service.py
│   ├── firestore_service.py
│   └── llm_service.py
├── models/
│   ├── scan_models.py
│   └── candidate.py
├── config/settings.py
└── tests/test_pipeline.py
```

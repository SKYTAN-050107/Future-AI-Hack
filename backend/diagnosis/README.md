# PadiGuard AI — Live-Scan Backend

**Google ADK + Vertex AI** real-time plant disease scanner.

---

## Architecture

```
Phone Camera (30fps)
    │
    ▼
MediaPipe (on-device) → bounding boxes (< 50ms)
    │
    │  every 10th frame → crop each box → base64 → WebSocket
    ▼
┌──────────── Cloud Run (this backend) ────────────────────┐
│  WS /ws/scan                                             │
│                                                          │
│  Google ADK SequentialAgent (per region, concurrent):     │
│    ① CropEmbedAgent  → Vertex AI Embedding (1408-dim)    │
│    ② VectorMatchAgent → Vertex AI Vector Search          │
│    ③ ReasoningAgent   → fast-path or Vertex AI Gemini    │
│                                                          │
│  Response: [{label, confidence, bbox, severity}, ...]    │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Frontend overlays labels on bounding boxes
If abnormal → Firestore → Cloud Function grid propagation
```

---

## Google Cloud Stack

| Component | Service |
|---|---|
| Agent Orchestration | **Google ADK** SequentialAgent |
| Feature Extraction | **Vertex AI** Multimodal Embedding (1408-dim) |
| Vector Database | **Vertex AI** Vector Search |
| Reasoning LLM | **Vertex AI** Gemini 2 Flash |
| Real-time Sync | **Cloud Firestore** |
| Compute | **Cloud Run** |

---

## Project Structure

```
backend/diagnosis/
├── main.py                        FastAPI entry point
├── requirements.txt               Dependencies
├── .env.example                   Environment template
│
├── agents/                        Google ADK BaseAgent sub-agents
│   ├── base_agent.py              ADK BaseAgent re-export
│   ├── crop_embed_agent.py        base64 → Vertex AI 1408-dim embedding
│   ├── vector_match_agent.py      Vertex AI Vector Search + confidence gate
│   └── reasoning_agent.py         fast-path or Vertex AI Gemini Flash
│
├── orchestration/
│   └── pipeline.py                ADK SequentialAgent (LiveScanPipeline)
│
├── api/
│   └── router.py                  WS /ws/scan endpoint
│
├── services/
│   ├── embedding_service.py       Vertex AI Multimodal Embedding
│   ├── vector_search_service.py   Vertex AI Vector Search queries
│   ├── llm_service.py             Vertex AI Gemini 2 Flash
│   └── firestore_service.py       Cloud Firestore write-back
│
├── models/
│   ├── scan_models.py             BoundingBox, ScanFrame, ScanResult
│   └── candidate.py               RetrievalCandidate
│
└── config/
    └── settings.py                Pydantic Settings / env loader
```

---

## WebSocket Protocol

### `WS /ws/scan`

**Client → Server:**
```json
{
  "grid_id": "grid_abc",
  "frame_number": 42,
  "regions": [
    {
      "cropped_image_b64": "/9j/4AAQ...",
      "bbox": {"x": 0.1, "y": 0.3, "width": 0.2, "height": 0.3,
               "mediapipe_label": "leaf", "detection_score": 0.9}
    }
  ]
}
```

**Server → Client:**
```json
{
  "frame_number": 42,
  "results": [
    {
      "label": "Rice Blast",
      "confidence": 0.94,
      "reason": "High-confidence Vertex AI Vector Search match.",
      "severity": "critical",
      "is_abnormal": true,
      "bbox": {"x": 0.1, "y": 0.3, "width": 0.2, "height": 0.3,
               "mediapipe_label": "leaf", "detection_score": 0.9},
      "alternatives": ["Brown Spot"]
    }
  ]
}
```

---

## Two Speed Paths

| Path | When | Latency | Gemini Call |
|---|---|---|---|
| **Fast** | Vector Search score ≥ 0.85 | ~100ms | ❌ Skipped |
| **LLM** | Score < 0.85 | ~300ms | ✅ Gemini Flash |

---

## Setup (You Handle)

1. **Vertex AI Vector Search** — embed reference images → deploy streaming index
2. **Cloud Firestore** — `grids` + `scanReports` collections
3. **`.env`** — copy `.env.example`, fill in your GCP values
4. **Frontend MediaPipe** — on-device detection → crops → WebSocket
5. `pip install -r requirements.txt`
6. `uvicorn main:app --reload --host 0.0.0.0 --port 8000`

---

*Built on Google ADK + Vertex AI for Future-AI-Hack*

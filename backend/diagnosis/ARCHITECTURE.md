# 🌾 PadiGuard AI — Live-Scan Backend Documentation

## 1. 🏗 System Architecture Overview

PadiGuard AI uses a **Parallel-Stream "Vector-First"** architecture designed for low-latency, real-time crop disease scanning. It moves away from static image uploads to a continuous live-stream processing model.

### The Three Layers
*   **Layer 1: The BOX (On-Device)**
    *   Powered by **MediaPipe** (JavaScript) running on the mobile browser.
    *   Detects plants/leaves and renders "ghost" bounding boxes locally in **< 50ms**.
*   **Layer 2: The VECTOR (Cloud Run)**
    *   Powered by **Google ADK** (Agent Development Kit) and **Vertex AI**.
    *   Processes cropped regions every 10 frames via WebSocket.
    *   Matches visual patterns against a vector index in **< 300ms**.
*   **Layer 3: The DISPLAY (WebSocket)**
    *   Pushes labels (e.g., "Rice Blast", "Healthy") back to the phone.
    *   Syncs results to **Cloud Firestore** to trigger spatial risk propagation.

---

## 2. 🤖 Agentic Pipeline (Google ADK)

The backend logic is orchestrated by a **SequentialAgent** pipeline that ensures high-performance multimodal analysis.

| Agent | Responsibility | AI Model / Service |
| :--- | :--- | :--- |
| **CropEmbedAgent** | Decodes base64 crops into raw bytes and generates a feature vector. | `multimodalembedding@001` (1408-dim) |
| **VectorMatchAgent** | Queries the vector database to find the "closest" matching disease photos. | **Vertex AI Vector Search** |
| **ReasoningAgent** | Decides on the final label. Uses a "Fast Path" if confidence is high. | **Gemini 2.0 Flash** |

### ⚡ Two Speed Paths
1.  **Fast Path (Vector-Direct):** If the vector search similarity is **≥ 0.85**, the system assigns the label immediately without calling the LLM. (~100ms)
2.  **LLM Path (Reasoned):** If lower confidence, **Gemini 2.0 Flash** analyzes the candidates to provide a final diagnosis and reasoning. (~300ms)

---

## 3. 🛠 Google Cloud Tech Stack

The system is built natively on Google Cloud to ensure maximum reliability and speed.

| Component | GCP Service | Role |
| :--- | :--- | :--- |
| **Orchestration** | **Google ADK** | Manages the multi-agent session state and flow. |
| **Intelligence** | **Gemini 2.0 Flash** | Multimodal reasoning and fallback validation. |
| **Identity** | **Vertex AI Vector Search** | High-speed similarity matching for diseases. |
| **Embeddings** | **Multimodal Embedding API** | Converts pixels into mathematical vectors. |
| **Real-time DB** | **Cloud Firestore** | Stores scan history and triggers grid health updates. |
| **Execution** | **Cloud Run** | Serverless hosting for the Python/FastAPI backend. |

---

## 🔌 4. WebSocket Protocol (`WS /ws/scan`)

The system communicates over a high-speed WebSocket protocol using structured JSON.

### Inbound Frame (`ScanFrame`)
The frontend sends multiple cropped regions from a single camera frame.
```json
{
  "grid_id": "section_A1",
  "frame_number": 120,
  "regions": [
    {
      "cropped_image_b64": "...", 
      "bbox": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 }
    }
  ]
}
```

### Outbound Result (`ScanResponse`)
The server returns labels for each region.
```json
{
  "frame_number": 120,
  "results": [
    {
      "label": "Rice Blast",
      "confidence": 0.92,
      "severity": "critical",
      "is_abnormal": true,
      "reason": "Visual match with BPH nymph clusters found in ref DB."
    }
  ]
}
```

---

## 🔄 5. Firestore & Grid Propagation

When an **abnormal result** (Disease/Pest) is confirmed:
1.  **`record_scan_result`**: Backend writes a detailed report to the `scanReports` collection.
2.  **Health State Transition**: This triggers the existing Cloud Function to set the associated **GridID** to `Infected`.
3.  **Spatial Analysis**: Neighboring grids within 200m are automatically flagged as `At-Risk` via the spatial propagation engine.

---

## 🚀 6. Setup Requirements

To deploy this module, ensure the following are configured in your GCP project:
1.  **Vector Search Index**: Created using 1408-dimension multimodal vectors.
2.  **Firestore Collections**: `grids` and `scanReports` collections defined with appropriate indexes.
3.  **Authentication**: Service Account JSON with `Vertex AI Administrator` and `Cloud Datastore User` roles.
4.  **Environment**: Fill in the `.env` file with your `GCP_PROJECT_ID` and `VECTOR_SEARCH_INDEX_ENDPOINT`.

---
*Built for Future-AI-Hack | Empowering Malaysian Padi Farmers*

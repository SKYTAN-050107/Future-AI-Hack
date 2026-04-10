# PadiGuard AI — Multi-Agent Plant Diagnosis

PadiGuard AI is a modular, schema-free backend system designed for accurate plant disease diagnosis. It utilizes a sophisticated multi-agent pipeline powered by **Google Agent Development Kit (ADK)** and **Vertex AI**.

## 🏗 System Architecture

The system follows a strict sequential multi-agent orchestration pattern. Every request flows through five specialized agents:

1.  **Planner Agent**: Inspects the input (image/text) and determines the execution strategy (input type and top-k retrieval parameters).
2.  **Embedding Agent**: Handles image uploads to Google Cloud Storage (GCS) and generates a 1408-dimensional multimodal embedding vector using Vertex AI.
3.  **Retrieval Agent**: Performs a top-k vector similarity search against a Vertex AI Vector Search index to find candidate diagnoses.
4.  **Validation Agent**: Uses **Gemini 2 Flash** to cross-reference the user's input against retrieved candidates for semantic relevance and reasoning.
5.  **Aggregator Agent**: Assembles the final structured JSON response with confidence scores and alternatives.

## 🛠 Tech Stack

*   **Framework**: FastAPI
*   **Orchestration**: Google Agent Development Kit (ADK)
*   **AI Models**: Gemini 2 Flash, Multimodal Embedding (Vertex AI)
*   **Infrastructure**: Vertex AI Vector Search, Google Cloud Storage (GCS)
*   **Language**: Python 3.10+

## 📁 Project Structure

```text
backend/diagnosis/
├── agents/             # ADK-based sub-agents
│   ├── base_agent.py   # ADK BaseAgent re-export
│   ├── planner.py
│   ├── embedding.py
│   ├── retrieval.py
│   ├── validation.py
│   └── aggregator.py
├── api/                # API Routing layer
├── config/             # Settings and environment config
├── models/             # Pydantic request/response schemas
├── orchestration/      # ADK SequentialAgent & Runner setup
├── services/           # Low-level Google Cloud SDK wrappers
├── main.py             # Entrypoint
└── requirements.txt
```

## 🚀 Getting Started

### 1. Installation

```bash
pip install -r requirements.txt
```

### 2. Configuration

Copy `.env.example` to `.env` and fill in your Google Cloud credentials:

```bash
GCP_PROJECT_ID="your-project"
GCP_REGION="us-central1"
GCS_BUCKET_NAME="your-bucket"
# ... other Vertex AI parameters
```

### 3. Running Locally

```bash
uvicorn main:app --reload
```

## 📡 API Reference

### POST `/analyze`

Analyzes a plant image and/or text description.

**Request**: `multipart/form-data`
*   `image`: (Optional) File
*   `text`: (Optional) String

**Response**:
```json
{
  "result": "Bacterial Leaf Blight",
  "confidence": 0.95,
  "reason": "The visual patterns and symptoms described perfectly match...",
  "alternatives": ["Leaf Smut"]
}
```

---
*Developed for Future-AI-Hack*

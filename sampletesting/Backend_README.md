# PadiGuard AI Backend README

## Overview

PadiGuard AI Backend 是一个多模块、多Agent的农业AI诊断与决策系统。由两个主要核心组成：
1. **Diagnosis Module** - 实时植物病害识别诊断
2. **Swarm Module** - 多Agent农业决策编排

系统采用 **Google ADK + Vertex AI + Genkit** 架构，支持WebSocket实时处理和REST异步处理。

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend (React)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
    ┌────▼─────┐           ┌────────▼──────┐
    │ WS /scan │           │ REST /api/... │
    └────┬─────┘           └────────┬──────┘
         │                          │
    ┌────▼──────────────────────────▼────┐
    │   FastAPI Router (api/router.py)   │
    └────┬───────────────────────────────┘
         │
    ┌────▼────────────────────────────────────┐
    │  Diagnosis Pipeline (LiveScanPipeline)  │
    │  ┌─────────────────────────────────┐   │
    │  │  Google ADK SequentialAgent     │   │
    │  │  • CropEmbedAgent              │   │
    │  │  • VectorMatchAgent            │   │
    │  │  • ReasoningAgent              │   │
    │  └─────────────────────────────────┘   │
    └────┬────────────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │  External Services                │
    │  • Vertex AI (Embedding)          │
    │  • Vertex AI (Vector Search)      │
    │  • Firestore (Data Persistence)  │
    │  • Gemini LLM (Conversation)      │
    └───────────────────────────────────┘
```

---

## Module 1: Diagnosis (Plant Disease Detection)

### Purpose
实时接收前端裁剪的病斑图像，通过向量检索和Firestore查询，返回结构化的诊断结果。

### Runtime Flow

```
Client (Mobile/Web)
  │
  ├─► WS /ws/scan (ScanFrame)
  │   ├─ grid_id: "section_A1"
  │   ├─ frame_number: 120
  │   └─ regions[]: { cropped_image_b64, bbox }
  │
  ├─► Router validates & parses ScanFrame
  │   └─► asyncio.gather(run_pipeline per region)
  │
  ├─► Pipeline.run(region)
  │   │
  │   ├─► CropEmbedAgent
  │   │   └─ base64 → image bytes → Vertex AI Embedding (1408-d)
  │   │
  │   ├─► VectorMatchAgent
  │   │   └─ Vector Search Top-K + confidence filtering
  │   │
  │   └─► ReasoningAgent
  │       └─ top candidate → Firestore query → structured result
  │
  ├─► ScanResponse (frame_number + results[])
  │   ├─ cropType: "Rice"
  │   ├─ disease: "Leaf Blast"
  │   ├─ severity: 72
  │   ├─ treatmentPlan: "Apply fungicide"
  │   └─ ...
  │
  └─► if is_abnormal: 
      └─ FirestoreService.record_scan_result(scanReports, grids)
```

### Diagnosis Agent Pipeline

| Agent | Input | Output | Key Service |
|-------|-------|--------|-------------|
| **CropEmbedAgent** | `cropped_image_b64` | `embedding[1408]` | `EmbeddingService` |
| **VectorMatchAgent** | `embedding` | `candidates[], fast_match` | `VectorSearchService` |
| **ReasoningAgent** | `candidates, bbox, grid_id` | `scan_result` | `FirestoreService` |

### API Endpoints

#### WebSocket: Real-time Scanning
```
WS ws://localhost:8000/ws/scan

Request (ScanFrame):
{
  "grid_id": "section_A1",
  "frame_number": 120,
  "regions": [
    {
      "cropped_image_b64": "iVBORw0KGgoAAAANS...",
      "bbox": {
        "x": 0.1,
        "y": 0.2,
        "width": 0.3,
        "height": 0.4,
        "mediapipe_label": "leaf",
        "detection_score": 0.92
      }
    }
  ]
}

Response (ScanResponse):
{
  "frame_number": 120,
  "results": [
    {
      "cropType": "Rice",
      "disease": "Leaf Blast",
      "severity": 72,
      "severityScore": 0.72,
      "treatmentPlan": "Apply propiconazole fungicide",
      "survivalProb": 0.65,
      "is_abnormal": true,
      "bbox": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 },
      "grid_id": "section_A1"
    }
  ]
}
```

#### REST: Assistant Scan (with Chatbot Reply)
```
POST /api/assistant/scan

Request:
{
  "source": "camera",
  "grid_id": "section_A1",
  "base64_image": "iVBORw0KGgoAAAANS...",
  "user_prompt": "What should I do with this leaf?"
}

Response:
{
  "disease": "Apple Scab",
  "severity": 82,
  "confidence": 91,
  "spread_risk": "High",
  "zone": "section_A1",
  "crop_type": "Apple",
  "treatment_plan": "Consult agrologist for fungicide",
  "assistant_reply": "Based on the image analysis, your apple tree has scab... I recommend..."
}
```

### Key Services

- **EmbeddingService** (`services/embedding_service.py`)
  - Vertex AI `multimodalembedding@001`
  - 输入：图像字节
  - 输出：1408维向量

- **VectorSearchService** (`services/vector_search_service.py`)
  - Vertex AI Matching Engine
  - 方法：`find_neighbors(embedding, top_k)`
  - 返回：Top-K候选及置信度

- **FirestoreService** (`services/firestore_service.py`)
  - 写入：`scanReports` 集合（异常结果）
  - 读取：候选元数据、crop/disease 字段
  - 更新：`grids` 状态和网格信息

- **LLMService** (`services/llm_service.py`)
  - Gemini API
  - 方法：`generate_assistant_dialogue(scan_result, user_prompt)`
  - 用途：将诊断结果转化为自然语言对话

---

## Module 2: Swarm (Multi-Agent Agricultural Decision System)

### Purpose
基于诊断结果和外部数据（天气、市场价格、库存），多Agent并行执行，生成农民友好的决策建议。

### Architecture

```
┌─────────────────────────────────────────────────┐
│          Genkit AI Framework (Main)              │
│  ┌───────────────────────────────────────────┐  │
│  │        4 Concurrent Agents                │  │
│  │                                           │  │
│  │  ┌──────────────────────────────────────┐ │  │
│  │  │ 1. Meteorologist Agent               │ │  │
│  │  │    ├─ fetch_weather()                │ │  │
│  │  │    ├─ spray_safety_advisory()        │ │  │
│  │  │    └─ next_safe_window()             │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌──────────────────────────────────────┐ │  │
│  │  │ 2. Economist Agent                   │ │  │
│  │  │    ├─ fetch_market_price()           │ │  │
│  │  │    ├─ fetch_treatment_cost()         │ │  │
│  │  │    ├─ calculate_roi()                │ │  │
│  │  │    └─ treatment_recommendation()     │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌──────────────────────────────────────┐ │  │
│  │  │ 3. Resource Manager Agent            │ │  │
│  │  │    ├─ allocate_resources()           │ │  │
│  │  │    ├─ optimize_supply_chain()        │ │  │
│  │  │    └─ inventory_check()              │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  │                                           │  │
│  │  ┌──────────────────────────────────────┐ │  │
│  │  │ 4. Spatial Propagation Agent         │ │  │
│  │  │    ├─ predict_spread()               │ │  │
│  │  │    ├─ buffer_zone_analysis()         │ │  │
│  │  │    └─ grid_state_update()            │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │
         │ (asyncio.gather)
         │
    ┌────▼──────────────────────────────┐
    │  Multi-Agent Tools                │
    │  • WeatherTool                    │
    │  • MCPClient (Market Data)        │
    │  • InventoryTool                  │
    │  • ROITool                        │
    │  • FCMTool (Notifications)        │
    └───────────────────────────────────┘
```

### Agents Overview

#### 1. Meteorologist Agent
- **输入**：GPS坐标、crop_type
- **流程**：
  1. 调用 `fetch_weather()` 获取当地天气
  2. 分析风力、湿度、温度
  3. 判断是否安全喷洒
  4. 推荐下一个合适窗口
- **输出**：天气建议、安全指数、喷洒窗口

**示例响应**：
```
天气概览: 晴朗，温度28°C，湿度65%，风力3m/s
喷洒安全: ✓ 当前可安全喷洒
风险提示: 下午风力可能增加至5m/s，建议上午完成
下一窗口: 明天上午6-10点（理想条件）
```

#### 2. Economist Agent
- **输入**：user_id、crop_type、treatment_plan、survival_prob、farm_size
- **流程**：
  1. 调用 `fetch_market_price()` 从ManaMurah MCP获取市场价格
  2. 调用 `fetch_inventory_cost()` 获取治疗成本
  3. 调用 `calculate_roi()` 计算ROI
  4. LLM生成农民友好的财务分析
- **输出**：零售价 vs 农场价、成本、ROI百分比、建议

**关键说明**：
- **零售价**：消费者在商店支付的价格
- **农场价**：农民实际收到的价格（通常为零售价的45%）
- **55%差异**：中间商、运输、加工、市场费用

**示例响应**：
```
市场价格:
- 零售价: 每公斤 Rp50,000
- 农场价: 每公斤 Rp22,500 (55% 被中间商拿走)

治疗成本: Rp3,500,000 (5公顷)
存活率: 85% (有效治疗)
预计收益: Rp9,562,500
ROI: 173% ✓ 强烈推荐治疗
```

#### 3. Resource Manager Agent
- **输入**：farm_id、current_inventory
- **流程**：
  1. 查询库存状态
  2. 预测资源消耗
  3. 优化供应链
  4. 生成采购建议
- **输出**：库存报告、采购清单

#### 4. Spatial Propagation Agent
- **输入**：affected_grids、weather_data、crop_type
- **流程**：
  1. 分析病害传播模式
  2. 计算缓冲区（buffer zone）
  3. 预测高风险网格
  4. 更新全农场网格状态
- **输出**：传播预测、高风险区域、隔离建议

### Swarm Tools

| Tool | Purpose | Source |
|------|---------|--------|
| **WeatherTool** | 获取实时天气数据 | OpenWeather API |
| **MCPClient** | 市场价格查询 | ManaMurah MCP |
| **InventoryTool** | 库存和成本查询 | Firestore inventory |
| **ROITool** | ROI计算（确定性） | 本地计算 |
| **FCMTool** | 推送通知 | Firebase Cloud Messaging |

---

## Installation & Setup

### Prerequisites
- Python 3.12+
- Google Cloud Project (with Vertex AI, Firestore enabled)
- Firebase Admin credentials
- .env 配置文件

### Environment Setup

```bash
# 1. Install dependencies
pip install -r backend/requirements.txt

# 2. Configure .env
# backend/.env should contain:
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
# FIRESTORE_PROJECT_ID=your-project
# VECTOR_SEARCH_CONFIDENCE_THRESHOLD=0.7
# ... (see settings.py)

# 3. Run Diagnosis Service
cd backend/diagnosis
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 4. Run Swarm Service
cd backend/swarm
python main.py
```

### Docker Deployment

```bash
# Build image
docker build -t padiguard-backend:latest -f backend/Dockerfile .

# Run diagnosis service
docker run -p 8000:8000 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/.env \
  padiguard-backend:latest

# Run swarm service
docker run -p 3400:3400 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/.env \
  padiguard-backend:latest python swarm/main.py
```

---

## Data Flow

### Diagnosis Flow
```
Mobile Camera → MediaPipe Detection → Crop Extraction
    ↓
WebSocket /ws/scan → ScanFrame JSON
    ↓
Diagnosis Pipeline (ADK SequentialAgent)
    ├─ CropEmbed (1408-d vector)
    ├─ VectorMatch (Top-K search)
    └─ Reasoning (Firestore enrichment)
    ↓
ScanResponse (structured diagnosis)
    ├─ if abnormal → Firestore record
    └─ → Swarm trigger (multi-agent decision)
```

### Swarm Decision Flow
```
Diagnosis Result
    ├─ Meteorologist (weather advisory)
    ├─ Economist (ROI analysis)
    ├─ Resource Manager (inventory check)
    └─ Spatial Propagation (spread prediction)
         ↓
    asyncio.gather() - All 4 agents run in parallel
         ↓
    Combined SwarmOutput
         ├─ Send to Frontend
         ├─ Store in Firestore
         └─ Trigger FCM notifications
```

---

## Key Configuration

### Settings (`backend/config/settings.py`)
```python
# Diagnosis
VECTOR_SEARCH_CONFIDENCE_THRESHOLD = 0.7
VECTOR_SEARCH_FAST_MATCH_THRESHOLD = 0.85

# LLM
LLM_MODEL = "gemini-2.0-flash"
TEMPERATURE = 0.7

# Firestore
FIRESTORE_COLLECTION_CANDIDATES = "candidates"
FIRESTORE_COLLECTION_SCANS = "scanReports"
```

---

## Error Handling

| Error | Handling Strategy |
|-------|-------------------|
| Embedding API timeout | Write empty embedding, allow downstream to continue |
| Vector Search no results | Return empty candidates, reason with Firestore fallback |
| Firestore read failure | Log error, return generic diagnosis with low confidence |
| LLM API error | Return structured result without assistant reply |

---

## Testing

```bash
# Test diagnosis pipeline
cd backend/diagnosis
pytest tests/test_pipeline.py -v

# Test swarm agents
cd backend/swarm
pytest tests/test_genkit_api.py -v
pytest tests/test_mcp.py -v
```

---

## Performance Notes

- **WebSocket latency**: ~500-1500ms per frame (embedding + search)
- **Vector Search**: Top-5 retrieval on 50K+ candidates
- **Firestore queries**: Batch write on abnormal results only
- **Swarm execution**: 4 agents parallel (~3-5s total)

---

## Next Steps / TODOs

- [ ] Add Redis caching for vector embeddings
- [ ] Implement batch processing for high-volume scans
- [ ] Add model retraining pipeline
- [ ] Expand swarm agents (agronomist, market analyst)
- [ ] Multi-language support for advisor responses

---

## Support

For issues or questions:
- Check logs: `backend/logs/`
- Review Firestore schema in `backend/scripts/upload_candidate_metadata.py`
- Consult architecture docs: `backend/diagnosis/ARCHITECTURE.md`

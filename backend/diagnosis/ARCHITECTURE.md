# PadiGuard AI Diagnosis Architecture (Current)

本文档描述 `backend/diagnosis` 当前实现（以代码为准）的架构与数据流。

## 1. High-Level Design

系统采用 **Vector-first** 的实时诊断架构：

- 输入：前端发送每帧中的多个裁剪病斑区域（base64 + bbox）
- 编排：后端对每个 region 并发执行 ADK SequentialAgent
- 推理：使用 Vector Search Top-1 id 到 Firestore 查询诊断字段后生成结果
- 输出：返回结构化 `ScanResponse`
- 落库：异常结果写入 Firestore，触发下游网格状态更新/扩散逻辑
- 会话增强：拍照后可直接进入 Chatbot，调用诊断并由 Gemini 生成对话回复

## 2. Runtime Components

| Component | File | Responsibility |
| --- | --- | --- |
| FastAPI App | `main.py` | App lifecycle, CORS, `/health`, router mount |
| REST API | `api/router.py` | `POST /api/scan` 与 `POST /api/assistant/scan` |
| WS API | `api/router.py` | 接收 `ScanFrame`，并发处理 regions，返回 `ScanResponse` |
| Pipeline Orchestrator | `orchestration/pipeline.py` | 创建 ADK session + Runner，串联 3 agents |
| Assistant Orchestrator | `orchestration/assistant_pipeline.py` | 接收 `scan_result`，运行对话 agent |
| Embed Agent | `agents/crop_embed_agent.py` | base64 -> image bytes -> 1408-d embedding |
| Match Agent | `agents/vector_match_agent.py` | Vector Search Top-K + threshold filtering |
| Reasoning Agent | `agents/reasoning_agent.py` | 用 top candidate id 查询 Firestore，生成最终诊断结果 |
| Assistant Reply Agent | `agents/assistant_reply_agent.py` | 读取诊断结果并调用 Gemini 生成聊天回复 |
| Embedding Service | `services/embedding_service.py` | Vertex AI `multimodalembedding@001` |
| Vector Search Service | `services/vector_search_service.py` | Vertex AI Matching Engine `find_neighbors` |
| Firestore Service | `services/firestore_service.py` | 写 `scanReports`、更新 `grids` |

## 3. Sequence Flow

```text
Client
  -> WS /ws/scan (ScanFrame)
Router
  -> validate ScanFrame
  -> asyncio.gather(run pipeline per region)
Pipeline.run(region)
  -> create ADK in-memory session (state: cropped_image_b64, bbox, grid_id)
  -> SequentialAgent:
       1) CropEmbedAgent
       2) VectorMatchAgent
       3) ReasoningAgent
  -> collect scan_result
Router
  -> build ScanResult list
  -> if result.is_abnormal: FirestoreService.record_scan_result(...)
  -> send ScanResponse

Client (Scanner -> Chatbot)
  -> POST /api/assistant/scan (base64 + user_prompt)
Router
  -> run LiveScanPipeline once (CropEmbed -> VectorMatch -> Reasoning)
  -> run AssistantPipeline (AssistantReplyAgent)
  -> return diagnosis + assistant_reply
```

## 4. Agent-Level Behavior

### 4.1 CropEmbedAgent

- 读取：`cropped_image_b64`
- 行为：base64 解码后调用 `EmbeddingService.embed_image_bytes`
- 写入：`embedding: list[float]`
- 异常策略：写空 embedding，允许下游继续

### 4.2 VectorMatchAgent

- 读取：`embedding`
- 行为：
  1. 调用 `VectorSearchService.search(embedding, top_k)`
  2. 按 `VECTOR_SEARCH_CONFIDENCE_THRESHOLD` 过滤
  3. 若 top1 >= `VECTOR_SEARCH_FAST_MATCH_THRESHOLD`，写 `fast_match`
- 写入：`candidates`, `fast_match`
- 异常策略：写空候选并返回

### 4.3 ReasoningAgent

- 读取：`candidates`, `bbox`, `grid_id`
- 当前实现：取 top candidate `id`，查询 Firestore 候选文档（不调用 LLM）构造
  - `cropType`, `disease`
  - `severity`, `severityScore`, `treatmentPlan`, `survivalProb`
  - `is_abnormal`, `bbox`, `grid_id`
- 写入：`scan_result`

### 4.4 AssistantReplyAgent

- 读取：`scan_result`, `user_prompt`
- 行为：调用 `LLMService.generate_assistant_dialogue`（Gemini）把诊断结果转成面向用户的自然语言答复
- 写入：`assistant_reply`

## 5. Data Contracts

定义位于 `models/scan_models.py`。

### 5.1 Inbound: `ScanFrame`

- `grid_id: str | None`
- `frame_number: int`
- `regions: list[ScanRegion]`（至少 1 个）

`ScanRegion`:
- `cropped_image_b64: str`
- `bbox: BoundingBox`

### 5.2 Outbound: `ScanResponse`

- `frame_number: int`
- `results: list[ScanResult]`

`ScanResult`:
- `cropType`, `disease`, `severity`
- `severityScore` (0..1)
- `treatmentPlan`
- `survivalProb` (0..1)
- `is_abnormal`
- `bbox`

### 5.3 REST: `HttpScanAssistantRequest` / `HttpScanAssistantResponse`

- `HttpScanAssistantRequest`
  - `source`, `grid_id`, `base64_image`, `user_prompt`
- `HttpScanAssistantResponse`
  - `disease`, `severity`, `confidence`, `spread_risk`, `zone`, `crop_type`, `treatment_plan`
  - `assistant_reply`

## 6. External Dependencies

| Capability | Service / SDK |
| --- | --- |
| Agent orchestration | `google-adk` |
| Embedding | Vertex AI Vision Models (`multimodalembedding@001`) |
| Vector retrieval | Vertex AI Matching Engine |
| Persistence | Cloud Firestore |
| API layer | FastAPI + Uvicorn |

## 7. Configuration Surface

配置入口：`config/settings.py`（Pydantic Settings）。

关键变量：

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `VECTOR_SEARCH_INDEX_ENDPOINT`
- `VECTOR_SEARCH_DEPLOYED_INDEX_ID`
- `VECTOR_SEARCH_CONFIDENCE_THRESHOLD`
- `VECTOR_SEARCH_FAST_MATCH_THRESHOLD`
- `FIRESTORE_GRID_COLLECTION`
- `FIRESTORE_REPORT_COLLECTION`
- `FIRESTORE_CANDIDATE_COLLECTION`
- `DEFAULT_TOP_K`

## 8. Notes on LLM Usage

`LiveScanPipeline` 主诊断链路仍不依赖 LLM（Vector + Firestore）。

LLM（Gemini）当前用于会话增强链路：`AssistantReplyAgent` 接收 `ReasoningAgent` 的诊断结果后，生成用户可读的对话回复。

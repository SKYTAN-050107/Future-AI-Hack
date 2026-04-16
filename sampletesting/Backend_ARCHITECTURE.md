# PadiGuard AI Backend — Detailed Architecture

## System Context

PadiGuard AI Backend is a **dual-module real-time agricultural AI system**:
1. **Diagnosis Module** - Plant disease detection via image analysis
2. **Swarm Module** - Multi-agent decision system for treatment & resource optimization

Both modules run independently but are triggered by the same diagnosis event.

---

## Part 1: Diagnosis Module Architecture

### 1.1 High-Level Design

The Diagnosis module implements a **Vector-first, Firestore-enriched** pipeline:

```
┌──────────────────┐
│  Frontend Image  │ (cropped leaf/plant region)
└────────┬─────────┘
         │ base64 + bbox
         ↓
┌──────────────────────────────────────────────────────┐
│  LiveScanPipeline (ADK SequentialAgent)              │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ CropEmbedAgent                              │    │
│  │ input: cropped_image_b64                    │    │
│  │ action: base64 → bytes → Vertex Embedding  │    │
│  │ output: embedding[1408]                     │    │
│  └────────────────┬────────────────────────────┘    │
│                   │                                 │
│  ┌────────────────▼────────────────────────────┐    │
│  │ VectorMatchAgent                            │    │
│  │ input: embedding[1408]                      │    │
│  │ action: Vector Search Top-K + filtering     │    │
│  │ output: candidates[], fast_match flag       │    │
│  └────────────────┬────────────────────────────┘    │
│                   │                                 │
│  ┌────────────────▼────────────────────────────┐    │
│  │ ReasoningAgent                              │    │
│  │ input: candidates, bbox, grid_id            │    │
│  │ action: Query Firestore for top candidate  │    │
│  │ output: scan_result (structured)            │    │
│  └────────────────┬────────────────────────────┘    │
│                   │                                 │
└───────────────────┼─────────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │  ScanResponse       │
         │  • cropType         │
         │  • disease          │
         │  • severity         │
         │  • treatmentPlan    │
         │  • is_abnormal      │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ if is_abnormal      │
         │ → Firestore record  │
         │ → trigger Swarm     │
         └─────────────────────┘
```

**Key Design Decisions:**

1. **Vector-First**: Embedding → search is the primary path
   - Pros: Fast, scalable, handles visual similarity
   - Cons: No LLM reasoning in main pipeline (separate in assistant flow)

2. **Firestore Enrichment**: Top candidate's metadata is the diagnosis source
   - Eliminates need for LLM in high-throughput path
   - Ensures consistent, reproducible results
   - Enables batch candidate metadata updates

3. **Parallel Region Processing**: Each ScanFrame region runs independently
   - All regions in a frame use `asyncio.gather()` for concurrency
   - Latency = max(region_latency), not sum

---

### 1.2 Core Components

#### 1.2.1 FastAPI Router (`api/router.py`)

**Responsibilities:**
- Parse incoming WebSocket frames or REST requests
- Validate data contracts
- Orchestrate pipeline execution
- Format response

**Key Endpoints:**
```python
@router.websocket("/ws/scan")
async def websocket_scan(websocket: WebSocket):
    """
    Real-time scanning endpoint.
    Receives ScanFrame, runs pipeline per region, returns ScanResponse.
    """
    # 1. Accept WebSocket connection
    # 2. Listen for ScanFrame JSON
    # 3. Validate ScanFrame schema
    # 4. Extract regions
    # 5. asyncio.gather(run_pipeline per region)
    # 6. Collect results
    # 7. Build ScanResponse
    # 8. Send back via WebSocket

@router.post("/api/scan")
async def rest_scan(request: ScanRequest):
    """
    REST endpoint for single-region scan + embedding.
    """

@router.post("/api/assistant/scan")
async def assistant_scan(request: AssistantScanRequest):
    """
    REST endpoint: scan + diagnosis + LLM assistant reply.
    Runs: LiveScanPipeline → AssistantReplyAgent → combined response
    """
    result = await pipeline.run(region_data)
    reply = await assistant_agent.process(result, user_prompt)
    return {**result, "assistant_reply": reply}
```

---

#### 1.2.2 LiveScanPipeline (`orchestration/pipeline.py`)

**Responsibilities:**
- Create ADK in-memory session
- Register agents
- Execute SequentialAgent flow
- Return scan result

**Flow:**
```python
async def run(region_data: RegionData) -> ScanResult:
    # 1. Create ADK session
    session = adk.Session(
        state={
            "cropped_image_b64": region_data.cropped_image_b64,
            "bbox": region_data.bbox,
            "grid_id": region_data.grid_id,
        }
    )
    
    # 2. Register agents
    session.register("crop_embed_agent", CropEmbedAgent())
    session.register("vector_match_agent", VectorMatchAgent())
    session.register("reasoning_agent", ReasoningAgent())
    
    # 3. Run SequentialAgent
    runner = adk.SequentialAgent([
        "crop_embed_agent",
        "vector_match_agent", 
        "reasoning_agent",
    ])
    
    # 4. Execute
    final_state = await runner.run(session)
    
    # 5. Extract result
    return ScanResult.from_state(final_state)
```

**Concurrency Model:**
```python
# In router, for each ScanFrame:
region_results = await asyncio.gather(
    *[pipeline.run(region) for region in frame.regions]
)

# If 3 regions, 3 pipelines run in parallel:
# Time = max(pipeline_latency), not 3x
# → Typical: 500ms for 1 region, 600-700ms for 3 regions
```

---

#### 1.2.3 Agent: CropEmbedAgent

**Input State:**
```python
{
    "cropped_image_b64": "iVBORw0KGgo...",
    "bbox": {...},
    "grid_id": "section_A1"
}
```

**Process:**
```python
class CropEmbedAgent(BaseAgent):
    async def execute(self, state: Dict) -> Dict:
        try:
            # 1. Decode base64
            image_bytes = base64.b64decode(state["cropped_image_b64"])
            
            # 2. Call Embedding Service
            embedding = await embedding_service.embed_image_bytes(
                image_bytes=image_bytes,
                model="multimodalembedding@001"
            )
            
            # 3. Update state
            state["embedding"] = embedding  # list[float], length 1408
            state["embedding_error"] = None
            
        except Exception as e:
            # On error: write empty embedding, allow downstream
            state["embedding"] = []
            state["embedding_error"] = str(e)
            logger.error(f"Embedding failed: {e}")
        
        return state
```

**Output State:**
```python
{
    "cropped_image_b64": "...",
    "bbox": {...},
    "grid_id": "section_A1",
    "embedding": [0.123, -0.456, ..., 0.789],  # 1408 dims
    "embedding_error": None
}
```

**Error Handling:**
- On API timeout: Write empty embedding
- On invalid image: Log, write empty
- Downstream agents must handle empty embedding gracefully

---

#### 1.2.4 Agent: VectorMatchAgent

**Input State:**
```python
{
    "embedding": [0.123, ..., 0.789],  # 1408-d
    "embedding_error": None,
    ...
}
```

**Process:**
```python
class VectorMatchAgent(BaseAgent):
    async def execute(self, state: Dict) -> Dict:
        if state.get("embedding_error"):
            state["candidates"] = []
            state["fast_match"] = False
            return state
        
        try:
            # 1. Call Vector Search
            neighbors = await vector_search_service.find_neighbors(
                embedding=state["embedding"],
                top_k=5,
                index_name="candidates-index"
            )
            
            # 2. Filter by confidence
            candidates = [
                n for n in neighbors
                if n["distance"] >= VECTOR_SEARCH_CONFIDENCE_THRESHOLD
            ]
            
            # 3. Check for fast match
            if neighbors and neighbors[0]["distance"] >= VECTOR_SEARCH_FAST_MATCH_THRESHOLD:
                state["fast_match"] = True
            else:
                state["fast_match"] = False
            
            # 4. Update state
            state["candidates"] = candidates
            state["vector_search_error"] = None
            
        except Exception as e:
            state["candidates"] = []
            state["fast_match"] = False
            state["vector_search_error"] = str(e)
            logger.error(f"Vector search failed: {e}")
        
        return state
```

**Output State:**
```python
{
    "embedding": [...],
    "candidates": [
        {
            "id": "rice_leaf_blast_01",
            "distance": 0.89,
            "metadata": {...}
        },
        {
            "id": "rice_blight_02",
            "distance": 0.76,
            ...
        }
    ],
    "fast_match": True,  # high confidence
    "vector_search_error": None
}
```

**Constants:**
```python
VECTOR_SEARCH_CONFIDENCE_THRESHOLD = 0.7
VECTOR_SEARCH_FAST_MATCH_THRESHOLD = 0.85
```

---

#### 1.2.5 Agent: ReasoningAgent

**Input State:**
```python
{
    "candidates": [
        {"id": "rice_leaf_blast_01", "distance": 0.89, ...},
        ...
    ],
    "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
    "grid_id": "section_A1"
}
```

**Process:**
```python
class ReasoningAgent(BaseAgent):
    async def execute(self, state: Dict) -> Dict:
        if not state.get("candidates"):
            # No candidates: return generic result
            state["scan_result"] = ScanResult(
                cropType="Unknown",
                disease="Unidentified",
                severity=0,
                is_abnormal=False
            )
            return state
        
        try:
            # 1. Take top candidate
            top_candidate = state["candidates"][0]
            candidate_id = top_candidate["id"]
            
            # 2. Query Firestore for full metadata
            candidate_doc = await firestore_service.get_candidate(candidate_id)
            
            # 3. Extract fields
            scan_result = ScanResult(
                cropType=candidate_doc.get("cropType"),
                disease=candidate_doc.get("disease"),
                severity=candidate_doc.get("severity", 0),
                severityScore=candidate_doc.get("severityScore", 0.0),
                treatmentPlan=candidate_doc.get("treatmentPlan", ""),
                survivalProb=candidate_doc.get("survivalProb", 0.0),
                is_abnormal=candidate_doc.get("is_abnormal", False),
                bbox=state["bbox"],
                grid_id=state["grid_id"],
                confidence=top_candidate["distance"]
            )
            
            # 4. Update state
            state["scan_result"] = scan_result
            state["reasoning_error"] = None
            
        except Exception as e:
            state["scan_result"] = ScanResult.default()
            state["reasoning_error"] = str(e)
            logger.error(f"Reasoning failed: {e}")
        
        return state
```

**Output State:**
```python
{
    "scan_result": ScanResult(
        cropType="Rice",
        disease="Leaf Blast",
        severity=72,
        severityScore=0.72,
        treatmentPlan="Apply propiconazole fungicide",
        survivalProb=0.65,
        is_abnormal=True,
        bbox={...},
        grid_id="section_A1",
        confidence=0.89
    )
}
```

---

#### 1.2.6 Agent: AssistantReplyAgent

**Input:**
```python
{
    "scan_result": ScanResult(...),
    "user_prompt": "What should I do?"
}
```

**Process:**
```python
class AssistantReplyAgent(BaseAgent):
    async def execute(self, input_data: AssistantReplyInput) -> str:
        """
        Convert diagnosis to farmer-friendly dialogue.
        """
        scan_result = input_data.scan_result
        user_prompt = input_data.user_prompt
        
        prompt = f"""You are PadiGuard's Agricultural Assistant. 
        
        The farmer asked: "{user_prompt}"
        
        Our AI diagnostic result:
        - Crop: {scan_result.cropType}
        - Disease: {scan_result.disease}
        - Severity: {scan_result.severity}%
        - Treatment: {scan_result.treatmentPlan}
        - Survival Probability: {scan_result.survivalProb*100}%
        
        Generate a clear, actionable, farmer-friendly response that:
        1. Confirms the diagnosis
        2. Explains the severity simply
        3. Recommends immediate actions
        4. Mentions risks if untreated
        
        Keep it concise and use local language where appropriate."""
        
        # Call LLM
        response = await llm_service.generate_assistant_dialogue(prompt)
        
        return response
```

**Output:**
```python
"Based on your photo, I can see leaf blast on your rice plants. 
This is moderate (72% severity) and spreads quickly in humid conditions. 
You should apply fungicide treatment within 24 hours. 
If left untreated, you could lose 35% of your crop."
```

---

### 1.3 Data Models

#### ScanFrame (WebSocket Input)
```python
class BBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    mediapipe_label: str
    detection_score: float

class Region(BaseModel):
    cropped_image_b64: str
    bbox: BBox

class ScanFrame(BaseModel):
    grid_id: str
    frame_number: int
    regions: list[Region]
```

#### ScanResult (Internal)
```python
class ScanResult(BaseModel):
    cropType: str
    disease: str
    severity: int  # 0-100
    severityScore: float  # 0.0-1.0
    treatmentPlan: str
    survivalProb: float  # 0.0-1.0
    is_abnormal: bool
    bbox: BBox
    grid_id: str
    confidence: float  # 0.0-1.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
```

#### ScanResponse (WebSocket Output)
```python
class ScanResponse(BaseModel):
    frame_number: int
    results: list[ScanResult]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
```

#### AssistantScanRequest (REST Input)
```python
class AssistantScanRequest(BaseModel):
    source: str  # "camera" or "gallery"
    grid_id: str
    base64_image: str
    user_prompt: str
```

#### AssistantScanResponse (REST Output)
```python
class AssistantScanResponse(BaseModel):
    disease: str
    severity: int
    confidence: int  # 0-100
    spread_risk: str  # "Low", "Medium", "High"
    zone: str
    crop_type: str
    treatment_plan: str
    assistant_reply: str
```

---

### 1.4 Services

#### EmbeddingService
- **File**: `services/embedding_service.py`
- **Method**: `embed_image_bytes(image_bytes: bytes, model: str) -> list[float]`
- **API**: Vertex AI Multimodal Embedding API
- **Output**: 1408-dimensional vector
- **Caching**: None (direct API call)
- **Error Handling**: Raise exception, caught by agent

#### VectorSearchService
- **File**: `services/vector_search_service.py`
- **Method**: `find_neighbors(embedding: list[float], top_k: int) -> list[dict]`
- **API**: Vertex AI Matching Engine
- **Output**: List of top-K neighbors with distances
- **Filtering**: Applied in VectorMatchAgent (not in service)

#### FirestoreService
- **File**: `services/firestore_service.py`
- **Key Methods**:
  - `get_candidate(candidate_id: str) -> dict`
  - `record_scan_result(scan_result: ScanResult) -> None`
  - `update_grid_state(grid_id: str, state: dict) -> None`
- **Collections**:
  - `candidates`: Metadata for each disease/crop variant
  - `scanReports`: Historical scan records (abnormal only)
  - `grids`: Grid status and statistics

#### LLMService
- **File**: `services/llm_service.py`
- **Method**: `generate_assistant_dialogue(prompt: str) -> str`
- **LLM**: Gemini 2.0 Flash
- **Usage**: Only in AssistantReplyAgent (not main diagnosis path)
- **Temperature**: 0.7

---

### 1.5 Firestore Data Schema

#### Collection: `candidates`
```json
{
  "id": "rice_leaf_blast_01",
  "cropType": "Rice",
  "disease": "Leaf Blast",
  "severity": 72,
  "severityScore": 0.72,
  "treatmentPlan": "Apply propiconazole (3mL per 15L water)",
  "survivalProb": 0.65,
  "is_abnormal": true,
  "vector_id": "rice_leaf_blast_01_embedding",
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### Collection: `scanReports`
```json
{
  "id": "report_grid_A1_20240415_153045",
  "grid_id": "section_A1",
  "scan_result": {...},
  "timestamp": "2024-04-15T15:30:45Z",
  "user_id": "farmer_001",
  "severity": 72,
  "is_abnormal": true
}
```

#### Collection: `grids`
```json
{
  "id": "section_A1",
  "grid_location": {"lat": -7.123, "lng": 110.456},
  "crop_type": "Rice",
  "size_hectares": 2.5,
  "last_scan_time": "2024-04-15T15:30:45Z",
  "abnormal_count": 3,
  "health_score": 0.72
}
```

---

## Part 2: Swarm Module Architecture

### 2.1 High-Level Design

The Swarm module is a **multi-agent decision system** that runs in parallel to provide comprehensive agricultural guidance.

```
Diagnosis Result
       │
       ├─► Meteorologist Agent
       │   (Weather → Spray Safety)
       │
       ├─► Economist Agent
       │   (Market Price → ROI Analysis)
       │
       ├─► Resource Manager Agent
       │   (Inventory → Supply Chain)
       │
       └─► Spatial Propagation Agent
           (Disease Spread → Buffer Zones)
           │
           asyncio.gather() - All 4 run concurrently
           │
           ▼
       Combined SwarmOutput
           ├─ All agent responses
           ├─ Integrated recommendations
           └─ Send to frontend + FCM notifications
```

---

### 2.2 Core Components

#### 2.2.1 Genkit Framework Integration

**File**: `swarm/main.py`

```python
from genkit.ai import Genkit

ai = Genkit()

# Register all tools
register_weather_tools(ai)
register_mcp_tools(ai)
register_inventory_tools(ai)
register_roi_tools(ai)
register_fcm_tools(ai)

# Register all agents
register_meteorologist_agent(ai)
register_economist_agent(ai)
register_resource_manager_agent(ai)
register_spatial_agent(ai)

# Run orchestration
async def run_swarm(diagnosis_result: ScanResult) -> SwarmOutput:
    meteorologist_output = await ai.flow("meteorologist_flow")(
        MeteorologistInput(...)
    )
    economist_output = await ai.flow("economist_flow")(
        EconomistInput(...)
    )
    resource_output = await ai.flow("resource_manager_flow")(
        ResourceManagerInput(...)
    )
    spatial_output = await ai.flow("spatial_propagation_flow")(
        SpatialInput(...)
    )
    
    # Wait for all 4 to complete
    results = await asyncio.gather(
        meteorologist_output,
        economist_output,
        resource_output,
        spatial_output
    )
    
    return SwarmOutput(
        meteorologist=results[0],
        economist=results[1],
        resource_manager=results[2],
        spatial_propagation=results[3]
    )
```

---

#### 2.2.2 Agent 1: Meteorologist

**Purpose**: Determine spray safety based on weather conditions

**Input Schema:**
```python
class MeteorologistInput(BaseModel):
    lat: float
    lng: float
    crop_type: str
```

**Process:**
```python
@ai.flow("meteorologist_flow")
async def meteorologist_flow(input_data: MeteorologistInput) -> str:
    # Step 1: Fetch weather
    weather = await fetch_weather(
        WeatherInput(lat=input_data.lat, lng=input_data.lng)
    )
    # Returns: {
    #   "temperature": 28,
    #   "humidity": 65,
    #   "wind_speed": 3.2,
    #   "wind_direction": "NW",
    #   "precipitation_chance": 15,
    #   "cloud_cover": 30
    # }
    
    # Step 2: LLM analyzes for farmer
    prompt = f"""You are PadiGuard's Meteorologist Agent.
    Analyze weather for {input_data.crop_type} farm at ({input_data.lat}, {input_data.lng}).
    
    Weather Data: {weather}
    
    Provide:
    1. Current conditions summary
    2. SAFE or UNSAFE to spray chemicals
    3. If unsafe, next clear window
    4. Wind-related precautions
    5. If rain within 4h: "DELAY" advisory
    
    Keep concise and farmer-friendly."""
    
    response = await llm_generate(prompt)
    return response
```

**Example Output:**
```
☀️ Current Weather: Clear, 28°C, 65% humidity, light breeze (3m/s NW)

✓ SAFE TO SPRAY NOW
- Wind is light and from favorable direction
- No rain expected for 6+ hours
- Humidity is optimal for fungicide coverage

⚠️ Precautions:
- Spray in early morning or late afternoon
- Avoid peak heat (11am-3pm) to prevent chemical burn
- Re-apply after 4+ days for persistent protection

Next ideal window: Tomorrow 6am-9am (similar conditions)
```

---

#### 2.2.3 Agent 2: Economist

**Purpose**: Analyze financial ROI of treatment

**Input Schema:**
```python
class EconomistInput(BaseModel):
    user_id: str
    crop_type: str
    treatment_plan: str
    survival_prob: float
    farm_size: float
```

**Process:**
```python
@ai.flow("economist_flow")
async def economist_flow(input_data: EconomistInput) -> str:
    # Step 1: Fetch market price from MCP
    market_data = await fetch_mcp_market_price(
        McpMarketPriceInput(crop_type=input_data.crop_type)
    )
    # Returns: {
    #   "crop": "Rice",
    #   "retail_price_per_kg": 50000,
    #   "farmgate_price_per_kg": 22500,
    #   "market_demand": "High",
    #   "price_trend": "Stable"
    # }
    
    # Step 2: Fetch treatment cost
    cost_data = await fetch_inventory_cost(
        InventoryInput(
            user_id=input_data.user_id,
            treatment_plan=input_data.treatment_plan
        )
    )
    # Returns: {
    #   "treatment": "Propiconazole fungicide",
    #   "unit_cost": 45000,
    #   "quantity_needed": 2,
    #   "total_cost": 90000,
    #   "supplier": "Syngenta"
    # }
    
    # Step 3: Calculate ROI
    roi_data = await calculate_roi_deterministic(
        RoiInput(
            retail_price=market_data["retail_price_per_kg"],
            survival_prob=input_data.survival_prob,
            treatment_cost=cost_data["total_cost"],
            crop_type=input_data.crop_type,
            farm_size_hectares=input_data.farm_size
        )
    )
    # Returns: {
    #   "expected_yield_kg": 15000,
    #   "revenue_if_treat": 337500000,  # IDR
    #   "revenue_if_no_treat": 195000000,
    #   "treatment_cost": 90000,
    #   "net_benefit": 52500000,
    #   "roi_percent": 58333
    # }
    
    # Step 4: LLM generates farmer-friendly analysis
    prompt = f"""You are PadiGuard's Economist Agent.
    
    Market Data: {market_data}
    Treatment Cost: {cost_data}
    ROI Analysis: {roi_data}
    
    IMPORTANT: Explain retail vs farm-gate price:
    - Retail: consumer shop price
    - Farm-gate: actual farmer receives (45% of retail)
    - 55% margin: middlemen, transport, processing, market fees
    
    Provide:
    1. Market summary (retail vs farm gate)
    2. Cost breakdown
    3. ROI with clear explanation
    4. Final recommendation (treat or not)
    
    Use numbers, be concise."""
    
    response = await llm_generate(prompt)
    return response
```

**Example Output:**
```
💰 FINANCIAL ANALYSIS FOR YOUR RICE FARM

Market Prices (as of today):
- Retail Price: Rp50,000 per kg (what shops charge)
- Farm-Gate Price: Rp22,500 per kg (what YOU receive)
- Market Margin: 55% (middlemen, transport, processing)

Treatment Option: Propiconazole Fungicide
- Unit Cost: Rp45,000/bottle
- Needed: 2 bottles = Rp90,000 total
- Supplier: Syngenta

Scenario Analysis:
┌─ IF YOU TREAT ──────────────────┐
│ Expected yield: 15,000 kg        │
│ Total revenue: Rp337,500,000     │
│ After treatment cost: Rp337,500,000 - Rp90,000 │
│ NET: Rp337,409,910              │
└──────────────────────────────────┘

┌─ IF YOU DON'T TREAT ────────────┐
│ Expected yield: 8,700 kg (58%)   │
│ Total revenue: Rp195,750,000     │
│ NET: Rp195,750,000               │
└──────────────────────────────────┘

💹 RECOMMENDATION: TREAT
✓ Additional profit if treated: Rp141,659,910
✓ ROI: 157,389% (highest in the season)
✓ Risk-Adjusted Survival: 85% (very likely to work)

Action: Buy fungicide now (prices stable). Apply within 24h.
```

---

#### 2.2.4 Agent 3: Resource Manager

**Purpose**: Optimize inventory and supply chain

**Input Schema:**
```python
class ResourceManagerInput(BaseModel):
    user_id: str
    farm_id: str
    current_inventory: dict
    treatment_plan: str
```

**Process:**
```python
@ai.flow("resource_manager_flow")
async def resource_manager_flow(input_data: ResourceManagerInput) -> str:
    # Step 1: Check inventory
    inventory = await fetch_inventory_cost(
        InventoryInput(
            user_id=input_data.user_id,
            treatment_plan=input_data.treatment_plan
        )
    )
    
    # Step 2: Predict resource consumption
    # (based on farm size, disease severity, weather)
    
    # Step 3: Identify supply chain gaps
    # (stockouts, supply delays)
    
    # Step 4: LLM generates supply chain recommendations
    # ...
    
    return response
```

---

#### 2.2.5 Agent 4: Spatial Propagation

**Purpose**: Predict disease spread and identify buffer zones

**Input Schema:**
```python
class SpatialInput(BaseModel):
    affected_grids: list[str]
    grid_locations: dict  # grid_id -> (lat, lng)
    weather_data: dict
    crop_type: str
```

**Process:**
```python
@ai.flow("spatial_propagation_flow")
async def spatial_propagation_flow(input_data: SpatialInput) -> str:
    # Step 1: Analyze current affected grids
    
    # Step 2: Calculate spread vector (wind + humidity)
    # → Disease spreads in wind direction
    
    # Step 3: Identify high-risk neighboring grids
    # → Create buffer zone recommendations
    
    # Step 4: LLM generates spatial advisory
    # ...
    
    return response
```

**Example Output:**
```
📍 SPATIAL PROPAGATION ANALYSIS

Current Infected Grid: section_A1

Wind Direction: NW (3.2 m/s)
High Humidity: 65% (favorable for fungal spread)
Predicted Spread Vector: NW direction

⚠️ HIGH-RISK ZONES (Next 5 days):
- section_A2 (50m NW): 78% infection risk
- section_B1 (150m NW): 45% infection risk

🛡️ BUFFER ZONE RECOMMENDATIONS:
1. IMMEDIATE (24h):
   - Treat section_A1 (infected)
   - Spray preventive on section_A2

2. SHORT-TERM (3 days):
   - Monitor section_B1 daily
   - Prepare fungicide for section_B1
   
3. MEDIUM-TERM (1 week):
   - Check sections downstream of wind
   - Adjust irrigation (lower humidity aids control)

Containment Strategy:
- Create 200m isolation zone around A1
- Daily scouting in buffer zones
- Early intervention if A2 shows symptoms
```

---

### 2.3 Swarm Tools

#### Tool 1: WeatherTool
```python
# tools/weather_tool.py

class WeatherInput(BaseModel):
    lat: float
    lng: float

async def fetch_weather(input_data: WeatherInput) -> dict:
    """Fetch real-time weather from OpenWeather API."""
    # Call OpenWeather API
    # Return: temperature, humidity, wind_speed, precipitation_chance, etc.
```

#### Tool 2: MCPClient (Market Price)
```python
# tools/mcp_client.py

class McpMarketPriceInput(BaseModel):
    crop_type: str

async def fetch_mcp_market_price(input_data: McpMarketPriceInput) -> dict:
    """
    Fetch market prices from ManaMurah MCP.
    (Represents market data aggregator)
    """
    # Call MCP service
    # Return: retail_price, farmgate_price, market_trend, etc.
```

#### Tool 3: InventoryTool
```python
# tools/inventory_tool.py

class InventoryInput(BaseModel):
    user_id: str
    treatment_plan: str

async def fetch_inventory_cost(input_data: InventoryInput) -> dict:
    """Query Firestore inventory for treatment cost."""
    # Query firestore inventory collection
    # Return: total_cost, unit_cost, quantity_needed, etc.
```

#### Tool 4: ROITool
```python
# tools/roi_tool.py

class RoiInput(BaseModel):
    retail_price: float
    survival_prob: float
    treatment_cost: float
    crop_type: str
    farm_size_hectares: float

async def calculate_roi_deterministic(input_data: RoiInput) -> dict:
    """
    Calculate ROI with deterministic logic (no LLM).
    Provides clear financial projections.
    """
    # Local calculation
    # Return: revenue_if_treat, revenue_if_no_treat, roi_percent, etc.
```

#### Tool 5: FCMTool
```python
# tools/fcm_tool.py

async def send_fcm_notification(user_id: str, message: str) -> bool:
    """Send push notification via Firebase Cloud Messaging."""
    # Call Firebase FCM API
    # Send to farmer's mobile device
```

---

### 2.4 Swarm Orchestration Flow

```python
async def orchestrate_swarm_decision(diagnosis_result: ScanResult) -> SwarmOutput:
    """
    Main entry point for Swarm orchestration.
    All agents run in parallel.
    """
    
    # Extract key data from diagnosis
    grid_id = diagnosis_result.grid_id
    crop_type = diagnosis_result.cropType
    treatment_plan = diagnosis_result.treatmentPlan
    survival_prob = diagnosis_result.survivalProb
    
    # Get farmer and farm data from Firestore
    farmer = await firestore_service.get_farmer(user_id)
    farm = await firestore_service.get_farm(farm_id)
    weather = await weather_service.get_location(farm.location)
    
    # Prepare agent inputs
    met_input = MeteorologistInput(
        lat=farm.location.lat,
        lng=farm.location.lng,
        crop_type=crop_type
    )
    
    econ_input = EconomistInput(
        user_id=farmer.user_id,
        crop_type=crop_type,
        treatment_plan=treatment_plan,
        survival_prob=survival_prob,
        farm_size=farm.size_hectares
    )
    
    resource_input = ResourceManagerInput(
        user_id=farmer.user_id,
        farm_id=farm.farm_id,
        current_inventory=farm.inventory,
        treatment_plan=treatment_plan
    )
    
    spatial_input = SpatialInput(
        affected_grids=[grid_id],
        grid_locations=farm.grids,
        weather_data=weather,
        crop_type=crop_type
    )
    
    # Run all 4 agents in parallel
    results = await asyncio.gather(
        ai.flow("meteorologist_flow")(met_input),
        ai.flow("economist_flow")(econ_input),
        ai.flow("resource_manager_flow")(resource_input),
        ai.flow("spatial_propagation_flow")(spatial_input),
        return_exceptions=True
    )
    
    # Handle exceptions
    meteorologist_output = results[0] if isinstance(results[0], str) else "Error"
    economist_output = results[1] if isinstance(results[1], str) else "Error"
    resource_output = results[2] if isinstance(results[2], str) else "Error"
    spatial_output = results[3] if isinstance(results[3], str) else "Error"
    
    # Build SwarmOutput
    swarm_output = SwarmOutput(
        diagnosis=diagnosis_result,
        meteorologist=meteorologist_output,
        economist=economist_output,
        resource_manager=resource_output,
        spatial_propagation=spatial_output,
        timestamp=datetime.utcnow()
    )
    
    # Store in Firestore
    await firestore_service.record_swarm_decision(swarm_output)
    
    # Send FCM notification to farmer
    combined_message = f"""
    🌾 PadiGuard Alert for {crop_type}
    
    Disease Detected: {diagnosis_result.disease}
    Severity: {diagnosis_result.severity}%
    
    Weather: {meteorologist_output[:100]}...
    Financial Impact: {economist_output[:100]}...
    """
    await fcm_tool.send_notification(farmer.user_id, combined_message)
    
    return swarm_output
```

---

### 2.5 Swarm Data Schema

#### Collection: `swarmDecisions`
```json
{
  "id": "decision_farmer_001_20240415_153045",
  "user_id": "farmer_001",
  "diagnosis": {...},
  "meteorologist_output": "...",
  "economist_output": "...",
  "resource_manager_output": "...",
  "spatial_propagation_output": "...",
  "timestamp": "2024-04-15T15:30:45Z",
  "action_taken": "Applied fungicide",
  "action_timestamp": "2024-04-15T16:00:00Z"
}
```

---

## Part 3: Integration & Data Flow

### 3.1 End-to-End Sequence

```
1. FRONTEND
   ├─ Mobile camera capture
   ├─ MediaPipe detection
   └─ Crop extraction

2. DIAGNOSIS SERVICE
   ├─ WS /ws/scan (receive ScanFrame)
   ├─ Pipeline execution (3 agents)
   ├─ ScanResponse (diagnosis)
   └─ if abnormal → Firestore record

3. SWARM TRIGGER
   ├─ Read diagnosis from Firestore
   ├─ Initialize 4 agents in parallel
   ├─ All agents run concurrently
   └─ SwarmOutput collection

4. BACKEND → FRONTEND
   ├─ Send diagnosis + swarm recommendations
   ├─ FCM push notifications
   └─ Update app UI with integrated advice

5. FARMER ACTION
   ├─ Review recommendations
   ├─ Decide on treatment
   └─ Report action back to system
```

---

## Part 4: Deployment & Scaling

### 4.1 Docker Deployment

```dockerfile
# Dockerfile (backend root)
FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y build-essential
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# Expose ports
EXPOSE 8000 3400

# Run Diagnosis service by default
CMD ["uvicorn", "diagnosis/main:app", "--host", "0.0.0.0", "--port", "8000"]

# To run Swarm service instead:
# CMD ["python", "swarm/main.py"]
```

### 4.2 Kubernetes Deployment (Optional)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: padiguard-diagnosis
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: diagnosis
        image: padiguard-backend:latest
        ports:
        - containerPort: 8000
        env:
        - name: GOOGLE_APPLICATION_CREDENTIALS
          valueFrom:
            secretKeyRef:
              name: gcp-credentials
              key: creds.json

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: padiguard-swarm
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: swarm
        image: padiguard-backend:latest
        command: ["python", "swarm/main.py"]
        ports:
        - containerPort: 3400
```

---

## Part 5: Performance & Monitoring

### 5.1 Latency Targets

| Component | Target | Notes |
|-----------|--------|-------|
| Embedding | 200-300ms | Vertex AI API |
| Vector Search | 100-150ms | Top-5 on 50K vectors |
| Firestore Query | 50-100ms | Indexed on candidate_id |
| Reasoning | 50-100ms | Local logic |
| **Total Diagnosis (1 region)** | **500-700ms** | Sum of above |
| **Total Diagnosis (3 regions)** | **600-800ms** | Parallel execution |
| Swarm (4 agents) | 3-5s | Parallel agent execution |

### 5.2 Monitoring & Logging

**Key Metrics:**
- Embedding API success rate
- Vector search hit rate
- Firestore read/write latency
- Pipeline execution time per region
- Swarm agent response time
- Error rates by component

**Logging:**
```python
# All services log to:
# - stdout (for container logs)
# - Firestore (for audit trail)
# - Cloud Logging (if deployed on GCP)

# Log levels:
# - ERROR: Service failures, critical issues
# - WARNING: Degraded performance, retries
# - INFO: Normal operations, key events
# - DEBUG: Detailed state, API calls
```

---

## Part 6: Future Enhancements

1. **Model Retraining Pipeline**
   - Auto-retrain embedding model on new crops
   - Update candidate index weekly

2. **Caching Layer**
   - Redis cache for embeddings
   - LRU cache for vector search results

3. **Batch Processing**
   - High-volume scan batching
   - Off-peak processing for historical analysis

4. **Additional Agents**
   - Agronomist Agent (expert recommendations)
   - Labor Cost Optimizer
   - Irrigation Advisor

5. **Multi-Language Support**
   - Localize all agent outputs
   - Regional crop/disease terminology

---

## Summary

PadiGuard AI Backend provides a production-ready, scalable architecture for:
- **Real-time plant disease diagnosis** via vector search
- **Multi-agent agricultural decision support** via Genkit
- **Farmer-friendly guidance** through LLM-powered advisors
- **Integrated financial & operational optimization**

The modular design allows easy extension, the parallel execution model ensures responsiveness, and the Firestore-backed persistence enables audit trails and continuous learning.

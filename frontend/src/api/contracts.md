# PadiGuard Frontend API Contracts

This document defines the active runtime contracts used by the frontend API layer.

## Runtime Addressing

- Frontend requests use same-origin paths in production and development.
- Development forwards `/api`, `/health`, and `/ws` through Vite proxy to the diagnosis backend target.

## 1) Health Check

Route:
- `GET /health`

Frontend call:
- `gateway.health()`

Response shape:

```json
{
  "status": "ok",
  "service": "padiguard-livescan"
}
```

## 2) Disease Scan

Route:
- `POST /api/scan`

Frontend call:
- `scanDisease({ source, gridId?, base64Image })`

Request body:

```json
{
  "source": "camera",
  "grid_id": "section_A1",
  "base64_image": "..."
}
```

Response shape:

```json
{
  "disease": "Blast",
  "severity": 64,
  "confidence": 92,
  "spread_risk": "High",
  "zone": "section_A1",
  "crop_type": "Rice",
  "treatment_plan": "Apply fungicide..."
}
```

## 3) Assistant Scan (Photo + Reply)

Route:
- `POST /api/assistant/scan`

Frontend call:
- `scanAndAskAssistant({ source, gridId?, base64Image, userPrompt? })`

Response shape:

```json
{
  "disease": "Blast",
  "severity": 64,
  "confidence": 92,
  "spread_risk": "High",
  "zone": "section_A1",
  "crop_type": "Rice",
  "treatment_plan": "Apply fungicide...",
  "assistant_reply": "Detected Blast. Prioritize treatment..."
}
```

## 4) Assistant Text Message

Route:
- `POST /api/assistant/message`

Frontend call:
- `sendAssistantMessage({ userPrompt, userId, zone? })`

Request body:

```json
{
  "user_prompt": "Show the latest risk trend",
  "user_id": "uid_123",
  "zone": "section_A1"
}
```

Response shape:

```json
{
  "assistant_reply": "Latest scan shows..."
}
```

## 5) Weather Outlook

Route:
- `GET /api/weather?lat=<float>&lng=<float>&days=<int>`
- `GET /api/v1/weather?lat=<float>&lng=<float>&days=<int>` (versioned alias)

Frontend call:
- `getWeatherOutlook({ lat, lng, days })`

Response shape:

```json
{
  "rain_probability": 76,
  "best_spray_window": "Today 3:00 PM - 5:00 PM",
  "advisory": "Delay spraying due to rain risk.",
  "condition": "Cloudy",
  "temperatureC": 29,
  "windKmh": 12,
  "windDirection": "SW",
  "rainInHours": 2,
  "safeToSpray": false,
  "forecast": [
    {
      "day": "Today",
      "condition": "Cloudy",
      "rainChance": 76,
      "wind": "12 km/h SW",
      "sprayWindow": "Delay spraying",
      "safe": false,
      "temperature_high": 33,
      "temperature_low": 25,
      "hourly": [
        {
          "time": "9:00 AM",
          "temperature_c": 27,
          "rain_chance": 30,
          "wind_kmh": 8,
          "condition": "Partly Cloudy",
          "safe_to_spray": true
        }
      ]
    }
  ]
}
```

## 5b) Meteorologist AI Advisory

Route:
- `POST /swarm-api/runAction` (proxied to swarm :3400)

Frontend call:
- `getMeteorologistAdvisory({ lat, lng, cropType })`

Request body:

```json
{
  "key": "/flow/meteorologist_flow",
  "input": {
    "lat": 3.14,
    "lng": 101.7,
    "crop_type": "Rice"
  }
}
```

Response shape:

```json
{
  "result": "🌦️ Weather Advisory for your Rice farm...\n\n✅ SAFE to spray now..."
}
```


## 6) Treatment and ROI

Route:
- `POST /api/treatment`

Frontend call:
- `getTreatmentPlan({ disease, zone?, cropType, treatmentPlan, userId, farmSizeHectares, survivalProb, lat?, lng?, weatherContext?, treatmentCostRm? })`

Request body:

```json
{
  "disease": "Blast",
  "zone": "section_A1",
  "crop_type": "Rice",
  "treatment_plan": "Nativo 75WG",
  "user_id": "uid_123",
  "farm_size_hectares": 3.2,
  "survival_prob": 0.65,
  "lat": 3.14,
  "lng": 101.7,
  "weatherContext": null,
  "treatment_cost_rm": null
}
```

Response shape:

```json
{
  "recommendation": "Apply Nativo 75WG...",
  "estimated_cost_rm": 110.0,
  "expected_gain_rm": 640.0,
  "roi_x": 5.8,
  "organic_alternative": "No verified organic alternative available from current connected data sources."
}
```

## 7) Inventory List and Update

Routes:
- `GET /api/inventory?user_id=<string>`
- `PATCH /api/inventory/{item_id}`

Frontend calls:
- `getInventory({ userId })`
- `updateInventoryItem(itemId, { userId, liters })`

List response shape:

```json
{
  "items": [
    {
      "id": "nativo-75wg",
      "name": "Nativo 75WG",
      "category": "Fungicides",
      "liters": 1.8,
      "unit_cost_rm": 25.0,
      "last_updated_iso": "2026-04-16T09:00:00+00:00"
    }
  ],
  "total_items": 1,
  "low_stock_count": 1,
  "last_updated_iso": "2026-04-16T09:00:00+00:00"
}
```

Update request body:

```json
{
  "user_id": "uid_123",
  "liters": 3.5
}
```

Update response shape:

```json
{
  "id": "nativo-75wg",
  "liters": 3.5,
  "updated": true
}
```

## 8) Dashboard Summary

Route:
- `POST /api/dashboard/summary`

Frontend call:
- `getDashboardSummary({ userId, cropType, treatmentPlan, farmSizeHectares, survivalProb, lat?, lng? })`

Response shape:

```json
{
  "weatherSnapshot": {
    "condition": "Cloudy",
    "temperatureC": 29,
    "windKmh": 12,
    "windDirection": "SW",
    "rainInHours": 2
  },
  "zoneHealthSummary": {
    "totalAreaHectares": 38.6,
    "healthy": 71,
    "atRisk": 19,
    "infected": 10,
    "zonesNeedingAttention": 2
  },
  "financialSummary": {
    "roiPercent": 18.7,
    "projectedRoiValueRm": 2430.0,
    "projectedYieldGainRm": 3720.0,
    "treatmentCostRm": 1290.0,
    "lowStockItem": "Nativo 75WG",
    "lowStockLiters": 3.4
  }
}
```

## 9) Live Scanner WebSocket

Route:
- `WS /ws/scan`

Request shape:

```json
{
  "grid_id": "section_A1",
  "frame_number": 12,
  "base64_image": "...",
  "regions": []
}
```

Response shape:

```json
{
  "frame_number": 12,
  "results": [
    {
      "cropType": "Rice",
      "disease": "Blast",
      "severity": "Moderate",
      "severityScore": 0.64,
      "treatmentPlan": "Apply fungicide...",
      "survivalProb": 0.78,
      "is_abnormal": true,
      "bbox": {
        "x": 0.2,
        "y": 0.3,
        "width": 0.3,
        "height": 0.3,
        "mediapipe_label": "leaf",
        "detection_score": 0.9
      }
    }
  ]
}
```

## 10) Swarm Orchestrator (Frontend Proxy)

Route:
- `GET /swarm-api/actions`
- `POST /swarm-api/runAction`

Frontend call:
- `runSwarmOrchestrator(input)`

Request body:

```json
{
  "key": "/flow/swarm_orchestrator",
  "input": {
    "user_id": "uid_123",
    "grid_id": "section_A1",
    "lat": 3.14,
    "lng": 101.7,
    "crop_type": "Rice",
    "disease": "Blast",
    "severity": "Medium",
    "severity_score": 0.55,
    "survival_prob": 0.7,
    "farm_size": 3.2,
    "treatment_plan": "Nativo 75WG",
    "wind_speed_kmh": 8,
    "wind_direction": "NE"
  }
}
```

Response shape:

```json
{
  "result": {
    "weather": "...",
    "economy": "...",
    "resources": "...",
    "spatial_risk": {
      "base_radius_meters": 300,
      "wind_direction_degrees": 45,
      "wind_stretch_factor": 1.8,
      "spread_rate_meters_per_day": 22.5,
      "advisory_message": "..."
    }
  },
  "telemetry": {
    "traceId": "..."
  }
}
```

## Error Contract

- Current backend failures are returned primarily as FastAPI standard:

```json
{
  "detail": "Human-readable error message"
}
```

- Frontend gateway also accepts nested error payloads when upstream services return:

```json
{
  "error": {
    "message": "Human-readable error message"
  }
}
```

- Structured backend errors are also supported:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "detail": "Human-readable error message"
}
```

## Versioned and Alias Endpoints

- Inventory:
  - `POST /api/inventory` (alias of v1 create)
  - `POST /api/v1/inventory`
  - `GET /api/inventory?user_id=<string>` (legacy list contract)
  - `GET /api/v1/inventory?user_id=<string>` (canonical v1 item schema)
  - `PATCH /api/inventory/{item_id}` (legacy absolute liters update)
  - `PATCH /api/v1/inventory/{item_id}` (delta `quantity_change` update)

### v1 Inventory Create request

```json
{
  "user_id": "uid_123",
  "name": "Nativo 75WG",
  "quantity": 3.5,
  "usage": "fungicide",
  "unit": "liters"
}
```

### v1 Inventory Create response

```json
{
  "success": true,
  "item": {
    "id": "auto_doc_id",
    "name": "Nativo 75WG",
    "quantity": 3.5,
    "usage": "fungicide",
    "unit": "liters",
    "created_at": "2026-04-17T10:00:00+00:00",
    "updated_at": "2026-04-17T10:00:00+00:00"
  }
}
```

### v1 Inventory delta update request

```json
{
  "user_id": "uid_123",
  "quantity_change": -1.0
}
```

- Zones summary:
  - `GET /api/zones`
  - `GET /api/zones/summary`
  - `GET /api/v1/zones/summary`

Response:

```json
{
  "total_zones": 8,
  "healthy": 5,
  "warning": 2,
  "unhealthy": 1
}
```

- Weather:
  - `GET /api/weather` keeps existing rich forecast contract used by current UI
  - `GET /api/v1/weather` provides simplified widget contract

### v1 Weather response

```json
{
  "temperature": 29,
  "humidity": 84,
  "wind_speed": 12,
  "rain_probability": 70,
  "safe_to_spray": false,
  "recommendation": "Rain expected within 2 hours. Delay spraying and recheck this evening."
}
```

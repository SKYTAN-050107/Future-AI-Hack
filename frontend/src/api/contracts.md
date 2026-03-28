# PadiGuard Frontend API Contracts

This document defines the expected request and response shapes used by the frontend integration layer.

## 1) Weather Outlook

Route usage:
- Dashboard summary and spray timing advisory

Frontend call:
- getWeatherOutlook()

Response shape:

```json
{
  "rain_probability": 76,
  "best_spray_window": "Today 3:00 PM - 5:00 PM",
  "advisory": "Avoid spraying tomorrow morning due to high rain intensity."
}
```

Required fields:
- rain_probability: number (0-100)
- best_spray_window: string
- advisory: string

## 2) Disease Scan

Route usage:
- Scanner capture result card
- Handoff to report and treatment pages

Frontend call:
- scanDisease({ source, imageUrl?, base64Image? })

Request notes:
- source: "camera" | "gallery" | "cache"
- provide either imageUrl or base64Image for backend inference

Response shape:

```json
{
  "disease": "Blast",
  "severity": 64,
  "confidence": 92,
  "spread_risk": "High",
  "zone": "Zone C"
}
```

Required fields:
- disease: string
- severity: number (0-100)
- confidence: number (0-100)
- spread_risk: string
- zone: string

## 3) Treatment Plan

Route usage:
- Treatment page recommendation and ROI cards

Frontend call:
- getTreatmentPlan({ disease, zone, severity?, weatherContext? })

Response shape:

```json
{
  "recommendation": "Apply tricyclazole at 0.6 kg/ha before evening rain window.",
  "estimated_cost_rm": 110,
  "expected_gain_rm": 640,
  "roi_x": 5.8,
  "organic_alternative": "Neem extract for low-severity sectors with follow-up scan in 48h."
}
```

Required fields:
- recommendation: string
- estimated_cost_rm: number
- expected_gain_rm: number
- roi_x: number
- organic_alternative: string

## 4) Error Contract

All endpoints should return the same error envelope for predictable UI handling.

```json
{
  "error": {
    "code": "string_code",
    "message": "Human-readable summary",
    "retriable": true
  }
}
```

Required fields:
- error.code: string
- error.message: string
- error.retriable: boolean

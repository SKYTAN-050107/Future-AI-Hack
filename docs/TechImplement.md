# 🌍 Farm Layout Mapping — Technical Implementation Plan

## 1. 🧠 System Overview

This feature builds a **Synchronized Spatial Grid System** that connects farm map regions (polygons) with real-time AI diagnostics.

### Core Idea

Each farm section = **GeoJSON Polygon + GridID + Health State** stored in Firestore.

The system combines:

* Map rendering (Mapbox)
* Spatial computation (Turf.js)
* Real-time database (Firestore)
* AI analysis (Vertex AI + Gemini)

---

## 2. 🏗️ Architecture Overview

### Frontend (React + Vite)

Handles:

* Map rendering
* Polygon drawing
* UI interactions
* Offline caching

### Backend (Firebase + AI)

Handles:

* Firestore storage
* Cloud Functions triggers
* Vertex AI spatial analysis
* Gemini location assistant

---

## 3. 🧩 Core Data Model (Firestore)

Collection: `grids`

```json
{
  "gridId": "GRID_001",
  "polygon": { "type": "Polygon", "coordinates": [...] },
  "areaHectares": 1.25,
  "plantDensity": 120,
  "healthState": "Healthy",
  "lastUpdated": "timestamp",
  "centroid": { "lat": 4.123, "lng": 101.123 }
}
```

---

## 4. 🗺️ Map Rendering (Mapbox GL JS)

### Setup

* Install Mapbox:

```bash
npm install mapbox-gl
```

### Initialize Map

```js
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = 'YOUR_TOKEN';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/satellite-v9',
  center: [101.0, 4.0],
  zoom: 15
});
```

---

## 5. 📐 Turf.js — Core Usage

### Install

```bash
npm install @turf/turf
```

### Key Concepts

Turf.js works with **GeoJSON**.

---

### 5.1 Create Polygon

```js
import * as turf from '@turf/turf';

const polygon = turf.polygon([[
  [101.0, 4.0],
  [101.1, 4.0],
  [101.1, 4.1],
  [101.0, 4.1],
  [101.0, 4.0]
]]);
```

---

### 5.2 Calculate Area (Hectares)

```js
const area = turf.area(polygon); // in square meters
const hectares = area / 10000;
```

---

### 5.3 Get Centroid (for AI + GPS matching)

```js
const center = turf.centroid(polygon);
```

---

### 5.4 Distance Between Grids

```js
const dist = turf.distance(point1, point2, { units: 'kilometers' });
```

---

## 6. ✏️ Polygon Drawing Flow

Use Mapbox Draw:

```bash
npm install @mapbox/mapbox-gl-draw
```

### Flow

1. User draws polygon
2. Capture GeoJSON
3. Pass to Turf
4. Calculate:

   * Area
   * Centroid
5. Save to Firestore

---

## 7. 🧱 Grid Segmentation Logic

Each polygon becomes:

* Unique GridID
* Stored object in Firestore

Optional advanced:

* Split large polygons into smaller grids using Turf:

```js
turf.squareGrid(bbox, cellSize);
```

---

## 8. 🌱 Plant Density Estimation

Formula:

```
plantDensity = number_of_plants / area
```

Can be:

* Manual input
* Estimated via AI (future)

---

## 9. 🎨 Health State Visualization

### Color Mapping

* Healthy → Green
* At-Risk → Amber
* Infected → Red

### Map Layer

```js
map.addLayer({
  id: 'grid-layer',
  type: 'fill',
  source: 'grids',
  paint: {
    'fill-color': [
      'match',
      ['get', 'healthState'],
      'Healthy', '#00FF00',
      'At-Risk', '#FFA500',
      'Infected', '#FF0000',
      '#CCCCCC'
    ]
  }
});
```

---

## 10. 🔄 Real-Time Updates (Firestore)

### Listener

```js
onSnapshot(collection(db, 'grids'), (snapshot) => {
  updateMap(snapshot.docs);
});
```

---

## 11. 🤖 Spatial Propagation Agent (Vertex AI)

### Logic

1. Get all infected grids
2. Compute distance to others using Turf
3. If distance < threshold → mark At-Risk
4. Suggest buffer zone

### Buffer Zone Example

```js
const buffer = turf.buffer(infectedPolygon, 50, { units: 'meters' });
```

---

## 12. 🧠 Gemini Spatial Advisor

### Inputs

* GPS coordinates
* Camera landmarks

### Logic

1. Convert GPS → Turf point
2. Compare with grid polygons

```js
turf.booleanPointInPolygon(point, polygon);
```

3. Return matching GridID

---

## 13. ⚡ Firestore Trigger

### Cloud Function

When scanner detects issue:

```js
exports.updateGridStatus = onDocumentUpdate(async (change) => {
  if (change.after.data().status === 'abnormal') {
    await updateGridHealth('Infected');
  }
});
```

---

## 14. 📡 Offline Support

### Mapbox

* Use tile caching
* Preload tiles for farm area

### Firestore

* Enable offline persistence

```js
enableIndexedDbPersistence(db);
```

---

## 15. 🔗 Full Data Flow

1. User draws polygon
2. Turf calculates area + centroid
3. Save to Firestore
4. Map renders polygon
5. Scanner updates GridID
6. Firestore triggers AI
7. Vertex AI evaluates spread
8. Map updates colors
9. Gemini helps user locate grid

---

## 16. 🧪 Acceptance Validation

| Requirement       | Implementation        |
| ----------------- | --------------------- |
| Area Accuracy     | Turf area calculation |
| Offline Map       | Mapbox caching        |
| Real-time updates | Firestore listeners   |
| Smooth UI         | React + Mapbox        |
| Spatial detection | Turf + Vertex AI      |

---

## 17. 🚀 Recommended Development Steps

### Phase 1 — Basics

* Setup Mapbox
* Draw polygons
* Store in Firestore

### Phase 2 — Turf Integration

* Area calculation
* Centroid
* Distance

### Phase 3 — Visualization

* Color states
* Real-time updates

### Phase 4 — AI Features

* Vertex AI propagation
* Gemini advisor

### Phase 5 — Offline

* Tile caching
* Firestore persistence

---

## 18. 💡 Key Takeaways

* Turf.js = spatial brain (math + geometry)
* Mapbox = visual layer
* Firestore = real-time state engine
* Vertex AI = prediction engine
* Gemini = intelligent assistant

Together → **Smart, AI-driven farm monitoring system**

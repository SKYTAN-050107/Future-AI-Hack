from vertexai.vision_models import MultiModalEmbeddingModel, Image
from google.cloud import aiplatform
from google.oauth2 import service_account
import json

# ======================
# 1. AUTH
# ======================
credentials = service_account.Credentials.from_service_account_file(
    r"C:\Users\cheng\Downloads\ragsystem-492216-73217bfdbcd7.json"
)

aiplatform.init(
    project="853665420353",
    location="us-central1",
    credentials=credentials
)

# ======================
# 2. MULTIMODAL EMBEDDING MODEL
# ======================
model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding")

image_path = r"D:\RAGsystem\Future-AI-Hack\leaf.jpg"
image = Image.load_from_file(image_path)

embedding = model.get_embeddings(image=image)
query_vec = embedding.image_embedding

print("✅ Embedding generated:", len(query_vec))

# ======================
# 3. VECTOR SEARCH
# ======================
endpoint = aiplatform.MatchingEngineIndexEndpoint(
    index_endpoint_name="projects/853665420353/locations/us-central1/indexEndpoints/5728413799271104512"
)

resp = endpoint.find_neighbors(
    deployed_index_id="deployed_index_v1_1776075438557",
    queries=[query_vec],
    num_neighbors=5
)

ids = [m.id for m in resp[0]]

print("\n🔍 Matched IDs:", ids)

# ======================
# 4. LOAD JSON (SAFE PARSER)
# ======================
json_path = r"C:\Users\cheng\Downloads\vector_index_data_ALL_COMBINED.json"

with open(json_path, "r", encoding="utf-8") as f:
    raw = json.load(f)

# auto-detect structure
if isinstance(raw, list):
    data = raw
elif isinstance(raw, dict) and "data" in raw:
    data = raw["data"]
elif isinstance(raw, dict) and "items" in raw:
    data = raw["items"]
elif isinstance(raw, dict):
    data = list(raw.values())
else:
    raise ValueError("Unknown JSON structure")

# build index map
index_map = {}
for item in data:
    if isinstance(item, dict) and "id" in item:
        index_map[item["id"]] = item

print("📦 Loaded metadata items:", len(index_map))

# ======================
# 5. MERGE VECTOR + METADATA
# ======================
results = []

for id in ids:
    if id not in index_map:
        continue

    item = index_map[id]

    # safe extract (based on your restricts format)
    try:
        crop = item["restricts"][0]["allow_list"][0]
        disease = item["restricts"][1]["allow_list"][0]
        image_uri = item["restricts"][2]["allow_list"][0]
    except Exception:
        crop = item.get("cropType", "Unknown")
        disease = item.get("disease", "Unknown")
        image_uri = item.get("gcs_uri", "Unknown")

    # distance match
    distance = next((m.distance for m in resp[0] if m.id == id), None)

    results.append({
        "id": id,
        "crop": crop,
        "disease": disease,
        "image": image_uri,
        "distance": distance
    })

# ======================
# 6. OUTPUT
# ======================
print("\n🌿 FINAL RESULT")
print("=" * 40)

for r in results:
    print(f"ID: {r['id']}")
    print(f"Crop: {r['crop']}")
    print(f"Disease: {r['disease']}")
    print(f"Image: {r['image']}")
    print(f"Distance: {r['distance']}")
    print("-" * 40)
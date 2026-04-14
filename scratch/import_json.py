import json

input_path = r"C:\Users\cheng\Downloads\vector_index_data_ALL_COMBINED.json"
output_path = r"C:\Users\cheng\Downloads\vector_index_final.json"

# ======================
# 1. 读取 JSONL
# ======================
data = []

with open(input_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            data.append(json.loads(line))

print("📦 Loaded:", len(data))

# ======================
# 2. 统一转换逻辑（3字段）
# ======================
cleaned = []

for item in data:
    raw_id = item["id"]

    # ----------------------
    # pest 类
    # ----------------------
    if raw_id.startswith("pests-"):
        cropType = "unknown"
        disease = raw_id.replace("pests-", "")

    # ----------------------
    # crop 类（disease / healthy）
    # ----------------------
    else:
        parts = raw_id.split("-")

        cropType = parts[0]

        if "healthy" in raw_id:
            disease = "healthy"
        else:
            disease = parts[-1]

    cleaned.append({
        "id": raw_id,
        "cropType": cropType,
        "disease": disease
    })

# ======================
# 3. 保存
# ======================
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(cleaned, f, indent=2)

print("✅ Done:", output_path)
"""
Offline Data Ingestion Script for Vertex AI Vector Search.

WHAT THIS DOES:
1. Reads your `metadata.csv` mapping.
2. Downloads/embeds the image from GCS using Multimodal Embedding.
3. Creates a `.jsonl` file containing the vector and all your required schema keys.
4. You then take this `.jsonl` file, upload it to a GC bucket, and create your Vector Search Index from it.

Run this ONCE when setting up your database.
"""

import csv
import json
import logging
import os
import time
import uuid
from typing import Any

import vertexai
from vertexai.vision_models import Image as VertexImage, MultiModalEmbeddingModel

from dotenv import load_dotenv

# ── Load .env from parent diagnosis directory ─────────────────────────
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

# --- CONFIGURATION (loaded from .env) ---
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
CSV_FILE_PATH = os.getenv("CSV_FILE_PATH", "pc_a.csv")
OUTPUT_JSONL_PATH = os.getenv("OUTPUT_JSONL_PATH", "vector_index_data.jsonl")
EMBEDDING_DIMENSION = int(os.getenv("EMBEDDING_DIMENSION", "1408"))
# -----------------------------------------

logging.basicConfig(level=logging.INFO)

# ── Retry Configuration ───────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 5


def embed_with_retry(model, gcs_uri: str, dimension: int) -> list[float]:
    """Embed a single image with retry logic for transient API failures."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            image = VertexImage.load_from_file(gcs_uri)
            response = model.get_embeddings(image=image, dimension=dimension)
            return list(response.image_embedding)
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            logging.warning(
                "Attempt %d/%d failed for %s: %s — retrying in %ds...",
                attempt, MAX_RETRIES, gcs_uri, e, RETRY_DELAY_SECONDS,
            )
            time.sleep(RETRY_DELAY_SECONDS)
    return []  # unreachable, but satisfies type checkers


def build_index_data():
    if not GCP_PROJECT_ID or GCP_PROJECT_ID.startswith("REPLACE_ME"):
        logging.error("❌ GCP_PROJECT_ID 未设置！请先编辑 .env 文件。")
        return

    vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION)
    model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")

    # ── Track progress for resumable ingestion ────────────────────────
    processed_uris: set[str] = set()
    if os.path.exists(OUTPUT_JSONL_PATH):
        logging.info("Found existing %s — loading already-processed URIs for resume...", OUTPUT_JSONL_PATH)
        with open(OUTPUT_JSONL_PATH, 'r', encoding='utf-8') as existing:
            for line in existing:
                try:
                    record = json.loads(line)
                    # Store the gcs_uri from restricts if available
                    for r in record.get("restricts", []):
                        if r.get("namespace") == "gcs_uri":
                            processed_uris.add(r["allow_list"][0])
                except json.JSONDecodeError:
                    continue
        logging.info("Resuming — %d datapoints already processed.", len(processed_uris))

    with open(CSV_FILE_PATH, mode='r', encoding='utf-8') as csv_file, \
         open(OUTPUT_JSONL_PATH, mode='a', encoding='utf-8') as jsonl_file:

        reader = csv.DictReader(csv_file)
        count = 0
        skipped = 0
        failed = 0

        for row in reader:
            gcs_uri = row['gcs_uri']

            # Skip already-processed URIs (for resumable runs)
            if gcs_uri in processed_uris:
                skipped += 1
                continue

            logging.info("Processing: %s", gcs_uri)

            try:
                embedding = embed_with_retry(model, gcs_uri, EMBEDDING_DIMENSION)
            except Exception as e:
                logging.error("❌ FAILED permanently for %s: %s — skipping.", gcs_uri, e)
                failed += 1
                continue

            # Package the vector together with metadata
            datapoint_id = uuid.uuid4().hex

            jsonl_record = {
                "id": datapoint_id,
                "embedding": embedding,
                "restricts": [
                    {"namespace": "cropType", "allow_list": [row['cropType']]},
                    {"namespace": "disease", "allow_list": [row['disease']]},
                    {"namespace": "gcs_uri", "allow_list": [gcs_uri]},
                ]
            }

            jsonl_file.write(json.dumps(jsonl_record) + "\n")
            jsonl_file.flush()  # Flush after each write for crash safety
            
            # 🔥 添加这一行：将当前uri加入集合，防止CSV自己出现重复行导致写入相同的向量
            processed_uris.add(gcs_uri) 
            count += 1

            if count % 100 == 0:
                logging.info("✅ 已处理 %d 张图（跳过 %d，失败 %d）...", count, skipped, failed)

    logging.info(
        "🎉 完成！新增 %d 条向量，跳过 %d 条（已存在），失败 %d 条。输出: %s",
        count, skipped, failed, OUTPUT_JSONL_PATH,
    )
    logging.info("NEXT STEP: Upload the JSONL to GCS, and create a Vertex AI Vector Search Index pointing to it!")

if __name__ == "__main__":
    build_index_data()

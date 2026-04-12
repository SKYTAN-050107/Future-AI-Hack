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
import uuid
from typing import Any

import vertexai
from vertexai.vision_models import Image as VertexImage, MultiModalEmbeddingModel

logging.basicConfig(level=logging.INFO)

# --- CONFIGURATION (Update these) ---
GCP_PROJECT_ID = "your-gcp-project-id"
GCP_REGION = "us-central1"
CSV_FILE_PATH = "my_metadata.csv"
OUTPUT_JSONL_PATH = "vector_index_data.jsonl"
# ------------------------------------

def build_index_data():
    vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION)
    model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")

    with open(CSV_FILE_PATH, mode='r', encoding='utf-8') as csv_file, \
         open(OUTPUT_JSONL_PATH, mode='w', encoding='utf-8') as jsonl_file:
        
        reader = csv.DictReader(csv_file)
        count = 0
        
        for row in reader:
            gcs_uri = row['gcs_uri']
            logging.info(f"Processing: {gcs_uri}")
            
            # 1. Ask Vertex AI to convert the image to a mathematical vector
            image = VertexImage.load_from_file(gcs_uri)
            response = model.get_embeddings(image=image, dimension=1408)
            embedding = list(response.image_embedding)
            
            # 2. Package the vector together with your exact metadata
            #    We store your parameters in "restricts" so they can be retrieved later
            datapoint_id = uuid.uuid4().hex
            
            jsonl_record = {
                "id": datapoint_id,
                "embedding": embedding,
                "restricts": [
                    {"namespace": "cropType", "allow_list": [row['cropType']]},
                    {"namespace": "disease", "allow_list": [row['disease']]}
                ]
            }
            
            # 3. Write it to the JSONL file
            jsonl_file.write(json.dumps(jsonl_record) + "\n")
            count += 1
            
    logging.info(f"Finished generating {count} datapoints into {OUTPUT_JSONL_PATH}")
    logging.info("NEXT STEP: Upload the JSONL to GCS, and create a Vertex AI Vector Search Index pointing to it!")

if __name__ == "__main__":
    build_index_data()

import os
from google import genai
from config import get_settings
from dotenv import load_dotenv

def list_models():
    # ── Load .env ──
    dotenv_path = os.path.join(os.path.dirname(__file__), 'backend', 'diagnosis', '.env')
    load_dotenv(dotenv_path)
    
    settings = get_settings()
    if settings.GOOGLE_APPLICATION_CREDENTIALS:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

    print(f"Checking models for project: {settings.GCP_PROJECT_ID} in {settings.GCP_REGION}")
    
    client = genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_REGION,
    )
    
    try:
        # 尝试列出模型 (注意：google-genai SDK 此时可能还在完善 list_models)
        # 我们直接尝试创建一个简单的请求来验证
        print("Testing model: gemini-1.5-flash ...")
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents='hello',
        )
        print("✅ gemini-1.5-flash is working!")
    except Exception as e:
        print(f"❌ gemini-1.5-flash failed: {e}")

    try:
        print("Testing model: gemini-1.5-flash-001 ...")
        response = client.models.generate_content(
            model='gemini-1.5-flash-001',
            contents='hello',
        )
        print("✅ gemini-1.5-flash-001 is working!")
    except Exception as e:
        print(f"❌ gemini-1.5-flash-001 failed: {e}")

if __name__ == "__main__":
    list_models()

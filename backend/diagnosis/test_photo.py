import asyncio
import base64
import json
import sys
import os

# 把当前目录加入 sys.path，避免找不到包的问题
sys.path.append(os.path.dirname(__file__))

from config import get_settings
from orchestration.pipeline import LiveScanPipeline

async def main():
    # ── 自动设置 Google 凭据 ──────────────────────────────────────────
    settings = get_settings()
    if settings.GOOGLE_APPLICATION_CREDENTIALS:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS
    
    if len(sys.argv) < 2:
        print("❌ 请输入照片路径！用法: python test_photo.py <你的图片路径.jpg>")
        return

    image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        print(f"❌ 找不到图片: {image_path}")
        return
        
    print(f"[IMAGE] Reading: {image_path} ...")
    with open(image_path, "rb") as f:
        image_bytes = f.read()
    
    # 模拟前端的 base64 转换
    base64_str = base64.b64encode(image_bytes).decode("utf-8")
    
    # 模拟 MediaPipe 从截图中框出的范围 (这里假设是一整片叶子)
    dummy_bbox = {
        "x": 0.0,
        "y": 0.0,
        "width": 1.0,
        "height": 1.0,
        "mediapipe_label": "leaf",
        "detection_score": 0.99
    }
    
    print("[INIT] Starting LiveScanPipeline (Google ADK)...")
    pipeline = LiveScanPipeline()
    
    print("[ANALYSIS] Processing image via AI pipeline, please wait...")
    result = await pipeline.run(
        cropped_image_b64=base64_str,
        bbox=dummy_bbox,
        grid_id="test_grid_001"  # 模拟网格ID
    )
    
    print("\n" + "="*50)
    print("--- ADK DIAGNOSIS RESULT ---")
    print("="*50)
    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    # 为了避免 Windows 下的一些 asyncio 事件循环报错
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())

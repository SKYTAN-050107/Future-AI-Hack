"""Offline scanner demo for the diagnosis pipeline.

This script simulates frontend scanner behavior:
- one frame can contain multiple detected plants (regions),
- each region is processed concurrently through LiveScanPipeline,
- in auto-discover mode, one image is split into tiles and output count equals discovered kinds.

Usage (from backend/diagnosis/):
    python run_leaf_demo.py
    python run_leaf_demo.py --repeat 4
    python run_leaf_demo.py --images ../../leaf.jpg ../../leaf.jpg ../../leaf.jpg
    python run_leaf_demo.py --realtime-sim --image ../../leaf.jpg --num-plants 5 --frames 3
    python run_leaf_demo.py --realtime-sim --image ../../leaf.jpg --num-plants 5 --frames 30 --fps 5 --loop-output

Requirements:
- .env configured for Vertex AI / Firestore (same as main app)
- Google Cloud credentials available in environment
"""

from __future__ import annotations

import asyncio
import argparse
import base64
import io
import json
import logging
from pathlib import Path

from PIL import Image

from orchestration.pipeline import LiveScanPipeline

# Configure logging to see diagnostic output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

ROOT_DIR = Path(__file__).resolve().parents[2]
IMAGE_PATH = ROOT_DIR / "leaf.jpg"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate scanner multi-plant detection in one frame")
    parser.add_argument(
        "--images",
        nargs="*",
        default=None,
        help="Image paths to use as detected plant regions. If omitted, uses leaf.jpg",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="When --images is omitted, repeat leaf.jpg this many times to simulate N plants",
    )
    parser.add_argument(
        "--auto-discover",
        action="store_true",
        help="Use one image, split into grid regions, and output unique discovered kinds",
    )
    parser.add_argument(
        "--grid-rows",
        type=int,
        default=2,
        help="Grid rows for --auto-discover mode",
    )
    parser.add_argument(
        "--grid-cols",
        type=int,
        default=2,
        help="Grid cols for --auto-discover mode",
    )
    parser.add_argument(
        "--grid-id",
        default="demo_grid_1",
        help="Grid ID attached to all simulated regions",
    )
    parser.add_argument(
        "--frame-number",
        type=int,
        default=1,
        help="Frame number for output payload",
    )
    parser.add_argument(
        "--realtime-sim",
        action="store_true",
        help="Simulate live camera mode with persistent track IDs and per-box outputs",
    )
    parser.add_argument(
        "--image",
        default=None,
        help="Single image path for --realtime-sim mode (default: leaf.jpg)",
    )
    parser.add_argument(
        "--num-plants",
        type=int,
        default=5,
        help="Number of detected plants (boxes) to simulate in --realtime-sim mode",
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=1,
        help="How many consecutive frames to simulate in --realtime-sim mode",
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=2.0,
        help="Frame rate for --realtime-sim mode",
    )
    parser.add_argument(
        "--loop-output",
        action="store_true",
        help="Print one frame result at a time to mimic realtime streaming output",
    )
    return parser.parse_args()


def _resolve_image_paths(args: argparse.Namespace) -> list[Path]:
    if args.images:
        paths = [Path(p).expanduser().resolve() for p in args.images]
    else:
        if args.repeat < 1:
            raise ValueError("--repeat must be >= 1")
        paths = [IMAGE_PATH for _ in range(args.repeat)]

    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Image(s) not found: {missing}")
    return paths


def _bbox_for_index(i: int, total: int) -> dict:
    # Spread bboxes across x-axis to mimic multiple plant detections.
    width = 0.22
    x = min(0.76, 0.02 + i * (0.96 / max(total, 1)))
    return {
        "x": round(x, 3),
        "y": 0.1,
        "width": width,
        "height": 0.8,
        "mediapipe_label": "leaf",
        "detection_score": 0.9,
    }


def _bbox_for_cell(row: int, col: int, rows: int, cols: int) -> dict:
    return {
        "x": round(col / cols, 3),
        "y": round(row / rows, 3),
        "width": round(1.0 / cols, 3),
        "height": round(1.0 / rows, 3),
        "mediapipe_label": "leaf",
        "detection_score": 0.9,
    }


def _bbox_for_live_index(i: int, total: int) -> dict:
    """Generate stable detection boxes to mimic tracked plants in live camera mode."""
    # Pack detections into a near-square grid.
    cols = max(1, int(total ** 0.5))
    while cols * cols < total:
        cols += 1
    rows = (total + cols - 1) // cols

    r = i // cols
    c = i % cols
    pad = 0.02
    cell_w = (1.0 - pad * (cols + 1)) / cols
    cell_h = (1.0 - pad * (rows + 1)) / rows

    return {
        "x": round(pad + c * (cell_w + pad), 3),
        "y": round(pad + r * (cell_h + pad), 3),
        "width": round(max(0.08, cell_w), 3),
        "height": round(max(0.08, cell_h), 3),
        "mediapipe_label": "leaf",
        "detection_score": 0.92,
    }


def _crop_image_with_bbox(image_path: Path, bbox: dict) -> str:
    """Crop a normalized bbox from one image and return base64 JPEG bytes."""
    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
        width, height = rgb.size

        left = int(float(bbox["x"]) * width)
        top = int(float(bbox["y"]) * height)
        right = int(float(bbox["x"] + bbox["width"]) * width)
        bottom = int(float(bbox["y"] + bbox["height"]) * height)

        left = max(0, min(left, width - 1))
        top = max(0, min(top, height - 1))
        right = max(left + 1, min(right, width))
        bottom = max(top + 1, min(bottom, height))

        crop = rgb.crop((left, top, right, bottom))
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=92)
        return base64.b64encode(buf.getvalue()).decode("utf-8")


def _label_anchor_for_bbox(bbox: dict) -> dict:
    """UI anchor point near the bbox, mimicking label placement beside each plant."""
    ax = min(0.98, float(bbox["x"]) + float(bbox["width"]) + 0.01)
    ay = max(0.02, float(bbox["y"]) + 0.02)
    return {"x": round(ax, 3), "y": round(ay, 3)}


def _build_regions_from_single_image(image_path: Path, rows: int, cols: int) -> list[tuple[str, dict]]:
    if rows < 1 or cols < 1:
        raise ValueError("--grid-rows and --grid-cols must be >= 1")

    with Image.open(image_path) as img:
        rgb = img.convert("RGB")
        width, height = rgb.size

        regions: list[tuple[str, dict]] = []
        for r in range(rows):
            for c in range(cols):
                left = int(c * width / cols)
                right = int((c + 1) * width / cols)
                top = int(r * height / rows)
                bottom = int((r + 1) * height / rows)

                crop = rgb.crop((left, top, right, bottom))
                buf = io.BytesIO()
                crop.save(buf, format="JPEG", quality=92)
                cropped_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                regions.append((cropped_b64, _bbox_for_cell(r, c, rows, cols)))

    return regions


def _kind_key(result: dict) -> tuple[str, str]:
    return (
        str(result.get("cropType", "Unknown")).strip().lower(),
        str(result.get("disease", "Unknown")).strip().lower(),
    )


def _dedupe_by_kind(results: list[dict]) -> list[dict]:
    best_by_kind: dict[tuple[str, str], dict] = {}
    for res in results:
        if str(res.get("cropType", "")).lower() == "error":
            continue
        key = _kind_key(res)
        score = float(res.get("severityScore", 0.0))
        prev = best_by_kind.get(key)
        if prev is None or score > float(prev.get("severityScore", 0.0)):
            best_by_kind[key] = res
    return list(best_by_kind.values())


async def main() -> None:
    args = _parse_args()
    image_paths = _resolve_image_paths(args)

    pipeline = LiveScanPipeline()

    if args.realtime_sim:
        if args.num_plants < 1:
            raise ValueError("--num-plants must be >= 1")
        if args.frames < 1:
            raise ValueError("--frames must be >= 1")
        if args.fps <= 0:
            raise ValueError("--fps must be > 0")

        source_image = Path(args.image).expanduser().resolve() if args.image else image_paths[0]
        if not source_image.exists():
            raise FileNotFoundError(f"Image not found: {source_image}")

        tracked = [
            {
                "track_id": f"plant_{i + 1}",
                "bbox": _bbox_for_live_index(i, args.num_plants),
            }
            for i in range(args.num_plants)
        ]

        frame_outputs = []
        for frame_offset in range(args.frames):
            frame_no = args.frame_number + frame_offset
            tasks = []

            for det in tracked:
                crop_b64 = _crop_image_with_bbox(source_image, det["bbox"])
                tasks.append(
                    pipeline.run(
                        cropped_image_b64=crop_b64,
                        bbox=det["bbox"],
                        grid_id=args.grid_id,
                    )
                )

            raw_results = await asyncio.gather(*tasks, return_exceptions=True)

            overlays = []
            for i, raw in enumerate(raw_results):
                det = tracked[i]
                if isinstance(raw, Exception):
                    logging.error("Frame %d track %s failed: %s", frame_no, det["track_id"], raw)
                    overlays.append(
                        {
                            "track_id": det["track_id"],
                            "bbox": det["bbox"],
                            "label_anchor": _label_anchor_for_bbox(det["bbox"]),
                            "result": {
                                "cropType": "Error",
                                "disease": str(raw),
                                "severity": "Low",
                                "severityScore": 0.0,
                                "treatmentPlan": "None",
                                "survivalProb": 0.0,
                                "is_abnormal": False,
                            },
                        }
                    )
                    continue

                overlays.append(
                    {
                        "track_id": det["track_id"],
                        "bbox": det["bbox"],
                        "label_anchor": _label_anchor_for_bbox(det["bbox"]),
                        "result": raw,
                    }
                )

            frame_payload = {
                "frame_number": frame_no,
                "detected_regions": len(overlays),
                "outputs": overlays,
            }
            frame_outputs.append(frame_payload)

            if args.loop_output:
                print(json.dumps(frame_payload, ensure_ascii=False), flush=True)

            if frame_offset < args.frames - 1:
                await asyncio.sleep(1.0 / args.fps)

        response = {
            "mode": "realtime_sim",
            "source_image": str(source_image),
            "frames": frame_outputs,
        }
        if args.loop_output:
            summary = {
                "mode": "realtime_sim",
                "source_image": str(source_image),
                "total_frames": len(frame_outputs),
                "streamed": True,
            }
            print(json.dumps(summary, ensure_ascii=False), flush=True)
        else:
            print(json.dumps(response, indent=2, ensure_ascii=False))
        return

    regions: list[tuple[str, dict]] = []
    if args.auto_discover:
        source = image_paths[0]
        regions = _build_regions_from_single_image(
            source,
            rows=args.grid_rows,
            cols=args.grid_cols,
        )
    else:
        for i, image_path in enumerate(image_paths):
            image_bytes = image_path.read_bytes()
            cropped_image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            regions.append((cropped_image_b64, _bbox_for_index(i, len(image_paths))))

    tasks = []
    for cropped_image_b64, bbox in regions:
        tasks.append(
            pipeline.run(
                cropped_image_b64=cropped_image_b64,
                bbox=bbox,
                grid_id=args.grid_id,
            )
        )

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for i, raw in enumerate(raw_results):
        if isinstance(raw, Exception):
            logging.error("Region %d failed: %s", i, raw)
            results.append(
                {
                    "cropType": "Error",
                    "disease": str(raw),
                    "severity": "Low",
                    "severityScore": 0.0,
                    "treatmentPlan": "None",
                    "survivalProb": 0.0,
                    "is_abnormal": False,
                    "bbox": regions[i][1],
                }
            )
            continue
        results.append(raw)

    final_results = _dedupe_by_kind(results) if args.auto_discover else results

    response = {
        "frame_number": args.frame_number,
        "results": final_results,
        "detected_regions": len(regions),
        "detected_kinds": len(final_results),
        "mode": "auto_discover" if args.auto_discover else "multi_region",
    }

    print(json.dumps(response, indent=2, ensure_ascii=False))


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(main())

"""Bulk upload candidate metadata JSON/JSONL into Firestore.

Usage examples:
  python scripts/upload_candidate_metadata.py --input my_metadata.json
  python scripts/upload_candidate_metadata.py --input vector_index_data.jsonl --dry-run

Input shapes supported:
  1) JSON array: [{"id": "...", ...}, ...]
  2) JSON object with "data" or "items": {"data": [{...}]}
  3) JSONL: one object per line

Each item must include an id field (default key: "id").
Document path written:
  {collection}/{item[id_field]}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterable

from google.cloud import firestore

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from config import get_settings


def _count_items(path: str) -> int:
    """Count candidate records for progress display."""
    lower = path.lower()
    if lower.endswith(".jsonl"):
        count = 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1
        return count

    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if isinstance(raw, list):
        return len(raw)
    if isinstance(raw, dict):
        if isinstance(raw.get("data"), list):
            return len(raw["data"])
        if isinstance(raw.get("items"), list):
            return len(raw["items"])

    raise ValueError("Unsupported input format. Use JSON array/object or JSONL.")


def _print_progress(current: int, total: int, *, force: bool = False) -> None:
    """Render an in-place ASCII progress bar."""
    if total <= 0:
        return

    width = 30
    ratio = min(max(current / total, 0.0), 1.0)
    filled = int(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    percent = int(ratio * 100)
    end = "\n" if force or current >= total else "\r"
    print(f"Progress [{bar}] {percent:3d}% ({current}/{total})", end=end, flush=True)


def _iter_items(path: str) -> Iterable[dict]:
    lower = path.lower()
    if lower.endswith(".jsonl"):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if isinstance(obj, dict):
                    yield obj
        return

    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                yield item
        return

    if isinstance(raw, dict):
        if isinstance(raw.get("data"), list):
            for item in raw["data"]:
                if isinstance(item, dict):
                    yield item
            return
        if isinstance(raw.get("items"), list):
            for item in raw["items"]:
                if isinstance(item, dict):
                    yield item
            return

    raise ValueError("Unsupported input format. Use JSON array/object or JSONL.")


def _commit_batch(db: firestore.Client, writes: list[tuple[str, dict]], collection: str) -> int:
    batch = db.batch()
    for doc_id, payload in writes:
        ref = db.collection(collection).document(doc_id)
        batch.set(ref, payload, merge=True)
    batch.commit()
    return len(writes)


def main() -> None:
    settings = get_settings()

    parser = argparse.ArgumentParser(description="Upload candidate metadata to Firestore")
    parser.add_argument("--input", required=True, help="Path to metadata JSON/JSONL file")
    parser.add_argument(
        "--collection",
        default=settings.FIRESTORE_CANDIDATE_COLLECTION,
        help="Firestore collection name (default from settings)",
    )
    parser.add_argument(
        "--id-field",
        default="id",
        help="Field name containing candidate id used as document id",
    )
    parser.add_argument(
        "--project",
        default=settings.GCP_PROJECT_ID,
        help="GCP project id (default from settings)",
    )
    parser.add_argument(
        "--credentials",
        default=settings.GOOGLE_APPLICATION_CREDENTIALS or "",
        help="Optional path to service account json",
    )
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate without writing")
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable progress bar output",
    )
    args = parser.parse_args()

    if args.credentials:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = args.credentials

    db = firestore.Client(project=args.project) if not args.dry_run else None
    total_items = _count_items(args.input)

    total = 0
    skipped = 0
    pending: list[tuple[str, dict]] = []
    processed = 0
    last_percent = -1

    for item in _iter_items(args.input):
        processed += 1
        raw_id = item.get(args.id_field)
        if raw_id is None:
            skipped += 1
            if not args.no_progress and total_items > 0:
                percent = int((processed / total_items) * 100)
                if percent != last_percent:
                    _print_progress(processed, total_items)
                    last_percent = percent
            continue

        doc_id = str(raw_id)
        payload = dict(item)
        payload["id"] = doc_id

        pending.append((doc_id, payload))
        if len(pending) >= 400:
            if not args.dry_run:
                assert db is not None
                total += _commit_batch(db, pending, args.collection)
            else:
                total += len(pending)
            pending = []

        if not args.no_progress and total_items > 0:
            percent = int((processed / total_items) * 100)
            if percent != last_percent:
                _print_progress(processed, total_items)
                last_percent = percent

    if pending:
        if not args.dry_run:
            assert db is not None
            total += _commit_batch(db, pending, args.collection)
        else:
            total += len(pending)

    if not args.no_progress and total_items > 0:
        if last_percent != 100:
            _print_progress(total_items, total_items, force=True)
        else:
            print()

    mode = "DRY RUN" if args.dry_run else "WRITE"
    print(f"[{mode}] Done. collection={args.collection} uploaded={total} skipped={skipped}")


if __name__ == "__main__":
    main()

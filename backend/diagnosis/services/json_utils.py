"""Helpers for parsing structured model output."""

from __future__ import annotations

import json
import re
from typing import Any


_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)


def extract_json_payload(raw_text: str) -> Any:
    """Extract a JSON object or array from model output.

    The helper accepts fenced JSON, plain JSON, and responses with leading or
    trailing prose as long as a valid JSON payload is present.
    """
    text = (raw_text or "").strip()
    if not text:
        raise json.JSONDecodeError("Empty JSON payload", raw_text or "", 0)

    candidates: list[str] = [text]

    fence_match = _CODE_FENCE_RE.match(text)
    if fence_match:
        candidates.append(fence_match.group(1).strip())

    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end != -1 and end > start:
            candidates.append(text[start : end + 1].strip())

    decoder = json.JSONDecoder()
    seen: set[str] = set()

    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)

        try:
            payload, _ = decoder.raw_decode(candidate)
            return payload
        except json.JSONDecodeError:
            continue

    raise json.JSONDecodeError("Unable to parse JSON payload", raw_text or "", 0)


def extract_json_object(raw_text: str, *, fallback_key: str = "data") -> dict:
    """Extract a JSON payload and ensure it is a ``dict``.

    If the model returns a JSON array, wrap it as ``{fallback_key: [...]}``.
    If parsing fails entirely, return a fallback dict containing the raw text
    so callers always get a usable dict without raising.
    """
    try:
        payload = extract_json_payload(raw_text)
    except json.JSONDecodeError:
        return {"answer": str(raw_text or "").strip(), "format": "fallback_text", "valid": False}

    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        return {fallback_key: payload}
    return {"answer": str(payload), "format": "fallback_text", "valid": False}
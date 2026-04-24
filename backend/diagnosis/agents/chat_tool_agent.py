"""Tool-using chat agent for the /api/assistant/message endpoint.

The agent lets Gemini decide which backend services to call (scan history,
inventory, weather, crops, treatment/ROI, pesticide catalog, swarm advisory)
instead of relying on hand-coded keyword intent routing.

Usage:
    agent = ChatToolAgent(...)
    reply = await agent.run(
        user_prompt="should I treat zone A?",
        user_id="uid",
        zone="A",
        lat=3.13,
        lng=101.68,
        location="Sungai Besar",
        recent_messages=[{"role": "user", "text": "..."}, ...],
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable

from google.genai import types

from config import get_settings
from services.crop_service import CropService
from services.firestore_service import FirestoreService
from services.inventory_service import InventoryService
from services.llm_service import LLMService, detect_farmer_language
from services.swarm_client import SwarmClient, SwarmUnavailableError
from services.treatment_service import TreatmentService
from services.weather_service import WeatherService

logger = logging.getLogger(__name__)

_TOOL_DISPATCH_MAX_RETRIES = 2
_TOOL_DISPATCH_BASE_DELAY_S = 0.5


class ChatToolAgentError(RuntimeError):
    """Raised when the tool-use loop cannot produce a reply; caller should fall back."""


# ── Tool declarations (LLM-visible schemas) ───────────────────────────────
# Sensitive fields (user_id, lat, lng, zone, location) are injected from the
# request context and deliberately absent from these schemas so the LLM cannot
# fabricate them.

def _build_tool_declarations() -> list[types.Tool]:
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="get_scan_history",
                    description=(
                        "Fetch the farmer's recent crop disease scan reports from Firestore. "
                        "Returns the latest disease, severity, crop type, treatment plan, and "
                        "a simple severity trend. Call when the farmer asks about diagnosis, "
                        "recent scans, disease history, or symptoms on a specific zone."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "zone": types.Schema(
                                type=types.Type.STRING,
                                description="Optional zone/grid filter. Omit for all zones.",
                            ),
                            "limit": types.Schema(
                                type=types.Type.INTEGER,
                                description="Max recent reports to return (default 5).",
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="get_inventory",
                    description=(
                        "List the farmer's inventory (pesticides, fungicides, fertilizer, urea, etc.) "
                        "with stock levels and low-stock flags. Call when the farmer asks about stock, "
                        "supplies, remaining pesticide, or whether they have enough material."
                    ),
                    parameters=types.Schema(type=types.Type.OBJECT, properties={}),
                ),
                types.FunctionDeclaration(
                    name="get_weather_outlook",
                    description=(
                        "Get current weather and 7-day forecast for the farmer's saved farm location, "
                        "including spray safety, rain window, wind speed. Call when the farmer asks "
                        "about weather, rain, spraying timing, or whether it is safe to apply "
                        "pesticide today."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "days": types.Schema(
                                type=types.Type.INTEGER,
                                description="Forecast horizon 1-10 days (default 7).",
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="get_crop_profiles",
                    description=(
                        "List the farmer's registered crops (name, hectares, expected yield, planting "
                        "status). Call when the farmer asks about their fields, crop mix, or when you "
                        "need farm size / crop type to answer another question."
                    ),
                    parameters=types.Schema(type=types.Type.OBJECT, properties={}),
                ),
                types.FunctionDeclaration(
                    name="get_treatment_plan",
                    description=(
                        "Compute a treatment and ROI plan (estimated cost, expected gain, profit, ROI%) "
                        "for a specific crop or for the disease from the latest scan. Call when the "
                        "farmer asks about cost of treatment, profit, ROI, whether treatment is worth it, "
                        "or yield loss estimates."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "crop_id": types.Schema(
                                type=types.Type.STRING,
                                description=(
                                    "Optional crop id from get_crop_profiles. If omitted, fields are "
                                    "derived from the latest scan + default farm size."
                                ),
                            ),
                            "disease": types.Schema(
                                type=types.Type.STRING,
                                description="Disease name. Derived from latest scan if omitted.",
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="run_swarm_advisory",
                    description=(
                        "Run the full multi-agent swarm advisory: spatial spread risk (which nearby "
                        "zones are at risk next), yield forecast, economist ROI, and meteorologist "
                        "spray window -- all in one pass. Call only when the farmer asks a broad "
                        "'what should I do next' / 'give me a full advisory' style question, since "
                        "this is slower than individual tools. Requires a recent scan to derive the "
                        "disease and severity context."
                    ),
                    parameters=types.Schema(type=types.Type.OBJECT, properties={}),
                ),
                types.FunctionDeclaration(
                    name="get_pesticide_catalog",
                    description=(
                        "Look up recommended pesticides for a named pest/disease from the internal "
                        "catalog. Call when the farmer asks 'what pesticide for X' or similar."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "pest_name": types.Schema(
                                type=types.Type.STRING,
                                description="Pest or disease name to look up.",
                            ),
                        },
                        required=["pest_name"],
                    ),
                ),
            ]
        )
    ]


# ── System prompt ─────────────────────────────────────────────────────────

_SYSTEM_PROMPT_EN = """\
You are the AcreZen farm assistant. You help rice/padi and smallholder farmers \
decide what to do next on their farm. You have function tools that retrieve \
the farmer's real data (scan history, inventory, weather, crops, treatment ROI, \
swarm advisory, pesticide catalog).

Rules:
- If the farmer's question needs real data (their scans, stock, weather, ROI, \
spread risk), call the relevant tool BEFORE answering. Do not guess numbers.
- Prefer the smallest useful set of tools. Use run_swarm_advisory only for \
broad 'what do I do next' questions, not single-topic questions.
- When you have enough data, answer in this exact format (keep the headings):
  Finding\n- <one-sentence observation>\n\nActions\n- <up to 3 concrete next steps>\n\nTreatment\n- <specific product / dose / approach>\n\nRecheck\n- <when to recheck and how>
- Be concrete: cite disease names, severity %, stock quantities, ROI %, rain \
hours from the tool results rather than vague phrases.
- If a tool errors or returns no data, acknowledge that and suggest what the \
farmer should do to unblock (e.g. 'capture a scan first', 'add your farm \
location in Settings').
- Stay strictly on agriculture topics. Politely decline off-topic questions.
- Keep replies under 180 words. No markdown bullets beyond the structure above.
"""

_SYSTEM_PROMPT_MS = """\
Anda ialah pembantu ladang AcreZen. Anda membantu petani padi dan petani kecil \
membuat keputusan di ladang mereka. Anda mempunyai alat fungsi yang mengambil \
data sebenar petani (sejarah imbasan, stok, cuaca, tanaman, ROI rawatan, \
nasihat swarm, katalog racun).

Peraturan:
- Jika soalan memerlukan data sebenar, panggil alat yang berkaitan SEBELUM \
menjawab. Jangan reka nombor.
- Guna set alat paling kecil yang berguna. Guna run_swarm_advisory hanya untuk \
soalan menyeluruh.
- Apabila data mencukupi, jawab dalam format ini (kekalkan tajuk):
  Penemuan\n- <satu ayat pemerhatian>\n\nTindakan\n- <sehingga 3 langkah seterusnya>\n\nRawatan\n- <produk / kadar / cara khusus>\n\nSemak Semula\n- <bila dan bagaimana semak semula>
- Nyatakan nombor konkrit (penyakit, % keterukan, stok, ROI %, jam hujan) dari \
hasil alat.
- Jika alat gagal atau tiada data, akui dan cadangkan langkah (contoh: 'ambil \
imbasan dahulu').
- Fokus hanya pada topik pertanian.
- Kekalkan jawapan di bawah 180 patah perkataan.
"""


def _build_system_prompt(language: str) -> str:
    return _SYSTEM_PROMPT_MS if language == "ms" else _SYSTEM_PROMPT_EN


# ── Tool result helpers ───────────────────────────────────────────────────

def _compact_report(item: dict[str, Any] | None) -> dict[str, Any]:
    if not item:
        return {}
    return {
        "gridId": item.get("gridId"),
        "zone": item.get("zone") or item.get("gridId"),
        "cropType": item.get("cropType") or item.get("crop_type"),
        "disease": item.get("disease"),
        "severity": item.get("severity"),
        "severityScore": item.get("severityScore"),
        "confidence": item.get("confidence"),
        "treatmentPlan": item.get("treatmentPlan") or item.get("treatment_plan"),
        "recommendedPesticides": item.get("recommendedPesticides") or [],
        "survivalProb": item.get("survivalProb"),
        "lat": item.get("lat"),
        "lng": item.get("lng"),
        "timestamp": str(item.get("timestamp") or item.get("createdAt") or item.get("lastUpdated") or ""),
    }


def _trim_inventory_payload(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") or []
    trimmed_items = []
    for item in items[:12]:
        if not isinstance(item, dict):
            continue
        trimmed_items.append(
            {
                "id": item.get("id"),
                "name": item.get("name") or item.get("itemName"),
                "quantity": item.get("quantity") if item.get("quantity") is not None else item.get("liters"),
                "unit": item.get("unit") or item.get("uom"),
                "usage": item.get("usage"),
                "cost_per_unit_rm": item.get("cost_per_unit_rm"),
                "low_stock": bool(item.get("low_stock")) if item.get("low_stock") is not None else None,
            }
        )
    return {
        "items": trimmed_items,
        "total_items": int(payload.get("total_items") or len(items)),
        "low_stock_count": int(payload.get("low_stock_count") or 0),
    }


def _trim_weather_payload(payload: dict[str, Any]) -> dict[str, Any]:
    keep_keys = (
        "condition",
        "temperatureC",
        "humidity",
        "windKmh",
        "windDirection",
        "rainProbability",
        "rainInHours",
        "safeToSpray",
        "bestSprayWindow",
        "recommendation",
        "advisory",
        "serviceWarning",
    )
    out: dict[str, Any] = {k: payload.get(k) for k in keep_keys if k in payload}
    forecast = payload.get("forecast") or []
    if isinstance(forecast, list):
        out["forecast"] = [
            {
                "date": day.get("date"),
                "conditionCode": day.get("conditionCode") or day.get("condition"),
                "temperatureMaxC": day.get("temperatureMaxC") or day.get("maxTempC"),
                "temperatureMinC": day.get("temperatureMinC") or day.get("minTempC"),
                "rainProbability": day.get("rainProbability"),
            }
            for day in forecast[:5]
            if isinstance(day, dict)
        ]
    return out


def _trim_crop_payload(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") or []
    trimmed = []
    for item in items[:10]:
        if not isinstance(item, dict):
            continue
        trimmed.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "area_hectares": item.get("area_hectares"),
                "expected_yield_kg": item.get("expected_yield_kg"),
                "planting_date": item.get("planting_date"),
                "status": item.get("status"),
            }
        )
    return {"items": trimmed, "count": len(items)}


def _trend_line(reports: list[dict[str, Any]]) -> str:
    if len(reports) < 2:
        return "Only one recent report available; trend baseline is limited."
    try:
        latest = float(reports[0].get("severityScore") or reports[0].get("severity") or 0.0)
        oldest = float(reports[-1].get("severityScore") or reports[-1].get("severity") or 0.0)
    except (TypeError, ValueError):
        return "Trend unavailable."
    delta = latest - oldest
    if delta > 5:
        return "Severity has increased; treat urgently."
    if delta < -5:
        return "Severity is improving; keep monitoring."
    return "Severity is stable; maintain treatment discipline."


# ── Agent ─────────────────────────────────────────────────────────────────


class ChatToolAgent:
    """Gemini-backed tool-using chat agent."""

    def __init__(
        self,
        *,
        llm_service: LLMService,
        crop_service: CropService,
        inventory_service: InventoryService,
        weather_service: WeatherService | None,
        treatment_service: TreatmentService | None,
        firestore_service: FirestoreService | None,
        swarm_client: SwarmClient | None,
        load_scan_reports: Callable[[str, str | None], Awaitable[list[dict[str, Any]]]],
    ) -> None:
        self._llm = llm_service
        self._crop_service = crop_service
        self._inventory_service = inventory_service
        self._weather_service = weather_service
        self._treatment_service = treatment_service
        self._firestore_service = firestore_service
        self._swarm_client = swarm_client
        self._load_scan_reports = load_scan_reports
        self._tools = _build_tool_declarations()

    async def run(
        self,
        *,
        effective_user_prompt: str,
        user_id: str,
        zone: str | None,
        lat: float | None,
        lng: float | None,
        location: str | None,
        recent_messages: list[dict[str, str]],
    ) -> str:
        """Run the tool-call loop and return the final assistant reply text."""

        if not effective_user_prompt.strip():
            raise ChatToolAgentError("effective_user_prompt is required")
        if not user_id.strip():
            raise ChatToolAgentError("user_id is required")

        settings = get_settings()
        max_iterations = max(1, int(settings.ASSISTANT_TOOL_USE_MAX_ITERATIONS or 4))

        request_context = {
            "user_id": user_id,
            "zone": zone,
            "lat": lat,
            "lng": lng,
            "location": location,
        }

        language = detect_farmer_language(effective_user_prompt)
        system_prompt = _build_system_prompt(language)

        contents: list[types.Content] = []
        for message in recent_messages[-10:]:
            role = "user" if message.get("role") == "user" else "model"
            text = str(message.get("text") or "").strip()
            if not text:
                continue
            contents.append(
                types.Content(role=role, parts=[types.Part.from_text(text=text)])
            )

        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=effective_user_prompt)],
            )
        )

        tool_trace: list[str] = []

        for iteration in range(1, max_iterations + 1):
            try:
                response = await self._llm.generate_with_tools(
                    contents=contents,
                    tools=self._tools,
                    system_instruction=system_prompt,
                    temperature=0.3,
                    max_output_tokens=900,
                )
            except Exception as exc:
                logger.warning("ChatToolAgent LLM call failed (iter %d): %s", iteration, exc)
                raise ChatToolAgentError(f"Gemini call failed: {exc}") from exc

            candidate_content = _extract_candidate_content(response)
            if candidate_content is None:
                raise ChatToolAgentError("Gemini returned no candidate content")

            function_calls = _extract_function_calls(candidate_content)

            if not function_calls:
                final_text = _extract_text(candidate_content)
                if final_text:
                    logger.info(
                        "ChatToolAgent replied after %d iteration(s); tools=%s",
                        iteration,
                        ",".join(tool_trace) or "none",
                    )
                    return final_text
                raise ChatToolAgentError("Gemini returned neither text nor function calls")

            contents.append(candidate_content)

            tool_response_parts: list[types.Part] = []
            for call in function_calls:
                name = call.name or ""
                args = dict(call.args or {})
                tool_trace.append(name)
                result = await self._dispatch_with_retry(name, args, request_context)

                tool_response_parts.append(
                    types.Part.from_function_response(
                        name=name,
                        response={"result": _json_safe(result)},
                    )
                )

            contents.append(types.Content(role="user", parts=tool_response_parts))

        # Tool budget exhausted — force a final text-only response.
        contents.append(
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=(
                            "Tool budget reached. Give the farmer a final answer now "
                            "with the data you already have, using the required heading format."
                        )
                    )
                ],
            )
        )

        try:
            final_response = await self._llm.generate_with_tools(
                contents=contents,
                tools=self._tools,
                system_instruction=system_prompt,
                temperature=0.3,
                max_output_tokens=900,
                disable_tools=True,
            )
        except Exception as exc:
            raise ChatToolAgentError(f"Final Gemini call failed: {exc}") from exc

        final_content = _extract_candidate_content(final_response)
        final_text = _extract_text(final_content) if final_content else ""
        if not final_text:
            raise ChatToolAgentError("Gemini produced no final text after tool loop")

        logger.info(
            "ChatToolAgent replied after tool-budget exhaustion; tools=%s",
            ",".join(tool_trace) or "none",
        )
        return final_text

    # ── Tool dispatch ────────────────────────────────────────────────────

    async def _dispatch_with_retry(
        self,
        name: str,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        """Dispatch a tool call with retry + exponential backoff on failure."""
        last_exc: Exception | None = None
        for attempt in range(_TOOL_DISPATCH_MAX_RETRIES + 1):
            t0 = time.monotonic()
            try:
                result = await self._dispatch(name, args, ctx)
                elapsed_ms = (time.monotonic() - t0) * 1000
                logger.info(
                    "Tool %s succeeded (attempt %d, %.0fms)",
                    name, attempt + 1, elapsed_ms,
                )
                return result
            except Exception as exc:
                elapsed_ms = (time.monotonic() - t0) * 1000
                last_exc = exc
                if attempt < _TOOL_DISPATCH_MAX_RETRIES:
                    delay = _TOOL_DISPATCH_BASE_DELAY_S * (2 ** attempt)
                    logger.warning(
                        "Tool %s failed (attempt %d, %.0fms), retrying in %.1fs: %s",
                        name, attempt + 1, elapsed_ms, delay, exc,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.warning(
                        "Tool %s failed after %d attempts (%.0fms): %s",
                        name, attempt + 1, elapsed_ms, exc,
                    )

        return {"error": f"{name} failed after retries: {last_exc}"}

    async def _dispatch(
        self,
        name: str,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        """Route a tool call to the appropriate handler."""
        if name == "get_scan_history":
            return await self._tool_get_scan_history(args, ctx)
        if name == "get_inventory":
            return await self._tool_get_inventory(ctx)
        if name == "get_weather_outlook":
            return await self._tool_get_weather_outlook(args, ctx)
        if name == "get_crop_profiles":
            return await self._tool_get_crop_profiles(ctx)
        if name == "get_treatment_plan":
            return await self._tool_get_treatment_plan(args, ctx)
        if name == "run_swarm_advisory":
            return await self._tool_run_swarm_advisory(ctx)
        if name == "get_pesticide_catalog":
            return await self._tool_get_pesticide_catalog(args)
        return {"error": f"Unknown tool: {name}"}

    async def _tool_get_scan_history(
        self,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        zone = str(args.get("zone") or ctx.get("zone") or "").strip() or None
        try:
            limit = int(args.get("limit") or 5)
        except (TypeError, ValueError):
            limit = 5
        limit = max(1, min(10, limit))

        reports = await self._load_scan_reports(ctx["user_id"], zone)
        if not reports:
            return {
                "has_reports": False,
                "report_count": 0,
                "message": "No scan history found for this account/zone yet.",
            }

        return {
            "has_reports": True,
            "report_count": len(reports),
            "zone_filter": zone,
            "latest_report": _compact_report(reports[0]),
            "recent_reports": [_compact_report(item) for item in reports[:limit]],
            "trend": _trend_line(reports),
        }

    async def _tool_get_inventory(self, ctx: dict[str, Any]) -> dict[str, Any]:
        payload = await self._inventory_service.list_items(user_id=ctx["user_id"])
        return _trim_inventory_payload(payload)

    async def _tool_get_weather_outlook(
        self,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        if self._weather_service is None:
            return {"error": "weather service unavailable"}

        lat = ctx.get("lat")
        lng = ctx.get("lng")
        if lat is None or lng is None:
            return {
                "error": (
                    "Farm location is not set. Ask the farmer to save their farm location "
                    "in Settings so weather can be fetched."
                )
            }

        try:
            days = int(args.get("days") or 7)
        except (TypeError, ValueError):
            days = 7
        days = max(1, min(10, days))

        payload = await self._weather_service.get_outlook(lat=float(lat), lng=float(lng), days=days)
        trimmed = _trim_weather_payload(payload)
        if ctx.get("location"):
            trimmed["location"] = ctx["location"]
        return trimmed

    async def _tool_get_crop_profiles(self, ctx: dict[str, Any]) -> dict[str, Any]:
        payload = await self._crop_service.list_crops(user_id=ctx["user_id"])
        return _trim_crop_payload(payload)

    async def _tool_get_treatment_plan(
        self,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        if self._treatment_service is None:
            return {"error": "treatment service unavailable"}

        crop_id = str(args.get("crop_id") or "").strip() or None
        disease_arg = str(args.get("disease") or "").strip()

        reports = await self._load_scan_reports(ctx["user_id"], ctx.get("zone"))
        latest = reports[0] if reports else {}

        disease = disease_arg or str(latest.get("disease") or "").strip()
        if not disease:
            return {
                "error": (
                    "Cannot compute treatment: no disease specified and no recent scan. "
                    "Ask the farmer to run a scan or name the disease."
                )
            }

        crop_type = str(latest.get("cropType") or latest.get("crop_type") or "Rice").strip() or "Rice"
        treatment_plan = str(latest.get("treatmentPlan") or latest.get("treatment_plan") or "recommended treatment").strip()
        try:
            survival_prob_value = float(latest.get("survivalProb") or 0.7)
        except (TypeError, ValueError):
            survival_prob_value = 0.7
        survival_prob = max(0.0, min(1.0, survival_prob_value))

        try:
            plan = await self._treatment_service.build_plan(
                user_id=ctx["user_id"],
                crop_id=crop_id,
                disease=disease,
                crop_type=crop_type,
                treatment_plan=treatment_plan,
                farm_size_hectares=1.0,
                survival_prob=survival_prob,
                lat=ctx.get("lat"),
                lng=ctx.get("lng"),
                treatment_cost_rm=None,
                selling_channel="middleman",
                market_condition="normal",
                manual_price_override=None,
                yield_kg=None,
                actual_sold_kg=None,
                labor_cost_rm=None,
                other_costs_rm=None,
            )
        except ValueError as exc:
            return {"error": f"Treatment plan input invalid: {exc}"}

        return {
            "disease": disease,
            "crop_type": crop_type,
            "recommendation": plan.get("recommendation"),
            "estimated_cost_rm": plan.get("estimated_cost_rm"),
            "expected_gain_rm": plan.get("expected_gain_rm"),
            "profit_rm": plan.get("profit_rm"),
            "roi_percent": plan.get("roi_percent"),
            "roi_x": plan.get("roi_x"),
            "yield_kg": plan.get("yield_kg"),
            "retail_price_rm_per_kg": plan.get("retail_price_rm_per_kg"),
            "farm_price_rm_per_kg": plan.get("farm_price_rm_per_kg"),
            "organic_alternative": plan.get("organic_alternative"),
            "roi_note": plan.get("roi_note"),
            "selling_channel": plan.get("selling_channel"),
            "market_condition": plan.get("market_condition"),
        }

    async def _tool_run_swarm_advisory(self, ctx: dict[str, Any]) -> dict[str, Any]:
        if self._swarm_client is None or not self._swarm_client.is_configured:
            return {
                "error": (
                    "Swarm advisory service is not configured. Use the individual tools "
                    "(scan, weather, inventory, treatment) to compose an answer."
                )
            }

        lat = ctx.get("lat")
        lng = ctx.get("lng")
        if lat is None or lng is None:
            return {"error": "Farm location missing; cannot run swarm advisory."}

        reports = await self._load_scan_reports(ctx["user_id"], ctx.get("zone"))
        if not reports:
            return {
                "error": "Swarm advisory needs a recent scan. Ask the farmer to scan a crop first."
            }
        latest = reports[0]

        try:
            severity_score = float(latest.get("severityScore") or 0.5)
        except (TypeError, ValueError):
            severity_score = 0.5
        severity_score = max(0.0, min(1.0, severity_score))

        try:
            survival_prob = float(latest.get("survivalProb") or 0.7)
        except (TypeError, ValueError):
            survival_prob = 0.7
        survival_prob = max(0.0, min(1.0, survival_prob))

        weather_snapshot: dict[str, Any] = {}
        if self._weather_service is not None:
            try:
                weather_snapshot = await self._weather_service.get_outlook(
                    lat=float(lat), lng=float(lng), days=3
                )
            except Exception as exc:
                logger.warning("Weather lookup for swarm advisory failed: %s", exc)

        try:
            wind_speed_kmh = float(weather_snapshot.get("windKmh") or 5.0)
        except (TypeError, ValueError):
            wind_speed_kmh = 5.0
        wind_direction = str(weather_snapshot.get("windDirection") or "NE").strip() or "NE"

        swarm_input = {
            "user_id": ctx["user_id"],
            "grid_id": str(ctx.get("zone") or latest.get("gridId") or latest.get("zone") or "default"),
            "lat": float(lat),
            "lng": float(lng),
            "crop_type": str(latest.get("cropType") or "Rice"),
            "disease": str(latest.get("disease") or "Unknown"),
            "severity": str(latest.get("severity") or "Moderate"),
            "severity_score": severity_score,
            "survival_prob": survival_prob,
            "farm_size": 1.0,
            "treatment_plan": str(latest.get("treatmentPlan") or "recommended treatment"),
            "wind_speed_kmh": max(0.0, wind_speed_kmh),
            "wind_direction": wind_direction,
        }

        try:
            result = await self._swarm_client.run_orchestrator(swarm_input)
        except SwarmUnavailableError as exc:
            return {"error": f"Swarm advisory unavailable: {exc}"}

        return {
            "weather": result.get("weather"),
            "economy": result.get("economy"),
            "resources": result.get("resources"),
            "spatial_risk": result.get("spatial_risk"),
            "yield_forecast": result.get("yield_forecast"),
            "chatbot_reply": result.get("chatbot_reply"),
        }

    async def _tool_get_pesticide_catalog(self, args: dict[str, Any]) -> dict[str, Any]:
        if self._firestore_service is None:
            return {"error": "pesticide catalog unavailable"}

        pest_name = str(args.get("pest_name") or "").strip()
        if not pest_name:
            return {"error": "pest_name is required"}

        try:
            data = await self._firestore_service.get_pesticide_catalog_recommendation(pest_name)
        except Exception as exc:
            return {"error": f"Catalog lookup failed: {exc}"}

        return {
            "requested_pest_name": pest_name,
            "matchedPestName": data.get("matchedPestName"),
            "recommendedPesticides": list(data.get("recommendedPesticides") or []),
            "recommendationSource": data.get("recommendationSource"),
        }


# ── Response parsing helpers ──────────────────────────────────────────────


def _extract_candidate_content(response: Any) -> types.Content | None:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None
    return getattr(candidates[0], "content", None)


def _extract_function_calls(content: types.Content) -> list[types.FunctionCall]:
    parts = getattr(content, "parts", None) or []
    calls: list[types.FunctionCall] = []
    for part in parts:
        call = getattr(part, "function_call", None)
        if call and getattr(call, "name", None):
            calls.append(call)
    return calls


def _extract_text(content: types.Content | None) -> str:
    if content is None:
        return ""
    parts = getattr(content, "parts", None) or []
    segments: list[str] = []
    for part in parts:
        text_value = getattr(part, "text", None)
        if text_value:
            segments.append(str(text_value))
    return "\n".join(s.strip() for s in segments if s.strip()).strip()


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return json.loads(json.dumps(value, default=str))


__all__ = ["ChatToolAgent", "ChatToolAgentError"]

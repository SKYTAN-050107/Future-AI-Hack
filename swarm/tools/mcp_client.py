"""Tool: MCP Client connecting to ManaMurah price server via SSE."""

import httpx
import json
import re
from urllib.parse import urlparse
from pydantic import BaseModel
from genkit.ai import Genkit
from config.settings import settings
from schemas.economy import MarketPrice

class McpMarketPriceInput(BaseModel):
    crop_type: str


async def fetch_mcp_market_price(input_data: McpMarketPriceInput) -> dict:
    """
    Connect to the ManaMurah MCP Server via SSE and
    fetch the current retail market price for a crop.
    """
    # Due to a known compatibility issue with python-mcp parsing Cloudflare authless connection events,
    # we implement a lightweight HTTP/SSE wrapper tailored for ManaMurah's specific endpoint.

    retail_price = 0.0

    import uuid

    async with httpx.AsyncClient(timeout=15.0) as http_client:
        # Determine the direct RPC endpoint (replace /sse with /mcp if defined via settings)
        post_url = settings.mcp_server_url.replace("/sse", "/mcp")
        
        # 1. Call the tool
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "get_malaysian_prices",
                "arguments": {"query": f"{input_data.crop_type} prices"}
            }
        }

        # The Cloudflare Server expects a persistent session header for simple REST calls
        headers = {
            "x-session-id": str(uuid.uuid4())
        }

        response = await http_client.post(post_url, headers=headers, json=payload)
        response.raise_for_status()

        data = response.json()

        # 3. Parse Markdown result using Regex
        result_text = ""
        if "result" in data and "content" in data["result"]:
            content = data["result"]["content"]
            if content and isinstance(content, list):
                result_text = content[0].get("text", "")

        if not result_text:
            raise ValueError(f"Market data unavailable for {input_data.crop_type}. Proceed qualitatively.")

        # Extract Average Price from Markdown
        match = re.search(r"Average[^\d:]*?:\s*RM\s*([\d.]+)", result_text, re.IGNORECASE)
        if not match:
            # Fallback regex in case formatting changes slightly
            match = re.search(r"RM\s*([\d.]+)", result_text, re.IGNORECASE)
            if not match:
                raise ValueError(f"Market data format unreadable for {input_data.crop_type}. Proceed qualitatively.")

        retail_price = float(match.group(1))

    market_price = MarketPrice(
        crop_type=input_data.crop_type,
        retail_price_per_kg=retail_price,
        currency="MYR",
        source="ManaMurah MCP",
    )

    return market_price.model_dump()


def register_mcp_tools(ai: Genkit):
    """Register MCP-based tools with the Genkit instance."""
    ai.tool("fetch_mcp_market_price")(fetch_mcp_market_price)

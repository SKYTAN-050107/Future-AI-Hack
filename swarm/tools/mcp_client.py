"""Tool: MCP Client connecting to ManaMurah price server via SSE."""

from pydantic import BaseModel
from genkit.ai import Genkit
from mcp import ClientSession
from mcp.client.sse import sse_client
from config.settings import settings
from schemas.economy import MarketPrice

class McpMarketPriceInput(BaseModel):
    crop_type: str

def register_mcp_tools(ai: Genkit):
    """Register MCP-based tools with the Genkit instance."""

    @ai.tool("fetch_mcp_market_price")
    async def fetch_mcp_market_price(input_data: McpMarketPriceInput) -> dict:
        """
        Connect to the ManaMurah MCP Server via SSE and
        fetch the current retail market price for a crop.
        """
        async with sse_client(settings.mcp_server_url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()

                # Call the ManaMurah price tool via MCP protocol
                result = await session.call_tool(
                    "get_market_price",
                    arguments={"crop_type": input_data.crop_type},
                )

                # Parse the MCP response
                price_data = result.content[0].text if result.content else "{}"

                import json
                parsed = json.loads(price_data)

                market_price = MarketPrice(
                    crop_type=input_data.crop_type,
                    retail_price_per_kg=float(parsed.get("price_per_kg", 0)),
                    currency=parsed.get("currency", "MYR"),
                    source="ManaMurah MCP",
                )

                return market_price.model_dump()

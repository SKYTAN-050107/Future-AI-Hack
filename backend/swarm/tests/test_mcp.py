"""Test script: Verify MCP ManaMurah integration end-to-end."""

import asyncio
import os
from pathlib import Path
os.environ.setdefault("MCP_SERVER_URL", "https://mcp.manamurah.com/sse")

from dotenv import load_dotenv
BACKEND_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=BACKEND_ENV_PATH)

from config.settings import settings
settings.mcp_server_url = "https://mcp.manamurah.com/sse"

from tools.mcp_client import fetch_mcp_market_price, McpMarketPriceInput


async def test():
    print("Connecting to remote ManaMurah MCP Server...")
    print(f"URL: {settings.mcp_server_url}")
    print()

    try:
        result = await fetch_mcp_market_price(
            McpMarketPriceInput(crop_type="rice")
        )
        print("Success! Parsed market data:")
        for k, v in result.items():
            print(f"  {k}: {v}")

    except Exception as e:
        import traceback
        print(f"Failed:")
        print(traceback.format_exc())


if __name__ == "__main__":
    asyncio.run(test())

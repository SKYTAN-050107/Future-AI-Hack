import httpx
import json

response = httpx.post(
    "https://mcp.manamurah.com/mcp",
    json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "get_malaysian_prices",
            "arguments": {"query": "rice prices"}
        }
    }
)
print(response.json())

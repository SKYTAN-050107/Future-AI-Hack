import httpx
import asyncio

async def test():
    print("Testing direct POST...")
    async with httpx.AsyncClient() as client:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "get_malaysian_prices",
                "arguments": {"query": "rice prices"}
            }
        }
        resp = await client.post("https://mcp.manamurah.com/mcp", json=payload)
        print("Status:", resp.status_code)
        try:
            print("Content:", resp.json())
        except Exception as e:
            print("Error parsing JSON:", e)
            print("Text:", resp.text)

if __name__ == "__main__":
    asyncio.run(test())

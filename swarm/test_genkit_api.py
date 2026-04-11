import asyncio
from pydantic import BaseModel
from genkit.ai import Genkit

ai = Genkit()

class ToolInput(BaseModel):
    name: str

@ai.tool("test_tool")
async def my_tool(input_data: ToolInput) -> dict:
    return {"result": f"hello {input_data.name}"}

@ai.flow("test_flow")
async def my_flow(x: str) -> str:
    # Call tool from inside a flow — this is the real use case
    result = await my_tool(ToolInput(name=x))
    return f"flow got: {result}"

async def main():
    # Test flow calling tool
    r = await my_flow("world")
    print("Flow+Tool result:", r)

asyncio.run(main())

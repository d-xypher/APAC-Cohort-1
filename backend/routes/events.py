import asyncio
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/events", tags=["events"])

# Simple memory queue for hackathon purposes
agent_events = asyncio.Queue()

async def event_generator():
    while True:
        event = await agent_events.get()
        yield {
            "event": "agent_update",
            "data": jso_dump(event)
        }

import json
def jso_dump(data):
    return json.dumps(data)

@router.get("/stream")
async def message_stream():
    """SSE endpoint for UI to listen to agent activity log."""
    return EventSourceResponse(event_generator())

async def push_agent_event(agent_name: str, action: str, message: str):
    """Called by agents to push status updates to the UI."""
    await agent_events.put({
        "agent": agent_name,
        "action": action,
        "message": message
    })

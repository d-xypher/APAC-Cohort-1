import asyncio
import json
from contextlib import suppress
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/events", tags=["events"])

CLIENT_QUEUE_MAXSIZE = 200
HEARTBEAT_SECONDS = 20
client_queues: set[asyncio.Queue] = set()


def _build_payload(agent_name: str, action: str, message: str):
    return {
        "agent": agent_name,
        "action": action,
        "message": message,
        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
    }


def _broadcast(payload):
    for queue in list(client_queues):
        if queue.full():
            with suppress(asyncio.QueueEmpty):
                queue.get_nowait()
        with suppress(asyncio.QueueFull):
            queue.put_nowait(payload)


async def event_generator(request: Request):
    queue = asyncio.Queue(maxsize=CLIENT_QUEUE_MAXSIZE)
    client_queues.add(queue)
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                yield {
                    "event": "agent_update",
                    "data": json.dumps(event),
                }
            except asyncio.TimeoutError:
                yield {
                    "event": "keepalive",
                    "data": json.dumps({"type": "heartbeat"}),
                }
    finally:
        client_queues.discard(queue)


@router.get("/stream")
async def message_stream(request: Request):
    """SSE endpoint for UI to listen to agent activity log."""
    return EventSourceResponse(event_generator(request))


async def push_agent_event(agent_name: str, action: str, message: str):
    """Called by agents to push status updates to the UI."""
    _broadcast(_build_payload(agent_name, action, message))


def push_agent_event_sync(agent_name: str, action: str, message: str):
    """Synchronous helper for non-async routes."""
    _broadcast(_build_payload(agent_name, action, message))

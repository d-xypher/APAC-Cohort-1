import asyncio
import json
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/events", tags=["events"])

CLIENT_QUEUE_MAXSIZE = 200
HEARTBEAT_SECONDS = 20
client_queues: set[asyncio.Queue] = set()


# Event types for rich SSE streaming
class EventType:
    AGENT_UPDATE = "agent_update"
    CASCADE_PREVIEW = "cascade_preview"
    CASCADE_PROGRESS = "cascade_progress"
    CASCADE_COMPLETE = "cascade_complete"
    CONFLICT_DETECTED = "conflict_detected"
    RESOLUTION_OPTIONS = "resolution_options"
    NODE_UPDATED = "node_updated"
    THINKING = "thinking"
    REASONING = "reasoning"


def _build_payload(agent_name: str, action: str, message: str, event_type: str = EventType.AGENT_UPDATE, data: Optional[Dict[str, Any]] = None):
    payload = {
        "agent": agent_name,
        "action": action,
        "message": message,
        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
        "event_type": event_type,
    }
    if data:
        payload["data"] = data
    return payload


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


async def push_agent_event(agent_name: str, action: str, message: str, event_type: str = EventType.AGENT_UPDATE, data: Optional[Dict[str, Any]] = None):
    """Called by agents to push status updates to the UI."""
    _broadcast(_build_payload(agent_name, action, message, event_type, data))


def push_agent_event_sync(agent_name: str, action: str, message: str, event_type: str = EventType.AGENT_UPDATE, data: Optional[Dict[str, Any]] = None):
    """Synchronous helper for non-async routes."""
    _broadcast(_build_payload(agent_name, action, message, event_type, data))


# Specialized event pushers for common patterns
def push_cascade_preview(affected_nodes: List[Dict], total_delay_mins: float):
    """Push cascade preview data to UI before commit."""
    _broadcast(_build_payload(
        "Orchestrator", 
        "Preview Generated",
        f"{len(affected_nodes)} nodes affected, {total_delay_mins:.0f} min total shift",
        EventType.CASCADE_PREVIEW,
        {"affected_nodes": affected_nodes, "total_delay_mins": total_delay_mins}
    ))


def push_cascade_progress(current_node: int, total_nodes: int, node_title: str):
    """Push incremental cascade progress."""
    _broadcast(_build_payload(
        "Task Agent",
        "Processing",
        f"Updating {node_title} ({current_node}/{total_nodes})",
        EventType.CASCADE_PROGRESS,
        {"current": current_node, "total": total_nodes, "node_title": node_title}
    ))


def push_conflict_detected(node_id: int, node_title: str, conflict_type: str, details: Dict):
    """Push when a conflict is detected during cascade."""
    _broadcast(_build_payload(
        "Conflict Detector",
        "Conflict Found",
        f"{conflict_type}: {node_title}",
        EventType.CONFLICT_DETECTED,
        {"node_id": node_id, "node_title": node_title, "conflict_type": conflict_type, **details}
    ))


def push_resolution_options(node_id: int, options: List[Dict]):
    """Push AI-generated resolution options to UI."""
    _broadcast(_build_payload(
        "Resolution Agent",
        "Options Ready",
        f"{len(options)} resolution options generated",
        EventType.RESOLUTION_OPTIONS,
        {"node_id": node_id, "options": options}
    ))


def push_reasoning(agent_name: str, reasoning_text: str):
    """Push agent's reasoning/thinking to UI for transparency."""
    _broadcast(_build_payload(
        agent_name,
        "Reasoning",
        reasoning_text[:100] + "..." if len(reasoning_text) > 100 else reasoning_text,
        EventType.REASONING,
        {"full_reasoning": reasoning_text}
    ))


def push_node_updated(node_id: int, changes: Dict):
    """Push individual node update notification."""
    _broadcast(_build_payload(
        "Task Agent",
        "Node Updated",
        f"Node {node_id} updated",
        EventType.NODE_UPDATED,
        {"node_id": node_id, "changes": changes}
    ))

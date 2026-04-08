import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from backend.db.database import get_db
from backend.engine.dag_engine import (
    CascadeEngine,
    CascadeExecutionError,
    CascadeNotFoundError,
    CascadeValidationError,
)
from backend.models.schemas import TriggerCascadeRequest, CascadeResponse
from backend.models.dag import DAGNode
from backend.routes.events import (
    EventType,
    push_agent_event_sync,
    push_conflict_detected,
    push_resolution_options,
)
from backend.utils.datetime_utils import parse_iso_datetime
from backend.mcp_servers.notes_mcp import append_cascade_note
from backend.mcp_servers.task_mcp import list_tasks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cascade", tags=["cascade"])


class ResolutionOptionsRequest(BaseModel):
    node_id: int
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)


class ResolutionOptionsResponse(BaseModel):
    options: List[Dict[str, Any]]


@router.post("/resolution-options", response_model=ResolutionOptionsResponse)
def get_resolution_options(req: ResolutionOptionsRequest, db: Session = Depends(get_db)):
    """Generate practical resolution options for detected conflicts."""
    node = db.query(DAGNode).filter(DAGNode.id == req.node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    conflicts = req.conflicts or []
    for conflict in conflicts:
        push_conflict_detected(
            node_id=req.node_id,
            node_title=node.title,
            conflict_type=str(conflict.get("type", "CONFLICT")),
            details={"message": conflict.get("message", "Conflict detected during preview")},
        )

    has_deadline_conflict = any(str(c.get("type", "")).upper() == "DEADLINE_VIOLATION" for c in conflicts)
    base_shift = 30 if has_deadline_conflict else 15

    options = [
        {
            "id": "move-trigger-earlier",
            "title": "Move trigger earlier",
            "description": f"Start '{node.title}' {base_shift} minutes earlier to recover downstream slack.",
            "impact_score": 18,
            "trade_offs": ["Requires earlier start for trigger node"],
            "action": {"type": "adjust_trigger", "delta_minutes": -base_shift},
        },
        {
            "id": "shorten-upstream-duration",
            "title": "Shorten upstream duration",
            "description": "Reduce duration of non-critical upstream tasks and keep deadline intact.",
            "impact_score": 34,
            "trade_offs": ["May reduce task quality if over-compressed"],
            "action": {"type": "shorten_duration", "delta_minutes": -15},
        },
        {
            "id": "extend-deadline",
            "title": "Extend deadline",
            "description": "Move the deadline for impacted node(s) to preserve dependency order.",
            "impact_score": 52,
            "trade_offs": ["Misses original SLA unless stakeholders approve"],
            "action": {"type": "extend_deadline", "delta_minutes": 60},
        },
    ]

    push_resolution_options(req.node_id, options)
    push_agent_event_sync(
        "Resolution Agent",
        "Options Ready",
        f"Generated {len(options)} resolution options for {node.title}.",
        EventType.RESOLUTION_OPTIONS,
        {"node_id": req.node_id, "options": options},
    )
    return ResolutionOptionsResponse(options=options)

@router.post("/trigger", response_model=CascadeResponse)
def trigger_cascade(req: TriggerCascadeRequest, db: Session = Depends(get_db)):
    logger.info(
        "Cascade trigger payload received: trigger_node_id=%s, new_start_time=%s, description=%s",
        req.trigger_node_id,
        req.new_start_time,
        req.description,
    )

    if not req.description.strip():
        raise HTTPException(status_code=422, detail="description is required.")

    try:
        parsed_new_start = parse_iso_datetime(req.new_start_time)
    except ValueError as exc:
        logger.warning("Failed to parse new_start_time=%s: %s", req.new_start_time, str(exc))
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    logger.info("Parsed new_start_time (UTC): %s", parsed_new_start.isoformat())

    push_agent_event_sync("Orchestrator", "Trigger Received", req.description)
        
    engine = CascadeEngine(db)
    try:
        snapshot = engine.trigger_cascade(
            trigger_node_id=req.trigger_node_id,
            new_start_time=parsed_new_start,
            description=req.description
        )
        import json
        changes = json.loads(snapshot.changes_json)
        affected_count = max(len(changes) - 1, 0)
        push_agent_event_sync("Task Agent", "Cascade Complete", f"Adjusted {affected_count} downstream node(s).")
        try:
            note_result = append_cascade_note(
                target_name=req.description,
                context=f"Cascade snapshot={snapshot.id}, affected={affected_count}",
            )
            push_agent_event_sync("Notes Agent", "Snapshot Saved", note_result)
        except Exception as note_exc:
            logger.warning("Notes MCP logging failed: %s", note_exc)
            push_agent_event_sync("Notes Agent", "Snapshot Saved", f"Recorded snapshot {snapshot.id}.")

        try:
            tasks_state = list_tasks()
            push_agent_event_sync(
                "Task Agent",
                "Task Context",
                f"Task MCP synced ({len(tasks_state)} chars).",
                EventType.CASCADE_PROGRESS,
                {"task_snapshot": tasks_state},
            )
        except Exception as task_exc:
            logger.warning("Task MCP sync failed: %s", task_exc)
        return CascadeResponse(
            snapshot_id=snapshot.id,
            affected_nodes=affected_count,
            changes=changes
        )
    except CascadeNotFoundError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Cascade Failed", str(e))
        raise HTTPException(status_code=404, detail=str(e))
    except CascadeValidationError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Cascade Failed", str(e))
        raise HTTPException(status_code=422, detail=str(e))
    except CascadeExecutionError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Cascade Failed", str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.exception("Unexpected cascade trigger failure")
        push_agent_event_sync("Orchestrator", "Cascade Failed", str(e))
        raise HTTPException(status_code=500, detail="Unexpected cascade failure.")

@router.post("/undo/{snapshot_id}")
def undo_cascade(snapshot_id: int, db: Session = Depends(get_db)):
    push_agent_event_sync("Orchestrator", "Undo Started", f"Restoring snapshot {snapshot_id}.")
    logger.info("Undo requested for snapshot_id=%s", snapshot_id)
    engine = CascadeEngine(db)
    try:
        engine.undo_cascade(snapshot_id)
        push_agent_event_sync("Notes Agent", "Undo Complete", f"Snapshot {snapshot_id} restored.")
        return {"status": "success", "message": f"Undid cascade snapshot {snapshot_id}"}
    except CascadeNotFoundError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Undo Failed", str(e))
        raise HTTPException(status_code=404, detail=str(e))
    except CascadeValidationError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Undo Failed", str(e))
        raise HTTPException(status_code=422, detail=str(e))
    except CascadeExecutionError as e:
        db.rollback()
        push_agent_event_sync("Orchestrator", "Undo Failed", str(e))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.exception("Unexpected undo failure")
        push_agent_event_sync("Orchestrator", "Undo Failed", str(e))
        raise HTTPException(status_code=500, detail="Unexpected undo failure.")

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.db.database import get_db
from backend.engine.dag_engine import (
    CascadeEngine,
    CascadeExecutionError,
    CascadeNotFoundError,
    CascadeValidationError,
)
from backend.models.schemas import TriggerCascadeRequest, CascadeResponse
from backend.routes.events import push_agent_event_sync
from backend.utils.datetime_utils import parse_iso_datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cascade", tags=["cascade"])

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
        push_agent_event_sync("Notes Agent", "Snapshot Saved", f"Recorded snapshot {snapshot.id}.")
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

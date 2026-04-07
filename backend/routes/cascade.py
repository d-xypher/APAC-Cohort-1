from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.db.database import get_db
from backend.engine.dag_engine import CascadeEngine
from backend.models.schemas import TriggerCascadeRequest, CascadeResponse

router = APIRouter(prefix="/api/cascade", tags=["cascade"])

@router.post("/trigger", response_model=CascadeResponse)
def trigger_cascade(req: TriggerCascadeRequest, db: Session = Depends(get_db)):
    if not req.new_start_time:
        raise HTTPException(status_code=400, detail="new_start_time is required to trigger cascade")
        
    engine = CascadeEngine(db)
    try:
        snapshot = engine.trigger_cascade(
            trigger_node_id=req.trigger_node_id,
            new_start_time=req.new_start_time,
            description=req.description
        )
        import json
        changes = json.loads(snapshot.changes_json)
        return CascadeResponse(
            snapshot_id=snapshot.id,
            affected_nodes=len(changes) - 1, # minus the trigger node
            changes=changes
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/undo/{snapshot_id}")
def undo_cascade(snapshot_id: int, db: Session = Depends(get_db)):
    engine = CascadeEngine(db)
    try:
        engine.undo_cascade(snapshot_id)
        return {"status": "success", "message": f"Undid cascade snapshot {snapshot_id}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

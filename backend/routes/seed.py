from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta
from backend.config import ENABLE_SEED_ENDPOINTS
from backend.db.database import get_db
from backend.models.dag import DAGNode, DAGEdge, NodeType, NodeStatus, User
from backend.utils.datetime_utils import utc_now

router = APIRouter(prefix="/api/seed", tags=["seed"])

@router.post("/")
def seed_demo_data(db: Session = Depends(get_db)):
    """Wipes the DB and pre-populates Priya's demo day."""
    if not ENABLE_SEED_ENDPOINTS:
        raise HTTPException(status_code=403, detail="Seeding is disabled in this environment.")
    
    # 1. Clear existing
    db.query(DAGEdge).delete()
    db.query(DAGNode).delete()
    
    # Create or get Priya user
    user = db.query(User).filter_by(username="Priya").first()
    if not user:
        user = User(username="Priya", email="priya@cascade.test", hashed_password="pw")
        db.add(user)
        db.commit()
        db.refresh(user)
        
    db.commit()
    
    today = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    
    # 2. Create nodes
    standup = DAGNode(
        title="Engineering Standup",
        node_type=NodeType.CALENDAR_EVENT,
        start_time=today + timedelta(hours=9),
        duration_minutes=30,
        owner_id=user.id
    )
    
    spec_review = DAGNode(
        title="Spec Review: Cascade Feature",
        node_type=NodeType.TASK,
        start_time=today + timedelta(hours=9, minutes=30),
        duration_minutes=60,
        priority=1,
        owner_id=user.id
    )
    
    design_sync = DAGNode(
        title="Design Sync w/ Alex",
        node_type=NodeType.CALENDAR_EVENT,
        start_time=today + timedelta(hours=11),
        duration_minutes=45,
        owner_id=user.id
    )
    
    draft_brief = DAGNode(
        title="Draft Launch Brief",
        node_type=NodeType.TASK,
        start_time=today + timedelta(hours=10, minutes=30),
        duration_minutes=30,
        priority=3,
        owner_id=user.id
    )

    db.add_all([standup, spec_review, design_sync, draft_brief])
    db.commit()
    
    # Refresh to get IDs
    for n in [standup, spec_review, design_sync, draft_brief]:
        db.refresh(n)
        
    # 3. Create edges (Dependencies)
    # Standup -> Spec Review -> Design Sync
    e1 = DAGEdge(from_node_id=standup.id, to_node_id=spec_review.id, edge_type="depends_on")
    e2 = DAGEdge(from_node_id=spec_review.id, to_node_id=design_sync.id, edge_type="depends_on")
    # Draft Brief doesn't strictly depend on anything, but is scheduled between Spec and Design
    
    db.add_all([e1, e2])
    db.commit()
    
    return {"status": "success", "message": "Seeded 4 nodes and 2 edges for Priya demo"}

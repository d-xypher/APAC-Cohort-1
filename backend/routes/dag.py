from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import json
import networkx as nx

from backend.db.database import get_db
from backend.models.dag import DAGNode, DAGEdge, NodeType, NodeStatus
from backend.models.schemas import DAGNodeCreate, DAGNodeUpdate, DAGNodeResponse, DAGEdgeCreate, DAGEdgeResponse
from backend.utils.datetime_utils import ensure_utc, parse_iso_datetime
from backend.routes.events import push_agent_event_sync, push_cascade_preview, EventType
from backend.mcp_servers.calendar_mcp import create_event as calendar_create_event, reschedule_event as calendar_reschedule_event

router = APIRouter(prefix="/api/dag", tags=["dag"])


def _normalize_datetime_payload(payload: dict):
    for key in ["start_time", "end_time", "deadline"]:
        payload[key] = ensure_utc(payload.get(key))
    return payload


# ═══════════════════════════════════════════════════════════════════════════════
# CASCADE PREVIEW — Shows impact BEFORE committing changes
# ═══════════════════════════════════════════════════════════════════════════════

class CascadePreviewRequest(BaseModel):
    node_id: int
    new_start_time: str  # ISO 8601
    

class CascadePreviewResponse(BaseModel):
    trigger_node: dict
    affected_nodes: List[dict]
    total_delay_minutes: float
    has_conflicts: bool
    conflicts: List[dict]
    summary: str


@router.post("/cascade/preview", response_model=CascadePreviewResponse)
def preview_cascade(req: CascadePreviewRequest, db: Session = Depends(get_db)):
    """Preview cascade effects WITHOUT committing. Essential for drag-to-reschedule."""
    
    # Parse and validate
    try:
        new_start = parse_iso_datetime(req.new_start_time)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    
    trigger_node = db.query(DAGNode).filter(DAGNode.id == req.node_id).first()
    if not trigger_node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    if not trigger_node.start_time:
        raise HTTPException(status_code=422, detail="Node has no start_time to cascade from")
    
    # Build graph for traversal
    nodes = db.query(DAGNode).all()
    edges = db.query(DAGEdge).all()
    
    G = nx.DiGraph()
    node_map = {}
    for n in nodes:
        G.add_node(n.id)
        node_map[n.id] = n
    for e in edges:
        G.add_edge(e.from_node_id, e.to_node_id)
    
    # Calculate time delta
    old_start = ensure_utc(trigger_node.start_time)
    new_start = ensure_utc(new_start)
    time_delta = new_start - old_start
    delta_minutes = time_delta.total_seconds() / 60
    
    # Find all downstream nodes
    try:
        descendants = list(nx.descendants(G, req.node_id))
    except nx.NetworkXError:
        descendants = []
    
    # Calculate impact on each descendant
    affected_nodes = []
    conflicts = []
    total_delay = abs(delta_minutes)
    
    # Process trigger node first
    trigger_preview = {
        "id": trigger_node.id,
        "title": trigger_node.title,
        "current_start": old_start.isoformat() if old_start else None,
        "new_start": new_start.isoformat(),
        "delta_minutes": delta_minutes,
        "is_trigger": True
    }
    
    # Get topological order for descendants
    if descendants:
        subgraph = G.subgraph([req.node_id] + descendants)
        try:
            topo_order = list(nx.topological_sort(subgraph))
        except nx.NetworkXUnfeasible:
            topo_order = descendants
        
        # Track shifted times
        shifted_ends = {req.node_id: new_start + (trigger_node.end_time - trigger_node.start_time) if trigger_node.end_time else new_start}
        
        for node_id in topo_order:
            if node_id == req.node_id:
                continue
                
            node = node_map.get(node_id)
            if not node or not node.start_time:
                continue
            
            node_start = ensure_utc(node.start_time)
            node_end = ensure_utc(node.end_time)
            
            # Find max end time of predecessors
            preds = list(G.predecessors(node_id))
            max_pred_end = None
            for p_id in preds:
                p_end = shifted_ends.get(p_id)
                if p_end and (not max_pred_end or p_end > max_pred_end):
                    max_pred_end = p_end
            
            # Calculate new start if predecessor ends after current start
            if max_pred_end and node_start < max_pred_end:
                from datetime import timedelta
                new_node_start = max_pred_end + timedelta(minutes=5)  # 5 min buffer
                node_delta = (new_node_start - node_start).total_seconds() / 60
                
                new_node_end = None
                if node.duration_minutes:
                    new_node_end = new_node_start + timedelta(minutes=node.duration_minutes)
                elif node_end:
                    new_node_end = node_end + timedelta(minutes=node_delta)
                
                shifted_ends[node_id] = new_node_end or new_node_start
                
                # Check for conflicts
                node_conflicts = []
                if node.deadline:
                    deadline = ensure_utc(node.deadline)
                    if new_node_start > deadline:
                        node_conflicts.append({
                            "type": "DEADLINE_VIOLATION",
                            "message": f"Would exceed deadline by {int((new_node_start - deadline).total_seconds() / 60)} minutes"
                        })
                
                affected_nodes.append({
                    "id": node.id,
                    "title": node.title,
                    "current_start": node_start.isoformat(),
                    "new_start": new_node_start.isoformat(),
                    "delta_minutes": node_delta,
                    "conflicts": node_conflicts,
                    "has_conflict": len(node_conflicts) > 0
                })
                
                conflicts.extend([{**c, "node_id": node.id, "node_title": node.title} for c in node_conflicts])
                total_delay += abs(node_delta)
    
    # Generate summary
    if not affected_nodes:
        summary = f"Moving '{trigger_node.title}' by {int(delta_minutes)} min with no downstream impact."
    elif conflicts:
        summary = f"⚠️ Moving '{trigger_node.title}' affects {len(affected_nodes)} node(s) with {len(conflicts)} conflict(s)!"
    else:
        summary = f"Moving '{trigger_node.title}' will shift {len(affected_nodes)} downstream node(s) by ~{int(total_delay/len(affected_nodes))} min avg."
    
    # Push preview to SSE for real-time UI update
    push_cascade_preview(affected_nodes, total_delay)
    
    return CascadePreviewResponse(
        trigger_node=trigger_preview,
        affected_nodes=affected_nodes,
        total_delay_minutes=total_delay,
        has_conflicts=len(conflicts) > 0,
        conflicts=conflicts,
        summary=summary
    )


# ═══════════════════════════════════════════════════════════════════════════════
# CRUD OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/nodes", response_model=List[DAGNodeResponse])
def get_nodes(db: Session = Depends(get_db)):
    return db.query(DAGNode).all()


@router.get("/nodes/{node_id}", response_model=DAGNodeResponse)
def get_node(node_id: int, db: Session = Depends(get_db)):
    """Get a single node by ID."""
    node = db.query(DAGNode).filter(DAGNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.post("/nodes", response_model=DAGNodeResponse)
def create_node(node: DAGNodeCreate, db: Session = Depends(get_db)):
    payload = _normalize_datetime_payload(node.model_dump())
    db_node = DAGNode(**payload)
    db.add(db_node)
    db.flush()

    # If this is a calendar event, create it in Google Calendar and persist external_id/source.
    if db_node.node_type == NodeType.CALENDAR_EVENT.value:
        if not db_node.start_time or not db_node.end_time:
            db.rollback()
            raise HTTPException(status_code=422, detail="Calendar events require start_time and end_time.")

        result = calendar_create_event(
            summary=db_node.title,
            start_datetime_iso=ensure_utc(db_node.start_time).isoformat(),
            end_datetime_iso=ensure_utc(db_node.end_time).isoformat(),
            description=db_node.description or "",
        )
        if not result.startswith("Successfully created event"):
            db.rollback()
            push_agent_event_sync("Calendar Agent", "Create Failed", result)
            raise HTTPException(status_code=502, detail=f"Google Calendar create failed: {result}")

        start = result.find("[ID:")
        end = result.find("]", start + 4)
        if start == -1 or end == -1:
            db.rollback()
            push_agent_event_sync("Calendar Agent", "Create Failed", result)
            raise HTTPException(status_code=502, detail="Google Calendar create succeeded but event ID was not returned.")

        db_node.external_id = result[start + 4:end].strip()
        db_node.source = db_node.source or "google_calendar"
        push_agent_event_sync("Calendar Agent", "Event Created", f"Synced calendar event: {db_node.title}")

    db.commit()
    db.refresh(db_node)
    
    push_agent_event_sync("DAG Engine", "Node Created", f"Created: {db_node.title}")
    return db_node


@router.put("/nodes/{node_id}", response_model=DAGNodeResponse)
def update_node(node_id: int, node_update: DAGNodeUpdate, db: Session = Depends(get_db)):
    db_node = db.query(DAGNode).filter(DAGNode.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
        
    original_start = ensure_utc(db_node.start_time)
    original_end = ensure_utc(db_node.end_time)
    update_payload = _normalize_datetime_payload(node_update.model_dump(exclude_unset=True))
    for key, value in update_payload.items():
        setattr(db_node, key, value)

    # Sync time changes to Google Calendar when this node is linked to an external event.
    new_start = ensure_utc(db_node.start_time)
    new_end = ensure_utc(db_node.end_time)
    times_changed = (original_start != new_start) or (original_end != new_end)
    if (
        db_node.node_type == NodeType.CALENDAR_EVENT.value
        and db_node.external_id
        and times_changed
        and new_start
        and new_end
    ):
        result = calendar_reschedule_event(
            event_id=db_node.external_id,
            new_start_datetime_iso=new_start.isoformat(),
            new_end_datetime_iso=new_end.isoformat(),
        )
        if not result.startswith("Successfully updated event"):
            db.rollback()
            push_agent_event_sync("Calendar Agent", "Reschedule Failed", result)
            raise HTTPException(status_code=502, detail=f"Google Calendar reschedule failed: {result}")
        push_agent_event_sync("Calendar Agent", "Event Rescheduled", f"Synced calendar update: {db_node.title}")

    db.commit()
    db.refresh(db_node)
    
    push_agent_event_sync("DAG Engine", "Node Updated", f"Updated: {db_node.title}")
    return db_node


@router.delete("/nodes/{node_id}")
def delete_node(node_id: int, db: Session = Depends(get_db)):
    """Delete a node and its associated edges."""
    db_node = db.query(DAGNode).filter(DAGNode.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    title = db_node.title
    
    # Delete associated edges first
    db.query(DAGEdge).filter(
        (DAGEdge.from_node_id == node_id) | (DAGEdge.to_node_id == node_id)
    ).delete()
    
    db.delete(db_node)
    db.commit()
    
    push_agent_event_sync("DAG Engine", "Node Deleted", f"Deleted: {title}")
    return {"status": "success", "message": f"Deleted node {node_id}"}


@router.get("/edges", response_model=List[DAGEdgeResponse])
def get_edges(db: Session = Depends(get_db)):
    return db.query(DAGEdge).all()


@router.post("/edges", response_model=DAGEdgeResponse)
def create_edge(edge: DAGEdgeCreate, db: Session = Depends(get_db)):
    # Verify nodes exist
    from_node = db.query(DAGNode).filter(DAGNode.id == edge.from_node_id).first()
    to_node = db.query(DAGNode).filter(DAGNode.id == edge.to_node_id).first()
    
    if not from_node:
        raise HTTPException(status_code=404, detail="from_node not found")
    if not to_node:
        raise HTTPException(status_code=404, detail="to_node not found")
    
    # Check for cycles
    nodes = db.query(DAGNode).all()
    edges = db.query(DAGEdge).all()
    
    G = nx.DiGraph()
    for n in nodes:
        G.add_node(n.id)
    for e in edges:
        G.add_edge(e.from_node_id, e.to_node_id)
    
    # Test if adding this edge creates a cycle
    G.add_edge(edge.from_node_id, edge.to_node_id)
    if not nx.is_directed_acyclic_graph(G):
        raise HTTPException(status_code=422, detail="Adding this edge would create a cycle")
        
    db_edge = DAGEdge(**edge.model_dump())
    db.add(db_edge)
    db.commit()
    db.refresh(db_edge)
    
    push_agent_event_sync("DAG Engine", "Edge Created", f"Linked: {from_node.title} → {to_node.title}")
    return db_edge


@router.delete("/edges/{edge_id}")
def delete_edge(edge_id: int, db: Session = Depends(get_db)):
    """Delete an edge."""
    db_edge = db.query(DAGEdge).filter(DAGEdge.id == edge_id).first()
    if not db_edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    
    db.delete(db_edge)
    db.commit()
    
    push_agent_event_sync("DAG Engine", "Edge Deleted", f"Removed edge {edge_id}")
    return {"status": "success", "message": f"Deleted edge {edge_id}"}

"""CASCADE — Pydantic schemas for API layer."""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from .dag import NodeType, NodeStatus

class DAGNodeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    node_type: NodeType
    status: NodeStatus = NodeStatus.SCHEDULED
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    deadline: Optional[datetime] = None
    priority: Optional[int] = 3
    source: Optional[str] = None

class DAGNodeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[NodeStatus] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    deadline: Optional[datetime] = None
    cascade_note: Optional[str] = None

class DAGNodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    external_id: Optional[str]
    title: str
    description: Optional[str]
    node_type: str
    status: str
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    duration_minutes: Optional[int]
    deadline: Optional[datetime]
    priority: Optional[int]
    owner: Optional[str]
    source: Optional[str]
    cascade_note: Optional[str]
    created_at: datetime
    updated_at: datetime

class DAGEdgeCreate(BaseModel):
    from_node_id: int
    to_node_id: int
    edge_type: str = "depends_on"
    weight: float = 1.0

class DAGEdgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    from_node_id: int
    to_node_id: int
    edge_type: str
    weight: float

class TriggerCascadeRequest(BaseModel):
    trigger_node_id: int
    new_start_time: Optional[datetime] = None
    new_end_time: Optional[datetime] = None
    new_status: Optional[NodeStatus] = None
    description: str

class CascadeResponse(BaseModel):
    snapshot_id: int
    affected_nodes: int
    changes: List[Dict[str, Any]]

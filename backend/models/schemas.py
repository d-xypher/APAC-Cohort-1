"""CASCADE — Pydantic schemas for API layer."""
from pydantic import BaseModel, ConfigDict, Field, field_validator
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
    owner_id: Optional[int]
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
    is_cross_user: bool

class TriggerCascadeRequest(BaseModel):
    trigger_node_id: int = Field(..., ge=1)
    new_start_time: str
    description: str = Field(..., min_length=1, max_length=500)

    @field_validator("new_start_time")
    @classmethod
    def validate_iso_datetime(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("new_start_time is required.")

        candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
        try:
            datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise ValueError("new_start_time must be a valid ISO datetime string.") from exc

        return text

class CascadeResponse(BaseModel):
    snapshot_id: int
    affected_nodes: int
    changes: List[Dict[str, Any]]

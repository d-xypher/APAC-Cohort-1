"""CASCADE — DAG Data Models (SQLAlchemy)."""
import json
from datetime import datetime, timedelta
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float,
    ForeignKey, Boolean, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from backend.db.database import Base
import enum


class NodeType(str, enum.Enum):
    CALENDAR_EVENT = "calendar_event"
    TASK = "task"
    NOTE = "note"
    FOCUS_BLOCK = "focus_block"


class NodeStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    RESCHEDULED = "rescheduled"
    CANCELLED = "cancelled"


class DAGNode(Base):
    """A node in the dependency graph — represents a task, event, or note."""
    __tablename__ = "dag_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    external_id = Column(String(255), nullable=True)  # Google Calendar event ID, Todoist task ID, etc.
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    node_type = Column(String(50), nullable=False, default=NodeType.TASK.value)
    status = Column(String(50), nullable=False, default=NodeStatus.SCHEDULED.value)

    # Scheduling
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    deadline = Column(DateTime, nullable=True)

    # Priority (1=highest, 5=lowest)
    priority = Column(Integer, nullable=True, default=3)

    # Metadata
    owner = Column(String(255), nullable=True, default="Priya")
    source = Column(String(100), nullable=True)  # "google_calendar", "todoist", "notion"
    cascade_note = Column(Text, nullable=True)    # Auto-generated note explaining adjustments
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    outgoing_edges = relationship("DAGEdge", foreign_keys="DAGEdge.from_node_id", back_populates="from_node", cascade="all, delete-orphan")
    incoming_edges = relationship("DAGEdge", foreign_keys="DAGEdge.to_node_id", back_populates="to_node", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "external_id": self.external_id,
            "title": self.title,
            "description": self.description,
            "node_type": self.node_type,
            "status": self.status,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_minutes": self.duration_minutes,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "priority": self.priority,
            "owner": self.owner,
            "source": self.source,
            "cascade_note": self.cascade_note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class DAGEdge(Base):
    """An edge in the dependency graph — from_node must finish before to_node can start."""
    __tablename__ = "dag_edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_node_id = Column(Integer, ForeignKey("dag_nodes.id"), nullable=False)
    to_node_id = Column(Integer, ForeignKey("dag_nodes.id"), nullable=False)
    edge_type = Column(String(50), nullable=False, default="depends_on")  # depends_on, blocks, related_to
    weight = Column(Float, default=1.0)  # How strongly coupled

    from_node = relationship("DAGNode", foreign_keys=[from_node_id], back_populates="outgoing_edges")
    to_node = relationship("DAGNode", foreign_keys=[to_node_id], back_populates="incoming_edges")

    def to_dict(self):
        return {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "edge_type": self.edge_type,
            "weight": self.weight,
        }


class CascadeSnapshot(Base):
    """Snapshot of the entire DAG state before a cascade — enables undo."""
    __tablename__ = "cascade_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trigger_description = Column(Text, nullable=False)  # What caused the cascade
    trigger_node_id = Column(Integer, nullable=True)
    nodes_json = Column(Text, nullable=False)  # JSON serialized list of all nodes
    edges_json = Column(Text, nullable=False)  # JSON serialized list of all edges
    changes_json = Column(Text, nullable=True)  # What changed in this cascade
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)  # False if this cascade was undone

    def to_dict(self):
        return {
            "id": self.id,
            "trigger_description": self.trigger_description,
            "trigger_node_id": self.trigger_node_id,
            "changes": json.loads(self.changes_json) if self.changes_json else [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_active": self.is_active,
        }

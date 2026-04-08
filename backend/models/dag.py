"""CASCADE — DAG Data Models (SQLAlchemy)."""
import json
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float,
    ForeignKey, Boolean, JSON
)
from sqlalchemy.orm import relationship
from backend.db.database import Base
from backend.utils.datetime_utils import ensure_utc, utc_now
import enum

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

class ReasoningAudit(Base):
    """Stores the LLM's internal monologue for schedule changes."""
    __tablename__ = "reasoning_audit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    snapshot_id = Column(Integer, nullable=True)  # loosely coupled to cascade
    trigger_node_id = Column(Integer, ForeignKey("dag_nodes.id"), nullable=True)
    monologue = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)


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
    start_time = Column(DateTime(timezone=True), nullable=True)
    end_time = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    deadline = Column(DateTime(timezone=True), nullable=True)

    # Priority (1=highest, 5=lowest)
    priority = Column(Integer, nullable=True, default=3)

    # Metadata
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    source = Column(String(100), nullable=True)  # "google_calendar", "todoist", "notion"
    cascade_note = Column(Text, nullable=True)    # Auto-generated note explaining adjustments
    
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    # Relationships
    outgoing_edges = relationship("DAGEdge", foreign_keys="DAGEdge.from_node_id", back_populates="from_node", cascade="all, delete-orphan")
    incoming_edges = relationship("DAGEdge", foreign_keys="DAGEdge.to_node_id", back_populates="to_node", cascade="all, delete-orphan")

    def to_dict(self):
        start_time = ensure_utc(self.start_time)
        end_time = ensure_utc(self.end_time)
        deadline = ensure_utc(self.deadline)
        created_at = ensure_utc(self.created_at)
        updated_at = ensure_utc(self.updated_at)

        return {
            "id": self.id,
            "external_id": self.external_id,
            "title": self.title,
            "description": self.description,
            "node_type": self.node_type,
            "status": self.status,
            "start_time": start_time.isoformat() if start_time else None,
            "end_time": end_time.isoformat() if end_time else None,
            "duration_minutes": self.duration_minutes,
            "deadline": deadline.isoformat() if deadline else None,
            "priority": self.priority,
            "owner_id": self.owner_id,
            "source": self.source,
            "cascade_note": self.cascade_note,
            "created_at": created_at.isoformat() if created_at else None,
            "updated_at": updated_at.isoformat() if updated_at else None,
        }


class DAGEdge(Base):
    """An edge in the dependency graph — from_node must finish before to_node can start."""
    __tablename__ = "dag_edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_node_id = Column(Integer, ForeignKey("dag_nodes.id"), nullable=False)
    to_node_id = Column(Integer, ForeignKey("dag_nodes.id"), nullable=False)
    edge_type = Column(String(50), nullable=False, default="depends_on")  # depends_on, blocks, related_to
    weight = Column(Float, default=1.0)  # How strongly coupled
    is_cross_user = Column(Boolean, default=False)

    from_node = relationship("DAGNode", foreign_keys=[from_node_id], back_populates="outgoing_edges")
    to_node = relationship("DAGNode", foreign_keys=[to_node_id], back_populates="incoming_edges")

    def to_dict(self):
        return {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "edge_type": self.edge_type,
            "weight": self.weight,
            "is_cross_user": self.is_cross_user,
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
    created_at = Column(DateTime(timezone=True), default=utc_now)
    is_active = Column(Boolean, default=True)  # False if this cascade was undone

    def to_dict(self):
        created_at = ensure_utc(self.created_at)
        return {
            "id": self.id,
            "trigger_description": self.trigger_description,
            "trigger_node_id": self.trigger_node_id,
            "changes": json.loads(self.changes_json) if self.changes_json else [],
            "created_at": created_at.isoformat() if created_at else None,
            "is_active": self.is_active,
        }

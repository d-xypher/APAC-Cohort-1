"""CASCADE — Core logic for propagating changes across the DAG."""
import json
import logging
import networkx as nx
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from backend.config import REDIS_URL
from backend.models.dag import DAGNode, DAGEdge, CascadeSnapshot
from backend.utils.datetime_utils import ensure_utc, parse_iso_datetime

logger = logging.getLogger(__name__)


class CascadeError(Exception):
    """Base error for cascade operations."""


class CascadeNotFoundError(CascadeError):
    """Raised when a requested DAG entity or snapshot is missing."""


class CascadeValidationError(CascadeError):
    """Raised when cascade inputs or graph state are invalid."""


class CascadeExecutionError(CascadeError):
    """Raised when persistence operations fail unexpectedly."""

class CascadeEngine:
    """Manages the physics of the dependency graph."""
    
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _normalize_node_time_fields(node: DAGNode) -> None:
        """Normalize datetime fields to UTC-aware values in-memory."""
        node.start_time = ensure_utc(node.start_time)
        node.end_time = ensure_utc(node.end_time)
        node.deadline = ensure_utc(node.deadline)
        
    def _build_nx_graph(self) -> nx.DiGraph:
        """Loads DB state into memory via NetworkX."""
        nodes = self.db.query(DAGNode).all()
        edges = self.db.query(DAGEdge).all()
        
        G = nx.DiGraph()
        for n in nodes:
            G.add_node(n.id, data=n)
        for e in edges:
            G.add_edge(e.from_node_id, e.to_node_id, edge_type=e.edge_type, weight=e.weight)
            
        return G

    @staticmethod
    def _effective_end_time(node: DAGNode):
        """Resolve end_time; fall back to start + duration when explicit end_time is missing."""
        end_time = ensure_utc(node.end_time)
        if end_time:
            return end_time

        start_time = ensure_utc(node.start_time)
        if start_time and node.duration_minutes:
            return start_time + timedelta(minutes=node.duration_minutes)

        return None

    def trigger_cascade(self, trigger_node_id: int, new_start_time: datetime, description: str) -> CascadeSnapshot:
        """
        When a node's schedule changes, propagate the shift to all downstream dependencies.
        Returns the snapshot.
        """
        if not description or not description.strip():
            raise CascadeValidationError("description is required.")
        if not isinstance(new_start_time, datetime):
            raise CascadeValidationError("new_start_time must be a datetime value.")

        new_start_time = ensure_utc(new_start_time)
        if new_start_time is None:
            raise CascadeValidationError("new_start_time is required.")

        logger.info(
            "Starting cascade: trigger_node_id=%s, new_start_time=%s",
            trigger_node_id,
            new_start_time.isoformat(),
        )

        G = self._build_nx_graph()
        
        if trigger_node_id not in G.nodes:
            raise CascadeNotFoundError("Trigger node not found in DAG")
            
        trigger_node: DAGNode = G.nodes[trigger_node_id]['data']
        self._normalize_node_time_fields(trigger_node)
        
        # 1. Capture snapshot of CURRENT state before changes
        snapshot = self._take_snapshot(description, trigger_node_id)
        
        # 2. Apply shift linearly to start node
        if not trigger_node.start_time:
            raise CascadeValidationError("Trigger node must have a start_time to cascade")
            
        time_delta = new_start_time - trigger_node.start_time
        
        trigger_node.start_time = new_start_time
        if trigger_node.end_time:
            trigger_node.end_time += time_delta
            
        trigger_node.cascade_note = f"Manually moved. Caused cascade: '{description}'"
        
        # 3. BFS or Topological sort to shift downstream
        # Get all nodes reachable from trigger
        descendants = list(nx.descendants(G, trigger_node_id))
        
        # We need to process them in topological order so dependencies resolve first
        subgraph = G.subgraph([trigger_node_id] + descendants)
        if not nx.is_directed_acyclic_graph(subgraph):
            raise CascadeValidationError("Dependency graph contains a cycle; cascade requires a DAG.")

        topo_order = list(nx.topological_sort(subgraph))
        
        changes = []
        changes.append({
            "node_id": trigger_node.id, 
            "title": trigger_node.title, 
            "action": "moved", 
            "delta_mins": time_delta.total_seconds() / 60
        })

        redis_client = None
        if REDIS_URL:
            try:
                import redis

                redis_client = redis.from_url(
                    REDIS_URL,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                )
            except Exception as exc:
                logger.warning("Redis unavailable: %s", exc)

        for node_id in topo_order:
            if node_id == trigger_node_id:
                continue
                
            node: DAGNode = G.nodes[node_id]['data']
            self._normalize_node_time_fields(node)
            node_start = node.start_time
            node_end = node.end_time
            
            # Find the max end_time of all predecessors
            preds = list(G.predecessors(node_id))
            max_pred_end = None
            for p_id in preds:
                p_node: DAGNode = G.nodes[p_id]['data']

                # Cross-user pub/sub notification
                # Check cross user notification
                if redis_client and getattr(p_node, 'owner_id', None) != getattr(node, 'owner_id', None):
                    try:
                        redis_client.publish(
                            f"user_{getattr(node, 'owner_id', 'unknown')}_notifications", 
                            json.dumps({"type": "cross_user_dependency", "from_node": p_node.id, "to_node": node.id})
                        )
                    except Exception as exc:
                        logger.warning("Redis notification publish failed: %s", exc)

                pred_end = self._effective_end_time(p_node)
                if pred_end and (not max_pred_end or pred_end > max_pred_end):
                    max_pred_end = pred_end
                        
            # If our start time is now before the predecessor's end time, we MUST shift
            if max_pred_end and (not node_start or node_start < max_pred_end):
                # Shift start_time to max_pred_end + 5 mins buffer
                shift_to = max_pred_end + timedelta(minutes=5)
                
                needs_resolution = False
                if node.deadline and shift_to > node.deadline:
                    node.cascade_note = f"DEADLINE VIOLATION: Shift exceeds deadline. Triggering ResolutionNode."
                    if redis_client:
                        try:
                            redis_client.publish("langgraph_resolution", json.dumps({"node_id": node.id, "violation": "deadline"}))
                        except Exception as exc:
                            logger.warning("Redis resolution publish failed: %s", exc)
                    needs_resolution = True

                if node_start:
                    node_delta = shift_to - node_start
                else:
                    node_delta = timedelta(0)
                    
                node.start_time = shift_to
                if node.duration_minutes:
                    node.end_time = shift_to + timedelta(minutes=node.duration_minutes)
                elif node_end and node_delta.total_seconds() > 0:
                    node.end_time = node_end + node_delta

                if not needs_resolution:
                    node.cascade_note = f"Auto-shifted due to upstream delay. Pushed by {int(node_delta.total_seconds() / 60)} mins."

                # Confetti Time Focus Guard
                gap = shift_to - max_pred_end if max_pred_end else timedelta(0)
                if timedelta(minutes=0) < gap < timedelta(minutes=90):
                    node.cascade_note += " [CONFETTI TIME WARNING]"

                changes.append({
                    "node_id": node.id, 
                    "title": node.title, 
                    "action": "needs-resolution" if needs_resolution else "auto-shifted", 
                    "delta_mins": node_delta.total_seconds() / 60,
                    "note": node.cascade_note
                })
                logger.info(
                    "Auto-shifted node_id=%s by %.1f minutes",
                    node.id,
                    node_delta.total_seconds() / 60,
                )
        
        # Save changes to snapshot and flush to DB
        snapshot.changes_json = json.dumps(changes)
        try:
            self.db.add(snapshot)
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            logger.exception("Failed to commit cascade changes")
            raise CascadeExecutionError("Failed to persist cascade changes.") from exc

        logger.info(
            "Cascade completed: snapshot_id=%s, affected_nodes=%s",
            snapshot.id,
            max(len(changes) - 1, 0),
        )
        
        return snapshot
        
    def _take_snapshot(self, description: str, trigger_node_id: int) -> CascadeSnapshot:
        """Captures JSON serialization of graph before mutation."""
        nodes = [n.to_dict() for n in self.db.query(DAGNode).all()]
        edges = [e.to_dict() for e in self.db.query(DAGEdge).all()]
        
        snapshot = CascadeSnapshot(
            trigger_description=description,
            trigger_node_id=trigger_node_id,
            nodes_json=json.dumps(nodes),
            edges_json=json.dumps(edges),
            changes_json="[]"
        )
        return snapshot

    def undo_cascade(self, snapshot_id: int):
        """Restores the graph to the exact state captured in the snapshot."""
        logger.info("Undo requested for snapshot_id=%s", snapshot_id)
        snapshot = self.db.query(CascadeSnapshot).filter(CascadeSnapshot.id == snapshot_id).first()
        if not snapshot or not snapshot.is_active:
            raise CascadeNotFoundError("Snapshot not found or already inactive")
            
        nodes_data = json.loads(snapshot.nodes_json)
        edges_data = json.loads(snapshot.edges_json)
        
        # Brutally simple for hackathon: delete all, insert from snapshot
        self.db.query(DAGEdge).delete()
        self.db.query(DAGNode).delete()
        self.db.flush()
        
        # Re-insert nodes
        for nd in nodes_data:
            # handle datetime parsing
            for dt_field in ["start_time", "end_time", "deadline", "created_at", "updated_at"]:
                if dt_field in nd and nd[dt_field]:
                    nd[dt_field] = parse_iso_datetime(nd[dt_field])
                    
            node = DAGNode(**nd)
            self.db.add(node)
            
        # Re-insert edges
        for ed in edges_data:
            edge = DAGEdge(**ed)
            self.db.add(edge)
            
        snapshot.is_active = False  # mark as undone
        try:
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            logger.exception("Failed to commit undo snapshot operation")
            raise CascadeExecutionError("Failed to restore snapshot data.") from exc

        logger.info("Undo completed for snapshot_id=%s", snapshot_id)

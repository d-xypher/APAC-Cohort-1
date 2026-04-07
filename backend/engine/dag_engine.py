"""CASCADE — Core logic for propagating changes across the DAG."""
import json
import networkx as nx
from typing import List, Dict, Any, Tuple
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from backend.models.dag import DAGNode, DAGEdge, CascadeSnapshot, NodeStatus

class CascadeEngine:
    """Manages the physics of the dependency graph."""
    
    def __init__(self, db: Session):
        self.db = db
        
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

    def trigger_cascade(self, trigger_node_id: int, new_start_time: datetime, description: str) -> CascadeSnapshot:
        """
        When a node's schedule changes, propagate the shift to all downstream dependencies.
        Returns the snapshot.
        """
        G = self._build_nx_graph()
        
        if trigger_node_id not in G.nodes:
            raise ValueError("Trigger node not found in DAG")
            
        trigger_node: DAGNode = G.nodes[trigger_node_id]['data']
        
        # 1. Capture snapshot of CURRENT state before changes
        snapshot = self._take_snapshot(description, trigger_node_id)
        
        # 2. Apply shift linearly to start node
        if not trigger_node.start_time:
            raise ValueError("Trigger node must have a start_time to cascade")
            
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
        topo_order = list(nx.topological_sort(subgraph))
        
        changes = []
        changes.append({
            "node_id": trigger_node.id, 
            "title": trigger_node.title, 
            "action": "moved", 
            "delta_mins": time_delta.total_seconds() / 60
        })

        for node_id in topo_order:
            if node_id == trigger_node_id:
                continue
                
            node: DAGNode = G.nodes[node_id]['data']
            
            # Find the max end_time of all predecessors
            preds = list(G.predecessors(node_id))
            max_pred_end = None
            for p_id in preds:
                p_node: DAGNode = G.nodes[p_id]['data']
                if p_node.end_time:
                    if not max_pred_end or p_node.end_time > max_pred_end:
                        max_pred_end = p_node.end_time
                        
            # If our start time is now before the predecessor's end time, we MUST shift
            if max_pred_end and (not node.start_time or node.start_time < max_pred_end):
                # Shift start_time to max_pred_end + 5 mins buffer
                shift_to = max_pred_end + timedelta(minutes=5)
                
                if node.start_time:
                    node_delta = shift_to - node.start_time
                else:
                    node_delta = timedelta(0)
                    
                node.start_time = shift_to
                if node.duration_minutes:
                    node.end_time = shift_to + timedelta(minutes=node.duration_minutes)
                elif node.end_time and node_delta.total_seconds() > 0:
                    node.end_time += node_delta

                node.cascade_note = f"Auto-shifted due to upstream delay. Pushed by {int(node_delta.total_seconds() / 60)} mins."
                
                changes.append({
                    "node_id": node.id, 
                    "title": node.title, 
                    "action": "auto-shifted", 
                    "delta_mins": node_delta.total_seconds() / 60,
                    "note": node.cascade_note
                })
        
        # Save changes to snapshot and flush to DB
        snapshot.changes_json = json.dumps(changes)
        self.db.add(snapshot)
        self.db.commit()
        
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
        snapshot = self.db.query(CascadeSnapshot).filter(CascadeSnapshot.id == snapshot_id).first()
        if not snapshot or not snapshot.is_active:
            raise ValueError("Snapshot not found or already inactive")
            
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
                    nd[dt_field] = datetime.fromisoformat(nd[dt_field])
                    
            node = DAGNode(**nd)
            self.db.add(node)
            
        # Re-insert edges
        for ed in edges_data:
            edge = DAGEdge(**ed)
            self.db.add(edge)
            
        snapshot.is_active = False  # mark as undone
        self.db.commit()

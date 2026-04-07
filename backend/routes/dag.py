from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from backend.db.database import get_db
from backend.models.dag import DAGNode, DAGEdge, NodeType, NodeStatus
from backend.models.schemas import DAGNodeCreate, DAGNodeUpdate, DAGNodeResponse, DAGEdgeCreate, DAGEdgeResponse

router = APIRouter(prefix="/api/dag", tags=["dag"])

@router.get("/nodes", response_model=List[DAGNodeResponse])
def get_nodes(db: Session = Depends(get_db)):
    return db.query(DAGNode).all()

@router.post("/nodes", response_model=DAGNodeResponse)
def create_node(node: DAGNodeCreate, db: Session = Depends(get_db)):
    db_node = DAGNode(**node.model_dump())
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    return db_node

@router.put("/nodes/{node_id}", response_model=DAGNodeResponse)
def update_node(node_id: int, node_update: DAGNodeUpdate, db: Session = Depends(get_db)):
    db_node = db.query(DAGNode).filter(DAGNode.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
        
    for key, value in node_update.model_dump(exclude_unset=True).items():
        setattr(db_node, key, value)
        
    db.commit()
    db.refresh(db_node)
    return db_node

@router.get("/edges", response_model=List[DAGEdgeResponse])
def get_edges(db: Session = Depends(get_db)):
    return db.query(DAGEdge).all()

@router.post("/edges", response_model=DAGEdgeResponse)
def create_edge(edge: DAGEdgeCreate, db: Session = Depends(get_db)):
    # Verify nodes exist
    if not db.query(DAGNode).filter(DAGNode.id == edge.from_node_id).first():
        raise HTTPException(status_code=404, detail="from_node not found")
    if not db.query(DAGNode).filter(DAGNode.id == edge.to_node_id).first():
        raise HTTPException(status_code=404, detail="to_node not found")
        
    db_edge = DAGEdge(**edge.model_dump())
    db.add(db_edge)
    db.commit()
    db.refresh(db_edge)
    return db_edge

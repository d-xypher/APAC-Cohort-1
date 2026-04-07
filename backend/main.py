from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import CORS_ORIGINS
from backend.db.database import init_db
from backend.routes import dag, cascade, seed, events

# Initialize SQLite/PostgreSQL tables
init_db()

app = FastAPI(
    title="CASCADE — Multi-Agent Productivity Assistant",
    description="The Ripple-Effect Workflow Engine",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dag.router)
app.include_router(cascade.router)
app.include_router(seed.router)
app.include_router(events.router)

@app.get("/health")
def health_check():
    return {"status": "healthy"}

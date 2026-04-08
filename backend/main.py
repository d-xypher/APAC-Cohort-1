import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import APP_ENV, CORS_ORIGINS
from backend.db.database import init_db
from backend.routes import dag, cascade, seed, events

logging.basicConfig(
    level=logging.DEBUG if APP_ENV == "development" else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

# Initialize SQLite/PostgreSQL tables
init_db()

app = FastAPI(
    title="CASCADE — Multi-Agent Productivity Assistant",
    description="The Ripple-Effect Workflow Engine",
    version="1.0.0"
)

allow_credentials = CORS_ORIGINS != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=allow_credentials,
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


import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.config import ALLOWED_HOSTS, APP_ENV, CORS_ORIGINS
from backend.db.database import init_db
from backend.routes import dag, cascade, seed, events, chat

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1024)

if ALLOWED_HOSTS != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        if APP_ENV == "production":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.include_router(dag.router)
app.include_router(cascade.router)
app.include_router(seed.router)
app.include_router(events.router)
app.include_router(chat.router)

@app.get("/health")
def health_check():
    return {"status": "healthy"}


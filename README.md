# CASCADE

CASCADE is a dependency-aware scheduling and workflow orchestration platform.

It includes:
1. A FastAPI backend that manages DAG-based cascade logic, chat orchestration, event streaming, and persistence.
2. A React (Vite) frontend for visual workflow control, timeline interaction, conflict review, and live agent updates.

## Contents
1. [Architecture Overview](#architecture-overview)
2. [Repository Structure](#repository-structure)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Local Development Setup](#local-development-setup)
6. [Configuration](#configuration)
7. [Backend API Overview](#backend-api-overview)
8. [Google Calendar OAuth Setup](#google-calendar-oauth-setup)
9. [Build and Quality Commands](#build-and-quality-commands)
10. [Deployment on Google Cloud](#deployment-on-google-cloud)
11. [Security Notes](#security-notes)
12. [Troubleshooting](#troubleshooting)

## Architecture Overview

The platform is designed around dependency propagation.

1. A node (task or calendar item) is moved or updated.
2. The backend computes downstream impact using DAG traversal.
3. Conflicts and previews are generated before commit when applicable.
4. Changes are persisted with snapshot history and can be undone.
5. Live progress and agent events are pushed to the frontend over SSE.

Key backend capabilities:
1. DAG CRUD and preview APIs.
2. Cascade trigger and undo APIs.
3. Chat endpoint with controlled Gemini integration.
4. SSE event stream for UI telemetry.

Key frontend capabilities:
1. Graph and timeline interaction.
2. Drag-to-reschedule workflow.
3. Conflict and resolution modals.
4. Command bar and command palette.
5. Live orchestration panel updates.

## Repository Structure

```text
cascade/
	backend/
		agents/
		db/
		engine/
		mcp_servers/
		models/
		routes/
		utils/
		main.py
		config.py
		requirements.txt
	frontend/
		src/
		public/
		package.json
		vite.config.js
	Dockerfile
	.dockerignore
	.gitignore
	README.md
```

## Tech Stack

Backend:
1. Python 3.11+
2. FastAPI
3. SQLAlchemy
4. NetworkX
5. Uvicorn

Frontend:
1. React 19
2. Vite 8
3. D3
4. Axios

Infrastructure:
1. Docker (multi-stage image)
2. Google Cloud Run target

## Prerequisites

1. Python 3.11+ installed.
2. Node.js 20+ and npm installed.
3. Optional: Google Cloud CLI for deployment.
4. Optional: Google Calendar API credentials for calendar integration.

## Local Development Setup

### 1) Backend setup

From repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
```

Update `backend/.env` with required values, especially:
1. `GEMINI_API_KEY`
2. `DATABASE_URL` (if not using default SQLite)

### 2) Frontend setup

```powershell
cd frontend
npm install
copy .env.example .env
cd ..
```

### 3) Run backend

Run from repository root:

```powershell
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

### 4) Run frontend

```powershell
cd frontend
npm run dev
```

By default, frontend API calls are proxied to `http://localhost:8000` in development.

## Configuration

### Backend environment variables

Reference file: `backend/.env.example`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_ENV` | No | `development` | Runtime mode (`development` or `production`). |
| `PORT` | No | `8000` | Backend listening port (Cloud Run injects its own). |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated allowed origins. |
| `ALLOWED_HOSTS` | No | `*` | Trusted hostnames for backend requests. |
| `ENABLE_SEED_ENDPOINTS` | No | `true` | Enables/disables demo seeding route. Set `false` in production. |
| `DATABASE_URL` | No | `sqlite:///./cascade.db` | SQLAlchemy connection string. |
| `REDIS_URL` | No | empty | Optional Redis URL for pub/sub signaling. |
| `GEMINI_API_KEY` | Yes for chat | empty | API key used by chat/orchestration model calls. |
| `GOOGLE_CREDENTIALS_PATH` | Optional | `backend/credentials.json` | OAuth client secret JSON path. |
| `GOOGLE_TOKEN_PATH` | Optional | `backend/token.json` | OAuth token cache path. |

### Frontend environment variables

Reference file: `frontend/.env.example`

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_BASE_URL` | No | `/api` | Base URL for API calls. |
| `VITE_EVENTS_STREAM_URL` | No | derived | Optional explicit SSE endpoint. |
| `VITE_API_TIMEOUT_MS` | No | `15000` | HTTP timeout in milliseconds. |
| `VITE_DEV_BACKEND_URL` | No | `http://localhost:8000` | Vite dev proxy target. |

## Backend API Overview

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Basic health endpoint. |

### DAG routes (`/api/dag`)

| Method | Path | Description |
|---|---|---|
| GET | `/nodes` | List all DAG nodes. |
| GET | `/nodes/{node_id}` | Get one node. |
| POST | `/nodes` | Create node. |
| PUT | `/nodes/{node_id}` | Update node. |
| DELETE | `/nodes/{node_id}` | Delete node. |
| GET | `/edges` | List edges. |
| POST | `/edges` | Create edge. |
| DELETE | `/edges/{edge_id}` | Delete edge. |
| POST | `/cascade/preview` | Preview downstream ripple effects. |

### Cascade routes (`/api/cascade`)

| Method | Path | Description |
|---|---|---|
| POST | `/trigger` | Commit cascade update and snapshot changes. |
| POST | `/undo/{snapshot_id}` | Undo previous cascade by snapshot. |
| POST | `/resolution-options` | Generate practical conflict resolution options. |

### Event stream (`/api/events`)

| Method | Path | Description |
|---|---|---|
| GET | `/stream` | Server-sent event stream for live UI updates. |

### Chat routes (`/api/chat`)

| Method | Path | Description |
|---|---|---|
| POST | `/` | Non-streaming chat response. |
| POST | `/stream` | Streaming chat response. |

### Seed route (`/api/seed`)

| Method | Path | Description |
|---|---|---|
| POST | `/` | Resets and seeds demo graph data. Controlled by `ENABLE_SEED_ENDPOINTS`. |

## Google Calendar OAuth Setup

1. In Google Cloud Console, enable Google Calendar API.
2. Create OAuth client credentials with application type `Desktop app`.
3. Download the JSON file.
4. Place it at `backend/credentials.json` or update `GOOGLE_CREDENTIALS_PATH`.
5. Run:

```powershell
python backend\test_calendar.py
```

On first successful authentication, token data is generated at `backend/token.json` or the configured `GOOGLE_TOKEN_PATH`.

## Build and Quality Commands

Frontend:

```powershell
cd frontend
npm run lint
npm run build
```

Backend syntax check:

```powershell
python -m compileall backend
```

## Deployment on Google Cloud

Cloud Run is the recommended backend target.

### 1) Build container image

```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/cascade-api
```

### 2) Deploy backend service

```bash
gcloud run deploy cascade-api \
	--image gcr.io/<PROJECT_ID>/cascade-api \
	--platform managed \
	--region <REGION> \
	--allow-unauthenticated \
	--set-env-vars APP_ENV=production,ENABLE_SEED_ENDPOINTS=false,CORS_ORIGINS=https://<FRONTEND_DOMAIN>,ALLOWED_HOSTS=<SERVICE_HOSTNAME>
```

### 3) Set secrets and runtime config

At minimum configure:
1. `GEMINI_API_KEY`
2. `DATABASE_URL`

Optional:
1. `REDIS_URL`
2. Calendar OAuth variables if required by your deployment model

### 4) Deploy frontend

Build frontend assets and deploy to static hosting (for example Firebase Hosting, Cloud Storage with CDN, or equivalent). Set frontend API base URL to:

`https://<cloud-run-service>/api`

## Security Notes

1. Do not commit `.env` files, credentials JSON, or token files.
2. Keep `ENABLE_SEED_ENDPOINTS=false` in production.
3. Restrict `CORS_ORIGINS` and `ALLOWED_HOSTS` to known domains.
4. Use managed secrets for API keys and database credentials.
5. Rotate compromised API keys immediately if upstream provider reports leakage.

## Troubleshooting

### Backend import error (`ModuleNotFoundError: No module named 'backend'`)

Run Uvicorn from repository root or pass app dir explicitly:

```powershell
uvicorn --app-dir . backend.main:app --reload
```

### Frontend proxy errors for `/api/events/stream`

Ensure backend is running on configured `VITE_DEV_BACKEND_URL` (default `http://localhost:8000`).

### Chat returns `502` with provider message

This indicates upstream AI provider rejection (for example invalid key, leaked key, quota, or billing limits). Update and validate `GEMINI_API_KEY`.

### Seed endpoint forbidden

Set `ENABLE_SEED_ENDPOINTS=true` in local development if you need demo reseeding.

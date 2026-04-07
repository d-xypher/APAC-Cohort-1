# APAC-Cohort-1 (CASCADE)

This repo contains a FastAPI backend and a React (Vite) frontend for the CASCADE multi-agent workflow demo.

## 1) Quick Start

### Backend

1. Create a virtual environment in `backend/`.
2. Activate it.
3. Install dependencies:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

4. Create env file from template:

```powershell
copy .env.example .env
```

5. Fill in required values in `.env` (at minimum `GEMINI_API_KEY`).

### Frontend

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

If backend is local, keep `VITE_API_BASE_URL=/api` and the Vite dev proxy will forward calls to `http://localhost:8000`.
For split deployments, set `VITE_API_BASE_URL` to your backend URL, for example `https://your-backend-domain/api`.

### Backend Run

```powershell
cd backend
uvicorn backend.main:app --reload
```

## 2) Google Calendar OAuth Setup (Fixes Auth Loop Issues)

1. In Google Cloud Console, enable **Google Calendar API**.
2. Create OAuth Client ID with app type **Desktop app**.
3. Download the JSON file.
4. Place it at `backend/credentials.json` (or update `GOOGLE_CREDENTIALS_PATH` in `backend/.env`).
5. Run auth test:

```powershell
python backend/test_calendar.py
```

On first success, a token file is generated at `backend/token.json` (or your configured `GOOGLE_TOKEN_PATH`).

## 3) Seed Demo Graph Data

Run the backend and call:

- `POST /api/seed/`

This resets and seeds demo DAG nodes/edges for local testing.

## 4) Requirement Alignment (Hackathon Demo)

- Primary Agent (Orchestrator):
	The orchestrator is the central controller for trigger handling, sub-agent sequencing, and summary events in `backend/agents/orchestrator.py`.
- Sub-Agents:
	- Calendar Agent handles scheduling updates.
	- Task Agent handles dependency propagation updates.
	- Notes Agent logs workflow outcomes.
	These are visible in the live agent stream in the frontend.
- Database:
	DAG nodes and edges are persisted via SQLAlchemy models and exposed through `GET /api/dag/nodes` and `GET /api/dag/edges`.
- MCP Integration:
	- Google Calendar MCP: `backend/mcp_servers/calendar_mcp.py`
	- Task MCP (mock): `backend/mcp_servers/task_mcp.py`
	- Notes MCP (mock): `backend/mcp_servers/notes_mcp.py`
- Workflow Execution:
	- Trigger cascade: `POST /api/cascade/trigger`
	- Undo cascade: `POST /api/cascade/undo/{snapshot_id}`
	- Real-time visibility through SSE: `GET /api/events/stream`

## 5) Suggested 90-Second Demo Flow

1. Seed demo graph.
2. Show Orchestrator control strip and Mission Control panel (Trigger -> Propagation -> Logging).
3. Click Simulate Demo Disruption.
4. Show live agent updates, DAG highlight, and timeline cascade impact.
5. Show success banner and local-time schedule updates.
6. Click Undo Cascade and confirm rollback in UI.

## 6) Current Development Priorities

- Tune agent orchestration in `backend/agents/orchestrator.py`.
- Improve frontend state refresh for DAG updates.
- Expand API/agent error handling and retries.
- Configure secret management and env vars for Cloud Run deployment.

## 7) Security Notes

- Never commit `backend/credentials.json`, `backend/token.json`, or `.env` files.
- Keep secrets in environment variables or cloud secret manager for production.

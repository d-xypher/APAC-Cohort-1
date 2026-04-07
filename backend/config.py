"""CASCADE — Configuration Module"""
import os
from dotenv import load_dotenv

load_dotenv()

# ── Gemini API ──────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ── Database ────────────────────────────────────────────────
# Local: SQLite | Cloud: PostgreSQL via Cloud SQL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./cascade.db")

# ── Google Calendar OAuth ───────────────────────────────────
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/callback")
GOOGLE_CREDENTIALS_PATH = os.getenv("GOOGLE_CREDENTIALS_PATH", "backend/credentials.json")
GOOGLE_TOKEN_PATH = os.getenv("GOOGLE_TOKEN_PATH", "backend/token.json")

# ── App Settings ────────────────────────────────────────────
APP_ENV = os.getenv("APP_ENV", "development")  # development | production
PORT = int(os.getenv("PORT", "8000"))
CORS_ORIGINS = [
	origin.strip()
	for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
	if origin.strip()
]

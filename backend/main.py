from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from dotenv import load_dotenv
import logging
import os

from routers import process, sessions, diagnostics, live
from db import init_db

load_dotenv(Path(__file__).parent / ".env")
logger = logging.getLogger("liberstudy.startup")

app = FastAPI(title="LiberStudy API", version="0.1.0")

# 初始化数据库（创建表）
init_db()

# CORS
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/slides", StaticFiles(directory="static/slides"), name="slides")
app.mount("/audio", StaticFiles(directory="static/audio"), name="audio")
app.mount("/runs", StaticFiles(directory="static/runs"), name="runs")

app.include_router(process.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(diagnostics.router, prefix="/api")
app.include_router(live.router, prefix="/api")

def _mask_key(key: str) -> str:
    if not key:
        return "(missing)"
    if len(key) <= 8:
        return f"{key}***"
    return f"{key[:8]}***"


@app.on_event("startup")
def startup_env_check():
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    logger.info(
        "[EnvCheck] OPENAI_API_KEY=%s ANTHROPIC_API_KEY=%s OPENAI_BASE_URL=%s",
        _mask_key(openai_key),
        _mask_key(anthropic_key),
        os.getenv("OPENAI_BASE_URL", "").strip() or "(default)",
    )


@app.get("/health")
def health():
    return {"status": "ok"}

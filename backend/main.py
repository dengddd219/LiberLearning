from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from dotenv import load_dotenv
import os

from routers import process, sessions, diagnostics
from db import init_db

load_dotenv(Path(__file__).parent / ".env")

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

app.include_router(process.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(diagnostics.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os

from routers import process, sessions

load_dotenv()

app = FastAPI(title="LiberStudy API", version="0.1.0")

# CORS
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files (PPT slide PNGs and audio)
app.mount("/slides", StaticFiles(directory="static/slides"), name="slides")
app.mount("/audio", StaticFiles(directory="static/audio"), name="audio")

# Routers
app.include_router(process.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}

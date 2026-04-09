from fastapi import APIRouter, UploadFile, File
from typing import Optional

router = APIRouter(tags=["process"])


@router.get("/process/health")
def process_health():
    return {"status": "ok", "router": "process"}


@router.post("/process-mock")
async def process_mock(
    ppt: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
):
    """
    Phase A mock endpoint: ignores uploaded files, returns a fixed session_id.
    The actual mock data is served by GET /api/sessions/{id}.
    """
    return {"session_id": "mock-session-001"}

"""Tests for POST /api/process parameter validation."""
import io
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine


def _inject_missing_service_mocks():
    """Inject mock modules for services that aren't importable in test env."""
    mocks = {
        "services.alignment": ["build_page_timeline"],
        "services.asr": ["transcribe"],
        "services.audio": ["convert_to_wav", "get_audio_duration"],
        "services.ppt_parser": ["parse_ppt", "extract_domain_terms"],
        "services.note_generator": ["generate_notes_for_all_pages"],
    }
    for mod_name, attrs in mocks.items():
        if mod_name not in sys.modules:
            mod = ModuleType(mod_name)
            for attr in attrs:
                setattr(mod, attr, MagicMock())
            sys.modules[mod_name] = mod


_inject_missing_service_mocks()


@pytest.fixture
def client():
    import db
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(test_engine)
    # Patch both the db module engine AND the rate_limit/session functions
    # imported into routers.process, to avoid async thread isolation issues.
    with patch.object(db, "engine", test_engine), \
         patch("routers.process.check_and_record_rate_limit"), \
         patch("routers.process.db") as mock_db:
        mock_db.save_session = MagicMock()
        mock_db.update_session = MagicMock()
        from main import app
        with TestClient(app) as c:
            yield c


def _audio_file(content_type="audio/wav"):
    return ("audio", ("test.wav", io.BytesIO(b"RIFF" + b"\x00" * 100), content_type))


def test_invalid_language_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file()],
        data={"language": "fr"},
    )
    assert resp.status_code == 422
    assert "language" in resp.json()["detail"].lower()


def test_invalid_user_anchors_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file()],
        data={"user_anchors": "not-valid-json"},
    )
    assert resp.status_code == 422
    assert "user_anchors" in resp.json()["detail"].lower()


def test_user_anchors_non_array_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file()],
        data={"user_anchors": '{"key": "value"}'},
    )
    assert resp.status_code == 422
    assert "user_anchors" in resp.json()["detail"].lower()


def test_unsupported_audio_type_returns_422(client):
    resp = client.post(
        "/api/process",
        files=[_audio_file(content_type="video/mp4")],
        data={"language": "zh"},
    )
    assert resp.status_code == 422
    assert "audio" in resp.json()["detail"].lower()


def test_valid_language_zh_passes_validation(client):
    """Valid params should not return 422 (may fail at pipeline stage, that's ok)."""
    with patch("routers.process._run_pipeline", new_callable=AsyncMock):
        resp = client.post(
            "/api/process",
            files=[_audio_file()],
            data={"language": "zh"},
        )
    assert resp.status_code != 422


def test_valid_language_en_passes_validation(client):
    """Valid params should not return 422."""
    with patch("routers.process._run_pipeline", new_callable=AsyncMock):
        resp = client.post(
            "/api/process",
            files=[_audio_file()],
            data={"language": "en"},
        )
    assert resp.status_code != 422

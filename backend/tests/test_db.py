"""Unit tests for db.py — use in-memory SQLite so no file is created."""
import pytest
from sqlmodel import create_engine, SQLModel
from unittest.mock import patch

TEST_DB_URL = "sqlite://"


@pytest.fixture(autouse=True)
def use_test_db(tmp_path):
    """Override engine to use in-memory SQLite for all tests."""
    import db
    test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(test_engine)
    with patch.object(db, "engine", test_engine):
        yield test_engine


def test_save_and_get_session():
    import db
    db.save_session("s1", {
        "session_id": "s1",
        "status": "processing",
        "ppt_filename": "test.pptx",
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
        "progress": {"step": "uploading", "percent": 5},
        "error": None,
    })
    result = db.get_session("s1")
    assert result is not None
    assert result["session_id"] == "s1"
    assert result["status"] == "processing"
    assert result["pages"] == []
    assert result["progress"]["step"] == "uploading"


def test_update_session():
    import db
    db.save_session("s2", {
        "session_id": "s2",
        "status": "processing",
        "ppt_filename": None,
        "audio_url": None,
        "total_duration": 0,
        "pages": [],
        "progress": {"step": "uploading", "percent": 5},
        "error": None,
    })
    db.update_session("s2", {"status": "ready", "total_duration": 3600})
    result = db.get_session("s2")
    assert result["status"] == "ready"
    assert result["total_duration"] == 3600


def test_get_session_not_found():
    import db
    result = db.get_session("nonexistent")
    assert result is None


def test_rate_limit_check_allows_under_limit():
    import db
    db.check_and_record_rate_limit("1.2.3.4", max_calls=2, window_seconds=86400)


def test_rate_limit_check_blocks_over_limit():
    import db
    db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)
    db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)
    with pytest.raises(db.RateLimitExceeded):
        db.check_and_record_rate_limit("5.6.7.8", max_calls=2, window_seconds=86400)


def test_get_rate_limit_status():
    import db
    db.check_and_record_rate_limit("9.9.9.9", max_calls=2, window_seconds=86400)
    status = db.get_rate_limit_status("9.9.9.9", max_calls=2, window_seconds=86400)
    assert status["used"] == 1
    assert status["limit"] == 2
    assert status["remaining"] == 1

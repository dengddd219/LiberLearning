"""
In-process SSE event pub/sub using asyncio.Queue.
Single-process deployment only. Replace with Redis Pub/Sub if scaling to multiple workers.
"""
import asyncio
import json
from typing import Optional

_event_queues: dict[str, list[asyncio.Queue]] = {}


def publish_event(session_id: str, event_type: str, data: Optional[dict] = None):
    """Push an event to all subscribers for this session."""
    event = {"event": event_type, **(data or {})}
    for q in _event_queues.get(session_id, []):
        q.put_nowait(event)


async def wait_for_event(session_id: str, timeout: float = 300) -> Optional[dict]:
    """Block until an event arrives or timeout. Returns None on timeout."""
    q: asyncio.Queue = asyncio.Queue()
    _event_queues.setdefault(session_id, []).append(q)
    try:
        return await asyncio.wait_for(q.get(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    finally:
        _event_queues[session_id].remove(q)
        if not _event_queues[session_id]:
            del _event_queues[session_id]

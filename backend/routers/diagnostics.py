"""
GET /api/diagnostics  — 全流程健康检查，逐步测试每个关键节点
返回结构化检查报告，可被前端诊断页面直接消费
"""

import os
import time
import json
import tempfile
import traceback
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["diagnostics"])


def _check(name: str, fn) -> dict:
    """执行一个检查，返回标准化结果"""
    t0 = time.time()
    try:
        detail = fn()
        return {
            "name": name,
            "status": "ok",
            "detail": detail,
            "ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        return {
            "name": name,
            "status": "fail",
            "detail": str(e),
            "trace": traceback.format_exc(limit=3),
            "ms": round((time.time() - t0) * 1000),
        }


# ─── 各检查项 ──────────────────────────────────────────────────────────────────

def check_env_vars() -> str:
    """关键环境变量是否已设置"""
    results = {}
    keys = [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
    ]
    missing = []
    for k in keys:
        val = os.getenv(k)
        if val:
            results[k] = f"✓ 已设置 ({val[:8]}...)" if len(val) > 8 else "✓ 已设置"
        else:
            results[k] = "✗ 未设置"
            if k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
                missing.append(k)

    if missing:
        raise RuntimeError(f"缺少必要环境变量: {', '.join(missing)}\n详情: {json.dumps(results, ensure_ascii=False)}")
    return json.dumps(results, ensure_ascii=False)


def check_database() -> str:
    """SQLite 数据库可读写"""
    import db
    from sqlmodel import Session as DbSession, text

    with DbSession(db.engine) as session:
        # 检查 session 表是否存在
        result = session.exec(
            text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session'")
        ).one()
        table_exists = result[0] == 1

    if not table_exists:
        raise RuntimeError("session 表不存在，请检查 db.init_db() 是否调用")

    # 查询 session 数量
    sessions = db.list_sessions()
    return f"数据库正常，当前 {len(sessions)} 条 session 记录（含历史）"


def check_static_dirs() -> str:
    """静态文件目录是否存在"""
    backend_dir = Path(__file__).parent.parent
    dirs = {
        "static/slides": backend_dir / "static" / "slides",
        "static/audio":  backend_dir / "static" / "audio",
    }
    results = {}
    for name, path in dirs.items():
        if path.exists():
            count = len(list(path.iterdir()))
            results[name] = f"✓ 存在，{count} 个子目录/文件"
        else:
            results[name] = "✗ 不存在"
    return json.dumps(results, ensure_ascii=False)


def check_ffmpeg() -> str:
    """FFmpeg 是否安装"""
    import subprocess
    result = subprocess.run(
        ["ffmpeg", "-version"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg 返回错误: {result.stderr[:200]}")
    first_line = result.stdout.split("\n")[0]
    return f"✓ {first_line}"


def check_libreoffice() -> str:
    """LibreOffice 是否安装"""
    import subprocess
    candidates = ["libreoffice", "soffice"]
    for cmd in candidates:
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return f"✓ {result.stdout.strip()[:100]}"
        except FileNotFoundError:
            continue
    raise RuntimeError("LibreOffice / soffice 未找到，PPT 解析将失败")


def check_openai_api() -> str:
    """OpenAI API 连通性（用于 Whisper ASR 和 Embeddings）"""
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 未设置")

    base_url = os.getenv("OPENAI_BASE_URL")
    client = OpenAI(api_key=api_key, base_url=base_url) if base_url else OpenAI(api_key=api_key)

    # 轻量测试：列出模型（不消耗 tokens）
    models = client.models.list()
    names = [m.id for m in list(models)[:3]]
    return f"✓ 连通，前3个模型: {names}"


def check_anthropic_api() -> str:
    """Anthropic API 连通性（用于笔记生成）"""
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 未设置")

    base_url = os.getenv("ANTHROPIC_BASE_URL")
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url

    client = anthropic.Anthropic(**kwargs)

    # 最小消耗测试：1 token prompt
    response = client.messages.create(
        model=model,
        max_tokens=5,
        messages=[{"role": "user", "content": "Hi"}],
    )
    return f"✓ 连通，model={model}，response_id={response.id[:12]}..."


def check_mock_session() -> str:
    """mock-session-001 端点返回正常"""
    import db
    from routers.sessions import MOCK_SESSION

    assert MOCK_SESSION["session_id"] == "mock-session-001", "mock session_id 不匹配"
    assert MOCK_SESSION["status"] == "ready", f"mock status={MOCK_SESSION['status']}"
    pages = MOCK_SESSION.get("pages", [])
    assert len(pages) > 0, "mock session 没有 pages"
    return f"✓ mock session 正常，共 {len(pages)} 页"


def check_upload_endpoint() -> str:
    """
    模拟一次真实上传请求（向本机 /api/process 发 multipart）
    使用 requests 库直接打本地端口，测试整个上传->写盘->返回 session_id 流程
    注意：只测试到 BackgroundTask 启动前（不等待流水线完成）
    """
    import requests
    import io

    # 创建 1 秒的静音 WAV（不需要 FFmpeg 处理，直接过校验）
    # WAV header for 1s 16kHz mono 16-bit PCM silence
    sample_rate = 16000
    num_samples = sample_rate  # 1 second
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample

    import struct
    wav_header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,        # chunk size
        1,         # PCM
        1,         # mono
        sample_rate,
        sample_rate * 2,  # byte rate
        2,         # block align
        16,        # bits per sample
        b"data",
        data_size,
    )
    wav_data = wav_header + b"\x00" * data_size

    files = {
        "audio": ("test_silence.wav", io.BytesIO(wav_data), "audio/wav"),
    }
    data = {
        "language": "zh",
        "user_anchors": "[]",
    }

    try:
        resp = requests.post(
            "http://localhost:8000/api/process",
            files=files,
            data=data,
            timeout=15,
        )
    except requests.exceptions.ConnectionError:
        raise RuntimeError("无法连接 http://localhost:8000 — 后端是否已启动？")

    if resp.status_code == 429:
        raise RuntimeError(f"触发限速 (429)，今日调用次数已满")
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")

    result = resp.json()
    session_id = result.get("session_id")
    if not session_id:
        raise RuntimeError(f"响应缺少 session_id: {result}")

    return f"✓ 上传成功，session_id={session_id}"


def check_sessions_list() -> str:
    """GET /api/sessions 返回正常"""
    import requests

    try:
        resp = requests.get("http://localhost:8000/api/sessions", timeout=5)
    except requests.exceptions.ConnectionError:
        raise RuntimeError("无法连接 http://localhost:8000 — 后端是否已启动？")

    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")

    sessions = resp.json()
    return f"✓ 返回 {len(sessions)} 条 session（含所有历史记录）"


# ─── 主端点 ───────────────────────────────────────────────────────────────────

CHECKS = [
    ("1. 环境变量",       check_env_vars),
    ("2. 数据库",         check_database),
    ("3. 静态目录",       check_static_dirs),
    ("4. FFmpeg",         check_ffmpeg),
    ("5. LibreOffice",    check_libreoffice),
    ("6. Anthropic API",  check_anthropic_api),
    ("7. OpenAI API",     check_openai_api),
    ("8. Mock Session",   check_mock_session),
    ("9. 上传端点",       check_upload_endpoint),
    ("10. Sessions列表",  check_sessions_list),
]


@router.get("/diagnostics")
def run_diagnostics(fast: bool = False):
    """
    运行全流程诊断。
    fast=true 时跳过外部 API 调用（检查1-5 + 8-10）
    """
    results = []
    for name, fn in CHECKS:
        is_api_check = name in ("6. Anthropic API", "7. OpenAI API")
        if fast and is_api_check:
            results.append({
                "name": name,
                "status": "skipped",
                "detail": "fast 模式跳过 API 连通性检查",
                "ms": 0,
            })
        else:
            results.append(_check(name, fn))

    total_ok = sum(1 for r in results if r["status"] == "ok")
    total_fail = sum(1 for r in results if r["status"] == "fail")
    total_skip = sum(1 for r in results if r["status"] == "skipped")

    return {
        "summary": {
            "ok": total_ok,
            "fail": total_fail,
            "skipped": total_skip,
            "total": len(results),
            "healthy": total_fail == 0,
        },
        "checks": results,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

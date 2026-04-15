"""
ASR transcription service.
Primary: Alibaba Cloud ASR (Chinese zh / English en via RESTful async API)
Fallback: OpenAI Whisper API

Output format (list of segments):
  [{"text": str, "start": float, "end": float}, ...]
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
from typing import Optional

from openai import OpenAI

import settings as _settings

CHUNK_DURATION_SEC = _settings.ASR_CHUNK_DURATION_SEC
MAX_FILE_SIZE_MB = 25

# ── Sentence-ending punctuation ───────────────────────────────────────────────
_SENTENCE_END = re.compile(r"[.?!。？！]$")
_MAX_MERGE_CHARS = _settings.ASR_MAX_MERGE_CHARS  # force-cut if no sentence-end punctuation found

# ── Filler words to strip (English + Chinese) ─────────────────────────────────
_EN_FILLERS = re.compile(
    r"\b(um+|uh+|er+|ah+|like|you know|i mean|sort of|kind of|basically|literally|right\?|okay so|so yeah)\b",
    re.IGNORECASE,
)
_ZH_FILLERS = re.compile(r"[嗯呃啊哦额那个就是其实吧呢]")


def _merge_into_sentences(segments: list[dict]) -> list[dict]:
    """
    Merge raw Whisper segments into complete sentences.

    Rules:
    - Cut on sentence-ending punctuation (. ? ! 。 ？ ！)
    - Force-cut when accumulated text exceeds _MAX_MERGE_CHARS
    - Merged segment: start = first sub-segment's start, end = last sub-segment's end
    """
    if not segments:
        return []

    merged = []
    buf_texts: list[str] = []
    buf_start: float = segments[0]["start"]
    buf_end: float = segments[0]["end"]
    buf_len = 0

    for seg in segments:
        buf_texts.append(seg["text"])
        buf_end = seg["end"]
        buf_len += len(seg["text"])

        should_cut = _SENTENCE_END.search(seg["text"].rstrip()) or buf_len > _MAX_MERGE_CHARS
        if should_cut:
            merged.append({"text": " ".join(buf_texts).strip(), "start": buf_start, "end": buf_end})
            buf_texts = []
            buf_start = seg["end"]
            buf_len = 0

    # Flush any remaining buffer
    if buf_texts:
        merged.append({"text": " ".join(buf_texts).strip(), "start": buf_start, "end": buf_end})

    return merged


def _postprocess(text: str, lang: str) -> str:
    """
    Remove filler words and clean up extra whitespace.
    """
    if lang.startswith("zh"):
        text = _ZH_FILLERS.sub("", text)
    else:
        text = _EN_FILLERS.sub("", text)
    # Collapse multiple spaces / newlines
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    # Clean up orphaned commas left after filler word removal
    text = re.sub(r",\s*,+", ",", text)       # ", ," → ","
    text = re.sub(r"^\s*[,，]\s*", "", text)   # leading comma → remove
    # Capitalize first letter for English
    if not lang.startswith("zh") and text:
        text = text[0].upper() + text[1:]
    return text.strip()


def _split_audio(wav_path: str) -> list[tuple[str, float]]:
    """
    Split a WAV file into chunks of CHUNK_DURATION_SEC seconds.
    Returns list of (chunk_path, offset_seconds) tuples.
    If the file is small enough, returns the original path with offset 0.
    """
    file_size_mb = os.path.getsize(wav_path) / (1024 * 1024)
    if file_size_mb <= MAX_FILE_SIZE_MB:
        return [(wav_path, 0.0)]

    from services.audio import _ffmpeg_path, get_audio_duration
    ffmpeg = _ffmpeg_path()
    total_duration = get_audio_duration(wav_path)

    tmp_dir = tempfile.mkdtemp(prefix="asr_chunks_")
    chunks = []
    offset = 0.0

    while offset < total_duration:
        chunk_path = os.path.join(tmp_dir, f"chunk_{int(offset)}.wav")
        result = subprocess.run(
            [
                ffmpeg, "-y",
                "-i", wav_path,
                "-ss", str(offset),
                "-t", str(CHUNK_DURATION_SEC),
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                chunk_path,
            ],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg chunk split failed:\n{result.stderr}")
        chunks.append((chunk_path, offset))
        offset += CHUNK_DURATION_SEC

    return chunks


def transcribe_openai(
    wav_path: str,
    language: str = "en",
    prompt: Optional[str] = None,
) -> list[dict]:
    """
    Transcribe a WAV file using OpenAI Whisper API with word-level timestamps.
    Auto-splits files exceeding 25 MB into 10-minute chunks.

    Returns a list of segments:
      [{"text": str, "start": float, "end": float}, ...]
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError(
            "OPENAI_API_KEY not set or is placeholder. "
            "Add a real key to backend/.env"
        )
    base_url = os.environ.get("OPENAI_BASE_URL", "").strip() or None
    client = OpenAI(
        api_key=api_key,
        **({"base_url": base_url} if base_url else {}),
    )

    chunks = _split_audio(wav_path)
    all_segments = []

    for chunk_path, time_offset in chunks:
        with open(chunk_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=_settings.ASR_WHISPER_MODEL,
                file=audio_file,
                language=language,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
                prompt=prompt,
            )

        for seg in response.segments or []:
            cleaned = _postprocess(seg.text, language)
            if cleaned:
                all_segments.append(
                    {
                        "text": cleaned,
                        "start": seg.start + time_offset,
                        "end": seg.end + time_offset,
                    }
                )

    # Clean up temp chunk files
    if len(chunks) > 1:
        chunk_dir = os.path.dirname(chunks[0][0])
        shutil.rmtree(chunk_dir, ignore_errors=True)

    sentences = _merge_into_sentences(all_segments)
    return sentences, all_segments


def transcribe_aliyun(
    wav_path: str,
    language: str = "zh",
) -> tuple[list[dict], list[dict]]:
    """
    Transcribe using Alibaba Cloud RESTful ASR (录音文件识别).
    Supports Chinese (zh) and English (en).
    Requires ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_ASR_APP_KEY.

    Flow:
      1. Upload audio to a publicly accessible URL via Alibaba Cloud OSS (or temp upload)
      2. POST to CreateTask → get TaskId
      3. Poll GetTaskResult until SUCCESS
      4. Parse sentences into [{text, start, end}]
    """
    import hashlib
    import hmac
    import base64
    import json
    import uuid
    from datetime import datetime, timezone
    try:
        import httpx
    except ImportError:
        import urllib.request as _urllib_req
        httpx = None

    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    access_key_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "")
    app_key = os.environ.get("ALIYUN_ASR_APP_KEY", "")

    if not access_key_id or not access_key_secret or not app_key:
        raise RuntimeError(
            "Alibaba Cloud ASR keys not configured. "
            "Set ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, "
            "ALIYUN_ASR_APP_KEY in backend/.env"
        )

    # ── Step A: upload audio file to Aliyun OSS via STS or direct URL ─────────
    # Since we need a public URL, we use Aliyun OSS PutObject with the credentials.
    # The OSS bucket must be configured for public read or we use a signed URL.
    oss_bucket = os.environ.get("ALIYUN_OSS_BUCKET", "")
    oss_endpoint = os.environ.get("ALIYUN_OSS_ENDPOINT", "")

    if not oss_bucket or not oss_endpoint:
        raise RuntimeError(
            "ALIYUN_OSS_BUCKET and ALIYUN_OSS_ENDPOINT must be set to use Aliyun ASR. "
            "The ASR API requires a public URL for the audio file."
        )

    # Upload WAV to OSS
    object_key = f"liberstudy-asr/{uuid.uuid4()}.wav"
    file_url = _oss_put_object(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        bucket=oss_bucket,
        endpoint=oss_endpoint,
        object_key=object_key,
        file_path=wav_path,
    )

    try:
        # ── Step B: map language code ──────────────────────────────────────────
        # Aliyun uses: zh-cn (Chinese), en-us (English)
        lang_map = {"zh": "zh-cn", "en": "en-us"}
        aliyun_lang = lang_map.get(language[:2].lower(), "zh-cn")

        # ── Step C: submit transcription task ─────────────────────────────────
        task_id = _aliyun_create_task(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            app_key=app_key,
            file_url=file_url,
            language=aliyun_lang,
        )

        # ── Step D: poll for result ────────────────────────────────────────────
        result = _aliyun_wait_for_result(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            task_id=task_id,
        )

        # ── Step E: parse sentences into segments ──────────────────────────────
        raw_segments = []
        sentences = result.get("Sentences", []) if result else []
        for s in sentences:
            text = s.get("Text", "").strip()
            if not text:
                continue
            start_ms = s.get("BeginTime", 0)
            end_ms = s.get("EndTime", 0)
            raw_segments.append({
                "text": _postprocess(text, language),
                "start": start_ms / 1000.0,
                "end": end_ms / 1000.0,
            })

        merged = _merge_into_sentences(raw_segments)
        return merged, raw_segments

    finally:
        # Clean up OSS object
        _oss_delete_object(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            bucket=oss_bucket,
            endpoint=oss_endpoint,
            object_key=object_key,
        )


def _oss_put_object(
    access_key_id: str,
    access_key_secret: str,
    bucket: str,
    endpoint: str,
    object_key: str,
    file_path: str,
) -> str:
    """Upload a file to Alibaba Cloud OSS and return its public URL."""
    import hashlib
    import hmac
    import base64
    from datetime import datetime, timezone
    import urllib.request

    with open(file_path, "rb") as f:
        content = f.read()

    content_type = "audio/wav"
    date_str = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    content_md5 = ""
    string_to_sign = f"PUT\n{content_md5}\n{content_type}\n{date_str}\n/{bucket}/{object_key}"
    signature = base64.b64encode(
        hmac.new(access_key_secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()

    # endpoint format: oss-cn-hangzhou.aliyuncs.com
    host = f"https://{bucket}.{endpoint}"
    url = f"{host}/{object_key}"

    req = urllib.request.Request(
        url,
        data=content,
        method="PUT",
        headers={
            "Content-Type": content_type,
            "Date": date_str,
            "Authorization": f"OSS {access_key_id}:{signature}",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError(f"OSS PUT failed: HTTP {resp.status}")

    return url


def _oss_delete_object(
    access_key_id: str,
    access_key_secret: str,
    bucket: str,
    endpoint: str,
    object_key: str,
) -> None:
    """Delete an object from OSS (best-effort, ignores errors)."""
    import hashlib
    import hmac
    import base64
    from datetime import datetime, timezone
    import urllib.request

    try:
        date_str = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        string_to_sign = f"DELETE\n\n\n{date_str}\n/{bucket}/{object_key}"
        signature = base64.b64encode(
            hmac.new(access_key_secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
        ).decode()

        host = f"https://{bucket}.{endpoint}"
        url = f"{host}/{object_key}"
        req = urllib.request.Request(
            url,
            method="DELETE",
            headers={
                "Date": date_str,
                "Authorization": f"OSS {access_key_id}:{signature}",
            },
        )
        with urllib.request.urlopen(req, timeout=30):
            pass
    except Exception:
        pass


def _aliyun_create_task(
    access_key_id: str,
    access_key_secret: str,
    app_key: str,
    file_url: str,
    language: str,
) -> str:
    """Submit a transcription task via aliyunsdkcore and return TaskId."""
    import json
    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.request import CommonRequest

    client = AcsClient(access_key_id, access_key_secret, "cn-shanghai")
    req = CommonRequest()
    req.set_domain("filetrans.cn-shanghai.aliyuncs.com")
    req.set_version("2018-08-17")
    req.set_action_name("SubmitTask")
    req.set_method("POST")
    task_body = {
        "appkey": app_key,
        "file_link": file_url,
        "version": "4.0",
        "enable_words": False,
        "enable_sentence_detection": True,
        "language_id": language,
    }
    req.add_body_params("Task", json.dumps(task_body))
    result = json.loads(client.do_action_with_exception(req))

    if result.get("StatusText") != "SUCCESS":
        raise RuntimeError(f"Aliyun SubmitTask failed: {result}")

    task_id = result.get("TaskId")
    if not task_id:
        raise RuntimeError(f"No TaskId in Aliyun response: {result}")
    return task_id


def _aliyun_wait_for_result(
    access_key_id: str,
    access_key_secret: str,
    task_id: str,
    timeout_seconds: int = 7200,
    poll_interval: int = 10,
) -> dict:
    """Poll GetTaskResult until task succeeds. Returns the BizResult dict."""
    import json
    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.request import CommonRequest

    client = AcsClient(access_key_id, access_key_secret, "cn-shanghai")
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        req = CommonRequest()
        req.set_domain("filetrans.cn-shanghai.aliyuncs.com")
        req.set_version("2018-08-17")
        req.set_action_name("GetTaskResult")
        req.set_method("GET")
        req.add_query_param("TaskId", task_id)
        data = json.loads(client.do_action_with_exception(req))

        status = data.get("StatusText", "")
        if status == "SUCCESS":
            # Result is in data["Result"], not data["BizResult"]
            result = data.get("Result") or data.get("BizResult", {})
            if isinstance(result, str):
                return json.loads(result)
            return result

        if status in ("FAILED", "ERROR"):
            raise RuntimeError(f"Aliyun ASR task failed: {data}")

        time.sleep(poll_interval)

    raise RuntimeError(f"Aliyun ASR task timed out after {timeout_seconds}s (TaskId={task_id})")


def transcribe(
    wav_path: str,
    language: str = "en",
    prompt: Optional[str] = None,
) -> tuple[list[dict], list[dict]]:
    """
    Unified transcription entry point.
    Routes based on settings.ASR_ENGINE:
      - "aliyun": Alibaba Cloud RESTful ASR (supports zh + en)
      - "whisper": OpenAI Whisper API

    Returns:
        (sentences, raw_segments)

    Args:
        prompt: Domain vocabulary hint for Whisper. Ignored by Aliyun ASR.
    """
    if _settings.ASR_ENGINE == "aliyun":
        return transcribe_aliyun(wav_path, language)
    return transcribe_openai(wav_path, language, prompt=prompt)

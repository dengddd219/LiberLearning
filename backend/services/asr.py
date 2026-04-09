"""
ASR transcription service.
Primary: OpenAI Whisper API (English + Chinese fallback)
Secondary: Alibaba Cloud ASR (Chinese, optional – requires keys in .env)

Output format (list of segments):
  [{"text": str, "start": float, "end": float}, ...]
"""

import os
import re
from typing import Optional

from openai import OpenAI

# ── Filler words to strip (English + Chinese) ─────────────────────────────────
_EN_FILLERS = re.compile(
    r"\b(um+|uh+|er+|ah+|like|you know|i mean|sort of|kind of|basically|literally|right\?|okay so|so yeah)\b",
    re.IGNORECASE,
)
_ZH_FILLERS = re.compile(r"[嗯呃啊哦额那个就是其实吧呢]")


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
    return text.strip()


def transcribe_openai(
    wav_path: str,
    language: str = "en",
    prompt: Optional[str] = None,
) -> list[dict]:
    """
    Transcribe a WAV file using OpenAI Whisper API with word-level timestamps.

    Returns a list of segments:
      [{"text": str, "start": float, "end": float}, ...]
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("sk-xxx"):
        raise RuntimeError(
            "OPENAI_API_KEY not set or is placeholder. "
            "Add a real key to backend/.env"
        )

    client = OpenAI(api_key=api_key)

    with open(wav_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=language,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            prompt=prompt,
        )

    segments = []
    for seg in response.segments or []:
        cleaned = _postprocess(seg.text, language)
        if cleaned:
            segments.append(
                {
                    "text": cleaned,
                    "start": seg.start,
                    "end": seg.end,
                }
            )
    return segments


def transcribe_aliyun(
    wav_path: str,
    language: str = "zh",
) -> list[dict]:
    """
    Transcribe using Alibaba Cloud ASR (Chinese).
    Requires ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_ASR_APP_KEY.

    NOTE: This is a stub — the Alibaba Cloud SDK (`alibabacloud-nls`) is not
    yet installed. Implement when Chinese ASR becomes the primary use case.
    """
    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    if not access_key_id:
        raise RuntimeError(
            "Alibaba Cloud ASR keys not configured. "
            "Set ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, "
            "ALIYUN_ASR_APP_KEY in backend/.env"
        )
    raise NotImplementedError(
        "Alibaba Cloud ASR integration is pending. "
        "Use transcribe_openai() with language='zh' as a fallback."
    )


def transcribe(
    wav_path: str,
    language: str = "en",
) -> list[dict]:
    """
    Unified transcription entry point.
    Routes to Alibaba Cloud for Chinese if keys are available,
    otherwise falls back to OpenAI Whisper.
    """
    aliyun_key = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    if language.startswith("zh") and aliyun_key:
        return transcribe_aliyun(wav_path, language)
    return transcribe_openai(wav_path, language)

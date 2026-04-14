"""
ASR transcription service.
Primary: OpenAI Whisper API (English + Chinese fallback)
Secondary: Alibaba Cloud ASR (Chinese, optional – requires keys in .env)

Output format (list of segments):
  [{"text": str, "start": float, "end": float}, ...]
"""

import os
import re
import shutil
import subprocess
import tempfile
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
    prompt: Optional[str] = None,
) -> tuple[list[dict], list[dict]]:
    """
    Unified transcription entry point.
    Routes to Alibaba Cloud for Chinese if keys are available,
    otherwise falls back to OpenAI Whisper.

    Returns:
        (sentences, raw_segments) — sentences are Whisper segments merged into
        complete sentences; raw_segments are the unmerged Whisper output.

    Args:
        prompt: Domain vocabulary hint for Whisper (e.g. "CNN, LSTM, backpropagation").
                Improves recognition of technical terms. Ignored by Aliyun ASR.
    """
    aliyun_key = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    if language.startswith("zh") and aliyun_key:
        return transcribe_aliyun(wav_path, language)
    return transcribe_openai(wav_path, language, prompt=prompt)

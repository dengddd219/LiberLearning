"""
Audio processing service.
Converts WebM/Opus/M4A/MP3 to WAV using FFmpeg subprocess.
Also handles merging multiple audio Blob chunks into a single file.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def _ffmpeg_path() -> str:
    """Find FFmpeg executable."""
    candidates = [
        "ffmpeg",
        r"C:\Users\19841\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe",
        r"C:\Users\19841\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe",
    ]
    for c in candidates:
        if shutil.which(c) or Path(c).exists():
            return c
    raise RuntimeError(
        "FFmpeg not found. Run install_deps.bat and restart your terminal."
    )


def convert_to_wav(input_path: str, output_path: str) -> str:
    """
    Convert any audio file to 16kHz mono WAV (optimal for ASR APIs).
    Returns output_path on success.
    """
    ffmpeg = _ffmpeg_path()
    result = subprocess.run(
        [
            ffmpeg,
            "-y",                   # overwrite output if exists
            "-i", input_path,
            "-ar", "16000",         # 16 kHz sample rate
            "-ac", "1",             # mono
            "-c:a", "pcm_s16le",    # 16-bit PCM
            output_path,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg conversion failed:\n{result.stderr}"
        )
    return output_path


def merge_chunks(chunk_paths: list[str], output_path: str) -> str:
    """
    Concatenate multiple audio chunk files (e.g. from 10-min IndexedDB slices)
    into a single file, then convert to WAV.
    """
    if not chunk_paths:
        raise ValueError("No audio chunks provided")

    ffmpeg = _ffmpeg_path()

    with tempfile.TemporaryDirectory() as tmp_dir:
        # Write a concat list file for FFmpeg
        list_file = Path(tmp_dir) / "chunks.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for path in chunk_paths:
                # FFmpeg concat list requires absolute paths with forward slashes
                abs_path = str(Path(path).resolve()).replace("\\", "/")
                f.write(f"file '{abs_path}'\n")

        merged_raw = str(Path(tmp_dir) / "merged_raw")
        # Detect extension from first chunk
        ext = Path(chunk_paths[0]).suffix or ".webm"
        merged_raw += ext

        result = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(list_file),
                "-c", "copy",
                merged_raw,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"FFmpeg concat failed:\n{result.stderr}"
            )

        # Convert merged file to WAV
        return convert_to_wav(merged_raw, output_path)


def get_audio_duration(wav_path: str) -> float:
    """
    Return audio duration in seconds using ffprobe.
    """
    ffprobe_candidates = [
        "ffprobe",
        r"C:\Users\19841\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe",
        r"C:\Users\19841\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffprobe.exe",
    ]
    ffprobe = next(
        (c for c in ffprobe_candidates if shutil.which(c) or Path(c).exists()),
        None,
    )
    if not ffprobe:
        # fallback: derive from ffmpeg path
        ffprobe = str(Path(_ffmpeg_path()).parent / "ffprobe.exe")

    result = subprocess.run(
        [
            ffprobe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            wav_path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed:\n{result.stderr}")
    return float(result.stdout.strip())

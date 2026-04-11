"""Step 0 — Audio upload & conversion."""
import os
import tempfile
import time
from pathlib import Path

import streamlit as st

from test_ui.helpers import (
    _badge, _run_sync, _log_run,
    _get_run_dir,
    _wav_path,
)


def render_step0(audio_file):
    with st.expander("Step 0 — Audio upload & conversion", expanded=True):
        wav = _wav_path()
        if wav.exists():
            from services.audio import get_audio_duration
            dur = get_audio_duration(str(wav))
            st.success(f"✅ Cached WAV — {dur:.1f}s ({wav.stat().st_size/1e6:.1f} MB)")
        elif audio_file is not None:
            if st.button("▶ Convert to WAV", key="btn_step0"):
                t0 = time.time()
                prog = st.progress(0, text="Saving uploaded file…")
                suffix = Path(audio_file.name).suffix
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(audio_file.read())
                    tmp_path = tmp.name
                prog.progress(30, text="Converting to WAV…")
                from services.audio import convert_to_wav, get_audio_duration, _ffmpeg_path
                import subprocess
                full_wav = _get_run_dir() / "test_audio_full.wav"
                convert_to_wav(tmp_path, str(full_wav))
                os.unlink(tmp_path)
                prog.progress(70, text="Trimming to 10 minutes…")
                ffmpeg = _ffmpeg_path()
                subprocess.run([
                    ffmpeg, "-y", "-i", str(full_wav),
                    "-t", "600", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                    str(wav)
                ], capture_output=True, check=True)
                full_wav.unlink(missing_ok=True)
                prog.progress(100, text="Done")
                elapsed = time.time() - t0
                dur = get_audio_duration(str(wav))
                _log_run("audio", elapsed, extra={"duration_s": dur})
                st.success(f"✅ {_badge(elapsed)} — {dur:.1f}s (trimmed to 10 min)")
        else:
            st.info("Upload an audio file above to begin.")

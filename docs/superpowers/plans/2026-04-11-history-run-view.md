# History Run View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the test platform to display cached pipeline results when switching to a historical run without re-uploading files.

**Architecture:** Modify `pipeline.py` so each Step uses a three-state guard: (1) cache exists → render result; (2) cache missing + file uploaded → show action button; (3) cache missing + file not uploaded → show "Complete step N first". The `has_ppt` flag is inferred from the cache file's existence in addition to the uploader.

**Tech Stack:** Streamlit, Python, existing `test_ui/helpers.py` path helpers

---

## File Map

| File | Action | What changes |
|---|---|---|
| `backend/test_ui/pipeline.py` | Modify | Three-state guards for Steps 0–6, `has_ppt` inference |

No other files change.

---

### Task 1: Infer `has_ppt` from cache

**Files:**
- Modify: `backend/test_ui/pipeline.py:34`

- [ ] **Step 1: Change `has_ppt` to also check for cached `ppt_pages.json`**

Replace line 34:
```python
has_ppt = ppt_file is not None
```
with:
```python
has_ppt = ppt_file is not None or _ppt_path().exists()
```

- [ ] **Step 2: Verify Streamlit still starts**

```bash
cd "c:/Users/19841/Desktop/github/LiberLearning/LiberLearning" && .venv/Scripts/streamlit run backend/test_app.py --server.headless true &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8501
```
Expected: `200`

Kill the server after checking (`kill %1` or close the terminal).

- [ ] **Step 3: Commit**

```bash
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): infer has_ppt from cached ppt_pages.json"
```

---

### Task 2: Three-state guard for Step 0 (Audio conversion)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — the `Step 0` expander block (lines ~37–71)

Currently the block opens with:
```python
if audio_file is None:
    st.info("Upload an audio file above to begin.")
elif wav.exists():
    ...render cached...
else:
    if st.button(...):
        ...convert...
```

- [ ] **Step 1: Rewrite Step 0 guard to three-state**

Replace the entire content of the Step 0 expander with:
```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): step 0 renders cached WAV without file upload"
```

---

### Task 3: Three-state guard for Step 1 (PPT parsing)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — the `Step 1` expander block (lines ~74–115)

Currently:
```python
if not has_ppt:
    st.info("No PPT uploaded — no-PPT mode. Step 1 skipped.")
elif ppt_cache.exists():
    ...render...
else:
    if st.button(...): ...parse...
```

- [ ] **Step 1: Rewrite Step 1 guard to three-state**

Replace the entire content of the Step 1 expander with:
```python
ppt_cache  = _ppt_path()
slides_dir = _slides_dir()
if ppt_cache.exists():
    pages_meta = _load_json(ppt_cache)
    st.success(f"✅ Cached — {len(pages_meta)} slides")
    cols = st.columns(min(len(pages_meta), 5))
    import fitz
    pdf_path = slides_dir / "slides.pdf"
    if pdf_path.exists():
        doc = fitz.open(str(pdf_path))
        mat = fitz.Matrix(1.5, 1.5)
        for i, pg in enumerate(pages_meta[:5]):
            page_idx = pg["pdf_page_num"] - 1
            if page_idx < len(doc):
                pix = doc[page_idx].get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                with cols[i % 5]:
                    st.image(img_bytes, caption=f"Slide {pg['page_num']}",
                             use_container_width=True)
        doc.close()
elif ppt_file is not None:
    if st.button("▶ Parse PPT", key="btn_step1"):
        t0 = time.time()
        prog = st.progress(0, text="Saving PPT file…")
        suffix = Path(ppt_file.name).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(ppt_file.read())
            tmp_path = tmp.name
        prog.progress(30, text="Converting PPT → PDF → PNG…")
        from services.ppt_parser import parse_ppt
        pages_meta = parse_ppt(tmp_path, str(slides_dir))
        os.unlink(tmp_path)
        _save_json(ppt_cache, pages_meta)
        prog.progress(100, text="Done")
        elapsed = time.time() - t0
        _log_run("ppt_parse", elapsed, extra={"n_pages": len(pages_meta)})
        st.success(f"✅ {_badge(elapsed)} — {len(pages_meta)} slides")
        st.rerun()
else:
    st.info("No PPT uploaded — no-PPT mode. Step 1 skipped.")
```

- [ ] **Step 2: Commit**

```bash
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): step 1 renders cached PPT without file upload"
```

---

### Task 4: Three-state guard for Step 2 (ASR)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — the `Step 2` expander block (lines ~118–147)

Currently:
```python
wav = _wav_path()
asr = _asr_path()
if not wav.exists():
    st.info("Complete Step 0 first.")
elif asr.exists():
    ...render...
else:
    if st.button(...): ...transcribe...
```

The outer guard `if not wav.exists()` correctly covers the "no audio yet" case, so only a small change is needed: when `wav` doesn't exist AND `asr` already exists (edge case: user deleted wav but kept asr), we should still render. Simplest fix: check `asr.exists()` first.

- [ ] **Step 1: Rewrite Step 2 guard to cache-first**

Replace the entire content of the Step 2 expander with:
```python
wav = _wav_path()
asr = _asr_path()
if asr.exists():
    segments = _load_json(asr)
    total_chars = sum(len(s["text"]) for s in segments)
    st.success(f"✅ Cached — {len(segments)} segments, {total_chars:,} chars")
    for seg in segments[:10]:
        ms, me = int(seg["start"]), int(seg["end"])
        st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
    if len(segments) > 10:
        st.caption(f"… and {len(segments)-10} more")
elif wav.exists():
    if st.button("▶ Run ASR", key="btn_step2"):
        t0 = time.time()
        from services.audio import get_audio_duration
        dur = get_audio_duration(str(wav))
        prog = st.progress(0, text="Sending to Whisper API…")
        from services.asr import transcribe_openai
        segments = transcribe_openai(str(wav), language=language)
        _save_json(asr, segments)
        prog.progress(100, text="Done")
        elapsed = time.time() - t0
        cost = (dur / 60) * WHISPER_COST_PER_MIN
        _log_run("asr", elapsed, cost=cost,
                 extra={"n_segments": len(segments), "duration_s": dur})
        st.success(f"✅ {_badge(elapsed, cost=cost)} — {len(segments)} segments")
        st.rerun()
else:
    st.info("Complete Step 0 first.")
```

- [ ] **Step 2: Commit**

```bash
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): step 2 renders cached ASR without WAV present"
```

---

### Task 5: Three-state guard for Step 3 (Semantic alignment)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — the `Step 3` expander block (lines ~150–292)

The outer structure is:
```python
if not has_ppt:
    st.info("No PPT — alignment skipped.")
else:
    aligned_path = _aligned_path()
    ...
    if not asr.exists() or not ppt_cache.exists():
        st.info("Complete Steps 1 & 2 first.")
    else:
        ...alignment logic + display...
```

With `has_ppt` now inferred from cache (Task 1), the `if not has_ppt` guard already works correctly for history view. The inner guard `if not asr.exists() or not ppt_cache.exists()` also works as-is (both files exist in a completed run). **No changes needed to Step 3.**

- [ ] **Step 1: Verify Step 3 renders correctly for history run by reading current code**

Re-read lines 150–292 of `backend/test_ui/pipeline.py` and confirm neither guard requires `ppt_file` or `audio_file` variables directly (they don't — they only check file existence on disk).

```bash
grep -n "ppt_file\|audio_file" "c:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/test_ui/pipeline.py"
```

Expected: occurrences only in lines 30–33 (uploaders) and Step 0/Step 1 (already fixed by Tasks 2–3). If any occur inside Step 3 block (lines ~150–292), fix them using the same three-state pattern.

- [ ] **Step 2: Commit if any fixes were needed, otherwise no commit**

```bash
# Only if changes were made:
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): step 3 uses only disk-file guards"
```

---

### Task 6: Three-state guard for Step 4 (Note generation)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — the `Step 4` expander block (lines ~295–326)

Current guard:
```python
ready = (has_ppt and aligned.exists()) or (not has_ppt and asr.exists())
if not ready:
    st.info("Complete Step 3 (or Step 2 for no-PPT mode) first.")
elif note_cache.exists():
    ...render...
else:
    if st.button(...): ...generate...
```

With `has_ppt` inferred from cache, `ready` will be `True` for a completed history run. **No structural change needed** — verify and commit a no-op if clean.

- [ ] **Step 1: Verify `ready` evaluates correctly for history run**

```bash
grep -n "has_ppt\|ready\|note_cache\|audio_file\|ppt_file" "c:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/test_ui/pipeline.py" | grep -A2 -B2 "Step 4\|step4\|btn_step4"
```

Confirm `ready` only uses `has_ppt`, `aligned.exists()`, and `asr.exists()` — no direct reference to upload variables. If any direct upload variable references exist inside the Step 4 block, apply three-state pattern.

- [ ] **Step 2: Commit if any fixes were needed**

```bash
# Only if changes were made:
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): step 4 ready check works for history runs"
```

---

### Task 7: Verify Steps 5 and 6 (Active learning + Export)

**Files:**
- Modify: `backend/test_ui/pipeline.py` — Step 5 (lines ~329–383) and Step 6 (lines ~386–405)

Step 5 guard: `if not asr.exists(): st.info(...)` — disk-file check, works for history.  
Step 6 guard: `if not note_cache.exists(): st.info(...)` — disk-file check, works for history.

- [ ] **Step 1: Confirm no upload-variable references in Steps 5 and 6**

```bash
grep -n "audio_file\|ppt_file" "c:/Users/19841/Desktop/github/LiberLearning/LiberLearning/backend/test_ui/pipeline.py"
```

Expected: zero hits inside lines 329–405. If any exist, apply three-state fix.

- [ ] **Step 2: Commit if any fixes were needed**

```bash
# Only if changes were made:
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): steps 5-6 use disk-only guards"
```

---

### Task 8: End-to-end manual smoke test

- [ ] **Step 1: Start the Streamlit app**

```bash
cd "c:/Users/19841/Desktop/github/LiberLearning/LiberLearning" && .venv/Scripts/streamlit run backend/test_app.py
```

- [ ] **Step 2: Run through each history-view scenario**

With at least one existing run that has cached files (`asr_segments.json`, `aligned_pages.json`, `notes_*.json`):

1. Open the app. Select the historical run from the sidebar dropdown — **do NOT upload any files**.
2. Verify **Step 0** shows "✅ Cached WAV" (if `test_audio_10min.wav` exists).
3. Verify **Step 1** shows "✅ Cached — N slides" with thumbnails (if `ppt_pages.json` exists).
4. Verify **Step 2** shows cached ASR segments.
5. Verify **Step 3** shows alignment confidence metrics and per-slide breakdown.
6. Verify **Step 4** shows cached notes rendered with `_render_notes`.
7. Switch to a **new run** (select "+ New run"). Verify Step 0 shows "Upload an audio file above to begin." — new run behavior unchanged.

- [ ] **Step 3: Final commit if any cleanup**

```bash
git add backend/test_ui/pipeline.py
git commit -m "fix(test-ui): pipeline renders history runs without file re-upload"
```

---

## Self-Review

**Spec coverage:**
- ✅ `has_ppt` inference from `_ppt_path().exists()` — Task 1
- ✅ Three-state guard for Step 0 — Task 2
- ✅ Three-state guard for Step 1 — Task 3
- ✅ Three-state guard for Step 2 — Task 4
- ✅ Steps 3–6 verified / fixed — Tasks 5–7
- ✅ New run behavior unchanged — Task 8 smoke test
- ✅ Only `pipeline.py` modified — file map correct

**Placeholder scan:** No TBD/TODO. All code blocks are complete.

**Type consistency:** All helpers (`_wav_path`, `_asr_path`, `_aligned_path`, `_ppt_path`, `_notes_cache`, `_load_json`, `_save_json`, `_log_run`, `_badge`, `_render_notes`) match their existing signatures in `helpers.py`.

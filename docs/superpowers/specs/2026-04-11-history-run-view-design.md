# Design: History Run View for Test Platform

**Date:** 2026-04-11  
**Scope:** `backend/test_ui/pipeline.py` — minimal change to render cached results without requiring file re-upload

## Problem

When the user switches to a historical run via the sidebar selectbox, all pipeline steps show "Upload first" even though the cached JSON files (`asr_segments.json`, `aligned_pages.json`, `notes_*.json`, etc.) already exist in the run directory. This happens because each step guards rendering behind `audio_file is not None` or `ppt_file is not None` — but on a history view no file is uploaded.

## Goal

Switch to a historical run → all steps whose cache files exist render their results automatically, identical to what was shown when the run originally executed. No new UI, no new storage, no new tab.

## Design

### 1. `has_ppt` inference

```python
# Old
has_ppt = ppt_file is not None

# New
has_ppt = ppt_file is not None or _ppt_path().exists()
```

`_ppt_path()` checks the current run's `ppt_pages.json`. If it exists, we know this run had a PPT.

### 2. Three-state logic per step

Each step moves from two states (cached / not-cached+file) to three:

| State | Condition | Behavior |
|---|---|---|
| **Cached** | cache file exists | render result (read-only, no action button) |
| **Ready to run** | cache missing + required file uploaded | show action button |
| **Blocked** | cache missing + file not uploaded | show "Upload first" info |

The cached state is identical to the "already ran" branch that already exists — it's just that the check `if wav.exists()` or `if asr.exists()` currently sits inside a guard that bails early when `audio_file is None`. Removing that early bail-out is the core change.

### 3. Step-by-step changes in `pipeline.py`

**Step 0 — Audio conversion**  
- Remove `if audio_file is None: st.info(...)` guard.  
- Check `_wav_path().exists()` first → render cached; else check `audio_file is not None` → show button; else → show info.

**Step 1 — PPT parsing**  
- Same pattern. `if not has_ppt` guard becomes: if `not has_ppt and not _ppt_path().exists()` → show "No PPT" info.

**Step 2 — ASR**  
- Guard `if not wav.exists()` already exists, but is only reached if audio_file was non-None. Flatten: check `_wav_path().exists()` first, render cached; no wav and no upload → info.

**Steps 3, 4, 5, 6** — same pattern, already structured around cache-file existence checks. The only change is removing the outer file-upload guards that prevent reaching the cache check.

### 4. No changes to helpers, dashboard, ground truth, or batch tabs

All path helpers already use `_get_run_dir()` which reads from `st.session_state["run_id"]`. Switching run_id in the sidebar already routes all path helpers to the correct directory — the only issue is the upload guards in pipeline.py.

## What does NOT change

- Creating new runs: behavior identical (no cache → file required → button appears)
- "Clear cache" button: still clears only the current run's files
- Run log / dashboard: unaffected
- No new files created

## Files to modify

- `backend/test_ui/pipeline.py` — the only file changed

## Success criteria

1. Select a historical run from the sidebar dropdown
2. Without uploading any file, all steps whose cache exists show their results
3. Steps whose cache was never generated still show "Complete step N first"
4. Creating a new run and running steps works as before

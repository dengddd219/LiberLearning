# Pipeline Run Log + 前端流水线修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让前端流水线 `_run_pipeline()` 的每一步中间结果落盘到一个 JSON 文件，对齐版本切换为 v5，ASR raw segments 保存，使前端和 test 平台产出一致可追溯的结果。

**Architecture:** 在 `_run_pipeline()` 每一步完成后，把该步结果追加写入 `backend/static/runs/{session_id}/run_data.json`。这个文件是单个 JSON 对象，包含所有步骤的输入输出、耗时、配置。不改动现有 DB 写入逻辑，run_data.json 是额外的诊断产物。

**Tech Stack:** Python (FastAPI backend), JSON file I/O, 现有 services 模块

---

## 当前问题诊断（写计划时已确认）

1. **ASR 幻觉**：session `c8c12175` 前 602 秒 Whisper 输出 "the the the..."，这是 Whisper 在低质量音频段的已知 hallucination 问题
2. **对齐分布畸形**：19 页中 14 页无 segment，P19 独占 99 个 segment — 因为 ASR 前 10 分钟垃圾数据导致对齐失败
3. **笔记质量差**：笔记有生成（`passive_notes.bullets` 存在），但大多数页没有 transcript 输入（aligned_segments 为空），所以 `ai_comment` 全是 null，LLM 只能返回 PPT 原文
4. **`asr_raw` 数据丢失**：`transcribe()` 返回 `(sentences, raw_segments)` 但 `_run_pipeline()` 用 `_raw` 接收后丢弃
5. **对齐版本**：当前 settings.py 用 v5_1，用户要求切换为 v5

---

### Task 1: settings.py 对齐版本切换为 v5

**Files:**
- Modify: `backend/settings.py:26`

- [ ] **Step 1: 修改 ALIGNMENT_VERSION**

```python
# 第 26 行，将：
ALIGNMENT_VERSION: str = "v5_1"
# 改为：
ALIGNMENT_VERSION: str = "v5"
```

- [ ] **Step 2: 验证 v5 模块存在**

Run: `python -c "import importlib; m = importlib.import_module('services.step3_alignment_test.alignment_v5'); print(hasattr(m, 'build_page_timeline'))"`
Expected: `True`

- [ ] **Step 3: Commit**

```bash
git add backend/settings.py
git commit -m "chore: switch alignment version from v5_1 to v5"
```

---

### Task 2: _run_pipeline 保存 asr_raw + 全流程 run_data.json

**Files:**
- Modify: `backend/routers/process.py:149-248`（`_run_pipeline` 函数）

核心思路：在 `_run_pipeline` 开头创建 `run_data` dict，每步完成后往里追加结果并写盘。一个文件记录全部。

- [ ] **Step 1: 在 _run_pipeline 开头初始化 run_data 和 runs_dir**

在 `_run_pipeline` 函数体最开头（`try:` 之后，Step 1 之前），插入：

```python
import time as _time

runs_dir = Path("static") / "runs" / session_id
runs_dir.mkdir(parents=True, exist_ok=True)
run_data_path = runs_dir / "run_data.json"

run_data: dict = {
    "session_id": session_id,
    "started_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
    "config": {
        "alignment_version": _settings.ALIGNMENT_VERSION,
        "asr_engine": _settings.ASR_ENGINE,
        "note_provider": _settings.NOTE_PROVIDER,
        "note_model": _settings.NOTE_MODEL,
        "note_passive_template": _settings.NOTE_PASSIVE_TEMPLATE,
        "note_granularity": _settings.NOTE_GRANULARITY,
    },
    "steps": {},
}

def _save_run_data():
    """写 run_data 到磁盘。每步完成后调用。"""
    import json as _j
    with open(run_data_path, "w", encoding="utf-8") as f:
        _j.dump(run_data, f, ensure_ascii=False, indent=2, default=str)
```

- [ ] **Step 2: Step 1（音频转 WAV）后落盘**

在 `convert_to_wav` 和 `get_audio_duration` 之后、`db.update_session(session_id, {"total_duration": ...})` 之后，插入：

```python
t1_end = _time.time()
run_data["steps"]["step1_audio"] = {
    "status": "ok",
    "wav_path": wav_path,
    "duration_seconds": duration,
    "elapsed_s": round(t1_end - t1_start, 2),
}
_save_run_data()
```

需要在 Step 1 开始前加 `t1_start = _time.time()`。

- [ ] **Step 3: Step 2（PPT 解析）后落盘**

在 PPT 解析完成后、Step 3 之前，插入：

```python
t2_end = _time.time()
run_data["steps"]["step2_ppt"] = {
    "status": "ok",
    "ppt_path": str(ppt_path) if ppt_path else None,
    "num_pages": len(ppt_pages),
    "pages_summary": [
        {"page_num": p.get("page_num"), "ppt_text_len": len(p.get("ppt_text", ""))}
        for p in ppt_pages
    ],
    "elapsed_s": round(t2_end - t2_start, 2),
}
_save_run_data()
```

需要在 Step 2 开始前加 `t2_start = _time.time()`。

- [ ] **Step 4: Step 3（ASR）保存 raw_segments + 落盘**

当前代码 `segments, _raw = transcribe(wav_path, language=language)` 丢弃了 `_raw`。改为保存：

```python
t3_start = _time.time()
segments, raw_segments = transcribe(wav_path, language=language)
t3_end = _time.time()

run_data["steps"]["step3_asr"] = {
    "status": "ok",
    "engine": _settings.ASR_ENGINE,
    "language": language,
    "num_sentences": len(segments),
    "num_raw_segments": len(raw_segments),
    "sentences": segments,
    "raw_segments": raw_segments,
    "elapsed_s": round(t3_end - t3_start, 2),
}
_save_run_data()
```

- [ ] **Step 5: Step 4（对齐）后落盘**

对齐完成后插入：

```python
t4_end = _time.time()

# 序列化 aligned_pages（可能包含 Pydantic model）
def _serialize(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return obj

run_data["steps"]["step4_alignment"] = {
    "status": "ok",
    "version": _settings.ALIGNMENT_VERSION,
    "num_pages": len(aligned_pages),
    "pages_summary": [
        {
            "page_num": p.get("page_num") if isinstance(p, dict) else getattr(p, "page_num", "?"),
            "num_segments": len(p.get("aligned_segments", []) if isinstance(p, dict) else getattr(p, "aligned_segments", [])),
        }
        for p in aligned_pages
    ],
    "aligned_pages": [_serialize(p) for p in aligned_pages],
    "elapsed_s": round(t4_end - t4_start, 2),
}
_save_run_data()
```

需要在 Step 4 开始前加 `t4_start = _time.time()`。

- [ ] **Step 6: Step 5（笔记生成）后落盘**

笔记生成完成后插入：

```python
t5_end = _time.time()
run_data["steps"]["step5_notes"] = {
    "status": "ok",
    "provider": _settings.NOTE_PROVIDER,
    "model": _settings.NOTE_MODEL,
    "template": _settings.NOTE_PASSIVE_TEMPLATE,
    "granularity": _settings.NOTE_GRANULARITY,
    "num_pages": len(generated_pages),
    "pages_summary": [
        {
            "page_num": p.get("page_num"),
            "status": p.get("status"),
            "num_bullets": len(p.get("passive_notes", {}).get("bullets", [])) if p.get("passive_notes") else 0,
            "cost": p.get("_cost"),
        }
        for p in generated_pages
    ],
    "generated_pages": generated_pages,
    "elapsed_s": round(t5_end - t5_start, 2),
}
_save_run_data()
```

需要在 Step 5 开始前加 `t5_start = _time.time()`。

- [ ] **Step 7: 完成和异常处理时落盘**

在 pipeline 正常结束时（`db.update_session` 之后）加：

```python
run_data["finished_at"] = _time.strftime("%Y-%m-%d %H:%M:%S")
run_data["overall_status"] = overall_status
_save_run_data()
```

在 `except Exception as exc:` 块中加：

```python
run_data["finished_at"] = _time.strftime("%Y-%m-%d %H:%M:%S")
run_data["overall_status"] = "error"
run_data["error"] = str(exc)
_save_run_data()
```

- [ ] **Step 8: 在文件头部添加 time import**

`process.py` 头部已有 `import json as _json`，需要加 `import time as _time`。

- [ ] **Step 9: 验证**

Run: 手动用 curl 或前端上传一个小音频+PPT，检查 `backend/static/runs/{session_id}/run_data.json` 是否生成且包含所有 step。

- [ ] **Step 10: Commit**

```bash
git add backend/routers/process.py
git commit -m "feat: add pipeline run_data.json logging for all steps with intermediate results"
```

---

### Task 3: 确保 static/runs/ 路由可访问

**Files:**
- Check: `backend/main.py` — 确认 static 目录挂载覆盖 `runs/` 子目录

- [ ] **Step 1: 检查 main.py 的 StaticFiles 挂载**

当前 `main.py` 应该已经挂载了 `static` 目录。如果 `app.mount("/", StaticFiles(directory="static"), ...)` 或类似配置已存在，则 `/runs/{session_id}/run_data.json` 自动可访问，无需改动。

如果没有覆盖 runs 子目录，需要加：
```python
app.mount("/runs", StaticFiles(directory="static/runs"), name="runs")
```

- [ ] **Step 2: Commit（如有改动）**

---

## 不做的事

- 不改 test 平台代码
- 不改前端渲染逻辑
- 不加 Active 学习支持（用户明确说还没开始处理）
- 不改 ASR 逻辑本身（hallucination 是 Whisper API 问题，不是代码 bug）

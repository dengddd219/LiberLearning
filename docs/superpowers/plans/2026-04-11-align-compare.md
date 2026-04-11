# Alignment Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Streamlit 测试平台的 Step 3 底部新增 alignment 版本横向对比视图，支持任意两个 run 的 `aligned_pages.json` 对比，差异高亮 + 按需 LLM 分析。

**Architecture:** 新建 `backend/test_ui/align_compare.py`，包含纯函数比较逻辑、规则推断、LLM 分析、Streamlit UI 四个层次；`pipeline.py` 仅在 Step 3 末尾追加两行调用。所有比较以句子 `text` 字段为唯一 key，跨页移动通过全局文本索引检测。

**Tech Stack:** Python 3.11+, Streamlit, `anthropic` SDK（已安装），`os.environ` 读取 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`。

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/test_ui/align_compare.py` | 新建 | 比较逻辑 + 规则推断 + LLM 分析 + UI |
| `backend/test_ui/pipeline.py` | 修改末尾 | 在 Step 3 expander 末尾追加 2 行 |

---

## Task 1: 比较核心逻辑 `compare_aligned_pages`

**Files:**
- Create: `backend/test_ui/align_compare.py`

- [ ] **Step 1: 新建文件，写 `compare_aligned_pages` 的单元测试**

在 `backend/test_ui/align_compare.py` 顶部先写测试用的 fixture 数据和断言（用 `if __name__ == "__main__"` 块，不依赖 pytest，方便直接 `python align_compare.py` 跑）：

```python
"""
Alignment version comparison view for LiberStudy test platform.
"""
from __future__ import annotations
import os
from typing import Any

# ── 测试入口（python align_compare.py 直接运行）─────────────────────────────
if __name__ == "__main__":
    _DATA_A = [
        {
            "page_num": 1, "ppt_text": "Intro", "alignment_confidence": 0.42,
            "aligned_segments": [
                {"text": "Hello world", "start": 10.0, "end": 15.0, "similarity": 0.61},
                {"text": "Second sentence", "start": 16.0, "end": 20.0, "similarity": 0.37},
            ],
            "off_slide_segments": [
                {"text": "Off slide one", "start": 5.0, "end": 9.0, "similarity": 0.21},
            ],
        },
        {
            "page_num": 2, "ppt_text": "Details", "alignment_confidence": 0.55,
            "aligned_segments": [
                {"text": "Moved sentence", "start": 25.0, "end": 30.0, "similarity": 0.50},
            ],
            "off_slide_segments": [],
        },
    ]
    _DATA_B = [
        {
            "page_num": 1, "ppt_text": "Intro", "alignment_confidence": 0.50,
            "aligned_segments": [
                {"text": "Hello world", "start": 10.0, "end": 15.0, "similarity": 0.65},
                {"text": "Moved sentence", "start": 25.0, "end": 30.0, "similarity": 0.52},
            ],
            "off_slide_segments": [
                {"text": "Off slide one", "start": 5.0, "end": 9.0, "similarity": 0.21},
                {"text": "Second sentence", "start": 16.0, "end": 20.0, "similarity": 0.22},
            ],
        },
        {
            "page_num": 2, "ppt_text": "Details", "alignment_confidence": 0.55,
            "aligned_segments": [],
            "off_slide_segments": [],
        },
    ]

    diffs = compare_aligned_pages(_DATA_A, _DATA_B)

    p1 = next(d for d in diffs if d["page_num"] == 1)
    assert p1["has_diff"] is True, "page 1 should have diff"
    assert p1["conf_a"] == 0.42
    assert p1["conf_b"] == 0.50
    # "Moved sentence" moved from page 2 (A) into page 1 (B)
    assert "Moved sentence" in p1["moved_in"], f"moved_in={p1['moved_in']}"
    # "Second sentence" moved out of page 1 (A) — went to off_slide in B
    assert any(d["text"] == "Second sentence" and d["direction"] == "to_off"
               for d in p1["off_slide_changed"]), f"off_slide_changed={p1['off_slide_changed']}"

    p2 = next(d for d in diffs if d["page_num"] == 2)
    assert "Moved sentence" in p2["moved_out"], f"p2 moved_out={p2['moved_out']}"

    print("All assertions passed.")
```

- [ ] **Step 2: 实现 `compare_aligned_pages`**

在同一文件中，在测试块上方写实现：

```python
def compare_aligned_pages(data_a: list[dict], data_b: list[dict]) -> list[dict]:
    """
    Compare two aligned_pages.json datasets.
    Returns list of PageDiff dicts sorted by page_num.
    """
    page_map_a: dict[int, dict] = {p["page_num"]: p for p in data_a}
    page_map_b: dict[int, dict] = {p["page_num"]: p for p in data_b}

    # Global text → page_num indexes (aligned segments only)
    text_to_page_a: dict[str, int] = {}
    for p in data_a:
        for s in p.get("aligned_segments", []):
            text_to_page_a[s["text"]] = p["page_num"]

    text_to_page_b: dict[str, int] = {}
    for p in data_b:
        for s in p.get("aligned_segments", []):
            text_to_page_b[s["text"]] = p["page_num"]

    # Global off_slide text sets
    off_texts_a: set[str] = {
        s["text"] for p in data_a for s in p.get("off_slide_segments", [])
    }
    off_texts_b: set[str] = {
        s["text"] for p in data_b for s in p.get("off_slide_segments", [])
    }

    all_page_nums = sorted(set(page_map_a) | set(page_map_b))
    diffs: list[dict] = []

    for pn in all_page_nums:
        pa = page_map_a.get(pn, {})
        pb = page_map_b.get(pn, {})

        segs_a = pa.get("aligned_segments", [])
        segs_b = pb.get("aligned_segments", [])
        off_a  = pa.get("off_slide_segments", [])
        off_b  = pb.get("off_slide_segments", [])
        conf_a = pa.get("alignment_confidence", 0.0)
        conf_b = pb.get("alignment_confidence", 0.0)

        texts_a = {s["text"] for s in segs_a}
        texts_b = {s["text"] for s in segs_b}

        # moved_in: in B aligned at this page, but NOT in A aligned at this page
        moved_in: list[str] = [
            t for t in texts_b - texts_a
            if text_to_page_a.get(t) != pn  # not just missing — was somewhere else in A
        ]

        # moved_out: in A aligned at this page, but NOT in B aligned at this page
        moved_out: list[str] = [
            t for t in texts_a - texts_b
            if text_to_page_b.get(t) != pn
        ]

        # off_slide_changed: aligned ↔ off_slide transitions
        off_slide_changed: list[dict] = []
        # A aligned → B off_slide
        for t in texts_a:
            if t in off_texts_b and t not in texts_b:
                off_slide_changed.append({"text": t, "direction": "to_off"})
        # A off_slide → B aligned at this page
        for s in off_a:
            if s["text"] in texts_b:
                off_slide_changed.append({"text": s["text"], "direction": "from_off"})

        # sim_changed: same text in both, similarity delta > 0.05
        sim_map_a = {s["text"]: s["similarity"] for s in segs_a}
        sim_map_b = {s["text"]: s["similarity"] for s in segs_b}
        sim_changed = any(
            abs(sim_map_b[t] - sim_map_a[t]) > 0.05
            for t in texts_a & texts_b
        )

        has_diff = (
            abs(conf_b - conf_a) > 0.02
            or bool(moved_in)
            or bool(moved_out)
            or bool(off_slide_changed)
            or sim_changed
        )

        diffs.append({
            "page_num": pn,
            "ppt_text": pa.get("ppt_text", pb.get("ppt_text", "")),
            "has_diff": has_diff,
            "conf_a": conf_a,
            "conf_b": conf_b,
            "segments_a": segs_a,
            "segments_b": segs_b,
            "off_slide_a": off_a,
            "off_slide_b": off_b,
            "moved_in": moved_in,
            "moved_out": moved_out,
            "off_slide_changed": off_slide_changed,
        })

    return diffs
```

- [ ] **Step 3: 运行测试验证通过**

```bash
cd backend
..\.venv\Scripts\python test_ui/align_compare.py
```

期望输出：`All assertions passed.`

- [ ] **Step 4: Commit**

```bash
git add backend/test_ui/align_compare.py
git commit -m "feat: add compare_aligned_pages core logic"
```

---

## Task 2: 规则推断 `analyze_page_diff_rules`

**Files:**
- Modify: `backend/test_ui/align_compare.py`

- [ ] **Step 1: 在测试块中追加规则推断的断言**

在 `if __name__ == "__main__"` 块的断言之后追加：

```python
    # Rules analysis
    rules = analyze_page_diff_rules(p1)
    assert rules["conf_delta"] == round(0.50 - 0.42, 10)
    assert rules["conf_direction"] == "up"
    assert rules["moved_in_count"] == 1
    assert rules["moved_out_count"] == 0
    assert isinstance(rules["summary"], str) and len(rules["summary"]) > 0
    print("Rules assertions passed.")
```

- [ ] **Step 2: 实现 `analyze_page_diff_rules`**

在 `compare_aligned_pages` 函数之后添加：

```python
def analyze_page_diff_rules(page_diff: dict) -> dict:
    """Compute quantitative rule-based analysis for one PageDiff."""
    conf_a = page_diff["conf_a"]
    conf_b = page_diff["conf_b"]
    conf_delta = round(conf_b - conf_a, 6)
    conf_direction = "up" if conf_delta > 0.02 else ("down" if conf_delta < -0.02 else "flat")

    segs_a = page_diff["segments_a"]
    segs_b = page_diff["segments_b"]

    def _mean_sim(segs: list[dict]) -> float:
        if not segs:
            return 0.0
        return round(sum(s["similarity"] for s in segs) / len(segs), 4)

    def _min_sim(segs: list[dict]) -> float:
        if not segs:
            return 0.0
        return round(min(s["similarity"] for s in segs), 4)

    sim_mean_a = _mean_sim(segs_a)
    sim_mean_b = _mean_sim(segs_b)
    sim_min_a  = _min_sim(segs_a)
    sim_min_b  = _min_sim(segs_b)

    moved_in_count        = len(page_diff["moved_in"])
    moved_out_count       = len(page_diff["moved_out"])
    off_slide_changed_count = len(page_diff["off_slide_changed"])

    # Build summary string (Chinese, priority-ordered)
    parts: list[str] = []
    if abs(conf_delta) > 0.05:
        sign = "+" if conf_delta > 0 else ""
        parts.append(f"置信度 {sign}{conf_delta:.2f}（{conf_a:.2f}→{conf_b:.2f}）")
    if moved_in_count > 0:
        parts.append(f"新增 {moved_in_count} 条句子从其他页移入")
    if moved_out_count > 0:
        parts.append(f"移出 {moved_out_count} 条句子到其他页")
    if off_slide_changed_count > 0:
        parts.append(f"{off_slide_changed_count} 条句子 off_slide 判定变化")
    sim_mean_delta = round(sim_mean_b - sim_mean_a, 4)
    if abs(sim_mean_delta) > 0.03:
        sign = "+" if sim_mean_delta > 0 else ""
        parts.append(f"平均 similarity {sign}{sim_mean_delta:.3f}")
    if not parts:
        parts.append("无变化")

    return {
        "conf_delta": conf_delta,
        "conf_direction": conf_direction,
        "seg_count_a": len(segs_a),
        "seg_count_b": len(segs_b),
        "moved_in_count": moved_in_count,
        "moved_out_count": moved_out_count,
        "off_slide_changed_count": off_slide_changed_count,
        "sim_mean_a": sim_mean_a,
        "sim_mean_b": sim_mean_b,
        "sim_min_a": sim_min_a,
        "sim_min_b": sim_min_b,
        "summary": "；".join(parts),
    }
```

- [ ] **Step 3: 运行测试**

```bash
cd backend
..\.venv\Scripts\python test_ui/align_compare.py
```

期望输出：
```
All assertions passed.
Rules assertions passed.
```

- [ ] **Step 4: Commit**

```bash
git add backend/test_ui/align_compare.py
git commit -m "feat: add analyze_page_diff_rules"
```

---

## Task 3: LLM 分析 `analyze_page_diff_llm`

**Files:**
- Modify: `backend/test_ui/align_compare.py`

- [ ] **Step 1: 实现 `analyze_page_diff_llm`**

在 `analyze_page_diff_rules` 之后追加：

```python
def analyze_page_diff_llm(page_diff: dict, run_id_a: str, run_id_b: str) -> str:
    """
    Call Claude API to analyze why alignment changed between two runs.
    Uses ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL from env.
    Returns markdown string.
    """
    import anthropic

    api_key  = os.environ.get("ANTHROPIC_API_KEY", "")
    base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    model    = os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-sonnet-4-6"

    client = anthropic.Anthropic(
        api_key=api_key,
        **( {"base_url": base_url} if base_url else {}),
    )

    rules = analyze_page_diff_rules(page_diff)

    # Build sim_changed_segs list
    sim_map_a = {s["text"]: s["similarity"] for s in page_diff["segments_a"]}
    sim_map_b = {s["text"]: s["similarity"] for s in page_diff["segments_b"]}
    sim_changed_segs = [
        f"「{t}」 {sim_map_a[t]:.3f}→{sim_map_b[t]:.3f}"
        for t in set(sim_map_a) & set(sim_map_b)
        if abs(sim_map_b[t] - sim_map_a[t]) > 0.05
    ]

    prompt = f"""你是一个 AI 对齐质量分析助手。以下是一段讲座录音与 PPT 对齐结果的两个版本的对比数据，请分析变化原因并给出建议。

页面：Slide {page_diff['page_num']}
PPT 文本：{page_diff['ppt_text'][:200]}

【Run A ({run_id_a})】
- 置信度：{page_diff['conf_a']:.3f}
- Aligned 句子数：{rules['seg_count_a']}，平均 similarity：{rules['sim_mean_a']:.3f}
- Off_slide 句子数：{len(page_diff['off_slide_a'])}

【Run B ({run_id_b})】
- 置信度：{page_diff['conf_b']:.3f}
- Aligned 句子数：{rules['seg_count_b']}，平均 similarity：{rules['sim_mean_b']:.3f}
- Off_slide 句子数：{len(page_diff['off_slide_b'])}

【变化详情】
移入句子（B有A无）：{page_diff['moved_in'] or '无'}
移出句子（A有B无）：{page_diff['moved_out'] or '无'}
Off_slide 变化：{page_diff['off_slide_changed'] or '无'}
Similarity 变化显著的句子（>0.05）：{sim_changed_segs or '无'}

请用中文分析：
1. 这些变化的可能原因
2. 变化是否合理（改动方向是否正确）
3. 一句话建议

输出格式：直接输出分析内容，不要加额外标题。"""

    message = client.messages.create(
        model=model,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text
```

- [ ] **Step 2: 手动验证（无自动测试，需要真实 API key）**

这一步只做代码审查确认：
- `api_key`、`base_url`、`model` 读取方式与 `backend/services/note_generator.py:74-87` 完全一致
- prompt 中所有变量均在 `page_diff` 和 `rules` 中有定义，无悬空引用

- [ ] **Step 3: Commit**

```bash
git add backend/test_ui/align_compare.py
git commit -m "feat: add analyze_page_diff_llm with Claude API"
```

---

## Task 4: Streamlit UI `render_align_compare`

**Files:**
- Modify: `backend/test_ui/align_compare.py`（追加 UI 函数）

- [ ] **Step 1: 在文件顶部添加 streamlit import**

在文件最顶部的 `from __future__ import annotations` 下方追加：

```python
import streamlit as st
from test_ui.helpers import _list_runs, _load_json, _get_run_dir
```

- [ ] **Step 2: 实现辅助渲染函数 `_fmt_time` 和 `_render_segment_row`**

在 `analyze_page_diff_llm` 之后追加：

```python
def _fmt_time(sec: float) -> str:
    s = int(sec)
    return f"{s // 60:02d}:{s % 60:02d}"


def _render_segment_row(col_a: Any, col_b: Any, text: str,
                        seg_a: dict | None, seg_b: dict | None,
                        status: str, source_page: int | None = None,
                        dest_page: int | None = None) -> None:
    """
    Render one sentence row into two columns.
    status: unchanged | sim_changed | gone | new | to_off_slide | from_off_slide
    """
    def _seg_label(seg: dict, extra: str = "") -> str:
        ts = _fmt_time(seg["start"])
        te = _fmt_time(seg["end"])
        sim = seg["similarity"]
        return f"[{ts}–{te}] {text[:60]}  sim={sim:.3f}{extra}"

    if status == "unchanged":
        with col_a:
            st.caption(_seg_label(seg_a))
        with col_b:
            st.caption(_seg_label(seg_b))

    elif status == "sim_changed":
        delta = seg_b["similarity"] - seg_a["similarity"]
        sign  = "+" if delta > 0 else ""
        with col_a:
            st.markdown(_seg_label(seg_a))
        with col_b:
            st.markdown(_seg_label(seg_b, extra=f" 🟡({sign}{delta:.3f})"))

    elif status == "gone":
        with col_a:
            st.markdown(_seg_label(seg_a) + " 🔴")
        with col_b:
            dest_str = f" → page {dest_page}" if dest_page else ""
            st.caption(f"──{dest_str}")

    elif status == "new":
        with col_a:
            src_str = f"from page {source_page}" if source_page else "new"
            st.caption(f"── ({src_str})")
        with col_b:
            st.markdown(_seg_label(seg_b) + " 🟢")

    elif status == "to_off_slide":
        with col_a:
            st.markdown(_seg_label(seg_a) + " ⚠️→off")
        with col_b:
            st.caption("── (→ off_slide)")

    elif status == "from_off_slide":
        with col_a:
            st.caption("── (was off_slide)")
        with col_b:
            st.markdown(_seg_label(seg_b) + " ✅←off")
```

- [ ] **Step 3: 实现 `render_align_compare`**

在 `_render_segment_row` 之后追加：

```python
def render_align_compare() -> None:
    """Render the alignment comparison expander inside Step 3."""
    with st.expander("🔀 Alignment 版本对比", expanded=False):
        runs = _list_runs()
        run_ids = [r["run_id"] for r in runs]

        if len(run_ids) < 2:
            st.info("需要至少两个 run 才能对比。")
            return

        col_sel_a, col_sel_b = st.columns(2)
        with col_sel_a:
            run_id_a = st.selectbox("Run A（旧版）", run_ids, index=0,
                                    key="cmp_run_a")
        with col_sel_b:
            run_id_b = st.selectbox("Run B（新版）", run_ids, index=1,
                                    key="cmp_run_b")

        if run_id_a == run_id_b:
            st.warning("请选择不同的 run。")
            return

        path_a = _get_run_dir(run_id_a) / "aligned_pages.json"
        path_b = _get_run_dir(run_id_b) / "aligned_pages.json"

        if not path_a.exists():
            st.error(f"Run A ({run_id_a}) 没有 aligned_pages.json")
            return
        if not path_b.exists():
            st.error(f"Run B ({run_id_b}) 没有 aligned_pages.json")
            return

        data_a = _load_json(path_a)
        data_b = _load_json(path_b)
        page_diffs = compare_aligned_pages(data_a, data_b)

        # Summary metrics
        diff_pages       = sum(1 for d in page_diffs if d["has_diff"])
        total_moved_in   = sum(len(d["moved_in"]) for d in page_diffs)
        total_moved_out  = sum(len(d["moved_out"]) for d in page_diffs)
        total_off_change = sum(len(d["off_slide_changed"]) for d in page_diffs)

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("有变化的页", f"{diff_pages}/{len(page_diffs)}")
        m2.metric("句子移入（跨页）", total_moved_in)
        m3.metric("句子移出（跨页）", total_moved_out)
        m4.metric("off_slide 变化", total_off_change)

        only_diff = st.checkbox("只显示有变化的页", value=True, key="cmp_only_diff")

        # Build global text → page lookup for "来自/去往" annotation
        text_to_page_a: dict[str, int] = {
            s["text"]: p["page_num"]
            for p in data_a for s in p.get("aligned_segments", [])
        }
        text_to_page_b: dict[str, int] = {
            s["text"]: p["page_num"]
            for p in data_b for s in p.get("aligned_segments", [])
        }

        for pd in page_diffs:
            if only_diff and not pd["has_diff"]:
                continue

            conf_a = pd["conf_a"]
            conf_b = pd["conf_b"]
            rules  = analyze_page_diff_rules(pd)
            icon   = "🟡" if pd["has_diff"] else "⚪"
            label  = (f"Slide {pd['page_num']} — conf {conf_a:.2f}→{conf_b:.2f}  "
                      f"{icon}  {rules['summary']}")

            with st.expander(label, expanded=pd["has_diff"]):

                # Quantitative table
                import pandas as pd_lib
                tbl = pd_lib.DataFrame([{
                    "": "Run A", "conf": conf_a, "segs": rules["seg_count_a"],
                    "sim_mean": rules["sim_mean_a"], "sim_min": rules["sim_min_a"],
                    "off_slide": len(pd["off_slide_a"]),
                }, {
                    "": "Run B", "conf": conf_b, "segs": rules["seg_count_b"],
                    "sim_mean": rules["sim_mean_b"], "sim_min": rules["sim_min_b"],
                    "off_slide": len(pd["off_slide_b"]),
                }])
                st.dataframe(tbl.set_index(""), use_container_width=True)

                # LLM analysis button
                llm_key = f"llm_result_{pd['page_num']}_{run_id_a}_{run_id_b}"
                if st.button(f"🤖 Claude 分析 (Slide {pd['page_num']})",
                             key=f"btn_llm_{pd['page_num']}_{run_id_a}_{run_id_b}"):
                    with st.spinner("Claude 分析中…"):
                        result = analyze_page_diff_llm(pd, run_id_a, run_id_b)
                        st.session_state[llm_key] = result
                if llm_key in st.session_state:
                    st.info(st.session_state[llm_key])

                st.divider()

                # Sentence-level comparison
                col_a_hdr, col_b_hdr = st.columns(2)
                col_a_hdr.markdown(f"**Run A** `{run_id_a}`")
                col_b_hdr.markdown(f"**Run B** `{run_id_b}`")

                sim_map_a = {s["text"]: s for s in pd["segments_a"]}
                sim_map_b = {s["text"]: s for s in pd["segments_b"]}
                off_texts_changed = {d["text"] for d in pd["off_slide_changed"]}

                # Collect all texts that appear in aligned segments
                all_texts = list(dict.fromkeys(
                    [s["text"] for s in pd["segments_a"]]
                    + [s["text"] for s in pd["segments_b"]]
                ))

                col_a, col_b = st.columns(2)
                for text in all_texts:
                    in_a = text in sim_map_a
                    in_b = text in sim_map_b
                    is_to_off = any(
                        d["text"] == text and d["direction"] == "to_off"
                        for d in pd["off_slide_changed"]
                    )
                    is_from_off = any(
                        d["text"] == text and d["direction"] == "from_off"
                        for d in pd["off_slide_changed"]
                    )

                    if is_to_off:
                        _render_segment_row(col_a, col_b, text,
                                            sim_map_a.get(text), None, "to_off_slide")
                    elif is_from_off:
                        _render_segment_row(col_a, col_b, text,
                                            None, sim_map_b.get(text), "from_off_slide")
                    elif in_a and in_b:
                        delta = abs(sim_map_b[text]["similarity"] - sim_map_a[text]["similarity"])
                        status = "sim_changed" if delta > 0.05 else "unchanged"
                        _render_segment_row(col_a, col_b, text,
                                            sim_map_a[text], sim_map_b[text], status)
                    elif in_a and not in_b:
                        dest = text_to_page_b.get(text)
                        _render_segment_row(col_a, col_b, text,
                                            sim_map_a[text], None, "gone", dest_page=dest)
                    elif not in_a and in_b:
                        src = text_to_page_a.get(text)
                        _render_segment_row(col_a, col_b, text,
                                            None, sim_map_b[text], "new", source_page=src)

                # off_slide section
                if pd["off_slide_a"] or pd["off_slide_b"]:
                    st.divider()
                    st.caption("──── off_slide ────")
                    col_off_a, col_off_b = st.columns(2)

                    all_off_texts = list(dict.fromkeys(
                        [s["text"] for s in pd["off_slide_a"]]
                        + [s["text"] for s in pd["off_slide_b"]]
                    ))
                    off_map_a = {s["text"]: s for s in pd["off_slide_a"]}
                    off_map_b = {s["text"]: s for s in pd["off_slide_b"]}

                    for text in all_off_texts:
                        in_oa = text in off_map_a
                        in_ob = text in off_map_b
                        # Check if this off_slide text became aligned in B
                        became_aligned_b = text in sim_map_b
                        became_aligned_a = text in sim_map_a

                        if in_oa and in_ob:
                            with col_off_a:
                                st.caption(f"{_fmt_time(off_map_a[text]['start'])} {text[:50]} sim={off_map_a[text]['similarity']:.3f}")
                            with col_off_b:
                                st.caption(f"{_fmt_time(off_map_b[text]['start'])} {text[:50]} sim={off_map_b[text]['similarity']:.3f}")
                        elif in_oa and became_aligned_b:
                            with col_off_a:
                                st.caption(f"{_fmt_time(off_map_a[text]['start'])} {text[:50]}")
                            with col_off_b:
                                pg = text_to_page_b.get(text, "?")
                                st.markdown(f"🟢 → 升为 aligned (page {pg})")
                        elif in_ob and became_aligned_a:
                            with col_off_a:
                                pg = text_to_page_a.get(text, "?")
                                st.markdown(f"🔴 ← 降为 off_slide (was page {pg})")
                            with col_off_b:
                                st.caption(f"{_fmt_time(off_map_b[text]['start'])} {text[:50]}")
                        elif in_oa:
                            with col_off_a:
                                st.caption(f"{_fmt_time(off_map_a[text]['start'])} {text[:50]} sim={off_map_a[text]['similarity']:.3f}")
                            with col_off_b:
                                st.caption("──")
                        elif in_ob:
                            with col_off_a:
                                st.caption("──")
                            with col_off_b:
                                st.caption(f"{_fmt_time(off_map_b[text]['start'])} {text[:50]} sim={off_map_b[text]['similarity']:.3f}")
```

- [ ] **Step 4: 运行基础测试确认文件无语法错误**

```bash
cd backend
..\.venv\Scripts\python -c "from test_ui.align_compare import render_align_compare; print('import OK')"
```

期望输出：`import OK`

- [ ] **Step 5: Commit**

```bash
git add backend/test_ui/align_compare.py
git commit -m "feat: add render_align_compare Streamlit UI"
```

---

## Task 5: 接入 pipeline.py

**Files:**
- Modify: `backend/test_ui/pipeline.py`（末尾 Step 3 expander 内）

- [ ] **Step 1: 找到 Step 3 expander 的末尾位置**

[pipeline.py:150-214](backend/test_ui/pipeline.py#L150-L214) — Step 3 的 `with st.expander(...)` 块结尾处，在最后一行（`if pg.get("page_supplement"):` 之后的 `st.caption(...)` 行）之后，以及 Bullet-Level Alignment 子节之后，也就是整个 Step 3 expander 结束前。

具体是在第 216 行的 `# ── Bullet-Level Alignment (3 methods) ─────────────────────` 区块结束之后，即 `ba_cache` 块的最后一个 `st.caption(...)` 之后（pipeline.py:292）。

- [ ] **Step 2: 在 Step 3 expander 末尾追加 2 行**

在 [pipeline.py:292](backend/test_ui/pipeline.py#L292) 之后（`st.caption(...)` 结尾的缩进层级内，仍在 Step 3 的 `with st.expander` 块内）追加：

```python
                st.divider()
                from test_ui.align_compare import render_align_compare
                render_align_compare()
```

注意缩进：这两行在 `with st.expander("Step 3 — Semantic alignment", ...)` 的缩进层级内，但在 `if aligned_path.exists():` 块之外（和 `if not asr.exists() or not ppt_cache.exists():` 同级）。

实际插入位置参考：

```python
        # ── Bullet-Level Alignment (3 methods) ─────────────────────
        ...
                        ba_cache = _get_run_dir() / "bullet_alignment.json"
                        if ba_cache.exists():
                            ...
                                    st.caption(...)   # ← 最后一行
                # ↓ 追加在这里（Step 3 expander 末尾，仍在 else: 块内）
                st.divider()
                from test_ui.align_compare import render_align_compare
                render_align_compare()
```

- [ ] **Step 3: 启动 Streamlit 验证界面可访问**

```bash
cd backend
..\.venv\Scripts\streamlit run test_app.py
```

打开浏览器，进入 Pipeline tab → Step 3 expander → 滚动到底部，应看到 `🔀 Alignment 版本对比` expander。选择两个不同的 run，点击展开确认内容正确显示。

- [ ] **Step 4: Commit**

```bash
git add backend/test_ui/pipeline.py
git commit -m "feat: wire render_align_compare into Step 3"
```

---

## Self-Review

**Spec coverage check:**

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 以 page_num 为单位比较 | Task 1 |
| 全局文本索引检测跨页移动 | Task 1 |
| off_slide 判定变化检测 | Task 1 |
| `has_diff` 多维度判断 | Task 1 |
| 规则推断量化输出 + summary | Task 2 |
| summary 中文优先级拼接 | Task 2 |
| LLM 分析（按需）| Task 3 |
| ANTHROPIC_* env 变量读取 | Task 3 |
| LLM prompt 模板 | Task 3 |
| run 选择框（2 个 selectbox）| Task 4 |
| 汇总 metrics（4 列）| Task 4 |
| 只显示有变化的页 checkbox | Task 4 |
| per-page expander 有变化默认展开 | Task 4 |
| 量化数据 DataFrame | Task 4 |
| LLM 按钮 + session_state 缓存 | Task 4 |
| 两列并排句子渲染 | Task 4 |
| unchanged 灰色 caption | Task 4 |
| sim_changed 🟡 | Task 4 |
| gone 🔴 + 去向页 | Task 4 |
| new 🟢 + 来源页 | Task 4 |
| to/from_off_slide ⚠️✅ | Task 4 |
| off_slide 独立区块 | Task 4 |
| off_slide 升降标注 | Task 4 |
| 嵌入 Step 3 底部 | Task 5 |

**Placeholder scan:** 无 TBD/TODO/implement later。

**Type consistency:**
- `compare_aligned_pages` 返回 `list[dict]`，Task 4 中以 `pd` 迭代，字段名（`has_diff`、`segments_a`、`off_slide_a` 等）与 Task 1 定义一致。
- `analyze_page_diff_rules` 返回 dict，Task 4 中访问 `rules["seg_count_a"]`、`rules["summary"]` 等字段，均在 Task 2 定义。
- `_render_segment_row` 的 `status` 字符串值在 Task 4 调用处与 Task 4 定义处一致。
- `_fmt_time` 在 `_render_segment_row` 和 off_slide 区块均使用，定义在 Task 4 Step 2，无冲突。

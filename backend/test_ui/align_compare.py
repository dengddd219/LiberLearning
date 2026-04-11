"""
Alignment version comparison view for LiberStudy test platform.
"""
from __future__ import annotations
import os
from typing import Any

import streamlit as st
from test_ui.helpers import _list_runs, _load_json, _get_run_dir


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

        # off_slide_changed: aligned ↔ off_slide transitions (compute first)
        off_slide_changed: list[dict] = []
        # A aligned → B off_slide
        for t in texts_a:
            if t in off_texts_b and t not in texts_b:
                off_slide_changed.append({"text": t, "direction": "to_off"})
        # A off_slide → B aligned at this page
        for s in off_a:
            if s["text"] in texts_b:
                off_slide_changed.append({"text": s["text"], "direction": "from_off"})

        off_changed_texts = {d["text"] for d in off_slide_changed}

        # moved_in: in B aligned at this page, but NOT in A aligned at this page
        # exclude texts already accounted for in off_slide_changed
        moved_in: list[str] = [
            t for t in texts_b - texts_a
            if text_to_page_a.get(t) != pn and t not in off_changed_texts
        ]

        # moved_out: in A aligned at this page, but NOT in B aligned at this page
        # exclude texts already accounted for in off_slide_changed
        moved_out: list[str] = [
            t for t in texts_a - texts_b
            if text_to_page_b.get(t) != pn and t not in off_changed_texts
        ]

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

    moved_in_count          = len(page_diff["moved_in"])
    moved_out_count         = len(page_diff["moved_out"])
    off_slide_changed_count = len(page_diff["off_slide_changed"])

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
        **({"base_url": base_url} if base_url else {}),
    )

    rules = analyze_page_diff_rules(page_diff)

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

                llm_key = f"llm_result_{pd['page_num']}_{run_id_a}_{run_id_b}"
                if st.button(f"🤖 Claude 分析 (Slide {pd['page_num']})",
                             key=f"btn_llm_{pd['page_num']}_{run_id_a}_{run_id_b}"):
                    with st.spinner("Claude 分析中…"):
                        result = analyze_page_diff_llm(pd, run_id_a, run_id_b)
                        st.session_state[llm_key] = result
                if llm_key in st.session_state:
                    st.info(st.session_state[llm_key])

                st.divider()

                col_a_hdr, col_b_hdr = st.columns(2)
                col_a_hdr.markdown(f"**Run A** `{run_id_a}`")
                col_b_hdr.markdown(f"**Run B** `{run_id_b}`")

                sim_map_a = {s["text"]: s for s in pd["segments_a"]}
                sim_map_b = {s["text"]: s for s in pd["segments_b"]}

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
    assert "Moved sentence" in p1["moved_in"], f"moved_in={p1['moved_in']}"
    assert any(d["text"] == "Second sentence" and d["direction"] == "to_off"
               for d in p1["off_slide_changed"]), f"off_slide_changed={p1['off_slide_changed']}"

    p2 = next(d for d in diffs if d["page_num"] == 2)
    assert "Moved sentence" in p2["moved_out"], f"p2 moved_out={p2['moved_out']}"

    print("All assertions passed.")

    rules = analyze_page_diff_rules(p1)
    assert rules["conf_direction"] == "up"
    assert rules["moved_in_count"] == 1
    assert rules["moved_out_count"] == 0
    assert isinstance(rules["summary"], str) and len(rules["summary"]) > 0
    print("Rules assertions passed.")

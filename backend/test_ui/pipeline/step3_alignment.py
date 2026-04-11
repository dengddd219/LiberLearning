"""Step 3 — Semantic alignment (strategy A/B comparison + transcript timeline)."""
import time

import streamlit as st

from test_ui.helpers import (
    EMBED_COST_PER_1M_TOK,
    _badge, _confidence_color, _log_run,
    _wav_path, _asr_path, _aligned_path, _ppt_path, _gt_path,
    _save_json, _load_json,
    _aligned_path_for_strategy, _load_strategy_module,
    ALIGNMENT_STRATEGIES,
)


def render_step3(has_ppt, threshold, realign_btn):
    with st.expander("Step 3 — Semantic alignment", expanded=False):
        if not has_ppt:
            st.info("No PPT — alignment skipped.")
            return

        ppt_cache = _ppt_path()
        asr       = _asr_path()
        if not asr.exists() or not ppt_cache.exists():
            st.info("Complete Steps 1 & 2 first.")
            return

        segments_data  = _load_json(asr)
        ppt_pages_data = _load_json(ppt_cache)

        # ── Strategy selection row ────────────────────────────────────
        strat_keys   = list(ALIGNMENT_STRATEGIES.keys())
        strat_labels = [ALIGNMENT_STRATEGIES[k]["label"] for k in strat_keys]

        col_left_sel, col_right_sel = st.columns(2)
        with col_left_sel:
            left_strat_idx = st.selectbox(
                "Strategy (Left Pane)", range(len(strat_keys)),
                format_func=lambda i: strat_labels[i],
                key="left_strategy"
            )
            left_key = strat_keys[left_strat_idx]
            left_mod = _load_strategy_module(left_key)
            st.text_area("Strategy description",
                         value=getattr(left_mod, "STRATEGY_DESCRIPTION", ""),
                         disabled=True, height=80, key="left_strat_desc")

        with col_right_sel:
            right_strat_idx = st.selectbox(
                "Strategy (Right Pane)", range(len(strat_keys)),
                format_func=lambda i: strat_labels[i],
                index=min(1, len(strat_keys) - 1),
                key="right_strategy"
            )
            right_key = strat_keys[right_strat_idx]
            right_mod = _load_strategy_module(right_key)
            st.text_area("Strategy description",
                         value=getattr(right_mod, "STRATEGY_DESCRIPTION", ""),
                         disabled=True, height=80, key="right_strat_desc")

        # ── Per-strategy run buttons ──────────────────────────────────
        def _ensure_alignment(strategy_key, label):
            path = _aligned_path_for_strategy(strategy_key)
            cached = path.exists() and not realign_btn
            btn_label = f"↺ Re-run {label}" if path.exists() else f"▶ Run {label}"
            if st.button(btn_label, key=f"btn_align_{strategy_key}"):
                t0 = time.time()
                from services.audio import get_audio_duration
                dur = get_audio_duration(str(_wav_path()))
                mod = _load_strategy_module(strategy_key)
                mod.OFF_SLIDE_THRESHOLD = threshold
                aligned = mod.build_page_timeline(
                    ppt_pages_data, segments_data, total_audio_duration=dur
                )
                _save_json(path, aligned)
                elapsed = time.time() - t0
                total_chars = (sum(len(p.get("ppt_text", "")) for p in ppt_pages_data)
                               + sum(len(s["text"]) for s in segments_data))
                est_tokens = total_chars // 4
                cost = est_tokens / 1e6 * EMBED_COST_PER_1M_TOK
                _log_run(f"alignment_{strategy_key}", elapsed, est_tokens, cost,
                         extra={"strategy": strategy_key, "threshold": threshold})
                st.rerun()
            if cached:
                return _load_json(path)
            return None

        col_run_l, col_run_r = st.columns(2)
        with col_run_l:
            left_aligned = _ensure_alignment(left_key, strat_labels[left_strat_idx])
        with col_run_r:
            right_aligned = _ensure_alignment(right_key, strat_labels[right_strat_idx])

        # ── Section A — Overall View ──────────────────────────────────
        st.subheader("Section A — Overall Confidence View")
        st.caption(
            "**测什么**：对于 PPT 中的每一页，策略将哪些 ASR 句段分配给该页，"
            "以及这些句段的语义相似度置信度分布。\n\n"
            "**分数含义**：\n"
            "- `conf`（对齐置信度）= 该页所有已对齐句段的平均语义相似度，"
            "0–1 区间，越高说明讲师实际讲解内容与该页 PPT 文字越吻合。\n"
            "- `sim`（单句相似度）= 单条句段与该页 PPT embedding 的余弦相似度。\n"
            "- 🟩≥0.6 高置信度；🟨0.4–0.6 中；🟥<0.4 低（可能误对齐）。\n"
            "- `Covered` = 至少有一条句段对齐的 PPT 页数（上传 PPT 页数通常多于实际讲解页数，"
            "未覆盖页面不影响结果）。"
        )
        col_a_l, col_a_r = st.columns(2)

        def _render_confidence_badges(aligned_data, label):
            if aligned_data is None:
                st.caption(f"({label} not run yet)")
                return None, None
            covered = sum(1 for p in aligned_data if p.get("aligned_segments"))
            avg_conf = sum(p.get("alignment_confidence", 0) for p in aligned_data) / max(len(aligned_data), 1)
            high_conf_count = sum(1 for p in aligned_data if p.get("alignment_confidence", 0) >= 0.6)
            off_slide_count = sum(len(p.get("off_slide_segments", [])) for p in aligned_data)
            for pg in aligned_data:
                conf = pg.get("alignment_confidence", 0)
                icon = _confidence_color(conf)
                segs = pg.get("aligned_segments", [])
                ts   = int(pg.get("page_start_time", 0))
                te   = int(pg.get("page_end_time", 0))
                st.markdown(
                    f"{icon} Slide {pg['page_num']} — "
                    f"conf={conf:.2f}, {len(segs)} segs "
                    f"[{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}]"
                )
            st.caption(f"Covered: {covered}/{len(aligned_data)} | Avg conf: {avg_conf:.2f}")
            return avg_conf, high_conf_count, off_slide_count

        with col_a_l:
            st.markdown(f"**{strat_labels[left_strat_idx]}**")
            left_stats = _render_confidence_badges(left_aligned, strat_labels[left_strat_idx])

        with col_a_r:
            st.markdown(f"**{strat_labels[right_strat_idx]}**")
            right_stats = _render_confidence_badges(right_aligned, strat_labels[right_strat_idx])

        # Delta row
        if (left_aligned is not None and right_aligned is not None
                and left_stats is not None and right_stats is not None
                and len(left_stats) == 3 and len(right_stats) == 3):
            l_avg, l_high, l_off = left_stats
            r_avg, r_high, r_off = right_stats
            avg_delta = r_avg - l_avg
            high_delta = r_high - l_high
            n_pages = max(len(left_aligned), len(right_aligned), 1)
            high_pct = f"{high_delta/n_pages*100:+.0f}%"
            off_delta = r_off - l_off
            l_off_safe = max(l_off, 1)
            off_pct = f"{off_delta/l_off_safe*100:+.0f}%"
            st.info(
                f"📊 Delta (V2 vs V1): Avg conf {avg_delta:+.2f} | "
                f"高置信度页面 (≥0.6) {high_delta:+d} ({high_pct}) | "
                f"Off-slide 段 {off_delta:+d} ({off_pct})"
            )

        # ── Section B — Transcript Timeline ───────────────────────────
        st.subheader("Section B — Transcript Timeline")

        gt_path = _gt_path()
        gt_data = _load_json(gt_path) if gt_path.exists() else {}

        gt_lookup = {}
        for key, val in gt_data.items():
            if key.startswith("seg_"):
                try:
                    idx = int(key[4:])
                    gt_lookup[idx] = val
                except ValueError:
                    pass

        page_size = st.number_input(
            "Segments per page", min_value=5, max_value=100, value=15, step=5,
            key="tl_page_size"
        )

        if "tl_current_page" not in st.session_state:
            st.session_state["tl_current_page"] = 0

        asr_segs = segments_data
        total_segs  = len(asr_segs)
        total_pages = max(1, (total_segs + page_size - 1) // page_size)
        cur_tl = min(st.session_state["tl_current_page"], total_pages - 1)

        nav1, nav2, nav3 = st.columns([1, 3, 1])
        with nav1:
            if st.button("← Prev", key="tl_prev", disabled=cur_tl == 0):
                st.session_state["tl_current_page"] = cur_tl - 1
                st.rerun()
        with nav2:
            st.caption(f"Page {cur_tl + 1} / {total_pages}  ({total_segs} segments total)")
        with nav3:
            if st.button("Next →", key="tl_next", disabled=cur_tl >= total_pages - 1):
                st.session_state["tl_current_page"] = cur_tl + 1
                st.rerun()

        def _build_seg_lookup(aligned):
            lookup = {}
            if aligned is None:
                return lookup
            for pg in aligned:
                for s in pg.get("aligned_segments", []):
                    cls = s.get("segment_class", "") or "belongs"
                    lookup[s["start"]] = {
                        "page_num": pg["page_num"],
                        "is_off_slide": False,
                        "similarity": s.get("similarity", 0),
                        "conf": pg.get("alignment_confidence", 0),
                        "segment_class": cls,
                    }
                for s in pg.get("off_slide_segments", []):
                    cls = s.get("segment_class", "") or "filler"
                    lookup[s["start"]] = {
                        "page_num": pg["page_num"],
                        "is_off_slide": True,
                        "similarity": s.get("similarity", 0),
                        "conf": pg.get("alignment_confidence", 0),
                        "segment_class": cls,
                    }
            return lookup

        left_lookup  = _build_seg_lookup(left_aligned)
        right_lookup = _build_seg_lookup(right_aligned)

        CLASS_ICONS = {"belongs": "🟢属于", "extends": "🔵拓展", "filler": "⚪废话", "": ""}

        def _strategy_class(info):
            if info is None:
                return None
            if info["is_off_slide"]:
                return "filler"
            cls = info.get("segment_class", "")
            return cls if cls else None

        def _gt_class(gt_entry):
            if gt_entry is None:
                return None
            if gt_entry.get("page_num") is None:
                return "filler"
            return "extends" if gt_entry.get("is_extension") else "belongs"

        def _is_correct(strat_cls, gt_cls):
            if strat_cls is None or gt_cls is None:
                return None
            if strat_cls in ("belongs", "extends"):
                return gt_cls in ("belongs", "extends")
            return False  # filler 面对 GT=belongs/extends 均错

        def _fmt_info(info, label):
            if info is None:
                return f"({label} — not run)"
            cls = info.get("segment_class", "")
            cls_tag = f" [{CLASS_ICONS.get(cls, cls)}]" if cls else ""
            if info["is_off_slide"]:
                return f"off-slide (near Slide {info['page_num']}), sim={info['similarity']:.3f}{cls_tag}"
            return f"Slide {info['page_num']}, sim={info['similarity']:.3f}, conf={info['conf']:.2f}{cls_tag}"

        def _fmt_gt(gt_entry):
            if gt_entry is None:
                return "（无 GT）"
            pn = gt_entry.get("page_num")
            if pn is None:
                return "⚪废话 (off-slide)"
            label = "🔵拓展" if gt_entry.get("is_extension") else "🟢属于"
            return f"Slide {pn} {label}"

        def _correct_marker(strat_cls, gt_cls):
            if gt_cls is None or gt_cls == "filler":
                return ""
            result = _is_correct(strat_cls, gt_cls)
            if result is None:
                return ""
            return " ✅" if result else " ❌"

        s_start = cur_tl * page_size
        for seg_abs_idx, seg in enumerate(asr_segs[s_start: s_start + page_size], start=s_start):
            ms = int(seg["start"])
            me = int(seg["end"])
            st.markdown(f"`[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}]` {seg['text']}")
            sub_l, sub_r, sub_gt = st.columns(3)

            li = left_lookup.get(seg["start"])
            ri = right_lookup.get(seg["start"])
            gt_entry = gt_lookup.get(seg_abs_idx)

            l_cls  = _strategy_class(li)
            r_cls  = _strategy_class(ri)
            gt_cls = _gt_class(gt_entry)

            with sub_l:
                st.caption(f"  L: {_fmt_info(li, strat_labels[left_strat_idx])}{_correct_marker(l_cls, gt_cls)}")
            with sub_r:
                st.caption(f"  R: {_fmt_info(ri, strat_labels[right_strat_idx])}{_correct_marker(r_cls, gt_cls)}")
            with sub_gt:
                st.caption(f"  GT: {_fmt_gt(gt_entry)}")

        # ── Accuracy summary ────
        if gt_lookup:
            st.divider()
            st.markdown("**Ground Truth 成功率（仅统计 GT 中有明确页码的句段）**")
            acc_col_l, acc_col_r = st.columns(2)

            def _calc_accuracy(lookup, label):
                correct = 0
                total = 0
                for i, seg in enumerate(asr_segs):
                    gt_entry = gt_lookup.get(i)
                    gt_cls = _gt_class(gt_entry)
                    if gt_cls is None or gt_cls == "filler":
                        continue
                    total += 1
                    info = lookup.get(seg["start"])
                    strat_cls = _strategy_class(info)
                    if _is_correct(strat_cls, gt_cls):
                        correct += 1
                pct = correct / total * 100 if total > 0 else 0
                return correct, total, pct

            with acc_col_l:
                if left_aligned is not None:
                    c, t, p = _calc_accuracy(left_lookup, strat_labels[left_strat_idx])
                    st.metric(
                        label=strat_labels[left_strat_idx],
                        value=f"{p:.1f}%",
                        delta=f"{c}/{t} 正确"
                    )
                else:
                    st.caption(f"({strat_labels[left_strat_idx]} — 未运行)")

            with acc_col_r:
                if right_aligned is not None:
                    c, t, p = _calc_accuracy(right_lookup, strat_labels[right_strat_idx])
                    st.metric(
                        label=strat_labels[right_strat_idx],
                        value=f"{p:.1f}%",
                        delta=f"{c}/{t} 正确"
                    )
                else:
                    st.caption(f"({strat_labels[right_strat_idx]} — 未运行)")

            st.caption(
                "统计规则：策略判断「属于」或「拓展」且 GT 为「属于」或「拓展」→ ✅；"
                "策略判断「废话」而 GT 为「属于」或「拓展」→ ❌。"
                "GT 为 off-slide（废话）的句段不计入分母。"
            )

        # ── Legacy: bullet-level alignment ────────────────────────────
        aligned_path = _aligned_path()
        with st.expander("Bullet-Level Alignment (A / B / C) — Legacy", expanded=False):
            if not aligned_path.exists():
                st.info("Run alignment first to enable bullet-level analysis.")
            else:
                aligned_data = _load_json(aligned_path)
                page_opts_ba = [f"Slide {p['page_num']} ({len(p.get('aligned_segments',[]))} segs)"
                                for p in aligned_data if p.get("aligned_segments")]
                pages_with_segs = [p for p in aligned_data if p.get("aligned_segments")]

                if not pages_with_segs:
                    st.warning("No slides have aligned segments — cannot run bullet alignment.")
                else:
                    ba_page_idx = st.selectbox("Select slide for bullet alignment",
                                               range(len(page_opts_ba)),
                                               format_func=lambda i: page_opts_ba[i],
                                               key="ba_page_sel")
                    ba_page     = pages_with_segs[ba_page_idx]
                    ba_segments = ba_page.get("aligned_segments", [])
                    ba_ppt_text = ba_page.get("ppt_text", "")
                    bullet_lines = [l.strip() for l in ba_ppt_text.splitlines() if l.strip()]
                    st.caption(f"{len(bullet_lines)} bullets, {len(ba_segments)} segments on this slide")

                    if st.button("▶ Run Bullet Alignment (all 3 methods)", key="btn_bullet_align"):
                        from services.bullet_alignment import (
                            align_bullets_embedding,
                            align_bullets_llm,
                            align_bullets_hybrid,
                        )
                        results = {}
                        prog = st.progress(0, text="Method A (Embedding)…")
                        t0 = time.time()
                        results["A"] = align_bullets_embedding(ba_ppt_text, ba_segments)
                        elapsed_a = time.time() - t0

                        prog.progress(33, text="Method B (LLM)…")
                        t1 = time.time()
                        results["B"] = align_bullets_llm(ba_ppt_text, ba_segments)
                        elapsed_b = time.time() - t1

                        prog.progress(66, text="Method C (Hybrid)…")
                        t2 = time.time()
                        results["C"] = align_bullets_hybrid(ba_ppt_text, ba_segments)
                        elapsed_c = time.time() - t2

                        prog.progress(100, text="Done")
                        from test_ui.helpers import _get_run_dir
                        ba_out = {
                            "page_num": ba_page["page_num"],
                            "bullets": bullet_lines,
                            "n_segments": len(ba_segments),
                            "A": {"results": results["A"], "elapsed_s": round(elapsed_a, 2)},
                            "B": {"results": results["B"], "elapsed_s": round(elapsed_b, 2)},
                            "C": {"results": results["C"], "elapsed_s": round(elapsed_c, 2)},
                        }
                        _save_json(_get_run_dir() / "bullet_alignment.json", ba_out)
                        _log_run("bullet_align", elapsed_a + elapsed_b + elapsed_c,
                                 extra={"page_num": ba_page["page_num"]})
                        st.rerun()

                    ba_cache = _aligned_path().parent / "bullet_alignment.json"
                    if ba_cache.exists():
                        ba_out = _load_json(ba_cache)
                        col_a, col_b, col_c = st.columns(3)
                        for col, method, label in [
                            (col_a, "A", "A — Embedding"),
                            (col_b, "B", "B — LLM"),
                            (col_c, "C", "C — Hybrid"),
                        ]:
                            with col:
                                st.markdown(f"**{label}** ({ba_out[method]['elapsed_s']:.1f}s)")
                                for r in ba_out[method]["results"][:10]:
                                    bidx = r["bullet_idx"]
                                    conf = r["confidence"]
                                    icon = "🟢" if conf >= 0.6 else ("🟡" if conf >= 0.3 else "🔴")
                                    bullet_text = (ba_out["bullets"][bidx][:30] + "…"
                                                   if 0 <= bidx < len(ba_out["bullets"])
                                                   else "(off-slide)")
                                    st.caption(f"{icon} seg{r['segment_idx']} → {bullet_text} ({conf:.2f})")

        with st.expander("Legacy Run Diff", expanded=False):
            from test_ui.align_compare import render_align_compare
            render_align_compare()

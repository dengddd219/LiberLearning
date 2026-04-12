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

        # ── Shared helpers ──────────────────────────────────────────────
        asr_segs = segments_data

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

        def _is_page_correct(info, gt_entry):
            """Check if strategy assigned the segment to the correct page."""
            if info is None or gt_entry is None:
                return None
            gt_page = gt_entry.get("page_num")
            if info["is_off_slide"]:
                return gt_page is None
            if gt_page is None:
                return False
            return info.get("page_num") == gt_page

        gt_path = _gt_path()
        gt_data = _load_json(gt_path) if gt_path.exists() else {}
        gt_lookup = {}
        for key, val in gt_data.items():
            if key.startswith("seg_"):
                try:
                    gt_lookup[int(key[4:])] = val
                except ValueError:
                    pass

        def _calc_accuracy_for_lookup(lookup):
            correct = total = 0
            for i, seg in enumerate(asr_segs):
                gt_entry = gt_lookup.get(i)
                if gt_entry is None:
                    continue
                total += 1
                if _is_page_correct(lookup.get(seg["start"]), gt_entry):
                    correct += 1
            pct = correct / total * 100 if total > 0 else 0
            return correct, total, pct

        # ── Batch run panel ────────────────────────────────────────────
        st.subheader("批量运行对齐策略")
        strat_keys_all   = list(ALIGNMENT_STRATEGIES.keys())
        strat_labels_all = [ALIGNMENT_STRATEGIES[k]["label"] for k in strat_keys_all]

        selected_labels = st.multiselect(
            "选择要运行的策略（可多选）",
            options=strat_labels_all,
            default=[],
            key="batch_run_select",
        )
        selected_keys = [
            strat_keys_all[strat_labels_all.index(lbl)]
            for lbl in selected_labels
        ]

        if st.button("▶ 批量运行选中策略", key="btn_batch_run",
                     disabled=not selected_keys):
            from services.audio import get_audio_duration
            dur = get_audio_duration(str(_wav_path()))
            progress = st.progress(0, text="准备中…")
            n = len(selected_keys)
            for idx, skey in enumerate(selected_keys):
                slabel = ALIGNMENT_STRATEGIES[skey]["label"]
                progress.progress(idx / n, text=f"正在运行 {slabel}…")
                t0 = time.time()
                mod = _load_strategy_module(skey)
                mod.OFF_SLIDE_THRESHOLD = threshold
                aligned = mod.build_page_timeline(
                    ppt_pages_data, segments_data, total_audio_duration=dur
                )
                spath = _aligned_path_for_strategy(skey)
                _save_json(spath, aligned)
                elapsed = time.time() - t0
                total_chars = (
                    sum(len(p.get("ppt_text", "")) for p in ppt_pages_data)
                    + sum(len(s["text"]) for s in segments_data)
                )
                est_tokens = total_chars // 4
                cost = est_tokens / 1e6 * EMBED_COST_PER_1M_TOK
                _log_run(f"alignment_{skey}", elapsed, est_tokens, cost,
                         extra={"strategy": skey, "threshold": threshold})
            progress.progress(1.0, text=f"完成！已运行 {n} 个策略。")
            st.rerun()

        # ── Global accuracy table (ranked by score) ────────────────────
        if gt_lookup:
            st.subheader("全策略准确率对比（页码匹配）")
            import pandas as pd

            table_rows = []
            for skey in ALIGNMENT_STRATEGIES:
                slabel = ALIGNMENT_STRATEGIES[skey]["label"]
                spath = _aligned_path_for_strategy(skey)
                if not spath.exists():
                    table_rows.append({
                        "策略": slabel, "准确率": "未运行",
                        "正确/总数": "—", "_score": -1.0,
                    })
                    continue
                s_lookup = _build_seg_lookup(_load_json(spath))
                c, t, p = _calc_accuracy_for_lookup(s_lookup)
                table_rows.append({
                    "策略": slabel,
                    "准确率": f"{p:.1f}%",
                    "正确/总数": f"{c}/{t}",
                    "_score": p,
                })

            # Sort: ran strategies by score desc, unran ones at bottom
            table_rows.sort(key=lambda r: r["_score"], reverse=True)
            display_rows = [{k: v for k, v in r.items() if k != "_score"}
                            for r in table_rows]

            # Add rank column
            rank = 1
            for r in display_rows:
                if r["准确率"] == "未运行":
                    r["排名"] = "—"
                else:
                    r["排名"] = f"#{rank}"
                    rank += 1

            df = pd.DataFrame(display_rows)[["排名", "策略", "准确率", "正确/总数"]]
            st.table(df.set_index("排名"))
            st.caption(
                "统计规则：策略分配的页码 = GT 标注页码 → ✅；"
                "策略判为 off-slide 且 GT 也为 off-slide → ✅；"
                "其余情况 → ❌。所有 GT 句段均计入分母。按准确率降序排名。"
            )

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

        left_lookup  = _build_seg_lookup(left_aligned)
        right_lookup = _build_seg_lookup(right_aligned)

        # L/R selected strategies accuracy
        if gt_lookup:
            st.markdown("**当前选中策略 L / R**")
            acc_col_l, acc_col_r = st.columns(2)
            with acc_col_l:
                if left_aligned is not None:
                    c, t, p = _calc_accuracy_for_lookup(left_lookup)
                    st.metric(label=strat_labels[left_strat_idx], value=f"{p:.1f}%", delta=f"{c}/{t} 正确")
                else:
                    st.caption(f"({strat_labels[left_strat_idx]} — 未运行)")
            with acc_col_r:
                if right_aligned is not None:
                    c, t, p = _calc_accuracy_for_lookup(right_lookup)
                    st.metric(label=strat_labels[right_strat_idx], value=f"{p:.1f}%", delta=f"{c}/{t} 正确")
                else:
                    st.caption(f"({strat_labels[right_strat_idx]} — 未运行)")

        # ── Section A — Overall View (collapsible) ────────────────────
        with st.expander("Section A — Overall Confidence View"):
            st.caption(
                "**测什么**：对于 PPT 中的每一页，策略将哪些 ASR 句段分配给该页，"
                "以及这些句段的语义相似度置信度分布。\n\n"
                "**分数含义**：\n"
                "- `conf`（对齐置信度）= 该页所有已对齐句段的平均语义相似度，"
                "0–1 区间，越高说明讲师实际讲解内容与该页 PPT 文字越吻合。\n"
                "- `sim`（单句相似度）= 单条句段与该页 PPT embedding 的余弦相似度。\n"
                "- 🟩≥0.6 高置信度；🟨0.4–0.6 中；🟥<0.4 低（可能误对齐）。\n"
                "- `Covered` = 至少有一条句段对齐的 PPT 页数。"
            )

            def _render_confidence_column(aligned_data, label):
                if aligned_data is None:
                    st.caption(f"({label} not run yet)")
                    return None
                covered = sum(1 for p in aligned_data if p.get("aligned_segments"))
                avg_conf = sum(p.get("alignment_confidence", 0) for p in aligned_data) / max(len(aligned_data), 1)
                high_conf_count = sum(1 for p in aligned_data if p.get("alignment_confidence", 0) >= 0.6)
                off_slide_count = sum(len(p.get("off_slide_segments", [])) for p in aligned_data)
                st.caption(f"Covered: {covered}/{len(aligned_data)} | Avg conf: {avg_conf:.2f}")
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
                return avg_conf, high_conf_count, off_slide_count

            col_a_l, col_a_r = st.columns(2)
            with col_a_l:
                st.markdown(f"**{strat_labels[left_strat_idx]}**")
                left_stats = _render_confidence_column(left_aligned, strat_labels[left_strat_idx])
            with col_a_r:
                st.markdown(f"**{strat_labels[right_strat_idx]}**")
                right_stats = _render_confidence_column(right_aligned, strat_labels[right_strat_idx])

            if (left_stats is not None and right_stats is not None
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
                    f"Delta (R vs L): Avg conf {avg_delta:+.2f} | "
                    f"高置信度页面 (≥0.6) {high_delta:+d} ({high_pct}) | "
                    f"Off-slide 段 {off_delta:+d} ({off_pct})"
                )

        # ── Section B — Transcript Timeline (collapsible) ─────────────
        with st.expander("Section B — Transcript Timeline"):
            page_size = st.number_input(
                "Segments per page", min_value=5, max_value=100, value=15, step=5,
                key="tl_page_size"
            )

            if "tl_current_page" not in st.session_state:
                st.session_state["tl_current_page"] = 0

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

            CLASS_ICONS = {"belongs": "🟢属于", "extends": "🔵拓展", "filler": "⚪废话", "": ""}

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

            def _correct_marker(info, gt_entry):
                if gt_entry is None:
                    return ""
                result = _is_page_correct(info, gt_entry)
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

                with sub_l:
                    st.caption(f"  L: {_fmt_info(li, strat_labels[left_strat_idx])}{_correct_marker(li, gt_entry)}")
                with sub_r:
                    st.caption(f"  R: {_fmt_info(ri, strat_labels[right_strat_idx])}{_correct_marker(ri, gt_entry)}")
                with sub_gt:
                    st.caption(f"  GT: {_fmt_gt(gt_entry)}")

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

        # ── Excel 导出 ─────────────────────────────────────────────────
        with st.expander("📊 导出对齐结果 Excel", expanded=False):
            st.caption(
                "选择策略版本后，生成每句段的详细评估表格。"
                "如已有 Excel 文件，可选择追加模式（按版本名称去重）。"
            )
            import pandas as pd
            import io

            export_labels = st.multiselect(
                "选择要导出的策略",
                options=strat_labels_all,
                default=[],
                key="export_strat_select",
            )
            export_keys = [
                strat_keys_all[strat_labels_all.index(lbl)]
                for lbl in export_labels
            ]

            append_mode = st.checkbox("追加模式（追加到已有 Excel，按版本去重）", value=True, key="export_append")

            uploaded_excel = None
            if append_mode:
                uploaded_excel = st.file_uploader(
                    "上传已有 Excel 文件（.xlsx）以追加新版本数据",
                    type=["xlsx"],
                    key="export_upload_excel",
                )

            if st.button("生成 Excel", key="btn_export_excel", disabled=not export_keys):
                rows = []
                for ekey in export_keys:
                    elabel = ALIGNMENT_STRATEGIES[ekey]["label"]
                    epath = _aligned_path_for_strategy(ekey)
                    if not epath.exists():
                        st.warning(f"{elabel} 尚未运行，跳过。")
                        continue
                    e_lookup = _build_seg_lookup(_load_json(epath))
                    for i, seg in enumerate(asr_segs):
                        info = e_lookup.get(seg["start"])
                        gt_entry = gt_lookup.get(i)
                        ms = int(seg["start"])
                        me = int(seg["end"])
                        time_range = f"[{ms//60:02d}:{ms%60:02d}-{me//60:02d}:{me%60:02d}]"
                        # sim 和判定页码
                        if info is None:
                            sim_val = None
                            assigned_page = None
                        elif info["is_off_slide"]:
                            sim_val = round(info["similarity"], 4)
                            assigned_page = f"off-slide(near {info['page_num']})"
                        else:
                            sim_val = round(info["similarity"], 4)
                            assigned_page = info["page_num"]
                        # GT 页码
                        if gt_entry is None:
                            gt_page = None
                            is_correct = None
                        else:
                            gt_page = gt_entry.get("page_num")  # None 表示 off-slide
                            correct = _is_page_correct(info, gt_entry)
                            is_correct = "✅" if correct else ("❌" if correct is not None else "")
                        rows.append({
                            "版本名称": elabel,
                            "seg_index": i,
                            "时间段": time_range,
                            "sim": sim_val,
                            "正确与否": is_correct,
                            "判定slide页码": assigned_page,
                            "gt_slide页码": gt_page,
                        })

                if not rows:
                    st.warning("没有可导出的数据。")
                else:
                    new_df = pd.DataFrame(rows, columns=[
                        "版本名称", "seg_index", "时间段", "sim", "正确与否", "判定slide页码", "gt_slide页码"
                    ])

                    # 追加模式：合并已有 Excel
                    if append_mode and uploaded_excel is not None:
                        try:
                            existing_df = pd.read_excel(uploaded_excel)
                            new_versions = new_df["版本名称"].unique().tolist()
                            # 删除已有 Excel 中与新版本同名的行
                            existing_df = existing_df[~existing_df["版本名称"].isin(new_versions)]
                            final_df = pd.concat([existing_df, new_df], ignore_index=True)
                            st.success(f"已追加 {len(new_versions)} 个版本（去重后合并）。")
                        except Exception as e:
                            st.error(f"读取已有 Excel 失败：{e}，将仅导出新数据。")
                            final_df = new_df
                    else:
                        final_df = new_df

                    buf = io.BytesIO()
                    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
                        final_df.to_excel(writer, index=False, sheet_name="对齐结果")
                    buf.seek(0)
                    st.download_button(
                        label="⬇️ 下载 Excel",
                        data=buf,
                        file_name="alignment_eval.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        key="download_excel_btn",
                    )

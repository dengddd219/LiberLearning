"""Step 2 — ASR transcription with Whisper vs Aliyun comparison."""
import time

import streamlit as st

from test_ui.helpers import (
    ALIYUN_COST_PER_MIN,
    _badge, _log_run,
    _wav_path, _asr_path, _asr_raw_path,
    _save_json, _load_json, _gt_path,
    _get_doc_dir,
)

WHISPER_COST_PER_MIN = 0.006  # $0.006/min (OpenAI Whisper API pricing)


def _asr_whisper_path():
    return _get_doc_dir(st.session_state.get("doc_id") or "default") / "asr_whisper.json"


def _asr_aliyun_path():
    return _get_doc_dir(st.session_state.get("doc_id") or "default") / "asr_aliyun.json"


def _compute_cer(ref: str, hyp: str) -> float:
    """Character Error Rate = edit_distance(ref, hyp) / len(ref)."""
    r, h = list(ref), list(hyp)
    m, n = len(r), len(h)
    if m == 0:
        return 0.0
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[:]
        dp[0] = i
        for j in range(1, n + 1):
            if r[i - 1] == h[j - 1]:
                dp[j] = prev[j - 1]
            else:
                dp[j] = 1 + min(prev[j], dp[j - 1], prev[j - 1])
    return dp[n] / m


def _segments_to_text(segments: list[dict]) -> str:
    return " ".join(s["text"] for s in segments)


def _gt_ref_text(gt_data: dict) -> str:
    """把 ground_truth.json 里所有 seg 的 text 拼成参考文本。"""
    return " ".join(
        v["text"] for v in gt_data.values()
        if isinstance(v, dict) and v.get("text")
    )


def _render_segments(segments: list[dict], max_show: int = 30):
    for seg in segments[:max_show]:
        ms, me = int(seg["start"]), int(seg["end"])
        st.text(f"[{ms//60:02d}:{ms%60:02d}–{me//60:02d}:{me%60:02d}] {seg['text']}")
    if len(segments) > max_show:
        st.caption(f"… 共 {len(segments)} 条，仅显示前 {max_show} 条")


def render_step2(language):
    with st.expander("Step 2 — ASR transcription", expanded=False):
        wav = _wav_path()
        if not wav.exists():
            st.info("Complete Step 0 first.")
            return

        from services.audio import get_audio_duration
        dur = get_audio_duration(str(wav))

        # ── 模式切换 ──────────────────────────────────────────────────────────
        mode = st.radio(
            "模式",
            ["单引擎（生产配置）", "Whisper vs 阿里云 横向对比"],
            horizontal=True,
            key="s2_mode",
        )

        if mode == "单引擎（生产配置）":
            _render_single(wav, dur, language)
        else:
            _render_compare(wav, dur, language)


# ── 单引擎模式（原有逻辑不变）────────────────────────────────────────────────

def _render_single(wav, dur, language):
    asr = _asr_path()
    asr_raw = _asr_raw_path()

    if asr.exists():
        segments = _load_json(asr)
        total_chars = sum(len(s["text"]) for s in segments)
        st.success(f"✅ Cached — {len(segments)} sentences, {total_chars:,} chars")

        with st.expander("🔍 Merge comparison — raw vs merged", expanded=False):
            col_raw, col_merged = st.columns(2)
            with col_raw:
                st.markdown("**Raw segments** (pre-merge)")
                if asr_raw.exists():
                    raw_segs = _load_json(asr_raw)
                    st.caption(f"{len(raw_segs)} raw segments")
                    _render_segments(raw_segs)
                else:
                    st.info("Raw segments not available.")
            with col_merged:
                st.markdown("**Merged sentences** (used in Step 3+)")
                st.caption(f"{len(segments)} sentences")
                _render_segments(segments)
    else:
        if st.button("▶ Run ASR", key="btn_step2_single"):
            t0 = time.time()
            prog = st.progress(0, text="Running ASR…")
            from services.asr import transcribe
            sentences, raw_segments = transcribe(str(wav), language=language)
            _save_json(asr_raw, raw_segments)
            _save_json(asr, sentences)
            prog.progress(100, text="Done")
            elapsed = time.time() - t0
            cost = (dur / 60) * ALIYUN_COST_PER_MIN
            _log_run("asr", elapsed, cost=cost,
                     extra={"n_sentences": len(sentences), "n_raw": len(raw_segments), "duration_s": dur})
            st.success(f"✅ {_badge(elapsed, cost=cost)} — {len(raw_segments)} raw → {len(sentences)} sentences")
            st.rerun()


# ── 横向对比模式 ──────────────────────────────────────────────────────────────

def _render_compare(wav, dur, language):
    whisper_path = _asr_whisper_path()
    aliyun_path = _asr_aliyun_path()

    whisper_done = whisper_path.exists()
    aliyun_done = aliyun_path.exists()

    # ── 运行按钮 ──────────────────────────────────────────────────────────────
    col_w, col_a, col_clear = st.columns([2, 2, 1])

    with col_w:
        whisper_label = "✅ Whisper（已缓存）" if whisper_done else "▶ Run Whisper"
        if st.button(whisper_label, key="btn_s2_whisper", disabled=whisper_done):
            _run_whisper(wav, dur, language, whisper_path)
            st.rerun()

    with col_a:
        aliyun_label = "✅ 阿里云（已缓存）" if aliyun_done else "▶ Run 阿里云"
        if st.button(aliyun_label, key="btn_s2_aliyun", disabled=aliyun_done):
            _run_aliyun(wav, dur, language, aliyun_path)
            st.rerun()

    with col_clear:
        if st.button("🗑 清除缓存", key="btn_s2_clear"):
            for p in [whisper_path, aliyun_path]:
                if p.exists():
                    p.unlink()
            st.rerun()

    if not whisper_done and not aliyun_done:
        st.info("点击上方按钮运行引擎，两个都完成后显示对比结果。")
        return

    # ── 指标对比面板 ──────────────────────────────────────────────────────────
    if whisper_done or aliyun_done:
        st.divider()
        st.markdown("#### 📊 指标对比")

        w_data = _load_json(whisper_path) if whisper_done else None
        a_data = _load_json(aliyun_path) if aliyun_done else None

        # ── 参考文本（正确答案）输入 ──────────────────────────────────────────
        st.markdown("#### ✍️ 参考文本（正确答案）")
        st.caption("粘贴你认为正确的转录文本，用于计算 CER。留空则自动使用 ground_truth.json（如有）。")
        manual_ref = st.text_area(
            "正确答案文本",
            value=st.session_state.get("s2_ref_text", ""),
            height=120,
            placeholder="在此粘贴参考文本，例如：Okay, so let's get started. So before the break...",
            key="s2_ref_text_input",
            label_visibility="collapsed",
        )
        st.session_state["s2_ref_text"] = manual_ref

        # 优先用手动输入，否则回退 GT 文件
        if manual_ref.strip():
            ref_text = manual_ref.strip()
            st.caption(f"使用手动输入参考文本（{len(ref_text)} 字符）")
        else:
            gt_path = _gt_path()
            gt_data = _load_json(gt_path) if gt_path.exists() else {}
            ref_text = _gt_ref_text(gt_data) if gt_data else ""
            if ref_text:
                st.caption(f"使用 ground_truth.json 参考文本（{len(ref_text)} 字符）")
            else:
                st.caption("无参考文本，CER 不计算")

        _render_metrics_table(w_data, a_data, dur, ref_text)

        st.divider()

        # ── 文本并排对比 ──────────────────────────────────────────────────────
        st.markdown("#### 📝 转录文本并排对比")
        col_wt, col_at = st.columns(2)

        with col_wt:
            st.markdown("**Whisper**")
            if w_data:
                segs = w_data.get("sentences", [])
                _render_segments(segs)
            else:
                st.info("尚未运行")

        with col_at:
            st.markdown("**阿里云**")
            if a_data:
                segs = a_data.get("sentences", [])
                _render_segments(segs)
            else:
                st.info("尚未运行")

        # ── 设置为 Step 3 使用的 ASR 结果 ─────────────────────────────────────
        if whisper_done and aliyun_done:
            st.divider()
            st.markdown("#### ✅ 选择用于 Step 3 的 ASR 结果")
            commit_choice = st.radio(
                "哪个结果提交给 Step 3？",
                ["Whisper", "阿里云"],
                horizontal=True,
                key="s2_commit_choice",
            )
            if st.button("✅ 提交选中结果", key="btn_s2_commit"):
                src = whisper_path if commit_choice == "Whisper" else aliyun_path
                data = _load_json(src)
                _save_json(_asr_path(), data.get("sentences", []))
                _save_json(_asr_raw_path(), data.get("raw_segments", []))
                st.success(f"✅ 已将 **{commit_choice}** 的结果提交为 Step 3 输入（asr_segments.json）")


def _run_whisper(wav, dur, language, out_path):
    from services.asr import transcribe_openai
    t0 = time.time()
    with st.spinner("Whisper 转录中…"):
        sentences, raw_segments = transcribe_openai(str(wav), language=language)
    elapsed = time.time() - t0
    cost = (dur / 60) * WHISPER_COST_PER_MIN
    _save_json(out_path, {
        "engine": "whisper",
        "elapsed_s": round(elapsed, 2),
        "cost_usd": round(cost, 5),
        "duration_s": dur,
        "sentences": sentences,
        "raw_segments": raw_segments,
    })
    _log_run("asr_whisper", elapsed, cost=cost,
             extra={"n_sentences": len(sentences), "duration_s": dur})
    st.success(f"Whisper 完成 — {_badge(elapsed, cost=cost)} — {len(sentences)} sentences")


def _run_aliyun(wav, dur, language, out_path):
    from services.asr import transcribe_aliyun
    t0 = time.time()
    with st.spinner("阿里云 ASR 转录中（需上传 OSS，约 30–60s）…"):
        sentences, raw_segments = transcribe_aliyun(str(wav), language=language)
    elapsed = time.time() - t0
    cost = (dur / 60) * ALIYUN_COST_PER_MIN
    _save_json(out_path, {
        "engine": "aliyun",
        "elapsed_s": round(elapsed, 2),
        "cost_usd": round(cost, 5),
        "duration_s": dur,
        "sentences": sentences,
        "raw_segments": raw_segments,
    })
    _log_run("asr_aliyun", elapsed, cost=cost,
             extra={"n_sentences": len(sentences), "duration_s": dur})
    st.success(f"阿里云完成 — {_badge(elapsed, cost=cost)} — {len(sentences)} sentences")


def _render_metrics_table(w_data, a_data, dur, ref_text: str):
    rows = []

    def _row(label, w_val, a_val, better="low"):
        rows.append({"指标": label, "Whisper": w_val, "阿里云": a_val, "_better": better})

    # 延迟
    w_elapsed = w_data["elapsed_s"] if w_data else None
    a_elapsed = a_data["elapsed_s"] if a_data else None
    _row("延迟 (s)", f"{w_elapsed:.1f}" if w_elapsed else "—", f"{a_elapsed:.1f}" if a_elapsed else "—", better="low")

    # 成本
    w_cost = w_data["cost_usd"] if w_data else None
    a_cost = a_data["cost_usd"] if a_data else None
    _row("成本 (USD)", f"${w_cost:.5f}" if w_cost else "—", f"${a_cost:.5f}" if a_cost else "—", better="low")

    # 句段数
    w_n = len(w_data["sentences"]) if w_data else None
    a_n = len(a_data["sentences"]) if a_data else None
    _row("句段数", str(w_n) if w_n is not None else "—", str(a_n) if a_n is not None else "—", better="none")

    # 总字符数
    w_chars = sum(len(s["text"]) for s in w_data["sentences"]) if w_data else None
    a_chars = sum(len(s["text"]) for s in a_data["sentences"]) if a_data else None
    _row("总字符数", str(w_chars) if w_chars else "—", str(a_chars) if a_chars else "—", better="none")

    # CER（有 GT 时）
    if ref_text:
        w_cer = _compute_cer(ref_text, _segments_to_text(w_data["sentences"])) if w_data else None
        a_cer = _compute_cer(ref_text, _segments_to_text(a_data["sentences"])) if a_data else None
        _row("CER（字符错误率，↓越好）",
             f"{w_cer:.3f}" if w_cer is not None else "—",
             f"{a_cer:.3f}" if a_cer is not None else "—",
             better="low")

    # 渲染表格（用 metric 卡片形式）
    col_labels, col_w, col_a = st.columns([2, 1.5, 1.5])
    col_labels.markdown("**指标**")
    col_w.markdown("**Whisper**")
    col_a.markdown("**阿里云**")

    for row in rows:
        c1, c2, c3 = st.columns([2, 1.5, 1.5])
        c1.write(row["指标"])
        c2.write(row["Whisper"])
        c3.write(row["阿里云"])

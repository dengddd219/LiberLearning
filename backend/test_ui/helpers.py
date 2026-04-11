"""
Shared helpers, path functions, and constants for LiberStudy test platform.
"""
import asyncio
import json
import time
from pathlib import Path

import streamlit as st

# ── Cost constants ─────────────────────────────────────────────────────────────
WHISPER_COST_PER_MIN  = 0.006
EMBED_COST_PER_1M_TOK = 0.02
CLAUDE_INPUT_PER_1M   = 3.0
CLAUDE_OUTPUT_PER_1M  = 15.0

# ── Paths ──────────────────────────────────────────────────────────────────────
TEST_OUTPUT_BASE = Path(__file__).parent.parent / "test_output"
TEST_OUTPUT_BASE.mkdir(exist_ok=True)


def _get_current_run_id() -> str:
    return st.session_state.get("run_id") or "default"


def _get_run_dir(run_id: str = None) -> Path:
    rid = run_id or _get_current_run_id()
    d = TEST_OUTPUT_BASE / f"run_{rid}"
    d.mkdir(exist_ok=True)
    return d


def _get_slides_dir(run_id: str = None) -> Path:
    d = _get_run_dir(run_id) / "slides"
    d.mkdir(exist_ok=True)
    return d


def _list_runs() -> list[dict]:
    runs = []
    for d in sorted(TEST_OUTPUT_BASE.iterdir()):
        if d.is_dir() and d.name.startswith("run_"):
            log_file = d / "run_log.json"
            run_id = d.name[4:]
            ts = "unknown"
            n_steps = 0
            cost = 0.0
            if log_file.exists():
                try:
                    log = _load_json(log_file)
                    if log:
                        ts = log[0].get("ts", "unknown")
                        cost = sum(r.get("cost_usd", 0) for r in log)
                        n_steps = len(log)
                except Exception:
                    pass
            note = ""
            meta_file = d / "meta.json"
            if meta_file.exists():
                try:
                    note = _load_json(meta_file).get("note", "")
                except Exception:
                    pass
            runs.append({"run_id": run_id, "ts": ts, "cost": cost, "n_steps": n_steps, "note": note})
    return sorted(runs, key=lambda r: r["ts"], reverse=True)


def _save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ── Per-run path helpers ───────────────────────────────────────────────────────
def _wav_path():     return _get_run_dir() / "test_audio_10min.wav"
def _asr_path():     return _get_run_dir() / "asr_segments.json"
def _aligned_path(): return _get_run_dir() / "aligned_pages.json"
def _ppt_path():     return _get_run_dir() / "ppt_pages.json"
def _gt_path():      return TEST_OUTPUT_BASE / "ground_truth.json"
def _judge_path():   return TEST_OUTPUT_BASE / "judge_scores.json"
def _log_path():     return _get_run_dir() / "run_log.json"
def _slides_dir():   return _get_slides_dir()
def _notes_cache(tmpl, gran):
    return _get_run_dir() / f"notes_{tmpl}_{gran}.json"


# ── UI helpers ─────────────────────────────────────────────────────────────────
def _badge(elapsed: float, tokens: int = 0, cost: float = 0.0) -> str:
    parts = [f"⏱ {elapsed:.1f}s"]
    if tokens:
        parts.append(f"🔢 {tokens:,} tokens")
    if cost:
        parts.append(f"💰 ${cost:.4f}")
    return "  |  ".join(parts)


def _confidence_color(score: float) -> str:
    if score >= 0.6:
        return "🟢"
    elif score >= 0.3:
        return "🟡"
    return "🔴"


def _run_sync(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _log_run(step: str, elapsed: float, tokens: int = 0, cost: float = 0.0, extra: dict = None):
    log = _load_json(_log_path()) if _log_path().exists() else []
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "step": step,
        "elapsed_s": round(elapsed, 2),
        "tokens": tokens,
        "cost_usd": round(cost, 6),
    }
    if extra:
        record.update(extra)
    log.append(record)
    _save_json(_log_path(), log)


def _render_bullets(bullets: list[dict]):
    for b in bullets:
        ppt_b   = b.get("ppt_bullet", b.get("text", ""))
        comment = b.get("ai_comment", "")
        ts      = b.get("timestamp_start", b.get("timestamp", -1))
        te      = b.get("timestamp_end", -1)
        excerpt = b.get("transcript_excerpt", "")

        ts_str = ""
        if ts is not None and ts >= 0:
            ts_str = f" `[{ts//60:02d}:{ts%60:02d}"
            if te and te >= 0:
                ts_str += f"–{te//60:02d}:{te%60:02d}"
            ts_str += "]`"

        st.markdown(f"- **{ppt_b}**{ts_str}")
        if comment and comment != "(not covered in lecture)":
            st.markdown(f"  > {comment}")
        if excerpt:
            st.caption(f'  _"{excerpt[:100]}"_')


def _render_notes(notes: list[dict], tmpl: str):
    for pg in notes:
        page_num = pg.get("page_num", "?")
        conf     = pg.get("alignment_confidence", 0)
        icon     = _confidence_color(conf)
        with st.container():
            st.markdown(f"### {icon} Slide {page_num}")
            passive = pg.get("passive_notes")
            if passive:
                if passive.get("error"):
                    st.error(passive["error"])
                else:
                    _render_bullets(passive.get("bullets", []))
                    if passive.get("page_summary"):
                        st.info(passive["page_summary"])
            active = pg.get("active_notes")
            if active and active.get("ai_expansion"):
                st.markdown("**Active expansion:**")
                st.markdown(active["ai_expansion"])
            if pg.get("page_supplement"):
                st.caption(f"📎 Off-slide: {pg['page_supplement']['content'][:100]}…")
            st.divider()


def _build_noppt_pages(segments: list[dict], chunk_size: int = 10) -> list[dict]:
    pages = []
    for i in range(0, len(segments), chunk_size):
        chunk = segments[i:i + chunk_size]
        pages.append({
            "page_num": i // chunk_size + 1,
            "ppt_text": "",
            "pdf_url": "",
            "pdf_page_num": i // chunk_size + 1,
            "aligned_segments": chunk,
            "page_start_time": chunk[0]["start"],
            "page_end_time": chunk[-1]["end"],
            "alignment_confidence": 1.0,
            "page_supplement": None,
        })
    return pages


def _build_markdown(notes: list[dict], template: str, has_ppt: bool) -> str:
    lines = [f"# LiberStudy Notes\n\n_Template: {template}_\n"]
    for pg in notes:
        page_num = pg.get("page_num", "?")
        title    = f"Slide {page_num}" if has_ppt else f"Topic {page_num}"
        ts = int(pg.get("page_start_time", 0))
        te = int(pg.get("page_end_time", 0))
        lines.append(f"\n## {title} [{ts//60:02d}:{ts%60:02d}–{te//60:02d}:{te%60:02d}]\n")

        passive = pg.get("passive_notes")
        if passive and not passive.get("error"):
            for b in passive.get("bullets", []):
                ppt_b   = b.get("ppt_bullet", b.get("text", ""))
                comment = b.get("ai_comment", "")
                bts = b.get("timestamp_start", -1)
                bte = b.get("timestamp_end", -1)
                ts_tag = ""
                if bts is not None and bts >= 0:
                    ts_tag = f" `[{bts//60:02d}:{bts%60:02d}"
                    if bte and bte >= 0:
                        ts_tag += f"–{bte//60:02d}:{bte%60:02d}"
                    ts_tag += "]`"
                lines.append(f"- **{ppt_b}**{ts_tag}")
                if comment:
                    lines.append(f"  > {comment}")
            if passive.get("page_summary"):
                lines.append(f"\n_{passive['page_summary']}_")

        active = pg.get("active_notes")
        if active and active.get("ai_expansion"):
            lines.append(f"\n**My Note Expansion:**\n{active['ai_expansion']}")

        if pg.get("page_supplement"):
            lines.append(f"\n> 📎 Off-slide: {pg['page_supplement']['content']}")

    return "\n".join(lines)


def _build_pdf(notes: list[dict], template: str, has_ppt: bool) -> bytes:
    try:
        from fpdf import FPDF
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, "LiberStudy Notes", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, f"Template: {template}", ln=True)
        pdf.ln(4)
        for pg in notes:
            page_num = pg.get("page_num", "?")
            title    = f"Slide {page_num}" if has_ppt else f"Topic {page_num}"
            pdf.set_font("Helvetica", "B", 13)
            pdf.cell(0, 8, title, ln=True)
            passive = pg.get("passive_notes")
            if passive and not passive.get("error"):
                for b in passive.get("bullets", []):
                    ppt_b   = b.get("ppt_bullet", b.get("text", ""))
                    comment = b.get("ai_comment", "")
                    safe_b  = ppt_b.encode("latin-1", "replace").decode("latin-1")
                    safe_c  = comment.encode("latin-1", "replace").decode("latin-1")
                    pdf.set_font("Helvetica", "B", 10)
                    pdf.multi_cell(0, 6, f"- {safe_b}")
                    if safe_c:
                        pdf.set_font("Helvetica", "I", 9)
                        pdf.multi_cell(0, 5, f"  {safe_c}")
            pdf.ln(3)
        return pdf.output()
    except ImportError:
        st.error("fpdf2 not installed. Run: pip install fpdf2")
        return b""


def _render_accuracy_table(segments, ppt_pages, aligned, gt_data):
    labeled = {int(k.split("_")[1]): v for k, v in gt_data.items()}
    seg_to_page_A = {}
    for pg in aligned:
        for s in pg.get("aligned_segments", []):
            for i, seg in enumerate(segments):
                if abs(seg["start"] - s["start"]) < 0.1:
                    seg_to_page_A[i] = pg["page_num"]

    n = len(labeled)
    correct_A = sum(1 for idx, gt in labeled.items()
                    if seg_to_page_A.get(idx) == gt["page_num"])

    import pandas as pd
    df = pd.DataFrame([
        {"Method": "A — Embedding only",
         "Page Accuracy": f"{correct_A}/{n} ({100*correct_A/max(n,1):.0f}%)",
         "Bullet Accuracy": "N/A",
         "Note": "No bullet-level prediction"},
        {"Method": "B — LLM only",
         "Page Accuracy": "—", "Bullet Accuracy": "—",
         "Note": "Run LLM alignment to compute"},
        {"Method": "C — Emb + LLM",
         "Page Accuracy": "—", "Bullet Accuracy": "—",
         "Note": "Run combined alignment to compute"},
    ])
    st.dataframe(df, use_container_width=True, hide_index=True)
    st.caption(f"Based on {n} labeled segments.")

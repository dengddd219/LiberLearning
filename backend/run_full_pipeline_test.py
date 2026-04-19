"""
Full pipeline test script - end-to-end timing benchmark
Usage: python run_full_pipeline_test.py
"""
import sys, os, time, json, shutil, traceback
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# 路径
AUDIO_PATH = "C:/Users/19841/Desktop/github/Liberstudy-test/DL/test/test1 LLM C3/GMT20260206-103304_Recording(1)_5min.m4a"
PPT_PATH   = "C:/Users/19841/Desktop/github/Liberstudy-test/DL/test/test1 LLM C3/lec3_38-56.pdf"
WORK_DIR   = Path("static/test_run_tmp")
SLIDES_DIR = str(WORK_DIR / "slides")

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent)

from dotenv import load_dotenv
load_dotenv()

# ── 颜色输出 ─────────────────────────────────────────────
def c(text, code): return f"\033[{code}m{text}\033[0m"
def ok(s):  print(c(f"  ✓ {s}", "32"))
def err(s): print(c(f"  ✗ {s}", "31"))
def hdr(s): print(c(f"\n{'='*60}\n{s}\n{'='*60}", "36"))
def row(label, val): print(f"  {label:<35} {val}")

results = {}

def timed(label):
    class _T:
        def __enter__(self):
            self._t = time.time()
            return self
        def __exit__(self, *a):
            self.elapsed = round(time.time() - self._t, 2)
            results[label] = self.elapsed
            status = "ok" if a[1] is None else "error"
            if status == "ok":
                ok(f"{label}: {self.elapsed}s")
            else:
                err(f"{label}: FAILED after {self.elapsed}s")
    return _T()

# ── 准备目录 ─────────────────────────────────────────────
WORK_DIR.mkdir(parents=True, exist_ok=True)
(WORK_DIR / "slides").mkdir(parents=True, exist_ok=True)

hdr("STEP 0 — 环境 & 文件检查")
print(f"  音频: {AUDIO_PATH}")
print(f"  PPT:  {PPT_PATH}")
audio_exists = Path(AUDIO_PATH).exists()
ppt_exists   = Path(PPT_PATH).exists()
print(f"  音频文件存在: {audio_exists}")
print(f"  PPT文件存在:  {ppt_exists}")
if not audio_exists:
    err("音频文件不存在，退出")
    sys.exit(1)

# ── STEP 1: 音频转换 ─────────────────────────────────────
hdr("STEP 1 — 音频格式转换 (m4a → WAV 16kHz)")
from services.audio import convert_to_wav, get_audio_duration
wav_path = str(WORK_DIR / "audio.wav")
try:
    with timed("step1_audio_convert"):
        convert_to_wav(AUDIO_PATH, wav_path)
    with timed("step1_get_duration"):
        duration = get_audio_duration(wav_path)
    row("音频时长 (秒)", f"{duration:.1f}s ({duration/60:.1f} min)")
    wav_size_mb = Path(wav_path).stat().st_size / 1024**2
    row("WAV 文件大小", f"{wav_size_mb:.1f} MB")
    m4a_size_mb = Path(AUDIO_PATH).stat().st_size / 1024**2
    row("原始 m4a 大小", f"{m4a_size_mb:.1f} MB")
    row("体积膨胀比", f"{wav_size_mb/m4a_size_mb:.1f}x")
except Exception as e:
    err(f"音频转换失败: {e}")
    traceback.print_exc()
    sys.exit(1)

# ── STEP 2: PPT 解析 ──────────────────────────────────────
hdr("STEP 2 — PPT/PDF 解析")
ppt_pages = []
if ppt_exists:
    from services.ppt_parser import parse_ppt
    try:
        with timed("step2_ppt_parse"):
            ppt_pages = parse_ppt(PPT_PATH, SLIDES_DIR, pdf_name="slides_test.pdf")
        row("解析页数", len(ppt_pages))
        total_text = sum(len(p.get("ppt_text","")) for p in ppt_pages)
        row("PPT 总文本长度", f"{total_text} chars")
        for i, p in enumerate(ppt_pages[:3]):
            row(f"  页{p['page_num']} 文本预览", repr(p.get("ppt_text","")[:60]))
    except Exception as e:
        err(f"PPT 解析失败: {e}")
        traceback.print_exc()
        ppt_pages = []
else:
    print("  无PPT，跳过")

# ── STEP 3: ASR 转录 ──────────────────────────────────────
hdr("STEP 3 — ASR 转录 (阿里云)")
from services.asr import transcribe
import settings as _settings
print(f"  引擎: {_settings.ASR_ENGINE}")
try:
    with timed("step3_asr") as t:
        segments, raw_segments = transcribe(wav_path, language="en")
    row("句段数 (处理后)", len(segments))
    row("原始 segments", len(raw_segments))
    total_chars = sum(len(s.get("text","")) for s in segments)
    row("总转录字符数", f"{total_chars} chars")
    if duration > 0:
        row("RTF (实时率)", f"{results.get('step3_asr',0)/duration:.3f}x (越小越好)")
    # 前3段预览
    for s in segments[:3]:
        print(f"    [{s.get('start',0):.1f}s-{s.get('end',0):.1f}s] {s.get('text','')[:60]}")
except Exception as e:
    err(f"ASR 失败: {e}")
    traceback.print_exc()
    segments, raw_segments = [], []

# ── STEP 4: 语义对齐 ──────────────────────────────────────
hdr("STEP 4 — 语义对齐 (embedding cosine)")
print(f"  对齐版本: {_settings.ALIGNMENT_VERSION}")
aligned_pages = []
if ppt_pages and segments:
    try:
        align_module = _settings.get_alignment_module()
        with timed("step4_alignment") as t:
            aligned_pages = align_module.build_page_timeline(
                ppt_pages=ppt_pages, segments=segments,
                user_anchors=[], total_audio_duration=duration,
            )
        row("对齐后页数", len(aligned_pages))
        for p in aligned_pages:
            pd = p if isinstance(p, dict) else p.model_dump()
            segs = pd.get("aligned_segments", [])
            conf = pd.get("alignment_confidence", 0)
            print(f"    页{pd['page_num']}: {len(segs)}段, 置信度={conf:.2f}, "
                  f"时间=[{pd.get('page_start_time',0):.0f}s-{pd.get('page_end_time',0):.0f}s]")
    except Exception as e:
        err(f"对齐失败: {e}")
        traceback.print_exc()
elif not ppt_pages:
    print("  无PPT页面，跳过对齐")
elif not segments:
    print("  无ASR结果，跳过对齐")

# ── STEP 5: 笔记生成 ──────────────────────────────────────
hdr("STEP 5 — LLM 笔记生成 (Claude)")
print(f"  Provider: {_settings.NOTE_PROVIDER}")
print(f"  Model: {_settings.NOTE_MODEL}")
print(f"  Template: {_settings.NOTE_PASSIVE_TEMPLATE}")
print(f"  Granularity: {_settings.NOTE_GRANULARITY}")

import asyncio
from services.note_generator import generate_notes_for_all_pages

aligned_page_dicts = []
if aligned_pages:
    aligned_page_dicts = [p if isinstance(p, dict) else p.model_dump() for p in aligned_pages]
elif ppt_pages:
    aligned_page_dicts = ppt_pages

def _extract_ppt_bullets(ppt_text):
    return [l.strip() for l in ppt_text.splitlines() if l.strip()] or ["(no slide text)"]

def _make_placeholder(page_dict):
    return {
        **page_dict, "status": "ready",
        "passive_notes": {"bullets": [{"ppt_text": b, "level": 0, "ai_comment": "本页无对应课堂讲解录音，以下内容仅基于 PPT 文本整理。", "timestamp_start": -1, "timestamp_end": -1} for b in _extract_ppt_bullets(page_dict.get("ppt_text", ""))]},
        "active_notes": None, "_cost": {"input_tokens": 0, "output_tokens": 0},
    }

pages_with_audio    = [p for p in aligned_page_dicts if p.get("aligned_segments")]
pages_without_audio = [p for p in aligned_page_dicts if not p.get("aligned_segments")]
row("有音频覆盖页数", len(pages_with_audio))
row("无音频覆盖页数（placeholder）", len(pages_without_audio))

generated_pages = []

async def run_notes():
    placeholders = [_make_placeholder(p) for p in pages_without_audio]
    llm_results = await generate_notes_for_all_pages(
        pages_with_audio, provider=_settings.NOTE_PROVIDER,
    ) if pages_with_audio else []
    all_noted = {p["page_num"]: p for p in placeholders}
    all_noted.update({p["page_num"]: p for p in llm_results})
    for pd in aligned_page_dicts:
        generated_pages.append(all_noted[pd["page_num"]])

try:
    with timed("step5_notes_total"):
        asyncio.run(run_notes())
    for gp in generated_pages:
        bullets = (gp.get("passive_notes") or {}).get("bullets", [])
        ai_chars = sum(len(b.get("ai_comment") or "") for b in bullets)
        tag = "[placeholder]" if not gp.get("_cost", {}).get("input_tokens") else "[LLM]"
        row(f"  页{gp['page_num']} {tag}", f"{len(bullets)} bullets, {ai_chars} ai_chars")
except Exception as e:
    err(f"笔记生成失败: {e}")
    traceback.print_exc()

# ── 总结 ──────────────────────────────────────────────────
hdr("SUMMARY — 全流程时间汇总")
total = sum(results.values())
for k, v in results.items():
    pct = v/total*100 if total > 0 else 0
    row(k, f"{v:>6.2f}s  ({pct:.0f}%)")
print()
row("全流程总耗时", f"{total:.2f}s")
if duration > 0:
    row("音频时长 / 流程耗时比", f"{duration:.0f}s / {total:.2f}s = {total/duration:.2f}x (>1 慢于实时)")

# 保存 JSON 报告
report = {
    "audio_path": AUDIO_PATH,
    "ppt_path": PPT_PATH,
    "audio_duration_s": duration if 'duration' in dir() else 0,
    "num_ppt_pages": len(ppt_pages),
    "num_segments": len(segments),
    "num_aligned_pages": len(aligned_pages),
    "step_timings": results,
    "total_elapsed_s": total,
    "note_latencies_per_page": [],
    "config": {
        "asr_engine": _settings.ASR_ENGINE,
        "alignment_version": _settings.ALIGNMENT_VERSION,
        "note_provider": _settings.NOTE_PROVIDER,
        "note_model": _settings.NOTE_MODEL,
    }
}
report_path = WORK_DIR / "pipeline_test_report.json"
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
ok(f"报告已保存: {report_path}")

# 清理临时 slides 目录（可选）
# shutil.rmtree(WORK_DIR, ignore_errors=True)

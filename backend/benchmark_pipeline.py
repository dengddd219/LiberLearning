"""
全流程耗时基准测试 — 直接调用各 service，打印每步耗时。
用法：cd backend && python benchmark_pipeline.py
"""
import asyncio
import sys
import time
import shutil
import tempfile
from pathlib import Path

AUDIO_SRC = r"C:\Users\19841\Desktop\github\Liberstudy-test\DL\test\test1 LLM C3\GMT20260206-103304_Recording(1).m4a"
PDF_SRC   = r"C:\Users\19841\Desktop\github\Liberstudy-test\DL\test\test1 LLM C3\lec3_38-56.pdf"
LANGUAGE  = "en"

SEP = "─" * 60

def tick(label: str, t0: float) -> float:
    elapsed = time.perf_counter() - t0
    print(f"  OK  {label:<30} {elapsed:6.1f}s")
    return elapsed

async def main():
    print(SEP)
    print("LiberStudy 全流程耗时基准测试")
    print(SEP)

    # 准备临时目录
    session_dir = Path(tempfile.mkdtemp(prefix="liberbench_"))
    print(f"  工作目录: {session_dir}\n")

    total_start = time.perf_counter()
    timings: dict[str, float] = {}

    # ── Step 0: 文件复制（模拟上传写盘）─────────────────────────────
    print("[ Step 0 ] 文件写盘（模拟上传）")
    t0 = time.perf_counter()
    audio_raw = session_dir / "audio_raw.m4a"
    pdf_path  = session_dir / "lec3.pdf"
    shutil.copy2(AUDIO_SRC, audio_raw)
    shutil.copy2(PDF_SRC,   pdf_path)
    timings["0_upload_write"] = tick("文件写盘", t0)

    # ── Step 1: 音频转换 ──────────────────────────────────────────────
    print("\n[ Step 1 ] 音频格式转换 (FFmpeg → WAV)")
    from services.audio import convert_to_wav, get_audio_duration
    t0 = time.perf_counter()
    wav_path = str(session_dir / "audio.wav")
    convert_to_wav(str(audio_raw), wav_path)
    timings["1_convert"] = tick("FFmpeg 转 WAV", t0)

    t0 = time.perf_counter()
    duration = get_audio_duration(wav_path)
    timings["1_duration"] = tick(f"获取时长 ({duration:.0f}s / {duration/60:.1f}min)", t0)

    # ── Step 2: PPT 解析 ──────────────────────────────────────────────
    print("\n[ Step 2 ] PPT/PDF 解析 (PyMuPDF)")
    from services.ppt_parser import parse_ppt
    slides_dir = str(session_dir / "slides")
    t0 = time.perf_counter()
    ppt_pages = parse_ppt(str(pdf_path), slides_dir, pdf_name="bench_slides.pdf")
    timings["2_ppt_parse"] = tick(f"PPT 解析 ({len(ppt_pages)} 页)", t0)

    # ── Step 3: ASR 转录 ──────────────────────────────────────────────
    print("\n[ Step 3 ] ASR 转录 (Whisper API)")
    from services.asr import transcribe
    t0 = time.perf_counter()
    segments, _raw = transcribe(wav_path, language=LANGUAGE)
    timings["3_asr"] = tick(f"ASR ({len(segments)} segments)", t0)

    # ── Step 4: 语义对齐 ──────────────────────────────────────────────
    print("\n[ Step 4 ] 语义对齐 (Embedding + 对齐算法)")
    import settings as _settings
    align_module = _settings.get_alignment_module()
    t0 = time.perf_counter()
    aligned_pages = align_module.build_page_timeline(
        ppt_pages=ppt_pages,
        segments=segments,
        user_anchors=[],
        total_audio_duration=duration,
    )
    timings["4_align"] = tick(f"语义对齐 ({len(aligned_pages)} 页)", t0)

    # ── Step 5: LLM 笔记生成 ──────────────────────────────────────────
    print("\n[ Step 5 ] LLM 笔记生成 (Claude)")
    from services.note_generator import generate_notes_for_all_pages
    t0 = time.perf_counter()
    generated = await generate_notes_for_all_pages(
        aligned_pages,
        provider=_settings.NOTE_PROVIDER,
    )
    timings["5_notes"] = tick(f"笔记生成 ({len(generated)} 页)", t0)

    # ── 汇总 ──────────────────────────────────────────────────────────
    total = time.perf_counter() - total_start
    print(f"\n{SEP}")
    print("耗时汇总")
    print(SEP)
    labels = {
        "0_upload_write": "文件写盘（上传）",
        "1_convert":      "音频转换 (FFmpeg)",
        "1_duration":     "音频时长检测",
        "2_ppt_parse":    "PPT 解析",
        "3_asr":          "ASR 转录",
        "4_align":        "语义对齐",
        "5_notes":        "LLM 笔记生成",
    }
    for key, label in labels.items():
        t = timings.get(key, 0)
        bar = "#" * int(t / total * 40)
        pct = t / total * 100
        print(f"  {label:<20} {t:6.1f}s  {pct:4.1f}%  {bar}")
    print(f"  {'─'*20}  {'─'*6}  {'─'*5}")
    print(f"  {'总计':<20} {total:6.1f}s  100%")
    print(SEP)

    # 清理
    shutil.rmtree(session_dir, ignore_errors=True)

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    # Load .env so API keys are available
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent / ".env")
    except ImportError:
        pass
    asyncio.run(main())

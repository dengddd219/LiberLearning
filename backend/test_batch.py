"""
LiberStudy — Batch Testing Entry Point
Run: cd backend && ..\.venv\Scripts\python test_batch.py

Each test case is a dict:
  {"audio": "<path>", "ppt": "<path>", "label": "<name>"}

Results written to test_output/batch_results.json
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

TEST_OUTPUT = Path(__file__).parent.parent / "test_output" / "batch"
TEST_OUTPUT.mkdir(parents=True, exist_ok=True)

# ── Define your test cases here ───────────────────────────────────────────────
TEST_CASES = [
    # {
    #     "label": "DL_lec3",
    #     "audio": r"C:/Users/19841/Desktop/github/Liberstudy-test/DL/test/test1 LLM C3/test.m4a",
    #     "ppt":   r"C:/Users/19841/Desktop/github/Liberstudy-test/DL/test/test1 LLM C3/lec3_63-115.pdf",
    #     "language": "en",
    # },
]

TEMPLATES = [
    ("passive_ppt_notes",       "simple"),
    ("passive_outline_summary", "simple"),
]


async def run_case(case: dict) -> dict:
    from services.audio import convert_to_wav, get_audio_duration
    from services.asr import transcribe_openai
    from services.ppt_parser import parse_ppt
    from services.alignment import build_page_timeline
    from services.note_generator import generate_notes_for_all_pages

    label    = case["label"]
    language = case.get("language", "en")
    result   = {"label": label, "steps": {}}

    case_dir = TEST_OUTPUT / label
    case_dir.mkdir(exist_ok=True)
    slides_dir = case_dir / "slides"
    slides_dir.mkdir(exist_ok=True)
    wav_path = case_dir / "audio.wav"

    # Step 0: Convert audio
    t0 = time.time()
    convert_to_wav(case["audio"], str(wav_path))
    dur = get_audio_duration(str(wav_path))
    result["steps"]["audio"] = {"duration_s": dur, "elapsed_s": time.time() - t0}
    print(f"[{label}] Step 0 done: {dur:.1f}s audio")

    # Step 1: Parse PPT
    t0 = time.time()
    pages_meta = parse_ppt(case["ppt"], str(slides_dir))
    result["steps"]["ppt"] = {"n_pages": len(pages_meta), "elapsed_s": time.time() - t0}
    print(f"[{label}] Step 1 done: {len(pages_meta)} slides")

    # Step 2: ASR
    t0 = time.time()
    segments = transcribe_openai(str(wav_path), language=language)
    result["steps"]["asr"] = {
        "n_segments": len(segments),
        "cost_usd": (dur / 60) * 0.006,
        "elapsed_s": time.time() - t0,
    }
    print(f"[{label}] Step 2 done: {len(segments)} segments")

    # Step 3: Alignment
    t0 = time.time()
    aligned = build_page_timeline(pages_meta, segments, total_audio_duration=dur)
    result["steps"]["alignment"] = {
        "avg_confidence": sum(p.get("alignment_confidence", 0) for p in aligned) / max(len(aligned), 1),
        "elapsed_s": time.time() - t0,
    }
    print(f"[{label}] Step 3 done")

    # Step 4: Note generation (all templates)
    result["steps"]["notes"] = {}
    for template, granularity in TEMPLATES:
        t0 = time.time()
        notes = await generate_notes_for_all_pages(aligned, template=template, granularity=granularity)
        (case_dir / f"notes_{template}_{granularity}.json").write_text(
            json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        total_in  = sum(p.get("_cost", {}).get("input_tokens", 0) for p in notes)
        total_out = sum(p.get("_cost", {}).get("output_tokens", 0) for p in notes)
        result["steps"]["notes"][f"{template}/{granularity}"] = {
            "input_tokens": total_in,
            "output_tokens": total_out,
            "cost_usd": total_in / 1e6 * 3.0 + total_out / 1e6 * 15.0,
            "elapsed_s": time.time() - t0,
        }
        print(f"[{label}] Notes {template}/{granularity} done")

    return result


async def main():
    if not TEST_CASES:
        print("No test cases defined. Edit TEST_CASES in test_batch.py.")
        return

    all_results = []
    for case in TEST_CASES:
        print(f"\n=== Running: {case['label']} ===")
        r = await run_case(case)
        all_results.append(r)

    out_path = TEST_OUTPUT / "batch_results.json"
    out_path.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResults saved to {out_path}")

    # Summary table
    print("\n--- Summary ---")
    print(f"{'Label':<20} {'Pages':>6} {'Segments':>9} {'Avg Conf':>9} {'Cost $':>8}")
    for r in all_results:
        label  = r["label"]
        pages  = r["steps"].get("ppt", {}).get("n_pages", "?")
        segs   = r["steps"].get("asr", {}).get("n_segments", "?")
        conf   = r["steps"].get("alignment", {}).get("avg_confidence", 0)
        notes_cost = sum(
            v.get("cost_usd", 0)
            for v in r["steps"].get("notes", {}).values()
        )
        asr_cost = r["steps"].get("asr", {}).get("cost_usd", 0)
        total_cost = notes_cost + asr_cost
        print(f"{label:<20} {pages:>6} {segs:>9} {conf:>9.2f} {total_cost:>8.4f}")


if __name__ == "__main__":
    asyncio.run(main())

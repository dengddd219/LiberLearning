"""
Pipeline benchmark script.
Usage: python benchmark.py
Requires backend to be running at http://localhost:8000
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

import aiohttp

BASE_URL = "http://localhost:8000/api"

PDF_PATH = r"C:\Users\19841\Desktop\github\Liberstudy-test\DL\test\test1 LLM C3\lec3_38-56.pdf"
AUDIO_PATH = r"C:\Users\19841\Desktop\github\Liberstudy-test\DL\test\test1 LLM C3\GMT20260206-103304_Recording_2560x1920.mp4"

OUTPUT_DIR = Path(__file__).parent / "benchmark_results"
OUTPUT_DIR.mkdir(exist_ok=True)


async def run_benchmark():
    report = {
        "run_at": datetime.now().isoformat(),
        "input": {"audio": AUDIO_PATH, "pdf": PDF_PATH},
        "timeline": {},
        "steps": {},
        "pages": [],
        "issues": [],
    }

    async with aiohttp.ClientSession() as session:
        # ── Step 0: Upload files via POST /api/process ──────────────────────
        print("[1/3] 上传文件...")
        t_upload_start = time.time()

        pdf_bytes = Path(PDF_PATH).read_bytes()
        audio_bytes = Path(AUDIO_PATH).read_bytes()

        data = aiohttp.FormData()
        data.add_field("ppt", pdf_bytes, filename="slides.pdf", content_type="application/pdf")
        data.add_field("audio", audio_bytes, filename="recording.mp4", content_type="video/mp4")
        data.add_field("language", "zh")

        async with session.post(f"{BASE_URL}/process", data=data) as resp:
            if resp.status != 200:
                body = await resp.text()
                print(f"[ERROR] POST /api/process 失败 {resp.status}: {body}")
                return
            result = await resp.json()

        session_id = result.get("session_id")
        t_upload_done = time.time()
        upload_s = round(t_upload_done - t_upload_start, 2)
        report["timeline"]["t0_upload_done"] = upload_s
        print(f"  session_id: {session_id}  上传耗时: {upload_s}s")

        # ── Step 1: 监听 SSE 事件 ────────────────────────────────────────────
        print("[2/3] 监听 SSE 事件...")
        t0 = t_upload_done  # 以上传完成作为起点

        page_ready_times = []
        last_event_time = t0

        async with session.get(f"{BASE_URL}/sessions/{session_id}/events") as sse_resp:
            async for line in sse_resp.content:
                line = line.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                raw = line[len("data:"):].strip()
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                now = time.time()
                elapsed = round(now - t0, 2)
                event_type = event.get("event", "unknown")

                if event_type == "ppt_parsed":
                    report["timeline"]["t1_ppt_parsed"] = elapsed
                    report["steps"]["step1_2_audio_ppt"] = {
                        "duration_s": elapsed,
                        "note": "Step1(音频转换) + Step2(PPT解析) 并行完成",
                    }
                    print(f"  [{elapsed:6.1f}s] ppt_parsed")

                elif event_type == "asr_done":
                    t1 = report["timeline"].get("t1_ppt_parsed", elapsed)
                    report["timeline"]["t2_asr_done"] = elapsed
                    report["steps"]["step3_4_asr_align"] = {
                        "duration_s": round(elapsed - t1, 2),
                        "note": "Step3(ASR转录) + Step4(语义对齐) 串行完成",
                    }
                    data_payload = event.get("data", {})
                    if data_payload:
                        report["steps"]["step3_4_asr_align"]["segments"] = data_payload.get("segments_count")
                    print(f"  [{elapsed:6.1f}s] asr_done")

                elif event_type == "page_ready":
                    page_data = event.get("data", {})
                    page_num = page_data.get("page_num", len(page_ready_times) + 1)
                    interval = round(now - last_event_time, 2)
                    page_ready_times.append({
                        "page_num": page_num,
                        "elapsed_s": elapsed,
                        "interval_since_prev_s": interval,
                    })
                    last_event_time = now
                    print(f"  [{elapsed:6.1f}s] page_ready  page={page_num}  间隔={interval}s")

                elif event_type == "all_done":
                    report["timeline"]["t3_all_done"] = elapsed
                    t2_asr = report["timeline"].get("t2_asr_done", elapsed)
                    report["steps"]["step5_notes"] = {
                        "duration_s": round(elapsed - t2_asr, 2),
                        "first_page_s": page_ready_times[0]["elapsed_s"] - t2_asr if page_ready_times else None,
                        "page_ready_timeline": page_ready_times,
                        "pages_done": len(page_ready_times),
                    }
                    report["total_duration_s"] = elapsed
                    print(f"  [{elapsed:6.1f}s] all_done  总耗时: {elapsed}s")
                    break

                elif event_type == "error":
                    err_msg = event.get("data", {}).get("message", str(event))
                    report["issues"].append(f"pipeline error: {err_msg}")
                    print(f"  [{elapsed:6.1f}s] ERROR: {err_msg}")
                    break

        # ── Step 2: 拉取笔记内容评估质量 ────────────────────────────────────
        print("[3/3] 拉取笔记内容...")
        async with session.get(f"{BASE_URL}/sessions/{session_id}") as s_resp:
            if s_resp.status == 200:
                session_data = await s_resp.json()
                pages = session_data.get("pages", [])
                for p in pages:
                    pn = p.get("page_num")
                    passive = p.get("passive_notes") or {}
                    bullets = passive.get("bullets", [])
                    active = p.get("active_notes")
                    ppt_text = p.get("ppt_text", "")
                    aligned_segs = p.get("aligned_segments", [])

                    page_quality = {
                        "page_num": pn,
                        "status": p.get("status"),
                        "ppt_chars": len(ppt_text),
                        "aligned_segments": len(aligned_segs),
                        "alignment_confidence": p.get("alignment_confidence"),
                        "passive_bullets": len(bullets),
                        "passive_total_chars": sum(len(b.get("ai_comment") or "") for b in bullets),
                        "has_active_notes": active is not None,
                        "has_supplement": p.get("page_supplement") is not None,
                    }
                    if passive.get("error"):
                        page_quality["error"] = passive["error"]
                        report["issues"].append(f"page {pn} notes error: {passive['error']}")

                    report["pages"].append(page_quality)
            else:
                report["issues"].append(f"GET /sessions/{session_id} 返回 {s_resp.status}")

    # ── 写报告 ───────────────────────────────────────────────────────────────
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    out_path = OUTPUT_DIR / f"{ts}_report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已写入: {out_path}")

    # ── 打印摘要 ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 50)
    print("BENCHMARK 摘要")
    print("=" * 50)
    tl = report["timeline"]
    steps = report["steps"]

    if "step1_2_audio_ppt" in steps:
        print(f"Step1+2 (音频+PPT并行):  {steps['step1_2_audio_ppt']['duration_s']}s")
    if "step3_4_asr_align" in steps:
        print(f"Step3+4 (ASR+对齐串行):  {steps['step3_4_asr_align']['duration_s']}s")
    if "step5_notes" in steps:
        s5 = steps["step5_notes"]
        print(f"Step5   (笔记生成并发):  {s5['duration_s']}s  首页: {s5.get('first_page_s')}s  共{s5['pages_done']}页")
    print(f"总耗时:                  {report.get('total_duration_s', '?')}s")
    if report["issues"]:
        print(f"\n问题 ({len(report['issues'])} 个):")
        for iss in report["issues"]:
            print(f"  - {iss}")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(run_benchmark())

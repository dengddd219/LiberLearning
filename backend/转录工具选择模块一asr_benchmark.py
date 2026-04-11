"""
ASR Engine Benchmark
====================
Runs the same audio file through multiple ASR engines and outputs:
  - Full transcription text per engine
  - WER against a ground truth transcript (if provided)
  - Latency per engine
  - Estimated cost per engine

Usage:
    cd backend
    python asr_benchmark.py --audio test_documents/lec01/test_audio_10min.wav --lang en
    python asr_benchmark.py --audio test_documents/lec01/test_audio_10min.wav --lang en --ground-truth ground_truth.txt
    python asr_benchmark.py --audio test_documents/lec01/test_audio_10min.wav --lang zh --engines whisper aliyun xunfei

Engines available: whisper, aliyun, xunfei, azure
Engines enabled by default: whichever have API keys configured in backend/.env

Output:
    asr_benchmark_results/<timestamp>/
        summary.json          — latency, cost, WER per engine
        <engine>_raw.json     — raw segment output
        <engine>_text.txt     — plain transcript text (feed to Gemini for comparison)
        gemini_prompt.txt     — ready-to-paste Gemini comparison prompt
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# ── Make sure `services/` is importable ───────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from services.audio import get_audio_duration


# ── Cost table (USD per minute of audio, as of 2025) ──────────────────────────
# Update these when pricing changes.
COST_PER_MINUTE_USD = {
    "whisper": 0.006,    # OpenAI Whisper API: $0.006/min
    "aliyun":  0.0014,   # Alibaba Cloud ASR: ~¥0.01/min ≈ $0.0014
    "xunfei":  0.0014,   # iFlytek ASR: similar to Aliyun
    "azure":   0.01,     # Azure Speech: $0.01/min (standard tier)
}


# ══════════════════════════════════════════════════════════════════════════════
# Engine implementations
# ══════════════════════════════════════════════════════════════════════════════

def run_whisper(wav_path: str, language: str) -> list[dict]:
    """OpenAI Whisper API — already implemented in services/asr.py"""
    from services.asr import transcribe_openai
    return transcribe_openai(wav_path, language=language)


def run_aliyun(wav_path: str, language: str) -> list[dict]:
    """
    Alibaba Cloud NLS 录音文件识别（离线转写）。
    Requires: ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_ASR_APP_KEY
    SDK: pip install aliyun-python-sdk-core

    流程：SubmitTask（提交任务，需要公网可访问的音频 URL）→ 轮询 GetTaskResult
    返回字段：Sentences[].BeginTime / EndTime（毫秒整数）/ Text

    注意：阿里云 NLS 文件转写要求音频是公网 URL（如 OSS）。
    本实现用 ALIYUN_AUDIO_URL 环境变量指定 URL；如果没有，
    则尝试用 ALIYUN_OSS_BUCKET / ALIYUN_OSS_REGION 上传后获取 URL。
    最简单的测试方式：把 WAV 文件上传到 OSS（公读），把 URL 写到 .env 里。
    """
    import json as _json
    import time as _time

    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "").strip()
    app_key = os.environ.get("ALIYUN_ASR_APP_KEY", "").strip()
    audio_url = os.environ.get("ALIYUN_AUDIO_URL", "").strip()

    if not all([access_key_id, access_key_secret, app_key]):
        raise RuntimeError("ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_ASR_APP_KEY not set in .env")
    if not audio_url:
        raise RuntimeError(
            "ALIYUN_AUDIO_URL not set in .env.\n"
            "阿里云 NLS 文件转写要求音频必须是公网可访问的 URL。\n"
            "请把 WAV 文件上传到 OSS（设为公读），然后在 .env 里设置:\n"
            "ALIYUN_AUDIO_URL=https://your-bucket.oss-cn-shanghai.aliyuncs.com/audio.wav"
        )

    try:
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest
    except ImportError:
        raise RuntimeError("请先安装 SDK：pip install aliyun-python-sdk-core")

    client = AcsClient(access_key_id, access_key_secret, "cn-shanghai")

    # ── 提交转写任务 ───────────────────────────────────────────────────────────
    post_req = CommonRequest()
    post_req.set_domain("filetrans.cn-shanghai.aliyuncs.com")
    post_req.set_version("2018-08-17")
    post_req.set_action_name("SubmitTask")
    post_req.set_method("POST")
    task_body = {
        "appkey": app_key,
        "file_link": audio_url,
        "version": "4.0",
        "enable_words": False,  # 句子级时间戳即可
    }
    post_req.add_body_params("Task", _json.dumps(task_body))
    resp = _json.loads(client.do_action_with_exception(post_req))
    if resp.get("StatusText") != "SUCCESS":
        raise RuntimeError(f"阿里云提交任务失败: {resp}")
    task_id = resp["TaskId"]

    # ── 轮询结果 ───────────────────────────────────────────────────────────────
    for _ in range(120):  # 最多等 20 分钟（120 × 10s）
        get_req = CommonRequest()
        get_req.set_domain("filetrans.cn-shanghai.aliyuncs.com")
        get_req.set_version("2018-08-17")
        get_req.set_action_name("GetTaskResult")
        get_req.set_method("GET")
        get_req.add_query_param("TaskId", task_id)
        result = _json.loads(client.do_action_with_exception(get_req))
        status = result.get("StatusText")
        if status == "SUCCESS":
            segments = []
            for sent in result.get("Result", {}).get("Sentences", []):
                segments.append({
                    "text": sent["Text"],
                    "start": sent["BeginTime"] / 1000.0,  # ms → sec
                    "end": sent["EndTime"] / 1000.0,
                })
            return segments
        elif status in ("ERROR", "FAILED"):
            raise RuntimeError(f"阿里云转写失败: {result}")
        _time.sleep(10)

    raise RuntimeError("阿里云转写超时（>20分钟）")


def run_xunfei(wav_path: str, language: str) -> list[dict]:
    """
    iFlytek LFASR 录音文件识别（离线转写）。
    Requires: XUNFEI_APP_ID, XUNFEI_API_SECRET（.env 里的 XUNFEI_API_SECRET）
    无需额外 SDK，直接用 requests。

    流程：POST /upload（上传本地文件）→ 轮询 POST /getResult
    返回字段：sentences[].bg / ed（毫秒字符串）/ onebest
    """
    import hashlib as _hashlib
    import hmac as _hmac
    import base64 as _base64
    import json as _json
    import time as _time

    try:
        import requests as _requests
    except ImportError:
        raise RuntimeError("请先安装：pip install requests")

    app_id = os.environ.get("XUNFEI_APP_ID", "").strip()
    # 讯飞 LFASR 离线转写用的是 secret_key（对应 .env 的 XUNFEI_API_SECRET）
    secret_key = os.environ.get("XUNFEI_API_SECRET", "").strip()

    if not app_id or not secret_key:
        raise RuntimeError("XUNFEI_APP_ID / XUNFEI_API_SECRET not set in .env")

    HOST = "https://raasr.xfyun.cn/v2/api"

    def _make_signa() -> tuple[str, str]:
        ts = str(int(_time.time()))
        md5 = _hashlib.md5((app_id + ts).encode()).hexdigest().encode()
        sig = _hmac.new(secret_key.encode(), md5, _hashlib.sha1).digest()
        return _base64.b64encode(sig).decode(), ts

    # ── 上传文件 ───────────────────────────────────────────────────────────────
    signa, ts = _make_signa()
    file_size = os.path.getsize(wav_path)
    params = {
        "appId": app_id,
        "signa": signa,
        "ts": ts,
        "fileName": os.path.basename(wav_path),
        "fileSize": file_size,
        "duration": "0",
    }
    with open(wav_path, "rb") as f:
        resp = _requests.post(
            f"{HOST}/upload",
            params=params,
            data=f.read(),
            headers={"Content-Type": "application/octet-stream"},
            timeout=120,
        )
    data = resp.json()
    if data.get("code") != "000000":
        raise RuntimeError(f"讯飞上传失败: {data}")
    order_id = data["content"]["orderId"]

    # ── 轮询结果 ───────────────────────────────────────────────────────────────
    for _ in range(240):  # 最多等 20 分钟（240 × 5s）
        signa, ts = _make_signa()
        resp = _requests.post(
            f"{HOST}/getResult",
            params={"appId": app_id, "signa": signa, "ts": ts, "orderId": order_id},
            timeout=30,
        )
        data = resp.json()
        if data.get("code") != "000000":
            raise RuntimeError(f"讯飞查询失败: {data}")
        status = data["content"]["orderInfo"]["status"]
        # 0=等待 1=准备 2=处理中 3=完成 4=失败
        if status == 3:
            # orderResult 是 JSON 字符串，需要二次解析
            raw = data["content"]["orderResult"]
            sentences = _json.loads(raw)
            segments = []
            for sent in sentences:
                segments.append({
                    "text": sent["onebest"],
                    "start": int(sent["bg"]) / 1000.0,  # ms 字符串 → sec
                    "end": int(sent["ed"]) / 1000.0,
                })
            return segments
        elif status == 4:
            raise RuntimeError(f"讯飞转写失败: {data}")
        _time.sleep(5)

    raise RuntimeError("讯飞转写超时（>20分钟）")


def run_azure(wav_path: str, language: str) -> list[dict]:
    """
    Azure Cognitive Services Speech-to-Text.
    Requires: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION

    SDK: pip install azure-cognitiveservices-speech
    Docs: https://learn.microsoft.com/azure/cognitive-services/speech-service/

    Language codes: 'en-US', 'zh-CN' (not 'en'/'zh')
    """
    speech_key = os.environ.get("AZURE_SPEECH_KEY", "")
    region = os.environ.get("AZURE_SPEECH_REGION", "")
    if not speech_key or not region:
        raise RuntimeError("AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set in .env")
    raise NotImplementedError(
        "Azure Speech not yet implemented. "
        "Install azure-cognitiveservices-speech and implement this function."
    )


ENGINE_RUNNERS = {
    "whisper": run_whisper,
    "aliyun":  run_aliyun,
    "xunfei":  run_xunfei,
    "azure":   run_azure,
}


# ══════════════════════════════════════════════════════════════════════════════
# WER calculation
# ══════════════════════════════════════════════════════════════════════════════

def _tokenize(text: str) -> list[str]:
    """Split text into tokens for WER. Handles CJK (character-level) and Latin (word-level)."""
    import re
    # CJK characters: split character by character
    tokens = []
    for ch in text:
        if '\u4e00' <= ch <= '\u9fff':
            tokens.append(ch)
        elif re.match(r'\w', ch):
            if tokens and re.match(r'\w', tokens[-1][-1]):
                tokens[-1] += ch  # continue building word
            else:
                tokens.append(ch)
        # skip punctuation and spaces for WER
    return [t.lower() for t in tokens if t.strip()]


def compute_wer(reference: str, hypothesis: str) -> dict:
    """
    Compute Word Error Rate using dynamic programming.
    Returns dict with wer, substitutions, deletions, insertions, total_ref_words.
    """
    ref = _tokenize(reference)
    hyp = _tokenize(hypothesis)

    n, m = len(ref), len(hyp)
    # Edit distance matrix
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j - 1],  # substitution
                                    dp[i - 1][j],       # deletion
                                    dp[i][j - 1])       # insertion

    edit_distance = dp[n][m]
    wer = edit_distance / max(n, 1)

    return {
        "wer": round(wer, 4),
        "wer_pct": f"{wer * 100:.1f}%",
        "edit_distance": edit_distance,
        "ref_tokens": n,
        "hyp_tokens": m,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Output helpers
# ══════════════════════════════════════════════════════════════════════════════

def segments_to_text(segments: list[dict]) -> str:
    return " ".join(s["text"] for s in segments).strip()


def build_gemini_prompt(
    engine_texts: dict[str, str],
    ground_truth: str | None,
    audio_duration_min: float,
    language: str,
) -> str:
    lang_label = "中文" if language.startswith("zh") else "英文"
    gt_block = f"\n\n## Ground Truth（人工校对正确答案）\n\n{ground_truth}" if ground_truth else ""

    engine_blocks = ""
    for engine, text in engine_texts.items():
        engine_blocks += f"\n\n## {engine.upper()} 转录结果\n\n{text}"

    return f"""你是一位 ASR（语音识别）系统评测专家。我正在为一款课堂笔记产品（LiberStudy）选择最合适的 ASR 引擎。
以下是同一段 {audio_duration_min:.1f} 分钟的{lang_label}课堂录音，经过不同 ASR 引擎转录后的文本。请帮我做横向对比分析。

---
{gt_block}{engine_blocks}

---

请按以下结构输出分析报告：

## 1. 准确率对比
- 如果有 Ground Truth，计算或估算每个引擎的词错率（WER）
- 如果没有 Ground Truth，横向比较各引擎之间的差异，指出哪个引擎出现了明显错误（错字、漏字、专业术语误识别）
- 特别关注：专业术语（公式、缩写、人名地名）、数字、句子完整性

## 2. 流畅度与可读性
- 标点符号是否正确重建
- 句子是否完整，有无明显断句错误
- 是否有幻觉内容（凭空生成的文字）

## 3. 时间戳质量
- 各引擎的 segment 划分粒度是否合理
- 时间戳是否看起来可信（无异常跳跃）

## 4. 综合排名
给出你的推荐排序，说明理由。格式：
1. [引擎名] — 理由
2. [引擎名] — 理由
...

## 5. 特别提示
指出任何值得注意的问题，比如某引擎在特定内容类型（代码、公式、口音）上的系统性失败。
"""


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="ASR engine benchmark")
    parser.add_argument("--audio", required=True, help="Path to WAV audio file")
    parser.add_argument("--lang", default="en", help="Language code: en or zh (default: en)")
    parser.add_argument(
        "--engines", nargs="+",
        default=["whisper"],
        choices=list(ENGINE_RUNNERS.keys()),
        help="Engines to benchmark (default: whisper)",
    )
    parser.add_argument(
        "--ground-truth", default=None,
        help="Path to plain-text ground truth transcript (.txt)",
    )
    args = parser.parse_args()

    wav_path = str(Path(args.audio).resolve())
    if not Path(wav_path).exists():
        print(f"ERROR: audio file not found: {wav_path}")
        sys.exit(1)

    audio_duration_sec = get_audio_duration(wav_path)
    audio_duration_min = audio_duration_sec / 60
    print(f"Audio: {wav_path}")
    print(f"Duration: {audio_duration_min:.1f} min")
    print(f"Language: {args.lang}")
    print(f"Engines: {args.engines}\n")

    ground_truth_text = None
    if args.ground_truth:
        ground_truth_text = Path(args.ground_truth).read_text(encoding="utf-8").strip()
        print(f"Ground truth loaded: {len(ground_truth_text)} chars\n")

    # ── Output directory ───────────────────────────────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(__file__).parent / "asr_benchmark_results" / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Run engines ────────────────────────────────────────────────────────────
    results = {}
    engine_texts = {}

    for engine in args.engines:
        print(f"[{engine}] Running...", end=" ", flush=True)
        t0 = time.time()
        try:
            segments = ENGINE_RUNNERS[engine](wav_path, args.lang)
            elapsed = time.time() - t0
            text = segments_to_text(segments)

            cost_usd = COST_PER_MINUTE_USD.get(engine, 0) * audio_duration_min
            wer_result = compute_wer(ground_truth_text, text) if ground_truth_text else None

            results[engine] = {
                "status": "ok",
                "latency_sec": round(elapsed, 2),
                "latency_label": f"{elapsed:.1f}s",
                "cost_usd": round(cost_usd, 4),
                "cost_label": f"${cost_usd:.4f}",
                "segment_count": len(segments),
                "char_count": len(text),
                "wer": wer_result,
            }
            engine_texts[engine] = text

            # Save raw segments
            (out_dir / f"{engine}_raw.json").write_text(
                json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            # Save plain text
            (out_dir / f"{engine}_text.txt").write_text(text, encoding="utf-8")

            wer_str = f"  WER={wer_result['wer_pct']}" if wer_result else ""
            print(f"OK — {elapsed:.1f}s, ${cost_usd:.4f}{wer_str}")

        except NotImplementedError as e:
            elapsed = time.time() - t0
            print(f"SKIP (not implemented): {e}")
            results[engine] = {"status": "not_implemented", "error": str(e)}
        except Exception as e:
            elapsed = time.time() - t0
            print(f"ERROR: {e}")
            results[engine] = {"status": "error", "error": str(e)}

    # ── Summary JSON ───────────────────────────────────────────────────────────
    summary = {
        "audio": wav_path,
        "duration_min": round(audio_duration_min, 2),
        "language": args.lang,
        "timestamp": timestamp,
        "engines": results,
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── Gemini prompt ──────────────────────────────────────────────────────────
    if engine_texts:
        gemini_prompt = build_gemini_prompt(
            engine_texts, ground_truth_text, audio_duration_min, args.lang
        )
        (out_dir / "gemini_prompt.txt").write_text(gemini_prompt, encoding="utf-8")

    # ── Print summary table ────────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print(f"{'Engine':<12} {'Status':<10} {'Latency':>10} {'Cost':>10} {'WER':>10}")
    print(f"{'─'*60}")
    for engine, r in results.items():
        if r["status"] == "ok":
            wer_str = r["wer"]["wer_pct"] if r["wer"] else "—"
            print(f"{engine:<12} {'ok':<10} {r['latency_label']:>10} {r['cost_label']:>10} {wer_str:>10}")
        else:
            print(f"{engine:<12} {r['status']:<10}")
    print(f"{'─'*60}")
    print(f"\nResults saved to: {out_dir}")
    if engine_texts:
        print(f"Gemini prompt:    {out_dir / 'gemini_prompt.txt'}")
        print("\nNext step: open gemini_prompt.txt, paste into Gemini, attach the _text.txt files if needed.")


if __name__ == "__main__":
    main()

"""
ASR 横向对比脚本 — Whisper vs 阿里云

用法：
  python asr_compare.py <wav_path> [--lang zh|en] [--engine whisper|aliyun|both] [--force]

示例：
  python asr_compare.py test_documents/lec01/test_audio_10min.wav --lang en
  python asr_compare.py test_documents/lec01/test_audio_10min.wav --lang en --engine whisper
  python asr_compare.py test_documents/lec01/test_audio_10min.wav --lang en --force

参考文本：自动读取 wav 同目录的 asr_ref.txt（无则跳过 CER/WER/漏字/增字/术语召回）

结果输出：
  <wav_dir>/asr_whisper.json
  <wav_dir>/asr_aliyun.json
  <wav_dir>/asr_compare_result.json   ← 汇总评测报告
  <wav_dir>/asr_compare_report.txt    ← 人类可读报告
"""

import argparse
import json
import re
import time
from pathlib import Path


# ── 术语表（英文课堂常见专业词，可按需扩充）────────────────────────────────────
DEFAULT_TERMS_EN = [
    "neural network", "deep learning", "overfitting", "underfitting",
    "gradient descent", "backpropagation", "loss function", "training error",
    "generalization error", "validation", "hyperparameter", "batch size",
    "learning rate", "epoch", "K-fold", "cross-validation", "transformer",
    "CNN", "RNN", "LSTM", "attention", "dropout", "regularization",
]
DEFAULT_TERMS_ZH = [
    "神经网络", "深度学习", "过拟合", "欠拟合", "梯度下降", "反向传播",
    "损失函数", "训练误差", "泛化误差", "验证集", "超参数", "批大小",
    "学习率", "卷积", "注意力机制", "正则化", "Transformer", "CNN",
]

# ── 中文常见口头禅 ─────────────────────────────────────────────────────────────
FILLER_ZH = ["然后", "就是", "对吧", "那个", "嗯", "啊", "呃", "其实", "就是说"]
FILLER_EN_RE = re.compile(
    r"\b(um+|uh+|er+|ah+|like|you know|i mean|sort of|kind of|basically|right\?|okay so|so yeah)\b",
    re.IGNORECASE,
)

# ── 标点符号 ───────────────────────────────────────────────────────────────────
PUNCT_RE = re.compile(r"[，。！？,.!?;；]")

# SRT/VTT 时间戳行：00:00:00,000 --> 00:00:00,000 或 00:00:00.000 --> 00:00:00.000
_TIMESTAMP_RE = re.compile(r"^\d{1,2}:\d{2}:\d{2}[,\.]\d+ -->")
# 说话人前缀：如 "Xiao Lei: "
_SPEAKER_RE = re.compile(r"^[^:]{1,30}:\s+")


def _parse_ref_file(raw: str) -> str:
    """从 SRT/VTT 字幕文件中提取纯文本（去掉序号行、时间戳行、说话人前缀）。"""
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.isdigit():          # 序号行
            continue
        if _TIMESTAMP_RE.match(line):  # 时间戳行
            continue
        line = _SPEAKER_RE.sub("", line)  # 去说话人前缀
        if line:
            lines.append(line)
    return " ".join(lines)


# =============================================================================
# 核心指标计算
# =============================================================================

def _edit_distance_ops(ref: list, hyp: list) -> tuple[int, int, int]:
    """返回 (substitutions, deletions, insertions)，用于分解 CER/WER。"""
    m, n = len(ref), len(hyp)
    # dp[i][j] = (cost, sub, del, ins)
    INF = 10**9
    dp = [[(INF, 0, 0, 0)] * (n + 1) for _ in range(m + 1)]
    dp[0][0] = (0, 0, 0, 0)
    for j in range(1, n + 1):
        dp[0][j] = (j, 0, 0, j)
    for i in range(1, m + 1):
        dp[i][0] = (i, 0, i, 0)
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref[i - 1] == hyp[j - 1]:
                cost, s, d, ins = dp[i - 1][j - 1]
                dp[i][j] = (cost, s, d, ins)
            else:
                sub_c, ss, sd, si = dp[i - 1][j - 1]
                del_c, ds, dd, di = dp[i - 1][j]
                ins_c, is_, id_, ii = dp[i][j - 1]
                sub_c += 1; ss += 1
                del_c += 1; dd += 1
                ins_c += 1; ii += 1
                best = min((sub_c, ss, sd, si), (del_c, ds, dd, di), (ins_c, is_, id_, ii))
                dp[i][j] = best
    _, s, d, ins = dp[m][n]
    return s, d, ins


def compute_cer(ref: str, hyp: str) -> dict:
    """字符错误率 + 漏字率 + 增字率。"""
    r, h = list(ref.replace(" ", "")), list(hyp.replace(" ", ""))
    if not r:
        return {"cer": 0.0, "deletion_rate": 0.0, "insertion_rate": 0.0}
    s, d, ins = _edit_distance_ops(r, h)
    return {
        "cer": round((s + d + ins) / len(r), 4),
        "deletion_rate": round(d / len(r), 4),      # 漏字率
        "insertion_rate": round(ins / len(h) if h else 0, 4),  # 增字率
    }


def compute_wer(ref: str, hyp: str) -> dict:
    """词错误率（英文）+ 漏词率 + 增词率。"""
    r = ref.lower().split()
    h = hyp.lower().split()
    if not r:
        return {"wer": 0.0, "deletion_rate": 0.0, "insertion_rate": 0.0}
    s, d, ins = _edit_distance_ops(r, h)
    return {
        "wer": round((s + d + ins) / len(r), 4),
        "deletion_rate": round(d / len(r), 4),
        "insertion_rate": round(ins / len(h) if h else 0, 4),
    }


def compute_term_recall(hyp: str, terms: list[str]) -> dict:
    """术语召回率：术语表中有多少词出现在转录文本中。"""
    hyp_lower = hyp.lower()
    found = [t for t in terms if t.lower() in hyp_lower]
    return {
        "recall": round(len(found) / len(terms), 4) if terms else 0.0,
        "found": found,
        "missed": [t for t in terms if t.lower() not in hyp_lower],
        "total_terms": len(terms),
    }


def compute_punctuation_density(text: str) -> float:
    """标点密度：标点数 / 总字符数，合理范围约 0.03–0.12。"""
    chars = len(text.replace(" ", ""))
    if chars == 0:
        return 0.0
    puncts = len(PUNCT_RE.findall(text))
    return round(puncts / chars, 4)


def compute_filler_rate(text: str, lang: str) -> dict:
    """口头禅检测。"""
    if lang == "zh":
        found = [f for f in FILLER_ZH if f in text]
        total_chars = len(text)
        count = sum(text.count(f) for f in found)
        rate = round(count / total_chars, 4) if total_chars else 0.0
    else:
        matches = FILLER_EN_RE.findall(text)
        words = len(text.split())
        count = len(matches)
        rate = round(count / words, 4) if words else 0.0
        found = list(set(m.lower() for m in matches))
    return {"count": count, "rate": rate, "examples": found[:10]}


def compute_sentence_boundary_quality(sentences: list[dict]) -> dict:
    """
    断句质量（自动近似）：
    - 以标点结尾的句子比例（越高越好）
    - 平均句长（字符数）
    """
    if not sentences:
        return {"ends_with_punct_ratio": 0.0, "avg_len": 0.0}
    ends_with_punct = sum(
        1 for s in sentences if PUNCT_RE.search(s["text"].rstrip())
    )
    avg_len = sum(len(s["text"]) for s in sentences) / len(sentences)
    return {
        "ends_with_punct_ratio": round(ends_with_punct / len(sentences), 4),
        "avg_len": round(avg_len, 1),
    }


def compute_timestamp_consistency(sentences: list[dict]) -> dict:
    """
    时间戳一致性：
    - 检查是否有时间戳倒退（end < start 或下一句 start < 上一句 end）
    - 平均句间 gap
    """
    errors = 0
    gaps = []
    for i, s in enumerate(sentences):
        if s["end"] < s["start"]:
            errors += 1
        if i > 0:
            gap = s["start"] - sentences[i - 1]["end"]
            gaps.append(gap)
    avg_gap = round(sum(gaps) / len(gaps), 3) if gaps else 0.0
    return {
        "timestamp_errors": errors,
        "avg_gap_s": avg_gap,
        "negative_gaps": sum(1 for g in gaps if g < -0.1),
    }


def compute_half_stability(sentences: list[dict]) -> dict:
    """
    长音频稳定性：对比前半段 vs 后半段的字符密度（字/秒）。
    差异越小越稳定。
    """
    if not sentences:
        return {"first_half_density": 0.0, "second_half_density": 0.0, "diff": 0.0}
    mid = len(sentences) // 2
    first = sentences[:mid]
    second = sentences[mid:]

    def density(segs):
        chars = sum(len(s["text"]) for s in segs)
        duration = segs[-1]["end"] - segs[0]["start"] if len(segs) > 1 else 1
        return round(chars / max(duration, 1), 2)

    d1 = density(first)
    d2 = density(second)
    return {
        "first_half_density": d1,
        "second_half_density": d2,
        "diff": round(abs(d1 - d2), 2),
        "stable": abs(d1 - d2) < d1 * 0.3,
    }


def compute_cross_engine_diff(w_sents: list[dict], a_sents: list[dict], lang: str) -> float:
    """两引擎互相当 ref，算文本差异率（无正确答案时的替代指标）。"""
    w_text = _segments_to_text(w_sents)
    a_text = _segments_to_text(a_sents)
    if lang == "zh":
        return compute_cer(w_text, a_text)["cer"]
    else:
        return compute_wer(w_text, a_text)["wer"]


def compute_english_term_preservation(text: str) -> dict:
    """英文术语夹杂检测（中文课里专用）：找出文本中的英文词。"""
    en_words = re.findall(r"\b[A-Za-z]{2,}\b", text)
    unique = list(set(w.upper() for w in en_words))
    return {"count": len(en_words), "unique_terms": sorted(unique)[:20]}


# =============================================================================
# 运行引擎
# =============================================================================

def _segments_to_text(segments: list[dict]) -> str:
    return " ".join(s["text"] for s in segments)


def get_duration(wav_path: str) -> float:
    from services.audio import get_audio_duration
    return get_audio_duration(wav_path)


def _save(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → 保存: {path.name}")


def run_whisper(wav_path: str, language: str, out_path: Path) -> dict:
    from services.asr import transcribe_openai
    print(f"\n[Whisper] 转录中: {wav_path}")
    t0 = time.time()
    sentences, raw_segments = transcribe_openai(wav_path, language=language)
    elapsed = round(time.time() - t0, 2)
    dur = get_duration(wav_path)
    cost = round((dur / 60) * 0.006, 5)
    result = {
        "engine": "whisper", "elapsed_s": elapsed, "cost_usd": cost,
        "duration_s": dur, "n_sentences": len(sentences),
        "sentences": sentences, "raw_segments": raw_segments,
    }
    _save(out_path, result)
    print(f"  完成 {elapsed}s | ${cost} | {len(sentences)} 句")
    return result


def run_aliyun(wav_path: str, language: str, out_path: Path, max_retries: int = 3) -> dict:
    from services.asr import transcribe_aliyun
    print(f"\n[阿里云] 转录中（需上传 OSS ~30-60s）: {wav_path}")
    last_err = None
    for attempt in range(1, max_retries + 1):
        if attempt > 1:
            wait = 10 * attempt
            print(f"  [重试 {attempt}/{max_retries}] 等待 {wait}s 后重试…")
            time.sleep(wait)
        try:
            t0 = time.time()
            sentences, raw_segments = transcribe_aliyun(wav_path, language=language)
            elapsed = round(time.time() - t0, 2)
            dur = get_duration(wav_path)
            cost = round((dur / 60) * 0.0014, 5)
            result = {
                "engine": "aliyun", "elapsed_s": elapsed, "cost_usd": cost,
                "duration_s": dur, "n_sentences": len(sentences),
                "sentences": sentences, "raw_segments": raw_segments,
            }
            _save(out_path, result)
            print(f"  完成 {elapsed}s | ${cost} | {len(sentences)} 句")
            return result
        except Exception as e:
            last_err = e
            print(f"  [阿里云] 尝试 {attempt} 失败: {e}")
    raise RuntimeError(f"阿里云 ASR 重试 {max_retries} 次均失败: {last_err}")


# =============================================================================
# 评测主逻辑
# =============================================================================

def evaluate(data: dict, ref_text: str, lang: str, terms: list[str]) -> dict:
    """对单个引擎结果跑全部指标，返回评测结果 dict。"""
    if data is None:
        return {}
    sents = data["sentences"]
    full_text = _segments_to_text(sents)
    result = {
        "engine": data["engine"],
        "elapsed_s": data["elapsed_s"],
        "cost_usd": data["cost_usd"],
        "n_sentences": data["n_sentences"],
        "total_chars": len(full_text.replace(" ", "")),
    }

    # 需要 ref 的指标
    if ref_text:
        if lang == "zh":
            err = compute_cer(ref_text, full_text)
            result["CER"] = err["cer"]
            result["漏字率"] = err["deletion_rate"]
            result["增字率"] = err["insertion_rate"]
        else:
            err = compute_wer(ref_text, full_text)
            result["WER"] = err["wer"]
            result["漏词率"] = err["deletion_rate"]
            result["增词率"] = err["insertion_rate"]

    # 术语召回率
    if terms:
        term_res = compute_term_recall(full_text, terms)
        result["术语召回率"] = term_res["recall"]
        result["术语_命中"] = term_res["found"]
        result["术语_遗漏"] = term_res["missed"]

    # 不需要 ref 的指标
    result["标点密度"] = compute_punctuation_density(full_text)
    result["口头禅"] = compute_filler_rate(full_text, lang)
    result["断句质量"] = compute_sentence_boundary_quality(sents)
    result["时间戳一致性"] = compute_timestamp_consistency(sents)
    result["长音频稳定性"] = compute_half_stability(sents)

    if lang == "zh":
        result["英文术语夹杂"] = compute_english_term_preservation(full_text)

    return result


# =============================================================================
# 报告输出
# =============================================================================

def _fmt(val) -> str:
    if val is None:
        return "—"
    if isinstance(val, float):
        return f"{val:.4f}"
    if isinstance(val, bool):
        return "✅" if val else "❌"
    return str(val)


def print_report(w_eval: dict, a_eval: dict, cross_diff: float | None, lang: str):
    W = 22
    print("\n" + "=" * 70)
    print("  ASR 评测报告")
    print("=" * 70)
    print(f"{'指标':<26} {'Whisper':>{W}} {'阿里云':>{W}}")
    print("-" * 70)

    def row(label, wk, ak=None):
        wv = _fmt(w_eval.get(wk)) if w_eval else "—"
        av = _fmt(a_eval.get(ak or wk)) if a_eval else "—"
        print(f"{label:<26} {wv:>{W}} {av:>{W}}")

    # 性能
    print("\n【性能与成本】")
    row("延迟 (s)", "elapsed_s")
    row("成本 (USD)", "cost_usd")
    row("句段数", "n_sentences")
    row("总字符数", "total_chars")

    # 准确性
    print("\n【识别准确性】")
    if lang == "zh":
        row("CER ↓（字符错误率）", "CER")
        row("漏字率 ↓", "漏字率")
        row("增字率 ↓", "增字率")
    else:
        row("WER ↓（词错误率）", "WER")
        row("漏词率 ↓", "漏词率")
        row("增词率 ↓", "增词率")

    if cross_diff is not None:
        metric = "CER" if lang == "zh" else "WER"
        print(f"{'两引擎差异率':<26} {f'{cross_diff:.4f} ({metric})'}")

    if "术语召回率" in (w_eval or {}):
        row("术语召回率 ↑", "术语召回率")

    # 质量
    print("\n【文本质量】")
    w_punct = _fmt(w_eval.get("标点密度")) if w_eval else "—"
    a_punct = _fmt(a_eval.get("标点密度")) if a_eval else "—"
    print(f"{'标点密度（合理~0.05）':<26} {w_punct:>{W}} {a_punct:>{W}}")

    w_fill = w_eval.get("口头禅", {}) if w_eval else {}
    a_fill = a_eval.get("口头禅", {}) if a_eval else {}
    print(f"{'口头禅率 ↓':<26} {_fmt(w_fill.get('rate')):>{W}} {_fmt(a_fill.get('rate')):>{W}}")

    w_bq = w_eval.get("断句质量", {}) if w_eval else {}
    a_bq = a_eval.get("断句质量", {}) if a_eval else {}
    print(f"{'断句标点结尾率 ↑':<26} {_fmt(w_bq.get('ends_with_punct_ratio')):>{W}} {_fmt(a_bq.get('ends_with_punct_ratio')):>{W}}")
    print(f"{'平均句长（字符）':<26} {_fmt(w_bq.get('avg_len')):>{W}} {_fmt(a_bq.get('avg_len')):>{W}}")

    # 时间戳
    print("\n【时间戳与稳定性】")
    w_ts = w_eval.get("时间戳一致性", {}) if w_eval else {}
    a_ts = a_eval.get("时间戳一致性", {}) if a_eval else {}
    print(f"{'时间戳错误数 ↓':<26} {_fmt(w_ts.get('timestamp_errors')):>{W}} {_fmt(a_ts.get('timestamp_errors')):>{W}}")
    print(f"{'平均句间 gap (s)':<26} {_fmt(w_ts.get('avg_gap_s')):>{W}} {_fmt(a_ts.get('avg_gap_s')):>{W}}")

    w_hs = w_eval.get("长音频稳定性", {}) if w_eval else {}
    a_hs = a_eval.get("长音频稳定性", {}) if a_eval else {}
    print(f"{'前半段密度（字/秒）':<26} {_fmt(w_hs.get('first_half_density')):>{W}} {_fmt(a_hs.get('first_half_density')):>{W}}")
    print(f"{'后半段密度（字/秒）':<26} {_fmt(w_hs.get('second_half_density')):>{W}} {_fmt(a_hs.get('second_half_density')):>{W}}")
    print(f"{'前后密度差 ↓（稳定性）':<26} {_fmt(w_hs.get('diff')):>{W}} {_fmt(a_hs.get('diff')):>{W}}")

    # 术语明细
    for label, ev in [("Whisper", w_eval), ("阿里云", a_eval)]:
        if ev and "术语_遗漏" in ev and ev["术语_遗漏"]:
            print(f"\n[{label}] 遗漏术语: {', '.join(ev['术语_遗漏'])}")
        if ev and "术语_命中" in ev:
            print(f"[{label}] 命中术语: {', '.join(ev['术语_命中'])}")

    print("\n【注：以下指标需人工评分（1-5分）】")
    print("  □ 断句准确度（是否切在语义边界）")
    print("  □ 标点恢复质量（标点是否合理）")
    print("  □ 口音鲁棒性")
    print("  □ 快语速表现")
    print("  □ 教室噪声鲁棒性")
    print("  □ 幻觉问题（是否出现未说的内容）")
    print("=" * 70)


def claude_judge(w_eval: dict, a_eval: dict, w_result: dict | None,
                 a_result: dict | None, ref_text: str, lang: str) -> str:
    """调用 Claude 对人工评估维度打分，并给出选型建议。"""
    import os
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return "（未找到 ANTHROPIC_API_KEY，跳过 AI 评估）"

    # 取前 20 句样本
    def sample(result, n=20):
        if not result:
            return "（无数据）"
        sents = result.get("sentences", [])[:n]
        return "\n".join(
            f"[{int(s['start'])//60:02d}:{int(s['start'])%60:02d}] {s['text']}"
            for s in sents
        )

    w_sample = sample(w_result)
    a_sample = sample(a_result)

    # 把量化指标整理成文字
    def fmt_eval(ev: dict) -> str:
        if not ev:
            return "（无数据）"
        lines = []
        for k, v in ev.items():
            if k in ("术语_命中", "术语_遗漏", "口头禅", "断句质量",
                     "时间戳一致性", "长音频稳定性", "英文术语夹杂"):
                lines.append(f"  {k}: {json.dumps(v, ensure_ascii=False)}")
            elif isinstance(v, (int, float, str, bool)):
                lines.append(f"  {k}: {v}")
        return "\n".join(lines)

    ref_snippet = ref_text[:500] + "..." if len(ref_text) > 500 else ref_text

    prompt = f"""你是一位 ASR 评测专家，正在为一款课堂知识结构化产品（LiberStudy）评估两个 ASR 引擎的质量。

语言：{"中文" if lang == "zh" else "英文"}

## 量化指标

**Whisper:**
{fmt_eval(w_eval)}

**阿里云:**
{fmt_eval(a_eval)}

## 转录样本（前20句）

**Whisper:**
{w_sample}

**阿里云:**
{a_sample}

{"## 参考文本（正确答案节选）" + chr(10) + ref_snippet if ref_text else "（无参考文本）"}

## 评估任务

请针对以下维度，对两个引擎各给出 1-5 分（5分最好），并附一句简短理由：

1. 断句准确度（是否切在自然语义边界）
2. 标点恢复质量（标点是否合理、自然）
3. 口头禅/噪声词处理（是否有效过滤"嗯""啊"等）
4. 英文术语/专业词识别（课堂场景关键）
5. 幻觉风险评估（是否有明显的凭空编造）
6. 整体可读性（转录文本是否便于下游对齐和笔记生成）

最后给出：
- 推荐引擎（Whisper / 阿里云 / 并列）
- 推荐理由（2-3条）
- 保留风险（1-2条）

输出格式：直接用中文，简洁清晰，不要 markdown 标题符号。"""

    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


# =============================================================================
# 入口
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="ASR 全指标评测：Whisper vs 阿里云")
    parser.add_argument("wav", help="WAV 文件路径")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"], help="语言（默认 zh）")
    parser.add_argument("--engine", default="both", choices=["whisper", "aliyun", "both"])
    parser.add_argument("--terms", default="", help="术语表，逗号分隔，如 CNN,Transformer,梯度下降")
    parser.add_argument("--force", action="store_true", help="忽略缓存强制重跑")
    args = parser.parse_args()

    wav_path = Path(args.wav).resolve()
    if not wav_path.exists():
        print(f"错误：文件不存在 — {wav_path}")
        return

    out_dir = wav_path.parent

    # 参考文本
    ref_file = out_dir / "asr_ref.txt"
    if ref_file.exists():
        ref_text = _parse_ref_file(ref_file.read_text(encoding="utf-8"))
        print(f"[参考文本] 读取 asr_ref.txt（解析后 {len(ref_text)} 字符）")
    else:
        ref_text = ""
        print("[参考文本] 未找到 asr_ref.txt，跳过 CER/WER/漏字/增字")

    # 术语表
    if args.terms:
        terms = [t.strip() for t in args.terms.split(",") if t.strip()]
    else:
        terms = DEFAULT_TERMS_EN if args.lang == "en" else DEFAULT_TERMS_ZH
        print(f"[术语表] 使用默认术语表（{len(terms)} 个词），可用 --terms 自定义")

    whisper_out = out_dir / "asr_whisper.json"
    aliyun_out = out_dir / "asr_aliyun.json"

    w_result = a_result = None

    if args.engine in ("whisper", "both"):
        if not args.force and whisper_out.exists():
            print(f"[Whisper] 使用缓存（--force 强制重跑）")
            w_result = json.loads(whisper_out.read_text(encoding="utf-8"))
        else:
            w_result = run_whisper(str(wav_path), args.lang, whisper_out)

    if args.engine in ("aliyun", "both"):
        if not args.force and aliyun_out.exists():
            print(f"[阿里云] 使用缓存（--force 强制重跑）")
            a_result = json.loads(aliyun_out.read_text(encoding="utf-8"))
        else:
            a_result = run_aliyun(str(wav_path), args.lang, aliyun_out)

    # 评测
    print("\n[评测] 计算指标中…")
    w_eval = evaluate(w_result, ref_text, args.lang, terms)
    a_eval = evaluate(a_result, ref_text, args.lang, terms)

    cross_diff = None
    if w_result and a_result:
        cross_diff = compute_cross_engine_diff(
            w_result["sentences"], a_result["sentences"], args.lang
        )

    # 终端报告
    print_report(w_eval, a_eval, cross_diff, args.lang)

    # Claude AI 评估
    print("\n[AI 评估] 调用 Claude 评分中…")
    ai_judge = claude_judge(w_eval, a_eval, w_result, a_result, ref_text, args.lang)
    print("\n" + "=" * 70)
    print("  Claude AI 评估结果")
    print("=" * 70)
    print(ai_judge)
    print("=" * 70)

    # 保存 JSON 汇总
    summary = {
        "wav": str(wav_path),
        "language": args.lang,
        "has_ref": bool(ref_text),
        "terms_used": terms,
        "cross_engine_diff": cross_diff,
        "whisper": w_eval,
        "aliyun": a_eval,
        "ai_judge": ai_judge,
    }
    summary_path = out_dir / "asr_compare_result.json"
    _save(summary_path, summary)

    # 保存人类可读报告
    import io, sys
    buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = buf
    print_report(w_eval, a_eval, cross_diff, args.lang)
    print("\n" + "=" * 70)
    print("  Claude AI 评估结果")
    print("=" * 70)
    print(ai_judge)
    print("=" * 70)
    sys.stdout = old_stdout
    report_path = out_dir / "asr_compare_report.txt"
    report_path.write_text(buf.getvalue(), encoding="utf-8")
    print(f"  → 保存: {report_path.name}")


if __name__ == "__main__":
    import sys, os
    # 脚本放在 Activetest/ 下，但 services/ 在 backend/，两个路径都加入
    _script_dir = Path(__file__).parent
    _backend_dir = _script_dir.parent.parent / "backend"
    sys.path.insert(0, str(_backend_dir))
    sys.path.insert(0, str(_script_dir))
    os.chdir(_backend_dir)
    main()

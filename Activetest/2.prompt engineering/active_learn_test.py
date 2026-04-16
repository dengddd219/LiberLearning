"""
active_learn_test.py

测试 active learning 笔记扩写 prompt (prompt_v0.md)。
输入：ppt_text.md + transcript.md + query.md
模型：Azure AI Foundry Project endpoint（从 Activetest/.env 读取）
运行：python "Activetest/2.prompt engineering/active_learn_test.py"
"""

import os
import pathlib
from dotenv import load_dotenv
from openai import AzureOpenAI

# ── 路径 ──────────────────────────────────────────────────────────
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = pathlib.Path(__file__).resolve().parent

PPT_FILE    = DIR / "ppt_text.md"
TRANSCRIPT  = DIR / "transcript.md"
QUERY_FILE  = REPO_ROOT / "Activetest" / "query.md"
PROMPT_FILE = DIR / "prompt_v1.md"
ENV_FILE    = REPO_ROOT / "Activetest" / ".env"

# ── 加载 .env ─────────────────────────────────────────────────────
load_dotenv(ENV_FILE)

ENDPOINT   = os.environ["AZURE_OPENAI_ENDPOINT"]
API_KEY    = os.environ["AZURE_OPENAI_API_KEY"]
API_VER    = os.environ.get("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5-mini")

# ── 读文件 ────────────────────────────────────────────────────────
ppt_text   = PPT_FILE.read_text(encoding="utf-8").strip()
transcript = TRANSCRIPT.read_text(encoding="utf-8").strip()
user_note  = QUERY_FILE.read_text(encoding="utf-8").strip()
prompt_tpl = PROMPT_FILE.read_text(encoding="utf-8").strip()

# ── 注入变量 ──────────────────────────────────────────────────────
system_prompt = (
    prompt_tpl
    .replace("{PPT_TEXT}", ppt_text)
    .replace("{TRANSCRIPT}", transcript)
    .replace("{USER_NOTE}", user_note)
)

# ── 打印信息 ──────────────────────────────────────────────────────
print(f"模型: {DEPLOYMENT}")
print("=" * 60)
print("【学生笔记】")
print(user_note)
print("=" * 60)
print("调用中...\n")

# ── 调用 Azure OpenAI ─────────────────────────────────────────────
client = AzureOpenAI(
    azure_endpoint=ENDPOINT,
    api_key=API_KEY,
    api_version=API_VER,
)

response = client.chat.completions.create(
    model=DEPLOYMENT,
    max_completion_tokens=2048,
    messages=[{"role": "user", "content": system_prompt}],
)

finish = response.choices[0].finish_reason
usage = response.usage
raw = response.choices[0].message.content or ""

print(f"[finish_reason: {finish} | prompt={usage.prompt_tokens} reasoning={getattr(usage.completion_tokens_details, 'reasoning_tokens', 0)} output={usage.completion_tokens}]")
print()
print("【AI 扩写结果】")
print(raw if raw else "(空输出，reasoning token 可能耗尽)")

"""
LiberStudy 全局配置中心。

所有后端策略参数在这里集中管理，修改后 uvicorn --reload 自动生效。
前端通过 GET /api/settings 读取当前配置并展示。
"""

# =============================================================================
# Step 3 — 语义对齐
# =============================================================================

# 对齐算法版本，可选值：
#   "v1"    单遍 argmax cosine（无去抖，无单调约束）
#   "v1_1"  V1 + 时间轴硬窗口（单调递增）
#   "v1_2"  V1 + 后处理邻居平滑
#   "v2"    K=3 去抖状态机（当前生产版本）
#   "v2_1"  V2 + 时间轴硬窗口约束
#   "v3a"   三分类（逻辑词规则）
#   "v3a_1" V3a + 时间轴约束
#   "v3b"   三分类（滑窗 embedding）
#   "v3b_1" V3b + 时间轴约束
#   "v4"    两阶段有状态跟踪（SlideTracker + SentenceClassifier）
#   "v4_1"  V4 修复 Drag-Back 效应
#   "v5"    Viterbi/HMM 全局解码
#   "v5_1"  V5 参数调优
ALIGNMENT_VERSION: str = "v5"

# Embedding 模型（OpenAI 兼容接口）
EMBEDDING_MODEL: str = "text-embedding-3-small"

# K=3 去抖：连续多少个 segment 投票才切换页面（仅 v2/v2_1 生效）
ALIGNMENT_PAGE_SWITCH_K: int = 3

# Cosine 相似度低于此值 → 判为 off-slide 脱稿（v2 及以上）
ALIGNMENT_OFF_SLIDE_THRESHOLD: float = 0.30

# Off-slide segment 若与已对齐内容相似度 > 此值 → 升级回 aligned
ALIGNMENT_OFF_SLIDE_UPGRADE_THRESHOLD: float = 0.60

# 低于此置信度在前端显示"对齐置信度低"警告
ALIGNMENT_LOW_CONFIDENCE_THRESHOLD: float = 0.60


# =============================================================================
# Step 2 — ASR 转录
# =============================================================================

# ASR 引擎，可选值：
#   "whisper"  OpenAI Whisper API（支持中英文）
#   "aliyun"   阿里云录音文件识别 RESTful API（支持中英文，需配置 ALIYUN_* + OSS 环境变量）
#   "race"     同时跑 aliyun + whisper，谁先完成用谁
ASR_ENGINE: str = "race"

# Whisper 模型（目前 API 只有 whisper-1）
ASR_WHISPER_MODEL: str = "whisper-1"

# 大文件分块时长（秒），超过 25MB 时生效
ASR_CHUNK_DURATION_SEC: int = 600  # 10 分钟

# 句段合并最大字符数（无句尾标点时强制截断）
ASR_MAX_MERGE_CHARS: int = 200


# =============================================================================
# Step 5 — 笔记生成
# =============================================================================

# 笔记生成 provider，可选值：
#   "中转站"  使用 ANTHROPIC_API_KEY（Anthropic SDK）
#   "智增增"  使用 OPENAI_API_KEY + OPENAI_BASE_URL（OpenAI 兼容 SDK）
NOTE_PROVIDER: str = "中转站"

# Claude 模型版本（仅 provider=中转站 生效）
NOTE_MODEL: str = "claude-sonnet-4-6"

# 被动学习笔记模板，可选值：
#   "passive_ppt_notes"       Template ②：全PPT讲解笔记（按 bullet + 时间戳）
#   "passive_outline_summary" Template ④：大纲摘要
NOTE_PASSIVE_TEMPLATE: str = "passive_ppt_notes"

# 主动学习笔记模板，可选值：
#   "active_expand"           Template ①：基于我的笔记扩写
#   "active_comprehensive"    Template ③：完整综合笔记
NOTE_ACTIVE_TEMPLATE: str = "active_expand"

# 笔记粒度，可选值："simple" | "detailed"
NOTE_GRANULARITY: str = "detailed"

# 每页 LLM 调用最大并发数
NOTE_MAX_CONCURRENT: int = 10

# 每页失败最大重试次数
NOTE_MAX_RETRIES: int = 3

# 单次 LLM 输出 token 上限
NOTE_MAX_TOKENS: int = 2048


# =============================================================================
# Step 1 — 请求入口限制
# =============================================================================

# 每个 IP 每天最大处理请求次数
RATE_LIMIT_MAX_CALLS_PER_DAY: int = 2

# 音频最大时长（秒）
MAX_AUDIO_SECONDS: int = 120 * 60  # 120 分钟


# =============================================================================
# 内部：版本 → 模块路径映射（勿修改）
# =============================================================================

_ALIGNMENT_VERSION_MAP: dict[str, str] = {
    "v1":    "services.step3_alignment_test.alignment_v1",
    "v1_1":  "services.step3_alignment_test.alignment_v1_1",
    "v1_2":  "services.step3_alignment_test.alignment_v1_2",
    "v2":    "services.alignment",           # 生产模块
    "v2_1":  "services.step3_alignment_test.alignment_v2_1",
    "v3a":   "services.step3_alignment_test.alignment_v3a",
    "v3a_1": "services.step3_alignment_test.alignment_v3a_1",
    "v3b":   "services.step3_alignment_test.alignment_v3b",
    "v3b_1": "services.step3_alignment_test.alignment_v3b_1",
    "v4":    "services.step3_alignment_test.alignment_v4",
    "v4_1":  "services.step3_alignment_test.alignment_v4_1",
    "v5":    "services.step3_alignment_test.alignment_v5",
    "v5_1":  "services.step3_alignment_test.alignment_v5_1",
}


def get_alignment_module():
    """返回当前配置的对齐模块，动态 import。"""
    import importlib
    module_path = _ALIGNMENT_VERSION_MAP.get(ALIGNMENT_VERSION)
    if not module_path:
        raise ValueError(f"Unknown ALIGNMENT_VERSION: {ALIGNMENT_VERSION!r}. "
                         f"Valid: {list(_ALIGNMENT_VERSION_MAP)}")
    return importlib.import_module(module_path)


def as_dict() -> dict:
    """返回所有公开配置项的字典，供 /api/settings 接口使用。"""
    return {
        "alignment": {
            "version": ALIGNMENT_VERSION,
            "embedding_model": EMBEDDING_MODEL,
            "page_switch_k": ALIGNMENT_PAGE_SWITCH_K,
            "off_slide_threshold": ALIGNMENT_OFF_SLIDE_THRESHOLD,
            "off_slide_upgrade_threshold": ALIGNMENT_OFF_SLIDE_UPGRADE_THRESHOLD,
            "low_confidence_threshold": ALIGNMENT_LOW_CONFIDENCE_THRESHOLD,
        },
        "asr": {
            "engine": ASR_ENGINE,
            "whisper_model": ASR_WHISPER_MODEL,
            "chunk_duration_sec": ASR_CHUNK_DURATION_SEC,
            "max_merge_chars": ASR_MAX_MERGE_CHARS,
        },
        "notes": {
            "provider": NOTE_PROVIDER,
            "model": NOTE_MODEL,
            "passive_template": NOTE_PASSIVE_TEMPLATE,
            "active_template": NOTE_ACTIVE_TEMPLATE,
            "granularity": NOTE_GRANULARITY,
            "max_concurrent": NOTE_MAX_CONCURRENT,
            "max_retries": NOTE_MAX_RETRIES,
            "max_tokens": NOTE_MAX_TOKENS,
        },
        "limits": {
            "rate_limit_max_calls_per_day": RATE_LIMIT_MAX_CALLS_PER_DAY,
            "max_audio_seconds": MAX_AUDIO_SECONDS,
        },
        "available_alignment_versions": list(_ALIGNMENT_VERSION_MAP.keys()),
    }

# AI Frontpage Ask — 实时问答功能设计规格

**日期**: 2026-04-16
**状态**: 草稿

---

## 1. 背景与目标

用户在笔记页面浏览 AI 笔记时，对某一条 bullet 可能有疑问（"这个公式什么意思"、"链式法则是怎么推导的"）。如果用户跳出去问 Gemini/ChatGPT，不仅丢失客户，还面临内容不匹配（AI 不知道这条 bullet 来自哪页 PPT）的问题。

**目标**：在笔记页面内提供内联问答入口，用户 hover 任意一条 bullet 卡片即可针对该条提问，AI 基于该条 bullet 的内容回答，支持多模型切换。

---

## 2. 设计方案

### 方案选择：内联逐条问答（方案二）

每个 bullet 卡片 hover 时浮现「针对此条提问」按钮，点击展开内联问答区。该方案语义最聚焦——AI 只看到该条 bullet 内容，回答更精准；多 bullet 可同时展开独立对话，互不干扰。

### 整体架构

```
用户浏览笔记
    ↓ hover 单条 bullet
浮现「针对此条提问」按钮
    ↓ 点击
展开内联问答区
    ├── 模型选择器（中转站/通义/DeepSeek/豆包）
    ├── 对话历史（本地，IndexedDB 持久化）
    ├── 输入框（Enter 发送，Shift+Enter 换行）
    └── 收起按钮

用户发送问题
    ↓ HTTP POST /api/sessions/:id/ask
后端 router
    ├── 拿 bullet 的 ppt_text + ai_comment 组装 prompt
    ├── 流式调用选定模型（SSE）
    └── 推回前端
```

---

## 3. UI 组件清单

| 组件 | 说明 |
|------|------|
| `AskButton` | bullet 卡片右下角 hover 显示，触发内联问答展开 |
| `InlineQA` | bullet 卡片内展开区域，含模型选择 + 对话历史 + 输入框 |
| `ModelChip` | 可切换模型（中转站/通义千问/DeepSeek/豆包） |
| `ChatBubble` | user / ai 两种样式 |
| `AskInput` | Enter 发送，Shift+Enter 换行 |

**交互细节**：
- Hover bullet 卡片 → 浮现 AskButton（opacity 0→1 + 向上微动 2px）
- 点击 AskButton → 展开 InlineQA，input 自动聚焦
- 点击「收起」→ 折叠，保留对话历史（下次打开还在）
- 多条 bullet 可同时展开（独立对话，互不干扰）

---

## 4. API 接口

```
POST /api/sessions/:sessionId/ask
Body: {
  question: string
  page_num: number
  bullet_index: number        # 该 bullet 在 bullets 数组中的下标
  bullet_text: string         # ppt_text
  bullet_ai_comment: string   # ai_comment（可选）
  model: "claude" | "qwen" | "deepseek" | "doubao"
}
Response: SSE stream
  data: { "type": "chunk", "content": string }
  data: { "type": "done" }
  data: { "type": "error", "message": string }
```

---

## 5. 前端存储（IndexedDB）

```
DB: liberstudy_ask
Store: ask_history
  key: [session_id, page_num, bullet_index]  # 复合索引
  value: {
    messages: Array<{ role: "user" | "ai"; content: string; model: string; timestamp: number }>
    selected_model: string
  }
```

---

## 6. Prompt 设计

文件路径：`backend/prompts/ai_frontpage_ask/prompt.md`

Prompt 结构：
```
System: 你是高校课程助教，基于课件原文回答学生问题

Content:
"""ppt_text 内容"""

---
补充注释：
"""ai_comment（若有）"""

---
回答要求：
- 简洁，中文
- 如涉及公式，用 $...$ 或 $$...$$ 包裹 LaTeX
- 如果原课件没有足够信息回答，诚实说"这页内容没有涉及..."
```

---

## 7. 迭代计划

### 阶段一（MVP）：仅当条内容
- AI 只看到当前 bullet 的 ppt_text + ai_comment
- 支持 Claude（中转站）/ 通义千问 / DeepSeek / 豆包
- 对话历史存 IndexedDB

### 阶段二（迭代）：RAG 检索
- session 处理完成后，异步跑 embedding，存入向量库
- 问答接口升级：先向量检索 Top-K 相关块，再填入 prompt
- 支持跨页追问

---

## 8. 测试平台

测试平台入口：`backend/test_ui/ai_frontpage_ask.py`
注册到 `test_app.py` 新增 Tab「💬 AI Frontpage Ask」

测试平台功能：
- 左侧：PPT 页面截图 + PPT 文字（可编辑）
- 右侧上：用户输入框
- 右侧中：流程展示（Bullet Context → System Prompt → Final Message → LLM Response）
- 右侧下：LLM 输出框，支持修改 prompt 实时保存

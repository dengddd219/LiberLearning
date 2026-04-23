# Analytics Events Design — LiberStudy MVP-0 内测阶段

**日期：** 2026-04-22  
**阶段：** 内测  
**工具：** PostHog（Cloud 版，posthog-js + Python SDK）

---

## 设计原则

内测阶段用户数少，每个 session 的行为数据都很宝贵。埋点优先级按以下逻辑排序：

1. **P0 跑通率** — 用户在哪一步掉了？出错集中在哪个阶段？技术问题必须第一时间发现。
2. **P1 课中行为** — 验证"用户愿意在课中打锚点"这个核心产品假设。
3. **P2 笔记消费** — 验证北极星指标 WANG，看"拿到笔记"和"真正消费"的差距。

---

## P0 — 跑通率漏斗（7个事件）

回答：用户在哪一步流失？出错集中在哪个阶段？

### 事件清单

| 事件名 | 触发时机 | 触发端 | 关键属性 |
|--------|---------|--------|---------|
| `lobby_viewed` | 进入大厅页面 | 前端 | — |
| `session_create_started` | 点击「新建课程」按钮 | 前端 | — |
| `ppt_uploaded` | PPT 上传成功（后端返回 200） | 前端 | `file_size_mb`, `slide_count` |
| `recording_started` | 点击「开始录音」 | 前端 | `has_ppt: bool` |
| `recording_ended` | 点击「结束录音」 | 前端 | `duration_seconds` |
| `notes_generation_result` | 后端生成流程结束（成功或失败） | 后端 | `success: bool`, `error_stage`（asr\|align\|llm\|null）, `duration_seconds`, `session_id` |
| `notes_viewed` | 进入笔记查看页且停留 > 3 秒 | 前端 | `session_id`, `total_pages` |

### 漏斗节点说明

```
lobby_viewed
  → session_create_started   （流失 = 进来了但没新建）
    → ppt_uploaded            （流失 = 新建了但没传PPT，或传失败）
      → recording_started     （流失 = 上传了但没开始录）
        → recording_ended     （流失 = 开始录了但没结束，可能崩溃）
          → notes_generation_result.success=true  （流失 = 技术失败）
            → notes_viewed    （流失 = 生成了但没来看）
```

---

## P1 — 课中核心行为（5个事件）

回答：用户有没有真的用锚点？Live 课堂哪个功能被触碰了？

### 核心假设

> "用户愿意在课中主动打锚点" — 这是语义对齐算法价值的前提。如果没人打锚点，对齐算法的主动学习路径就没有意义。

### 事件清单

| 事件名 | 触发时机 | 触发端 | 关键属性 |
|--------|---------|--------|---------|
| `annotation_added` | 完成一条文字标注 | 前端 | `page_index`, `session_duration_at_action`（秒，标注发生时录音已进行了多久） |
| `live_asr_subtitle_toggled` | 开关实时字幕 | 前端 | `turned_on: bool` |
| `ai_notes_opened` | Live 课堂中打开 AI Notes 面板 | 前端 | `session_duration_at_action` |
| `page_chat_sent` | 发送 Page Chat 问题 | 前端 | `page_index` |
| `detailed_note_opened` | 打开详细笔记侧边栏 | 前端 | `page_index` |

### 假设验证标准

- `annotation_added` 在 > 50% 的 session 中出现 → 假设成立
- `annotation_added` 在 < 20% 的 session 中出现 → 假设存疑，需用户访谈

---

## P2 — 笔记消费深度（4个事件）

回答：用户看了多久？最受欢迎的模板是哪个？有没有人导出？

### 事件清单

| 事件名 | 触发时机 | 触发端 | 关键属性 |
|--------|---------|--------|---------|
| `notes_closed` | 离开笔记查看页 | 前端 | `time_spent_seconds`, `had_scroll: bool` |
| `template_switched` | 切换 AI 笔记模板 | 前端 | `from_template`（1-4）, `to_template`（1-4） |
| `export_clicked` | 点击导出按钮 | 前端 | `format`（md\|pdf） |
| `rating_submitted` | 提交满意度评分弹窗 | 前端 | `score`（1-5）, `trigger`（auto\|manual） |

### 北极星指标（WANG）计算方式

WANG = 每周去重用户数，满足：`notes_generation_result.success=true` 且（`notes_closed.time_spent_seconds > 60` 或 `export_clicked` 出现）

---

## 全局属性（每个事件都附带）

所有事件自动附带以下属性，由 PostHog 初始化时注册：

| 属性名 | 来源 | 说明 |
|--------|------|------|
| `user_id` | 前端本地生成 UUID，localStorage 持久化 | 内测阶段无登录，用设备标识代替 |
| `session_id` | 当前 live session 的 UUID | 关联同一次课的所有事件 |
| `app_version` | 前端构建时注入（`import.meta.env.VITE_APP_VERSION`） | 区分版本迭代前后的行为变化 |

---

## 与 PRD §6 原方案的差异

| 变更 | 原因 |
|------|------|
| 删除 `session_recovery_shown` / `session_recovery_action` | 内测阶段中断恢复是边缘场景，数据量不足以分析 |
| 删除 `quick_ask_triggered` | Quick Ask 是 P1 功能，内测暂未完整实现 |
| 新增 `live_asr_subtitle_toggled` | PRD 原方案遗漏，字幕开关是 Live 课堂核心交互 |
| 新增 `session_duration_at_action` 属性 | 了解用户在课程哪个时间点开始打锚点 |
| `notes_generation_result` 从前端移至后端触发 | 后端才有完整的 error_stage 信息，前端只能知道"成功/失败" |

---

## 实现注意事项

- 前端用 `posthog-js`，在 `main.tsx` 初始化，`PostHog.init()` 在 React 渲染前执行
- 后端用 `posthog-python`，在 `notes_generation_result` 的触发点（`process.py` 的 `_run_pipeline()` 末尾）调用
- `notes_viewed` 的 3 秒防抖用 `setTimeout` 实现，组件卸载时 clearTimeout
- 内测阶段不需要 opt-out 弹窗，但建议在大厅页面底部加一行小字说明数据收集


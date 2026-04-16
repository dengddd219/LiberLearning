# LivePage 设计规格

**日期：** 2026-04-16  
**状态：** 已审阅，待实现

---

## 1. 背景

SessionPage 从未真正投入使用，代码基本是原始 stub。用户一直在 NotesPage（课后笔记视图）迭代。LivePage 直接基于 NotesPage 的代码创建，差异只在于 transcript 的获取方式：NotesPage 从 API 拿静态数据，LivePage 从 WebSocket 流式 ASR 实时获取。

---

## 2. 范围

本规格覆盖：
- 新建 `LivePage.tsx`（从 NotesPage 代码 fork，删除 SessionPage）
- LobbyPage / UploadPage 入口改造
- LivePage 与 NotesPage 的差异点：WebSocket 流式 ASR、字幕条、手动触发 AI 解释、录音结束过渡
- i18n：所有 UI 文字走 `t()` key

不覆盖：
- Quick Ask 浮窗（PRD P1，独立规格）
- 语义自动对齐（课后流水线已有，课中用用户翻页代替）
- 无 PPT 模式
- 就地批注（留到后续迭代）

---

## 3. 文件变动

| 操作 | 文件 |
|---|---|
| 新建（从 NotesPage fork） | `frontend/src/pages/LivePage.tsx` |
| 删除 | `frontend/src/pages/SessionPage.tsx` |
| 修改路由 `/session` → `/live` | `frontend/src/App.tsx` |
| 删除 `/session/live` 重定向 | `frontend/src/App.tsx` |
| 入口改造 | `frontend/src/pages/LobbyPage.tsx` |
| 新增 Live 入口卡片 | `frontend/src/pages/UploadPage.tsx` |
| 新增 i18n key | `frontend/src/lib/i18n.ts` |
| 新增后端路由 | `backend/routers/live.py` |

---

## 4. 入口改造

### 4.1 LobbyPage

- 绿色「新建录音」按钮（现在弹 `NewClassModal`）→ 改为 `navigate('/upload')`
- 删除 `NewClassModal` 组件
- 空状态绿色按钮同样改为跳转 `/upload`

### 4.2 UploadPage

在现有两个上传区（PPT + Audio）**上方**，新增 Live 入口卡片：

```
┌─────────────────────────────────────────────┐
│  t('live_card_title')                        │
│  t('live_card_desc')                         │
│                                             │
│            [t('live_card_cta') →]           │
└─────────────────────────────────────────────┘
```

点击 → `navigate('/live')`，不需要上传文件。

---

## 5. LivePage vs NotesPage：差异清单

LivePage fork 自 NotesPage，以下是需要改动的地方，其余保持不变：

### 5.1 移除

- `useEffect` 里的 `getSession(sessionId)` API 调用（改为 WebSocket）
- `session: SessionData | null` state（transcript 来自 WebSocket，其余数据课中暂无）
- 音频播放器相关 state（`playingSegIdx`、`playProgress`）

### 5.2 新增 state

```ts
const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'live' | 'stopped'>('idle')
const [subtitleLines, setSubtitleLines] = useState<string[]>([])       // 字幕条显示用，最多 50 条
const [transcriptByPage, setTranscriptByPage] = useState<Record<number, string[]>>({})  // 按页累积
const [explanationsByPage, setExplanationsByPage] = useState<Record<number, string>>({})
const [currentExplanation, setCurrentExplanation] = useState<string>('')  // 当前页流式输出
const [explaining, setExplaining] = useState(false)
```

### 5.3 字幕条

插入在 PPT 画布下方，固定高度 120px，自动滚动到最新：

```tsx
<div className="subtitle-bar">
  {subtitleLines.map((line, i) => <p key={i}>{line}</p>)}
</div>
```

i18n key：`live_subtitle_placeholder`（空状态提示文字）

### 5.4 右侧面板

原 NotesPage 右侧有 `my / ai / transcript` 三个 tab。LivePage 右侧简化：

- 移除 tab 切换，只显示当前页 AI 解释区
- 空状态：`t('live_explain_empty')`
- 按钮：`t('live_explain_btn')`，录音未开始时 disabled
- 生成中：复用 `StreamingExpandText` 组件展示流式输出
- 已生成：显示结果 + 「`t('live_explain_refresh')`」刷新按钮

### 5.5 录音控制条

使用已有 `RecordingControl` 组件（替换 SessionPage 内联的重复实现），放在页面底部或中栏底部。

---

## 6. 实时转录（WebSocket）

### 前端流程

1. 用户点开始录音 → `getUserMedia` + 创建 `MediaRecorder` + 建立 WebSocket `ws://.../ws/live-asr`
2. `MediaRecorder` 每 250ms 产出 chunk → WebSocket 发送（binary frame）
3. 后端推回：
   ```json
   { "text": "识别到的文字", "is_final": true, "timestamp": 12.5 }
   ```
4. 字幕条：
   - `is_final: false` → 更新最后一行（实时预览）
   - `is_final: true` → 追加新行，超过 50 行删最早的
5. `transcriptByPage[currentPage]` 累积 final 文本

### 后端

新增 `backend/routers/live.py`：

```
WebSocket /ws/live-asr
  ← binary（音频 chunk，WebM/PCM）
  → 转发阿里云流式 ASR（wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1）
  → 推回 JSON { text, is_final, timestamp }

POST /api/live/explain
  ← { page_num, ppt_text, transcript }
  → SSE 流式返回 Claude 生成的解释
```

---

## 7. 页码匹配

用户翻页驱动，不做实时语义对齐：

- 用户点击左侧缩略图 → `setCurrentPage(n)` + 记录时间戳
- `transcriptByPage[n]` 从该时刻起累积新的 final 文本
- 课后 ProcessingPage 流水线做完整语义对齐并覆盖

---

## 8. AI 解释（手动触发）

- 点击「解释这页」→ `POST /api/live/explain`，body：`{ page_num, ppt_text: currentPageText, transcript: transcriptByPage[currentPage].join('') }`
- SSE 流式返回，`StreamingExpandText` 展示
- 完成后存入 `explanationsByPage[currentPage]`

---

## 9. 录音结束 → 两阶段过渡

1. 用户点击停止录音
2. `explanationsByPage` 写入 IndexedDB（key：`live-explanations-{sessionId}`）
3. 音频 chunks + PPT → `POST /api/process`
4. 跳转 ProcessingPage（与 UploadPage 流程一致）
5. 流水线完成后进入 NotesPage
6. NotesPage 启动时从 IndexedDB 读 `live-explanations-{sessionId}`，作为各页 AI Notes 初始内容；流水线结果到位后覆盖

---

## 10. i18n Key 清单

新增 key（前缀 `live_`）：

| Key | 中文 | 英文 |
|---|---|---|
| `live_card_title` | 直播课堂 | Live Class |
| `live_card_desc` | 实时录音 · 实时字幕 · 课中 AI 解释 | Real-time recording · Live transcript · In-class AI explanation |
| `live_card_cta` | 进入直播课堂 | Start Live Class |
| `live_subtitle_placeholder` | 开始录音后，字幕将在这里实时显示 | Subtitles will appear here once recording starts |
| `live_explain_empty` | 录音中，点击下方按钮获取 AI 解释 | Recording in progress. Click below for AI explanation |
| `live_explain_btn` | 解释这页 | Explain This Page |
| `live_explain_refresh` | 重新解释 | Re-explain |
| `live_recording_required` | 请先开始录音 | Please start recording first |

---

## 11. 不做的事（MVP 边界）

- 不做课中语义自动翻页
- 不做课中笔记的云端实时同步
- 不支持无 PPT 模式
- 不做 Quick Ask 浮窗
- 不做就地批注

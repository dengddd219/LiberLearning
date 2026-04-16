# LivePage 设计规格

**日期：** 2026-04-16  
**状态：** 已审阅，待实现

---

## 1. 背景

SessionPage 从未真正投入使用，用户一直在 NotesPage（课后笔记视图）工作。现在需要把课中实时录音路径真正做起来，并重命名为 LivePage，同时打通入口和课后流程的衔接。

---

## 2. 范围

本规格覆盖：
- SessionPage → LivePage 重命名
- LobbyPage / UploadPage 入口改造
- LivePage 布局与三大实时功能：流式 ASR 字幕、用户翻页驱动的页码匹配、手动触发 AI 解释
- 录音结束后的两阶段过渡到 NotesPage

不覆盖：
- Quick Ask 浮窗（PRD P1，独立规格）
- 语义自动对齐（课后流水线已有，课中版本用用户翻页代替）
- 无 PPT 模式

---

## 3. 重命名

| 旧 | 新 |
|---|---|
| `frontend/src/pages/SessionPage.tsx` | `frontend/src/pages/LivePage.tsx` |
| 路由 `/session` | 路由 `/live` |
| App.tsx 中所有 `SessionPage` 引用 | `LivePage` |
| `/session/live` 重定向 | 删除，不再需要 |

---

## 4. 入口改造

### 4.1 LobbyPage

- 绿色「新建录音」按钮（现在弹 `NewClassModal`）→ 改为 `navigate('/upload')`
- 删除 `NewClassModal` 组件（功能合并进 UploadPage）
- 空状态绿色按钮同样改为跳转 `/upload`

### 4.2 UploadPage

在现有两个上传区（PPT + Audio）上方，新增一个 **Live 入口卡片**：

```
┌─────────────────────────────────────────────┐
│  直播课堂                                    │
│  实时录音 + 实时字幕 + 课中 AI 解释           │
│                                             │
│            [进入直播课堂 →]                  │
└─────────────────────────────────────────────┘
```

点击按钮 → `navigate('/live')`，不需要上传任何文件。

---

## 5. LivePage 布局

复用 NotesPage 的三栏布局壳（`ThreeColumnLayout`），替换内容区：

```
┌──────────────┬─────────────────────────────────┬───────────────────┐
│ 左：幻灯片   │ 中：PPT 画布（垂直滚动）          │ 右：AI 解释        │
│ 缩略图导航   │                                 │                   │
│              │  PPT 第 N 页渲染区              │  当前页 AI 解释    │
│  [第1页] ◀  │                                 │  （空状态提示：    │
│  [第2页]    │  ┌─────────────────────────┐    │  "录音中，点击    │
│  [第3页]    │  │ 实时字幕条（自动滚动）    │    │  解释这页"）       │
│  ...        │  │ "…老师正在讲解…"         │    │                   │
│             │  └─────────────────────────┘    │  [解释这页] 按钮  │
│             │                                 │                   │
│             │  [录音控制条：开始 / 暂停 / 停止] │                   │
└──────────────┴─────────────────────────────────┴───────────────────┘
```

**PPT 画布**：复用 SlideCanvas 组件，支持垂直滚动浏览所有页面，高亮当前页。  
**字幕条**：固定高度（约 120px），内容超出时自动滚动到最新一条，半透明深色背景覆盖在 PPT 下方。  
**录音控制条**：使用已有的 `RecordingControl` 组件（替换 SessionPage 内联的重复实现）。

---

## 6. 实时转录（WebSocket 流式 ASR）

### 前端

1. 用户点击开始录音 → `getUserMedia` 获取麦克风 → 创建 `MediaRecorder`
2. 同时建立 WebSocket 连接：`ws://backend/ws/live-asr`
3. `MediaRecorder` 每 250ms 产出一个 chunk → 通过 WebSocket 发送给后端（binary frame）
4. 后端推回识别结果（JSON）：
   ```json
   { "text": "识别到的文字", "is_final": true, "timestamp": 12.5 }
   ```
5. 前端字幕条：
   - `is_final: false` → 更新最后一行（实时预览）
   - `is_final: true` → 追加为新行，最多保留 50 行，超出后删除最早的
6. 同时维护 `transcriptByPage: Record<number, string[]>`，按 `currentPage` 累积 final 文本

### 后端

新增 WebSocket 路由：`backend/routers/live.py`

```
WebSocket /ws/live-asr
  ← 接收 binary（音频 chunk，PCM/WebM）
  → 转发给阿里云流式 ASR
  → 推回 JSON { text, is_final, timestamp }
```

阿里云流式 ASR 接口：`wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1`，语言同现有 `asr.py` 配置。

---

## 7. 页码匹配

**策略：用户翻页驱动（不做实时语义对齐）**

- 用户点击左侧缩略图切换页面 → `setCurrentPage(n)` + 记录时间戳
- `transcriptByPage[n]` 从该时刻起累积新的 final 文本
- 课中不做语义对齐，保持实现简单；课后流水线（ProcessingPage）做完整语义对齐并覆盖

---

## 8. AI 解释（手动触发）

### 触发

- 右侧面板显示「解释这页」按钮
- 录音未开始时按钮禁用，提示"请先开始录音"
- 点击后调用 `POST /api/live/explain`

### 请求体

```json
{
  "page_num": 3,
  "ppt_text": "PPT 第3页提取的文字",
  "transcript": "这一页累积的转录文本"
}
```

### 响应

Server-Sent Events（SSE）流式返回，前端复用 `StreamingExpandText` 组件展示。

### 状态存储

```ts
explanationsByPage: Record<number, string>
// { 3: "AI 对第3页的解释文本" }
```

每页最新解释覆盖上一次，存在内存中，录音结束前持久化到 IndexedDB。

---

## 9. 录音结束 → 两阶段过渡

1. 用户点击停止录音
2. 将 `explanationsByPage` 写入 IndexedDB（key：`live-explanations-{sessionId}`）
3. 将音频 chunks + PPT 文件 → `POST /api/process`（现有接口）
4. 跳转 ProcessingPage（和 UploadPage 流程完全一致）
5. ProcessingPage 跑完整流水线后进入 NotesPage
6. NotesPage 启动时：
   - 从 IndexedDB 读取 `live-explanations-{sessionId}`
   - 作为各页 AI Notes 的初始内容（`source: 'live'` 标记）
   - 后台流水线生成的笔记到位后，覆盖对应页面（`source: 'pipeline'`）

---

## 10. 数据流总览

```
麦克风
  │
  ├─── MediaRecorder (250ms chunks) ──→ WebSocket /ws/live-asr
  │                                          │
  │                                     阿里云流式 ASR
  │                                          │
  │                                    字幕条 + transcriptByPage
  │
  └─── 用户翻页 ──→ currentPage 更新 ──→ transcriptByPage 分页累积
                                            │
                                    [解释这页] 按钮
                                            │
                                   POST /api/live/explain (SSE)
                                            │
                                    explanationsByPage

停止录音
  │
  ├─── IndexedDB.set('live-explanations-{id}', explanationsByPage)
  ├─── POST /api/process (音频 + PPT)
  └─── navigate('/processing')
            │
       ProcessingPage（完整流水线）
            │
       NotesPage
            │
       IndexedDB.get('live-explanations-{id}') → 初始 AI Notes
```

---

## 11. 不做的事（MVP 边界）

- 不做课中语义自动翻页（用用户手动翻页代替）
- 不做课中笔记的云端实时同步
- 不支持无 PPT 模式（可后续扩展）
- 不做 Quick Ask 浮窗（独立规格）
- PPT 画布课中版本不做就地批注（留到后续迭代）

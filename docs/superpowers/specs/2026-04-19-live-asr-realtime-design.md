# Live ASR 实时转录设计文档

**日期：** 2026-04-19  
**状态：** 已审阅

---

## 背景

LivePage 已有完整的前端录音逻辑（MediaRecorder + WebSocket），后端 `/api/ws/live-asr` 端点存在但为 mock 模式。本次目标是接入阿里云 NLS 流式 ASR，实现真实实时转录。

---

## 约束与决策

| 决策点 | 结论 |
|--------|------|
| ASR 服务 | 阿里云 NLS 流式识别（凭证已在 `.env` 配置，token 测试通过） |
| 音频格式转换位置 | 后端（ffmpeg 子进程管道）|
| ffmpeg 接法 | stdin/stdout 管道，复用项目已有 ffmpeg |
| 前端改动 | 无——消息格式 `{text, is_final, timestamp}` 保持不变 |
| 实时转录与笔记流水线关系 | 课中字幕显示用；停录后走独立 ASR 重新识别（暂不复用实时文本） |

---

## 数据流

```
前端 MediaRecorder (audio/webm;codecs=opus, 250ms chunk)
  │  WS /api/ws/live-asr
  ▼
后端 live.py
  ├─ ffmpeg 子进程
  │    stdin  ← webm chunks
  │    stdout → PCM s16le 16000Hz mono
  │
  ├─ 阿里云 NLS WebSocket
  │    wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1
  │    ← PCM frames (binary)
  │    → {header: {name: TranscriptionResultChanged|SentenceEnd}, payload: {result}}
  │
  └─ 推回前端
       {text: str, is_final: bool, timestamp: float}
```

---

## 后端实现设计（`backend/routers/live.py`）

### NLS Token 管理

- 连接建立前调用 `https://nls-meta.cn-shanghai.aliyuncs.com/` 获取 token
- Token 有效期约 10 分钟（ExpireTime 字段），模块级缓存，过期前重新获取
- 函数：`_get_nls_token()` → 返回 `(token: str, expire_ts: int)`

### WebSocket 处理器 `live_asr(websocket)`

每个客户端连接独立一套资源：

**① ffmpeg 子进程**
```
ffmpeg -f webm -i pipe:0
       -ar 16000 -ac 1 -f s16le pipe:1
```
- stdin 非阻塞写入，stdout 读取 PCM frames
- 进程在连接结束时 `terminate()`

**② 阿里云 NLS WebSocket 连接**

握手流程：
1. 连接 `wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=<token>`
2. 发送 `StartTranscription` 指令（JSON，含 appkey、format=pcm、sample_rate=16000）
3. 收到 `TranscriptionStarted` 后开始发送 PCM 数据
4. 持续收 `TranscriptionResultChanged`（interim）和 `SentenceEnd`（final）

**③ 三个 asyncio 协程并行运行**

```python
async def feed_ffmpeg():
    # 从前端收 webm bytes → 写 ffmpeg.stdin

async def read_ffmpeg_send_nls():
    # 读 ffmpeg.stdout PCM → 发 NLS WS（每帧 3200 bytes = 100ms）

async def recv_nls_push_client():
    # 收 NLS 消息 → 推回前端
    # TranscriptionResultChanged → {is_final: false}
    # SentenceEnd              → {is_final: true}
```

用 `asyncio.gather()` 运行，任意协程异常时取消其余协程，清理 ffmpeg 进程和 NLS 连接。

### 错误处理

| 场景 | 处理 |
|------|------|
| Token 获取失败 | 立即关闭 WS，发错误消息给前端 |
| ffmpeg 启动失败 | 同上 |
| NLS 连接断开 | 关闭前端 WS |
| 前端主动断开 | `WebSocketDisconnect` → 清理 ffmpeg + NLS |
| NLS token 快过期 | 下一次新连接时刷新（单连接不续期，课堂场景单次 < 10min） |

---

## 前端（无改动）

`LivePage.tsx` 的 `startRecording()` 逻辑和消息处理逻辑完全不变。

---

## 依赖

- `websockets` Python 包（后端连阿里云 NLS 用）——检查是否已安装
- `ffmpeg` 可执行文件——项目已依赖，已在环境中
- 阿里云 NLS AppKey + AccessKey——已配置

---

## 不在本次范围内

- 实时转录文本复用到笔记生成流水线（留 V2）
- NLS token 连接中续期
- 多语言切换（当前固定中文 `zh-cn`）

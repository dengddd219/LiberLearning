# 服务端口速查

**一键启动全部服务：双击根目录 `start.bat`**

| 服务 | 地址 | 单独启动命令 |
|------|------|-------------|
| 前端（React） | http://localhost:5173 | `cd frontend && npm run dev` |
| 后端（FastAPI） | http://localhost:8000 | `cd backend && uvicorn main:app --reload --port 8000` |
| 测试平台（Streamlit） | http://localhost:8501 | `cd backend && streamlit run test_app.py` |
| 系统诊断 | http://localhost:5173/diagnostics | 前端 + 后端同时运行后访问 |

## 重启后端

代码改动后需要重启后端使修改生效（`--reload` 模式下保存文件会自动热重载，无需手动重启）：

```bash
cd C:\Users\19841\Desktop\github\LiberLearning\LiberLearning\backend
uvicorn main:app --reload --port 8000
```

**仅重启后端**（不动前端）：

```bash
# 在新终端执行，或先 Ctrl+C 停掉旧进程再运行
cd backend && uvicorn main:app --reload --port 8000
```

> `--reload` 会监听文件变化并自动重启，开发期间推荐始终带上此参数。

# 服务端口速查

**一键启动全部服务：双击根目录 `start.bat`**

| 服务 | 地址 | 单独启动命令 |
|------|------|-------------|
| 前端（React） | http://localhost:5173 | `cd frontend && npm run dev` |
| 后端（FastAPI） | http://localhost:8000 | `cd backend && uvicorn main:app --reload --port 8000` |
| 测试平台（Streamlit） | http://localhost:8501 | `cd backend && streamlit run test_app.py` |
| 系统诊断 | http://localhost:5173/diagnostics | 前端 + 后端同时运行后访问 |

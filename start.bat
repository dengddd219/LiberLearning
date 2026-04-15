@echo off
chcp 65001 >nul
title LiberStudy 启动器

echo.
echo  ╔══════════════════════════════════════╗
echo  ║         LiberStudy 一键启动           ║
echo  ╚══════════════════════════════════════╝
echo.

set ROOT=%~dp0
set BACKEND=%ROOT%backend

echo  [1/3] 启动后端 (FastAPI :8000) ...
start "后端 :8000" cmd /k "cd /d %BACKEND% && uvicorn main:app --reload --port 8000"

timeout /t 2 /nobreak >nul

echo  [2/3] 启动前端 (React :5173) ...
start "前端 :5173" cmd /k "cd /d %ROOT%frontend && npm run dev"

timeout /t 2 /nobreak >nul

echo  [3/3] 启动测试平台 (Streamlit :8501) ...
start "测试平台 :8501" cmd /k "cd /d %BACKEND% && streamlit run test_app.py"

echo.
echo  ✓ 三个服务已在独立窗口启动，等待约 5 秒后访问：
echo.
echo    前端       http://localhost:5173
echo    后端 API   http://localhost:8000/docs
echo    系统诊断   http://localhost:5173/diagnostics
echo    测试平台   http://localhost:8501
echo.
echo  关闭对应窗口即可停止对应服务。
echo.
pause

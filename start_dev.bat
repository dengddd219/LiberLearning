@echo off
chcp 65001 >nul
title LiberStudy Dev

set ROOT=%~dp0
set BACKEND=%ROOT%backend

echo.
echo  启动后端 (FastAPI :8000) ...
start "后端 :8000" cmd /k "cd /d %BACKEND% && uvicorn main:app --reload --port 8000"

timeout /t 2 /nobreak >nul

echo  启动前端 (React :5173) ...
start "前端 :5173" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo.
echo  服务启动中，稍候访问：
echo.
echo    前端       http://localhost:5173
echo    后端 API   http://localhost:8000/docs
echo.
echo  关闭对应窗口即可停止服务。
echo.
pause

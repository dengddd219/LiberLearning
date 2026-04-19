@echo off
chcp 65001 >nul
title LiberStudy Dev

set ROOT=%~dp0
set BACKEND=%ROOT%backend

echo.
echo  清理旧进程 (端口 5173 / 8000) ...

:: 杀占用 8000 的进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: 杀占用 5173 的进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo  旧进程已清理。
echo.

echo  启动后端 (FastAPI :8000) ...
start "后端 :8000" cmd /k "cd /d %BACKEND% && %ROOT%.venv\Scripts\uvicorn.exe main:app --reload --port 8000"

:: 等后端起来再开前端
timeout /t 3 /nobreak >nul

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

:: 等前端 Vite 起来后自动打开浏览器
timeout /t 4 /nobreak >nul
start http://localhost:5173

pause

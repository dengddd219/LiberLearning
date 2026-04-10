@echo off
chcp 65001 >nul
title LiberStudy Test Platform

set "ROOT=%~dp0"
set "VENV=%ROOT%.venv\Scripts"
set "BACKEND=%ROOT%backend"

echo ============================================
echo   LiberStudy — Test Platform
echo ============================================
echo.

:: Check venv exists
if not exist "%VENV%\python.exe" (
    echo ERROR: .venv not found at %VENV%
    echo Please create it first:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install -r backend\requirements.txt
    pause
    exit /b 1
)

:: Install / upgrade streamlit and fpdf2 if missing
"%VENV%\python.exe" -c "import streamlit" >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/2] Installing streamlit...
    "%VENV%\pip.exe" install streamlit>=1.35.0 fpdf2>=2.7.9
    if %errorlevel% neq 0 (
        echo ERROR: pip install failed.
        pause
        exit /b 1
    )
) else (
    echo [OK] streamlit already installed
)

"%VENV%\python.exe" -c "import fpdf" >nul 2>&1
if %errorlevel% neq 0 (
    echo [2/2] Installing fpdf2...
    "%VENV%\pip.exe" install fpdf2>=2.7.9
)

echo.
echo Starting Streamlit... (browser will open automatically)
echo Press Ctrl+C in this window to stop.
echo.

cd /d "%BACKEND%"
"%VENV%\streamlit.exe" run test_app.py --server.headless false --browser.gatherUsageStats false

pause

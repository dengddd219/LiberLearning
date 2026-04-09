@echo off
echo ============================================
echo  LiberStudy - Installing System Dependencies
echo ============================================
echo.

echo [1/2] Installing LibreOffice (for PPT to PDF conversion)...
winget install --id TheDocumentFoundation.LibreOffice --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo ERROR: LibreOffice installation failed. Please install manually from https://www.libreoffice.org/
    pause
    exit /b 1
)
echo LibreOffice installed successfully.
echo.

echo [2/2] Installing FFmpeg (for audio format conversion)...
winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo ERROR: FFmpeg installation failed. Please install manually from https://ffmpeg.org/download.html
    pause
    exit /b 1
)
echo FFmpeg installed successfully.
echo.

echo ============================================
echo  Done! Please RESTART your terminal so that
echo  LibreOffice (soffice) and ffmpeg are in PATH.
echo ============================================
echo.
echo After restart, verify with:
echo   soffice --version
echo   ffmpeg -version
pause

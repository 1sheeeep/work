@echo off
setlocal
cd /d "%~dp0"

echo.
echo Stopping Xzdesk Agent dev mode...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-dev.ps1" -ClearWebViewCache
if errorlevel 1 (
    echo.
    echo Dev cleanup failed.
    pause
    exit /b 1
)

echo.
echo Dev mode stopped cleanly.
pause

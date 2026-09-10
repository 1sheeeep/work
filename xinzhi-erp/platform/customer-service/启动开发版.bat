@echo off
setlocal
cd /d "%~dp0"

set "GOTMPDIR=%~dp0runtime\go-build-tmp"
if not exist "%GOTMPDIR%" mkdir "%GOTMPDIR%"
if errorlevel 1 (
    echo.
    echo Failed to create Go temp directory: %GOTMPDIR%
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-dev.ps1"
if errorlevel 1 (
    echo.
    echo Dev cleanup failed.
    pause
    exit /b 1
)

"%USERPROFILE%\go\bin\wails.exe" dev
if errorlevel 1 (
    echo.
    echo Dev startup failed.
    pause
    exit /b 1
)

exit /b 0

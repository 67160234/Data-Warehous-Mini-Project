@echo off
title Smart Predictive Maintenance Dashboard Server
echo ============================================================
echo   Smart Predictive Maintenance Platform (AI + IoT)
echo   Starting Dashboard Server on http://localhost:8080 ...
echo ============================================================

REM Find Python executable
set PYTHON_CMD=python
where python >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
        set "PYTHON_CMD=%LOCALAPPDATA%\Python\bin\python.exe"
    )
)

echo Using Python: %PYTHON_CMD%

REM Start browser after 2 seconds in background
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

REM Launch Python server
"%PYTHON_CMD%" -X utf8 "%~dp0dashboard\server.py"

pause

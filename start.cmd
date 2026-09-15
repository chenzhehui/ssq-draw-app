@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 -X utf8 app.py --open
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3.10 or newer is required. Install it from https://www.python.org/
        pause
        exit /b 1
    )
    python -X utf8 app.py --open
)
if errorlevel 1 pause
endlocal

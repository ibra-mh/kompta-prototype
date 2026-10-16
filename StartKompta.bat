@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" || (echo Python 3.10+ is required. & pause & exit /b 1)
  py -3 -m venv .venv || (pause & exit /b 1)
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (pause & exit /b 1)
)
start "Kompta backend" /D "%~dp0" cmd /k ".venv\Scripts\python.exe run.py"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8000/"
endlocal

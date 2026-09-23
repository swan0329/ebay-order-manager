@echo off
setlocal
cd /d "%~dp0"
set PY=
py -3.11 --version >nul 2>&1 && set PY=py -3.11
if not defined PY py -3.10 --version >nul 2>&1 && set PY=py -3.10
if errorlevel 1 (
  echo Python 3.10 or 3.11 is required. Install one from python.org, then run this file again.
  pause
  exit /b 1
)
%PY% -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install torch==2.1.2 torchvision==0.16.2 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
echo.
echo Installation completed. Run run.bat.
pause

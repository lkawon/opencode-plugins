@echo off
setlocal
cd /d "%~dp0"

where python.exe >nul 2>nul
if not errorlevel 1 (
  python.exe "%~dp0sync_llamacpp_context.py" %*
) else (
  py.exe -3 "%~dp0sync_llamacpp_context.py" %*
)

endlocal

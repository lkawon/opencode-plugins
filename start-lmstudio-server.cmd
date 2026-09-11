@echo off
setlocal
cd /d "%~dp0"

if "%GPU_STATS_TOKEN%"=="" set "GPU_STATS_TOKEN=token123"
if "%GPU_STATS_URL%"=="" set "GPU_STATS_URL=http://127.0.0.1:8765"

rem The server uses a single-instance lock, so this command is safe to run again.
start "GPU stats" /b pythonw.exe "%~dp0lm-studio-and-nvidia\gpu_lmstudio_server.py"

endlocal

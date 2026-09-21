@echo off
setlocal
cd /d "%~dp0"

if "%GPU_STATS_TOKEN%"=="" set "GPU_STATS_TOKEN=token123"
if "%GPU_STATS_URL%"=="" set "GPU_STATS_URL=http://127.0.0.1:8765"

rem The server uses a single-instance lock, so this command is safe to run again.
if not exist "%~dp0logs" mkdir "%~dp0logs"
where python.exe >nul 2>&1
if errorlevel 1 (
  echo Python was not found in PATH.
  exit /b 1
)

start "GPU stats" /b python.exe "%~dp0lm-studio-and-nvidia\gpu_lmstudio_server.py" >> "%~dp0logs\gpu-lmstudio-server.log" 2>&1
if errorlevel 1 (
  echo Failed to start the GPU stats server.
  exit /b 1
)

echo GPU stats server start requested on %GPU_STATS_URL%.
echo Server output: %~dp0logs\gpu-lmstudio-server.log

endlocal

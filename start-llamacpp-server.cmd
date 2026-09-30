@echo off
setlocal
cd /d "%~dp0"

rem Default token is auto-generated and persisted by the server when GPU_STATS_TOKEN
rem is unset. Set it here (or in the environment) to pin a specific value.
if not exist "%~dp0logs" mkdir "%~dp0logs"
where python.exe >nul 2>&1
if errorlevel 1 (
  echo Python was not found in PATH.
  exit /b 1
)

start "GPU stats" /b python.exe "%~dp0llamacpp-and-nvidia\gpu_llamacpp_server.py" >> "%~dp0logs\gpu-llamacpp-server.log" 2>&1
if errorlevel 1 (
  echo Failed to start the GPU stats server.
  exit /b 1
)

echo GPU stats server start requested.
echo Server output: %~dp0logs\gpu-llamacpp-server.log

endlocal

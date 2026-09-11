@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-lmstudio-model.ps1" %*
if errorlevel 1 exit /b %errorlevel%
endlocal

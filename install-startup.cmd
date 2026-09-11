@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-startup.ps1" %*
if errorlevel 1 exit /b %errorlevel%
pause
endlocal

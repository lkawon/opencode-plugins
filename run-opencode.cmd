@echo off
setlocal
cd /d "%~dp0"

call "%~dp0start-lmstudio-server.cmd"

rem Start OpenCode in the repository root.
opencode

endlocal

@echo off
setlocal
set "MA_PACKAGE=%~dp0..\apps\desktop\release-spec004-m1\win-unpacked"
if not exist "%MA_PACKAGE%\MovieAgent.exe" (
  >&2 echo MovieAgent MCP package not found. Open the desktop settings to copy the current configuration.
  exit /b 2
)
set "ELECTRON_RUN_AS_NODE=1"
"%MA_PACKAGE%\MovieAgent.exe" "%MA_PACKAGE%\resources\app.asar\out\main\mcp-stdio.js" "--discovery=%APPDATA%\MovieAgent\launcher\mcp-instances" %*
exit /b %ERRORLEVEL%

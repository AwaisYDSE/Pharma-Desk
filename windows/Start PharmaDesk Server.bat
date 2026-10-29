@echo off
title PharmaDesk Server - by Awais Amin
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Installing it now for free...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo  Please close this window and open "Start PharmaDesk Server" again.
  pause
  exit /b
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo  Your Node.js is too old. Updating to the free LTS version...
  winget upgrade -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  pause
  exit /b
)
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo  Optional: installing Cloudflare tunnel (free) so phones can connect from anywhere...
  winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements >nul 2>nul
)
echo.
echo  PharmaDesk server is running. Keep this window open (you can minimise it).
echo  Data is saved in %USERPROFILE%\PharmaDesk
echo.
set PHARMADESK_OPEN=1
node --no-warnings server\server.mjs
echo.
echo  The server stopped. Press any key to close.
pause >nul

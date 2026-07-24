@echo off
setlocal
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=3000
echo Starting Brands Planets POS on LAN...
echo.
echo Open this computer at: http://localhost:3000
echo Other devices on the same WiFi should open: http://YOUR-PC-IP:3000
echo.
npm start

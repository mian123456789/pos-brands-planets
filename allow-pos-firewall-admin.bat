@echo off
setlocal
echo This will ask Windows for Administrator permission.
echo It adds a firewall rule so phones/tablets on the same WiFi can open Brands Planets POS.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"Brands Planets POS LAN 3000\" dir=in action=allow protocol=TCP localport=3000' -Verb RunAs"
echo.
echo If Windows asked for permission, approve it, then start the POS with start-lan-pos.bat.
pause

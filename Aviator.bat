@echo off
title My Game Launcher

start "" cmd /k "npm run dev"

:waitloop
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('localhost',5000); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
    timeout /t 2 > nul
    goto waitloop
)

start "" msedge --app=http://localhost:5000
exit
@echo off
title LAN Port 5000 Scanner

:: Set your subnet here
set subnet=192.168.100

echo Scanning %subnet%.0/24 for port 5000...

:: Loop through all hosts in the subnet
for /L %%i in (1,1,254) do (
    set host=%subnet%.%%i
    call :CheckPort %host%
)

echo Scan complete.
pause
exit

:CheckPort
setlocal
set host=%1

:: Test TCP connection on port 5000
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('%host%',5000); $c.Close(); exit 0 } catch { exit 1 }"

if errorlevel 0 (
    echo Found server at %host%
    :: Open in Edge webview
    start "" msedge --app=http://%host%:5000
    :: Or for Chrome webview, uncomment the next line:
    :: start "" chrome --app=http://%host%:5000
    endlocal
    exit /b 0
)
endlocal
exit /b 1
@echo off
cd /d "%~dp0"
:loop
echo Starting Koin-chart bot...
node src\index.js
echo Bot stopped. Restarting in 10 seconds (close this window to stop).
timeout /t 10 /nobreak >nul
goto loop

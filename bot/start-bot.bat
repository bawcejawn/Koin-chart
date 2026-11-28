@echo off
cd /d "%~dp0"
:loop
echo Starting Koin-chart bot...
node src\index.js
if errorlevel 3 if not errorlevel 4 (echo Another bot window is already running. This one will close.& timeout /t 10 >nul & exit /b)
echo Bot stopped. Restarting in 10 seconds (close this window to stop).
timeout /t 10 /nobreak >nul
goto loop

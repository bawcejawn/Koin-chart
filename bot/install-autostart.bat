@echo off
rem Start the bot automatically every time you log in to Windows (after a restart, too).
rem Run this once. To undo: remove-autostart.bat
cd /d "%~dp0"
schtasks /create /tn "Koin-chart bot" /tr "\"%~dp0start-bot.bat\"" /sc onlogon /rl limited /f
if errorlevel 1 (echo Could not create the task. Try right-click, Run as administrator.) else (echo Done. The bot will start by itself when you log in.)
pause

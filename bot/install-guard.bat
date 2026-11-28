@echo off
rem Turn on the Bot Guard for the bot address (run once). Stop the bot first.
cd /d "%~dp0"
node src\install-guard.js
pause

@echo off
rem Restore the bot key and settings from a backup file: drag the .kcbak file onto this script
cd /d "%~dp0"
node src\backup.js restore "%~1"
pause

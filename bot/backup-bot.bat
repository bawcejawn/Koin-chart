@echo off
rem Make an encrypted backup of the bot key and settings (into the backups folder)
cd /d "%~dp0"
node src\backup.js create
pause

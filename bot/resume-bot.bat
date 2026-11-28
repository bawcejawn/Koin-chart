@echo off
rem Resume trading after stop-bot.bat
cd /d "%~dp0"
if exist STOP del STOP
echo Bot resumed.
pause

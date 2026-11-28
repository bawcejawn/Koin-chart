@echo off
rem Emergency stop: the bot finishes its current check and stops trading until resume-bot.bat is run.
cd /d "%~dp0"
echo stopped %date% %time% > STOP
echo Bot STOPPED. It will not trade until you run resume-bot.bat.
pause

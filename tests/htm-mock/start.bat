@echo off
REM Запуск мок-стенда ТОЛЬКО на localhost. Открыть: http://127.0.0.1:8099/
REM Наружу стенд не выставлять (см. README). Остановить — Ctrl+C.
cd /d "%~dp0"
if "%STAND_HOST%"=="" set STAND_HOST=127.0.0.1
if "%STAND_PORT%"=="" set STAND_PORT=8099
echo htm-mock -^> http://%STAND_HOST%:%STAND_PORT%/   (Ctrl+C - stop)
php -S %STAND_HOST%:%STAND_PORT% -t public public\router.php

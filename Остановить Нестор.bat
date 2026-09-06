@echo off
chcp 65001 >nul
title Нестор — остановка
cd /d "%~dp0"
echo.
echo   Останавливаю Нестор. Данные остаются на месте.
echo.
docker compose stop
echo.
echo   Остановлено. Запустить снова — "Запустить Нестор.bat".
echo.
pause

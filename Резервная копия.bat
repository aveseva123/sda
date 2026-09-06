@echo off
chcp 65001 >nul
title Нестор — резервная копия
cd /d "%~dp0"

if not exist "backup" mkdir "backup"
for /f "tokens=1-3 delims=." %%a in ("%date%") do set stamp=%%c-%%b-%%a

echo.
echo   Снимаю резервную копию в папку backup\
echo.

docker compose exec -T db pg_dump -U sda sda > "backup\nestor-%stamp%.sql"
if errorlevel 1 (
  echo   Не удалось снять базу. Платформа запущена?
  pause
  exit /b 1
)

rem Файлы DXF лежат в томе, поэтому копируются прямо из контейнера.
docker compose cp api:/storage "backup\storage-%stamp%" >nul

echo   Готово:
echo     backup\nestor-%stamp%.sql      — база (заказы, раскрои, склад)
echo     backup\storage-%stamp%\        — загруженные DXF
echo.
echo   Копируйте эту папку на флешку или в облако. Без неё поломка диска
echo   означает потерю всех заказов.
echo.
pause

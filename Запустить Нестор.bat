@echo off
chcp 65001 >nul
title Нестор — платформа раскроя
cd /d "%~dp0"

echo.
echo   НЕСТОР — запуск платформы раскроя
echo   ---------------------------------
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo   Не найден Docker Desktop.
  echo.
  echo   Скачайте и установите его с https://www.docker.com/products/docker-desktop
  echo   затем перезагрузите компьютер и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo   Docker Desktop установлен, но не запущен.
  echo   Откройте Docker Desktop, дождитесь надписи Running и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   Создан файл настроек .env
)

echo   Собираю и запускаю (в первый раз это 5-10 минут)...
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo   Не удалось запустить. Скопируйте текст выше и покажите разработчику.
  pause
  exit /b 1
)

echo.
echo   Наполняю справочники (материалы, фрезы, пресеты)...
docker compose exec -T api python -m app.scripts.seed

echo.
echo   Готово. Платформа работает.
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do (
    echo   С этого компьютера:  http://localhost:8080
    echo   С других в цеху:     http://%%b:8080
    goto :opened
  )
)
:opened
echo.
echo   Платформа продолжит работать, даже если закрыть это окно.
echo   Чтобы остановить — запустите "Остановить Нестор.bat".
echo.
start http://localhost:8080
pause

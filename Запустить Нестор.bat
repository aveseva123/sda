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
  echo   Установите его с https://www.docker.com/products/docker-desktop
  echo   перезагрузите компьютер и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo   Docker Desktop установлен, но не запущен.
  echo   Откройте Docker Desktop, дождитесь надписи Running и повторите.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   Создан файл настроек .env
)

echo   Собираю и запускаю. Первый раз это 5-10 минут и нужен интернет.
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo   Не удалось запустить. Скопируйте текст выше и покажите разработчику.
  pause
  exit /b 1
)

echo.
echo   Жду, пока применятся миграции базы...
set /a tries=0
:waitloop
docker compose exec -T api python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" >nul 2>nul
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% GEQ 60 (
  echo   База не поднялась за пять минут. Покажите разработчику вывод команды:
  echo     docker compose logs api
  pause
  exit /b 1
)
timeout /t 5 /nobreak >nul
goto waitloop

:ready
echo   Наполняю справочники (материалы, фрезы, пресеты)...
docker compose exec -T api python -m app.scripts.seed

echo.
echo   Готово. Платформа работает.
echo.
echo   На этом компьютере:  http://localhost:8080
echo.
echo   С других компьютеров цеха — по адресу этого компьютера в сети.
echo   Подходящие адреса (обычно 192.168.* или 10.*):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do (
    echo %%b | findstr /r "^19[26]\. ^10\. ^172\.1[6-9]\. ^172\.2[0-9]\. ^172\.3[01]\." >nul && echo      http://%%b:8080
  )
)
echo.
echo   Платформа продолжит работать, даже если закрыть это окно.
echo   Чтобы она поднималась после перезагрузки компьютера, включите в
echo   Docker Desktop: Settings - General - Start Docker Desktop when you log in.
echo.
start http://localhost:8080
pause

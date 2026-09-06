@echo off
chcp 65001 >nul
title Нестор — запуск без Docker
cd /d "%~dp0"

echo.
echo   НЕСТОР — запуск без Docker
echo   --------------------------
echo   Способ для случая, когда Docker поставить не получается.
echo   Всё работает на одном компьютере, база лежит файлом рядом.
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo   Не найден Python. Установите с https://www.python.org/downloads/
  echo   ОБЯЗАТЕЛЬНО поставьте галочку "Add python.exe to PATH".
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo   Не найден Node.js. Установите LTS с https://nodejs.org
  pause
  exit /b 1
)

if not exist "backend\.venv" (
  echo   Готовлю окружение Python, это пара минут...
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -q -e backend
  if errorlevel 1 (
    echo   Не удалось поставить библиотеки. Покажите текст выше разработчику.
    pause
    exit /b 1
  )
)

if not exist "frontend\dist\index.html" (
  echo   Собираю интерфейс, это пара минут...
  pushd frontend
  call npm ci
  call npm run build
  popd
  if not exist "frontend\dist\index.html" (
    echo   Интерфейс не собрался. Покажите текст выше разработчику.
    pause
    exit /b 1
  )
)

rem Пути абсолютные: иначе база и файлы разъедутся между шагами.
set DATABASE_URL=sqlite+pysqlite:///%~dp0nestor.db
set STORAGE_DIR=%~dp0storage
set CONFIG_DIR=%~dp0config

echo   Готовлю базу и справочники...
backend\.venv\Scripts\python -c "import app.models; from app.core.db import Base, engine; Base.metadata.create_all(engine)"
if errorlevel 1 (
  echo   Не удалось создать базу. Покажите текст выше разработчику.
  pause
  exit /b 1
)
backend\.venv\Scripts\python -m app.scripts.seed

echo.
echo   Запускаю. Окно не закрывать — пока оно открыто, платформа работает.
echo.
echo   На этом компьютере:  http://localhost:8080
echo   С других в цеху — по адресу этого компьютера, порт 8080.
echo.
start http://localhost:8080
backend\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
pause

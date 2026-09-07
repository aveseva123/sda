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

rem Библиотеки геометрии собраны не под все версии Python. Берём ту, на
rem которой платформа проверена, а самую свежую — только если выбора нет.
set PY=
for %%v in (3.12 3.11 3.13) do (
  if not defined PY (
    py -%%v -c "import sys" >nul 2>nul && set "PY=py -%%v"
  )
)
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo   Не найден Python. Установите с https://www.python.org/downloads/
  echo   ОБЯЗАТЕЛЬНО поставьте галочку "Add python.exe to PATH".
  pause
  exit /b 1
)
echo   Python: %PY%
where npm >nul 2>nul
if errorlevel 1 (
  echo   Не найден Node.js. Установите LTS с https://nodejs.org
  pause
  exit /b 1
)

if not exist "backend\.venv" (
  echo   Готовлю окружение Python, это пара минут...
  %PY% -m venv backend\.venv
  backend\.venv\Scripts\python -m pip install -q --upgrade pip
  backend\.venv\Scripts\pip install -e backend
  if errorlevel 1 (
    echo.
    echo   Не удалось поставить библиотеки.
    echo   Чаще всего помогает установка проверенной версии Python:
    echo       py install 3.12
    echo   затем удалите папку backend\.venv и запустите этот файл снова.
    echo.
    pause
    exit /b 1
  )
)

rem Собранный интерфейс устаревает молча: после обновления кода в
rem frontend\dist лежит вчерашняя сборка, а скрипт видел «файл на месте» и
rem сборку пропускал. Человек обновлял платформу и не понимал, почему на
rem экране ничего не изменилось. Сравниваем время сборки с исходниками.
rem Если проверить не удалось — пересобираем: лишняя минута безопаснее
rem вчерашнего интерфейса.
set "FRONT_STALE=1"
if exist "frontend\dist\index.html" call :check_front
if "%FRONT_STALE%"=="0" goto front_ready

echo   Собираю интерфейс, это пара минут...
pushd frontend
if not exist "node_modules" call npm ci
call npm run build
if errorlevel 1 (
  popd
  echo.
  echo   Интерфейс не собрался. Если в обновлении появились новые
  echo   библиотеки — удалите папку frontend\node_modules и запустите
  echo   этот файл снова. Иначе покажите текст выше разработчику.
  pause
  exit /b 1
)
popd

:front_ready

rem Пути абсолютные: иначе база и файлы разъедутся между шагами.
set DATABASE_URL=sqlite+pysqlite:///%~dp0nestor.db
set STORAGE_DIR=%~dp0storage
set CONFIG_DIR=%~dp0config

echo   Готовлю базу и справочники...
backend\.venv\Scripts\python -m app.scripts.sync_schema
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

exit /b 0

rem Сборка считается свежей, только если её файл новее всех исходников.
rem Любая осечка проверки — это «пересобрать», а не «оставить как есть».
:check_front
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$b=(Get-Item 'frontend\dist\index.html').LastWriteTimeUtc;$s=@(Get-ChildItem -File -Recurse 'frontend\src' -ErrorAction SilentlyContinue)+@(Get-Item 'frontend\index.html','frontend\package.json','frontend\package-lock.json','frontend\vite.config.ts' -ErrorAction SilentlyContinue);if(@($s|Where-Object{$_.LastWriteTimeUtc -gt $b}).Count -gt 0){exit 1};exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (set "FRONT_STALE=1") else (set "FRONT_STALE=0")
exit /b

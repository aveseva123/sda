#!/usr/bin/env bash
# Запуск без Docker: один процесс, база файлом рядом. Для случая, когда
# виртуализацию включить нельзя. Windows — «Запустить без Docker.bat».
set -euo pipefail
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "Не найден Python 3." >&2; exit 1; }
command -v npm >/dev/null || { echo "Не найден Node.js." >&2; exit 1; }

[ -d backend/.venv ] || {
  echo "Готовлю окружение Python…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -e backend
}

# Собранный интерфейс устаревает молча: после обновления кода в
# frontend/dist лежит вчерашняя сборка, а скрипт видел «файл на месте» и
# пропускал сборку. Человек обновлял платформу и не понимал, почему ничего
# не изменилось. Сравниваем время сборки с исходниками.
frontend_stale() {
  [ -f frontend/dist/index.html ] || return 0
  [ -n "$(find frontend/src frontend/index.html frontend/package.json \
               frontend/package-lock.json frontend/vite.config.ts \
               -newer frontend/dist/index.html -print 2>/dev/null | head -n 1)" ]
}

if frontend_stale; then
  echo "Собираю интерфейс…"
  (
    cd frontend
    [ -d node_modules ] || npm ci
    npm run build
  )
fi

export DATABASE_URL="sqlite+pysqlite:///$PWD/nestor.db"
export STORAGE_DIR="$PWD/storage"
export CONFIG_DIR="$PWD/config"

echo "Готовлю базу и справочники…"
backend/.venv/bin/python -m app.scripts.sync_schema
backend/.venv/bin/python -m app.scripts.seed

echo
echo "Платформа запускается. Окно не закрывать."
echo "  на этом компьютере: http://localhost:8080"
echo
exec backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080

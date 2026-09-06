#!/usr/bin/env bash
# Запуск платформы в цеху (macOS и Linux). Windows — «Запустить Нестор.bat».
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || {
  echo "Не найден Docker. Установите Docker Desktop и повторите." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Docker установлен, но не запущен. Откройте Docker Desktop и повторите." >&2
  exit 1
}

[ -f .env ] || { cp .env.example .env; echo "Создан файл настроек .env"; }

echo "Собираю и запускаю (в первый раз 5–10 минут)…"
docker compose up -d --build

echo "Наполняю справочники…"
docker compose exec -T api python -m app.scripts.seed

ip=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "")
echo
echo "Готово. Платформа работает:"
echo "  на этом компьютере: http://localhost:8080"
[ -n "$ip" ] && echo "  с других в цеху:    http://$ip:8080"
echo
echo "Остановить: docker compose stop"

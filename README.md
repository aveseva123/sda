# Furniture CAM

Настольная CAM-система для мебельного ЧПУ-фрезера на стойке Weihong NC-Studio.
Техническое задание — [`SPEC.md`](SPEC.md), план — [`PLAN.md`](PLAN.md),
решения — [`DECISIONS.md`](DECISIONS.md), история — [`CHANGELOG.md`](CHANGELOG.md),
открытые вопросы заказчику — [`QUESTIONS.md`](QUESTIONS.md).

Текущий этап: **M0 — каркас**. Программа открывается, база создаётся и мигрирует,
но ни DXF, ни G-код ещё не обрабатываются.

## Требования

- Python 3.12 (ровно 3.12: см. `requires-python`)
- [`uv`](https://github.com/astral-sh/uv) — рекомендуется, но достаточно `pip`
- Linux без дисплея: для тестов Qt нужны `libegl1`, `libopengl0`, `libgl1`
  и переменная `QT_QPA_PLATFORM=offscreen`

## Установка для разработки

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e ".[dev]"
```

## Запуск

```bash
.venv/bin/cam              # графический интерфейс (python -m cam)
.venv/bin/cam-cli version  # служебные команды без Qt
.venv/bin/cam-cli db status
.venv/bin/cam-cli db upgrade
.venv/bin/cam-cli db backup
```

Папка данных (SQLite `cam.sqlite`, `backups/`): переменная `CAM_DATA_DIR`,
иначе `data/` в корне репозитория; в собранном приложении — `%LOCALAPPDATA%\FurnitureCAM`.

## Проверки качества (обязательны перед коммитом)

```bash
.venv/bin/ruff format . && .venv/bin/ruff check .
.venv/bin/mypy
QT_QPA_PLATFORM=offscreen .venv/bin/python -m pytest
```

## Структура

```
cam/
  core/        # ядро без Qt: модели, геометрия, хранение, конфиг
  ui/          # PySide6: главное окно
  resources/   # defaults.yaml; позже — профили станков, постпроцессор, правила, этикетки
  cli.py       # cam-cli
tests/         # pytest; golden/ и fixtures/ наполняются на M3 и M1
```

## Миграции базы

Схема — `cam/core/storage/orm.py`, миграции — `cam/core/storage/migrations/versions/`.
После изменения ORM новая ревизия создаётся программно:

```bash
.venv/bin/python -c "
from pathlib import Path
from alembic import command
from cam.core.storage import migrate
from cam.core.storage.db import make_engine
engine = make_engine(Path('/tmp/mig.sqlite')); migrate.upgrade(engine)
command.revision(migrate.alembic_config(engine), message='описание', autogenerate=True)
"
```

Тест `test_migrations_match_orm_metadata` не даст закоммитить ORM без миграции.

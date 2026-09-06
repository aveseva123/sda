"""Приведение схемы SQLite к текущим моделям — для запуска без Docker.

В бою база — PostgreSQL, и её ведёт Alembic. Но у варианта «без Docker»
база лежит файлом, а миграции написаны на диалекте Postgres (JSONB, ALTER с
внешними ключами) и на SQLite не выполнятся. Без этого шага обновление
платформы падало бы на «no such column»: create_all() создаёт недостающие
таблицы, но не добавляет колонки в уже существующие.

Здесь делается ровно то, что SQLite умеет безопасно: создать новые таблицы и
дописать недостающие колонки. Всё остальное — переименования, смену типов,
удаление — скрипт не трогает и честно об этом говорит.

Запуск:  python -m app.scripts.sync_schema
"""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.schema import CreateColumn

import app.models  # noqa: F401  (регистрирует таблицы в метаданных)
from app.core.db import Base, engine


def sync() -> dict:
    """Создаёт недостающие таблицы и колонки. Возвращает, что изменилось."""
    Base.metadata.create_all(engine)

    added: list[str] = []
    skipped: list[str] = []
    inspector = inspect(engine)

    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if table.name not in inspector.get_table_names():
                continue
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                # SQLite добавляет колонку только если она допускает NULL или
                # имеет константу по умолчанию. Иначе трогать таблицу опасно.
                if not column.nullable and column.server_default is None:
                    skipped.append(f"{table.name}.{column.name}")
                    continue
                ddl = CreateColumn(column).compile(engine).string
                connection.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {ddl}"))
                added.append(f"{table.name}.{column.name}")

    return {"added": added, "skipped": skipped}


def main() -> None:
    result = sync()
    if result["added"]:
        print("Добавлены колонки: " + ", ".join(result["added"]))
    else:
        print("Схема уже соответствует моделям.")
    if result["skipped"]:
        print(
            "Не удалось добавить автоматически: "
            + ", ".join(result["skipped"])
            + ". Это обязательные поля без значения по умолчанию — "
            "для такой правки нужна миграция на PostgreSQL."
        )


if __name__ == "__main__":
    main()

"""Окружение Alembic. Движок приходит из ``migrate.alembic_config`` через attributes."""

from __future__ import annotations

from alembic import context
from sqlalchemy import Engine

from cam.core.storage.orm import Base

config = context.config
target_metadata = Base.metadata


def _engine() -> Engine:
    engine = config.attributes.get("engine")
    if engine is None:
        raise RuntimeError(
            "Миграции запускаются через cam.core.storage.migrate (или cam-cli db ...), "
            "а не через консольный alembic без движка"
        )
    return engine  # type: ignore[no-any-return]


def run_migrations_online() -> None:
    with _engine().connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite: ALTER TABLE только через пересоздание
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline-режим Alembic в проекте не используется")
run_migrations_online()

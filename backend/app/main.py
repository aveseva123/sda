"""Точка входа API.

Интерфейс и сообщения — на русском; архитектурно оставлена возможность
добавить языки (тексты собраны в app/core/i18n.py).
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    cutting,
    imports,
    materials,
    nesting,
    orders,
    parts,
    presets,
    stock,
    toolpaths,
    tools,
)
from app.core.settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

settings = get_settings()

app = FastAPI(
    title="Платформа раскроя листовых материалов",
    description=(
        "Импорт DXF, автосортировка по толщинам, дерево проектов, "
        "цветовая система, раскрой, стикеры и генерация УП."
    ),
    version="0.1.0",
    docs_url=f"{settings.api_prefix}/docs",
    openapi_url=f"{settings.api_prefix}/openapi.json",
)

# Цех работает в локальной сети, фронтенд может отдаваться с другого порта.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    orders.router,
    parts.router,
    materials.router,
    imports.router,
    stock.router,
    nesting.router,
    toolpaths.router,
    tools.router,
    cutting.router,
    presets.router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get(f"{settings.api_prefix}/health", tags=["Служебное"])
def health() -> dict:
    return {"status": "ok"}

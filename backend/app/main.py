"""Точка входа API.

Интерфейс и сообщения — на русском; архитектурно оставлена возможность
добавить языки (тексты собраны в app/core/i18n.py).
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

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


@app.exception_handler(IntegrityError)
def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
    """Нарушение целостности — это не «внутренняя ошибка сервера».

    Технолог удаляет материал, на котором висит склад, или заводит второй
    материал с тем же именем и толщиной. База отвечает отказом, и человек в
    цеху должен прочитать, что именно не так, а не голое «500».
    """
    text = str(getattr(exc, "orig", exc))
    if "unique" in text.lower():
        detail = "Такая запись уже есть: значения должны быть уникальными."
    elif "foreign key" in text.lower() or "violates foreign key" in text.lower():
        detail = (
            "Запись используется в других данных — сначала уберите её оттуда."
        )
    else:
        detail = "Данные не прошли проверку целостности."
    logging.getLogger(__name__).warning("Нарушение целостности: %s", text)
    return JSONResponse(status_code=409, content={"detail": detail})


@app.get(f"{settings.api_prefix}/health", tags=["Служебное"])
def health() -> dict:
    return {"status": "ok"}


class SpaFiles(StaticFiles):
    """Раздача собранного интерфейса.

    Маршруты редактора живут в адресной строке (/editor, /tools), а файлов
    для них на диске нет: при обновлении страницы нужно отдать index.html и
    дать роутеру разобраться самому.
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return FileResponse(self.directory / "index.html")
            raise


if settings.static_dir.exists():
    # Интерфейс и API с одного порта: в цеху это один процесс вместо связки
    # «nginx + сервер», и запускать его может человек без командной строки.
    app.mount("/", SpaFiles(directory=settings.static_dir, html=True), name="ui")
    logging.getLogger(__name__).info("Интерфейс раздаётся из %s", settings.static_dir)

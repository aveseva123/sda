"""Библиотека фрез: магазин станка, режимы по материалам, ресурс."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.cutting import service as cutting
from app.models import Tool
from app.schemas import ToolIn, ToolResourceIn
from app.tools import service

router = APIRouter(tags=["Фрезы"])


@router.get("/tools", response_model=dict)
def list_tools(db: Session = Depends(get_db)) -> dict:
    """Все фрезы и раскладка магазина. При первом обращении наполняется
    из config/tools.yaml."""
    # «Где используется» читается из пресетов раскроя — их тоже подтягиваем
    # из конфига, иначе связь фрезы с пресетом не видна на пустой базе.
    cutting.sync_presets(db)
    tools = service.all_tools(db)
    return {
        "magazine": service.magazine(db),
        "slots": service.magazine_slots(),
        "tools": [service.as_dict(db, tool) for tool in tools],
    }


@router.post("/tools", response_model=dict, status_code=201)
def create_tool(payload: ToolIn, db: Session = Depends(get_db)) -> dict:
    tool = Tool(**payload.model_dump(), is_builtin=False)
    tool.number = tool.slot or 0
    db.add(tool)
    db.flush()
    return service.as_dict(db, tool)


@router.put("/tools/{tool_id}", response_model=dict)
def update_tool(tool_id: int, payload: ToolIn, db: Session = Depends(get_db)) -> dict:
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(404, "Фреза не найдена")
    for key, value in payload.model_dump().items():
        setattr(tool, key, value)
    # Правка руками отвязывает фрезу от конфига: в цеху инструмент меняют
    # чаще, чем правят YAML.
    tool.is_builtin = False
    tool.number = tool.slot or tool.number
    db.flush()
    return service.as_dict(db, tool)


@router.post("/tools/{tool_id}/resource", response_model=dict)
def set_resource(tool_id: int, payload: ToolResourceIn, db: Session = Depends(get_db)) -> dict:
    """Отметка о наработке или замене фрезы.

    ``used`` — сколько пройдено в материале; при замене ставится ноль.
    """
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(404, "Фреза не найдена")
    tool.resource_used = max(0.0, payload.used)
    if payload.limit is not None:
        tool.resource_limit = payload.limit
    tool.is_builtin = False
    db.flush()
    return service.as_dict(db, tool)


@router.delete("/tools/{tool_id}", status_code=204)
def delete_tool(tool_id: int, db: Session = Depends(get_db)) -> None:
    tool = db.get(Tool, tool_id)
    if tool is None:
        raise HTTPException(404, "Фреза не найдена")
    db.delete(tool)
    db.flush()

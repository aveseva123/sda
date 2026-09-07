"""Репозиторий: pydantic-модели ↔ ORM-строки.

Преобразование единообразное: ``model_dump()`` → конструктор строки, обратно —
``Model.model_validate(row)`` (``from_attributes``). Агрегаты (детали в проекте,
операции в детали и т.д.) описаны таблицей ``_AGGREGATES`` и обходятся рекурсивно.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from cam.core import models as m
from cam.core.storage import orm

E = TypeVar("E", bound=m.Entity)

# поле агрегата -> (класс строки, вложенные агрегаты этого поля)
Children = Mapping[str, tuple[type[orm.Base], "Children"]]

_OPERATIONS: Children = {"operations": (orm.OperationRow, {})}

_AGGREGATES: dict[type[m.Entity], Children] = {
    m.Project: {"parts": (orm.PartRow, _OPERATIONS)},
    m.Part: _OPERATIONS,
    m.Batch: {
        "part_instances": (orm.PartInstanceRow, {}),
        "nest_results": (orm.NestResultRow, {}),
    },
    m.ImportProfile: {"rules": (orm.LayerRuleRow, {})},
}

_ROWS: dict[type[m.Entity], type[orm.Base]] = {
    m.Material: orm.MaterialRow,
    m.SheetStock: orm.SheetStockRow,
    m.EdgeBandStock: orm.EdgeBandStockRow,
    m.Tool: orm.ToolRow,
    m.CuttingMode: orm.CuttingModeRow,
    m.TechProfile: orm.TechProfileRow,
    m.ImportProfile: orm.ImportProfileRow,
    m.LayerRule: orm.LayerRuleRow,
    m.Project: orm.ProjectRow,
    m.Part: orm.PartRow,
    m.Operation: orm.OperationRow,
    m.Batch: orm.BatchRow,
    m.PartInstance: orm.PartInstanceRow,
    m.NestResult: orm.NestResultRow,
    m.NcProgram: orm.NcProgramRow,
    m.User: orm.UserRow,
    m.StockTxn: orm.StockTxnRow,
}


class NotFoundError(LookupError):
    """Сущность с таким id отсутствует в базе."""


def row_class(entity_cls: type[m.Entity]) -> type[orm.Base]:
    try:
        return _ROWS[entity_cls]
    except KeyError as exc:
        raise TypeError(f"{entity_cls.__name__} не хранится в базе") from exc


def to_row(model: BaseModel, row_cls: type[orm.Base], children: Children) -> orm.Base:
    """Собрать ORM-строку (с вложенными) из pydantic-модели."""
    data = model.model_dump(exclude=set(children))
    row = row_cls(**data)
    for field, (child_cls, grandchildren) in children.items():
        items: list[BaseModel] = getattr(model, field)
        setattr(row, field, [to_row(item, child_cls, grandchildren) for item in items])
    return row


class Repository:
    """CRUD поверх сессии SQLAlchemy. Транзакциями управляет вызывающий код."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, entity: E) -> E:
        """Сохранить новую сущность (с агрегатом) и вернуть её с проставленными id."""
        if entity.id is not None:
            raise ValueError(
                f"{type(entity).__name__} уже имеет id={entity.id}; используйте update"
            )
        row = to_row(entity, row_class(type(entity)), _AGGREGATES.get(type(entity), {}))
        self.session.add(row)
        self.session.flush()
        return type(entity).model_validate(row)

    def get(self, entity_cls: type[E], entity_id: int) -> E | None:
        row = self.session.get(row_class(entity_cls), entity_id)
        return None if row is None else entity_cls.model_validate(row)

    def require(self, entity_cls: type[E], entity_id: int) -> E:
        found = self.get(entity_cls, entity_id)
        if found is None:
            raise NotFoundError(f"{entity_cls.__name__} id={entity_id} не найден")
        return found

    def list(self, entity_cls: type[E]) -> list[E]:
        row_cls = row_class(entity_cls)
        rows = self.session.scalars(select(row_cls).order_by(row_cls.id)).all()  # type: ignore[attr-defined]
        return [entity_cls.model_validate(row) for row in rows]

    def update(self, entity: E) -> E:
        """Записать изменения сущности с id. Вложенные объекты без id — добавятся,
        отсутствующие в агрегате — удалятся (delete-orphan)."""
        if entity.id is None:
            raise ValueError(f"{type(entity).__name__} без id нельзя обновить; используйте add")
        row_cls = row_class(type(entity))
        if self.session.get(row_cls, entity.id) is None:
            raise NotFoundError(f"{type(entity).__name__} id={entity.id} не найден")
        row = to_row(entity, row_cls, _AGGREGATES.get(type(entity), {}))
        merged = self.session.merge(row)
        self.session.flush()
        return type(entity).model_validate(merged)

    def delete(self, entity_cls: type[m.Entity], entity_id: int) -> None:
        row = self.session.get(row_class(entity_cls), entity_id)
        if row is None:
            raise NotFoundError(f"{entity_cls.__name__} id={entity_id} не найден")
        self.session.delete(row)
        self.session.flush()

    def count(self, entity_cls: type[m.Entity]) -> int:
        row_cls = row_class(entity_cls)
        return len(self.session.scalars(select(row_cls.id)).all())  # type: ignore[attr-defined]

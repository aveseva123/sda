"""Склад листовых материалов и деловой отход.

Цикл, который платформа обязана поддерживать целиком:

    приход листов -> лист ушёл в раскрой -> лист списан
                  -> от него остался обрезок -> обрезок лёг на склад
                  -> обрезок сам ушёл в раскрой -> от него остался обрезок...

Поэтому целый лист и обрезок — одна сущность ``StockItem`` с разным
``kind``: обрезок можно резать так же, как лист, и от него точно так же
остаётся обрезок. Двумя таблицами такую рекурсию пришлось бы дублировать.

Отличие от модели данных в ТЗ: там ``Offcut`` был отдельной таблицей без
количества и без движений. Здесь он стал частным случаем складской позиции,
а все изменения пишутся в журнал ``StockMovement`` — иначе нельзя ответить
на вопрос «куда делся лист».
"""

from __future__ import annotations

from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import JSONType, TimestampMixin
from app.models.enums import StockKind, StockMovementKind, StockStatus


class StockItem(Base, TimestampMixin):
    """Складская позиция: партия одинаковых листов или один обрезок."""

    __tablename__ = "stock_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=StockKind.SHEET)

    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    # Обрезки штучные (qty=1), целые листы приходят партиями.
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=StockStatus.AVAILABLE
    )
    location: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float | None] = mapped_column(Float)

    # Откуда взялся обрезок: из какой складской позиции его отрезали.
    source_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_items.id", ondelete="SET NULL")
    )
    # На каком листе раскроя это произошло. use_alter: sheets ссылается
    # обратно на stock_items, FK создаётся отдельным ALTER.
    source_sheet_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "sheets.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_stock_items_source_sheet_id",
        )
    )
    # Реальная форма обрезка, если он не прямоугольный.
    geometry: Mapped[dict | None] = mapped_column(JSONType)

    # foreign_keys обязателен: из stock_movements на stock_items ведут две
    # ссылки — сама позиция и родившийся обрезок.
    movements: Mapped[list[StockMovement]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        foreign_keys="StockMovement.item_id",
    )

    __table_args__ = (
        Index("ix_stock_items_material", "material_id"),
        Index("ix_stock_items_status", "status"),
    )

    @property
    def area_m2(self) -> float:
        return round(self.w * self.h / 1_000_000, 4)

    @property
    def long_side(self) -> float:
        return max(self.w, self.h)

    @property
    def short_side(self) -> float:
        return min(self.w, self.h)


class StockMovement(Base, TimestampMixin):
    """Журнал движений склада: приход, списание, появление обрезка.

    Нужен, чтобы на вопрос «куда делся лист» был ответ, а остаток
    не приходилось принимать на веру.
    """

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("stock_items.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # Положительное — приход, отрицательное — расход.
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    # Кто отметил. Пока свободный текст: роли появятся на Этапе 5.
    actor: Mapped[str | None] = mapped_column(String(120))
    # Обрезок, который родился в этом движении.
    offcut_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_items.id", ondelete="SET NULL")
    )

    item: Mapped[StockItem] = relationship(
        back_populates="movements", foreign_keys=[item_id]
    )

    __table_args__ = (Index("ix_stock_movements_item", "item_id"),)

    @staticmethod
    def kinds() -> tuple[str, ...]:
        return tuple(StockMovementKind)

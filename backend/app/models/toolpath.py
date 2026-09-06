"""Пресеты траекторий и их назначение на векторы детали.

Модель повторяет то, как это устроено в ArtCAM: выбираешь вектор и
применяешь к нему стратегию обработки. Пресет живёт отдельно от детали,
назначение — отдельной строкой, поэтому один пресет можно поменять сразу
во всех деталях, а конкретной детали — задать исключение.

Назначение делается на ДЕТАЛЬ, а не на экземпляр: все экземпляры одной
детали обрабатываются одинаково, различаются только положением на листе.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import JSONType, TimestampMixin


class ToolpathPreset(Base, TimestampMixin):
    """Стратегия обработки: сторона коррекции, глубина, инструмент, режимы."""

    __tablename__ = "toolpath_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Идентификатор из конфига, если пресет пришёл оттуда.
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Семантика вектора, для которой пресет предназначен (может быть пустой).
    semantic: Mapped[str | None] = mapped_column(String(16))
    # outside | inside | center | none
    side: Mapped[str] = mapped_column(String(16), nullable=False, default="outside")

    tool_id: Mapped[int | None] = mapped_column(
        ForeignKey("tools.id", ondelete="SET NULL")
    )
    # Диаметр, если инструмент не выбран из справочника.
    tool_diameter: Mapped[float | None] = mapped_column(Float)
    tool_type: Mapped[str | None] = mapped_column(String(32))

    # {"mode": "from_layer|through|fixed", "value": .., "fallback": .., "overcut": ..}
    depth: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)

    step_down: Mapped[float | None] = mapped_column(Float)
    finish_pass: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    finish_allowance: Mapped[float | None] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="climb")
    # {"type": "arc|normal|none", "radius": ..}
    lead: Mapped[dict | None] = mapped_column(JSONType)
    # auto | always | never
    tabs: Mapped[str] = mapped_column(String(16), nullable=False, default="auto")
    # Прочие параметры стратегии: шаг выборки, клевки и т.п.
    params: Mapped[dict | None] = mapped_column(JSONType)
    # Цвет траектории на холсте.
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#111827")
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("slug", name="uq_toolpath_presets_slug"),)


class PartToolpath(Base, TimestampMixin):
    """Назначение пресета на конкретный вектор детали.

    ``target`` адресует вектор внутри геометрии детали:
      * ``outer``    — внешний контур;
      * ``inner:3``  — внутренний вырез с индексом 3;
      * ``op:7``     — операция (присадка, паз, карман) с индексом 7.
    """

    __tablename__ = "part_toolpaths"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(
        ForeignKey("parts.id", ondelete="CASCADE"), nullable=False
    )
    target: Mapped[str] = mapped_column(String(32), nullable=False)
    preset_id: Mapped[int] = mapped_column(
        ForeignKey("toolpath_presets.id", ondelete="CASCADE"), nullable=False
    )
    # Точечные отклонения от пресета для этого вектора.
    overrides: Mapped[dict | None] = mapped_column(JSONType)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Назначено автоматически по семантике или руками технолога.
    assigned_manually: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    preset: Mapped[ToolpathPreset] = relationship()

    __table_args__ = (
        UniqueConstraint("part_id", "target", name="uq_part_toolpaths_part_target"),
        Index("ix_part_toolpaths_part", "part_id"),
    )

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import JSONType, TimestampMixin


class Material(Base, TimestampMixin):
    """Справочник материалов. Толщина — часть идентичности материала:
    раскрой всегда идёт по паре «материал + толщина»."""

    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    thickness: Mapped[float] = mapped_column(Float, nullable=False)
    has_grain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Формат листа по умолчанию; дополнительные типоразмеры — в sheet_formats.
    sheet_w: Mapped[float] = mapped_column(Float, nullable=False, default=2800.0)
    sheet_h: Mapped[float] = mapped_column(Float, nullable=False, default=2070.0)

    price: Mapped[float | None] = mapped_column(Float)
    supplier: Mapped[str | None] = mapped_column(String(200))

    # Обрезка кромок листа, настраиваемая с каждой стороны.
    trim_left: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    trim_right: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    trim_top: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    trim_bottom: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)

    # Ограничение по количеству листов в наличии (None — не ограничено).
    stock_sheets: Mapped[int | None] = mapped_column()

    # Алиасы для распознавания материала в именах файлов и спецификациях.
    aliases: Mapped[list | None] = mapped_column(JSONType)

    sheet_formats: Mapped[list[MaterialSheetFormat]] = relationship(
        back_populates="material", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("name", "thickness", name="uq_materials_name_thickness"),
    )


class MaterialSheetFormat(Base, TimestampMixin):
    """Дополнительный типоразмер листа для материала."""

    __tablename__ = "material_sheet_formats"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    price: Mapped[float | None] = mapped_column(Float)

    material: Mapped[Material] = relationship(back_populates="sheet_formats")


class Offcut(Base, TimestampMixin):
    """Деловой отход: полезный обрезок, доступный как виртуальный лист.
    Предлагается к использованию в следующих заданиях в первую очередь."""

    __tablename__ = "offcuts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # use_alter: sheets.offcut_id ссылается обратно на offcuts, поэтому FK
    # создаётся отдельным ALTER после обеих таблиц.
    source_sheet_id: Mapped[int | None] = mapped_column(
        ForeignKey("sheets.id", ondelete="SET NULL", use_alter=True,
                   name="fk_offcuts_source_sheet_id")
    )
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    # Реальная форма обрезка (может быть не прямоугольной).
    geometry: Mapped[dict | None] = mapped_column(JSONType)
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    location: Mapped[str | None] = mapped_column(String(200))

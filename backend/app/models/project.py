from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import JSONType, TimestampMixin
from app.models.enums import GrainMode, PartStatus, ResolveSource


class Project(Base, TimestampMixin):
    """Объект/заказ. Носитель базового цвета всей цветовой системы."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    client: Mapped[str | None] = mapped_column(String(200))
    # Индекс в палитре (различимой для дальтоников); hex вычисляется из него,
    # но хранится тоже — чтобы технолог мог переопределить цвет вручную.
    color_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#1f77b4")
    deadline: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")

    products: Mapped[list[Product]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("name", name="uq_projects_name"),)


class Product(Base, TimestampMixin):
    """Изделие внутри проекта (шкаф, тумба, стеллаж)."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(64))
    # Оттенок/паттерн базового цвета проекта: цвет = проект, штриховка = изделие.
    shade_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped[Project] = relationship(back_populates="products")
    parts: Mapped[list[Part]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_products_project_name"),
    )


class Part(Base, TimestampMixin):
    """Деталь — позиция с количеством, а не отдельный экземпляр."""

    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(64))
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Габариты, мм. Считаются из геометрии, могут быть переопределены спецификацией.
    length: Mapped[float | None] = mapped_column(Float)
    width: Mapped[float | None] = mapped_column(Float)
    thickness: Mapped[float | None] = mapped_column(Float)

    material_id: Mapped[int | None] = mapped_column(
        ForeignKey("materials.id", ondelete="SET NULL")
    )
    grain: Mapped[str] = mapped_column(String(16), nullable=False, default=GrainMode.NONE)

    # Карта кромок: тип кромки по сторонам (None — кромки нет).
    edge_top: Mapped[str | None] = mapped_column(String(64))
    edge_bottom: Mapped[str | None] = mapped_column(String(64))
    edge_left: Mapped[str | None] = mapped_column(String(64))
    edge_right: Mapped[str | None] = mapped_column(String(64))

    # Нормализованная геометрия: внешний контур, внутренние, операции, bbox.
    geometry: Mapped[dict | None] = mapped_column(JSONType)
    source_file: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=PartStatus.READY
    )
    # Откуда взялась толщина и насколько уверенно — для очереди уточнений.
    thickness_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ResolveSource.UNRESOLVED
    )
    thickness_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    material_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ResolveSource.UNRESOLVED
    )
    # Что именно не удалось определить — показывается технологу.
    clarification: Mapped[dict | None] = mapped_column(JSONType)
    # Переопределения правил глубин на уровне конкретной детали.
    depth_overrides: Mapped[dict | None] = mapped_column(JSONType)

    product: Mapped[Product] = relationship(back_populates="parts")
    instances: Mapped[list[PartInstance]] = relationship(
        back_populates="part", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_parts_product", "product_id"),
        Index("ix_parts_status", "status"),
        Index("ix_parts_material_thickness", "material_id", "thickness"),
    )


class PartInstance(Base, TimestampMixin):
    """Конкретный физический экземпляр детали: своя позиция на листе,
    свой стикер, свой сквозной ID для сканирования."""

    __tablename__ = "part_instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(
        ForeignKey("parts.id", ondelete="CASCADE"), nullable=False
    )
    # Сквозной человекочитаемый ID для QR/Code128.
    uid: Mapped[str] = mapped_column(String(64), nullable=False)
    sheet_id: Mapped[int | None] = mapped_column(
        ForeignKey("sheets.id", ondelete="SET NULL")
    )
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    rotation: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Зафиксировано технологом вручную — пересчёт раскроя не сбрасывает.
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Порядок съёма со стола: по нему сортируется печать стикеров.
    pick_order: Mapped[int | None] = mapped_column(Integer)
    label_printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    part: Mapped[Part] = relationship(back_populates="instances")

    __table_args__ = (
        UniqueConstraint("uid", name="uq_part_instances_uid"),
        Index("ix_part_instances_sheet", "sheet_id"),
    )

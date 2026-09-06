from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
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
from app.models.enums import JobStatus, ToolType


class NestingJob(Base, TimestampMixin):
    """Задание на раскрой. Всегда ровно одна пара «материал + толщина»:
    разные толщины никогда не попадают на один лист."""

    __tablename__ = "nesting_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200))
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False
    )
    thickness: Mapped[float] = mapped_column(Float, nullable=False)
    # Пресет раскроя, с которым задание было посчитано. Хранится ссылкой и
    # копией параметров: пресет могут потом поправить, а старая УП должна
    # повторяться точь-в-точь.
    preset_id: Mapped[int | None] = mapped_column(
        ForeignKey("cutting_presets.id", ondelete="SET NULL")
    )
    preset_snapshot: Mapped[dict | None] = mapped_column(JSONType)
    params: Mapped[dict | None] = mapped_column(JSONType)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=JobStatus.DRAFT)
    # Любая перегенерация создаёт новую версию, старая остаётся доступной.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    parent_job_id: Mapped[int | None] = mapped_column(
        ForeignKey("nesting_jobs.id", ondelete="SET NULL")
    )
    utilization: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)

    sheets: Mapped[list[Sheet]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class Sheet(Base, TimestampMixin):
    __tablename__ = "sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("nesting_jobs.id", ondelete="CASCADE"), nullable=False
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False
    )
    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    # Раскрой на деловом отходе, а не на целом листе.
    is_offcut: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Раскрой мог идти по деловому отходу — тогда здесь складская позиция.
    stock_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_items.id", ondelete="SET NULL")
    )
    utilization: Mapped[float | None] = mapped_column(Float)

    job: Mapped[NestingJob] = relationship(back_populates="sheets")

    __table_args__ = (Index("ix_sheets_job", "job_id"),)


class Tool(Base, TimestampMixin):
    __tablename__ = "tools"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    diameter: Mapped[float] = mapped_column(Float, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default=ToolType.END_MILL)
    rpm: Mapped[int] = mapped_column(Integer, nullable=False, default=18000)
    feed: Mapped[float] = mapped_column(Float, nullable=False, default=6000.0)
    plunge_feed: Mapped[float] = mapped_column(Float, nullable=False, default=1500.0)
    step_down: Mapped[float] = mapped_column(Float, nullable=False, default=8.0)
    # Попутно / встречно.
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="climb")


class NcProgram(Base, TimestampMixin):
    """Управляющая программа для одного листа. Версионируется вместе с
    заданием: старую УП можно поднять."""

    __tablename__ = "nc_programs"

    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(
        ForeignKey("sheets.id", ondelete="CASCADE"), nullable=False
    )
    file: Mapped[str] = mapped_column(Text, nullable=False)
    tool_ids: Mapped[list | None] = mapped_column(JSONType)
    est_time: Mapped[float | None] = mapped_column(Float)
    post_id: Mapped[str] = mapped_column(String(64), nullable=False, default="daihong_ncstudio")
    # Черновая, пока постпроцессор не сверен с эталонным .nc со станка.
    is_draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

"""ORM-таблицы SQLAlchemy — зеркало pydantic-моделей из ``core/models.py``.

Правила:
* перечисления хранятся строками (значения ``StrEnum``), без ``sa.Enum`` —
  добавление варианта не должно требовать миграции схемы;
* вложенные структуры (контуры, отступы, параметры, размещения) — JSON-колонки;
* агрегаты (проект → детали → операции, задание → экземпляры/раскрои,
  профиль импорта → правила) — relationship с ``delete-orphan``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JsonDict = dict[str, Any]
JsonList = list[Any]


class Base(DeclarativeBase):
    type_annotation_map = {  # noqa: RUF012 — декларативный атрибут SQLAlchemy
        JsonDict: JSON,
        JsonList: JSON,
        datetime: DateTime,
        date: Date,
        str: String,
    }


class MaterialRow(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    article: Mapped[str] = mapped_column(String(100), default="")
    type: Mapped[str] = mapped_column(String(32))
    nominal_thickness: Mapped[float] = mapped_column(Float)
    actual_thickness: Mapped[float] = mapped_column(Float)
    grain_matters: Mapped[bool] = mapped_column(Boolean, default=False)
    default_sheet_w: Mapped[float] = mapped_column(Float)
    default_sheet_l: Mapped[float] = mapped_column(Float)
    supplier: Mapped[str] = mapped_column(String(200), default="")
    price_per_m2: Mapped[float] = mapped_column(Float, default=0.0)
    batch_code: Mapped[str] = mapped_column(String(100), default="")


class SheetStockRow(Base):
    __tablename__ = "sheet_stock"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), index=True)
    nominal_w: Mapped[float] = mapped_column(Float)
    nominal_l: Mapped[float] = mapped_column(Float)
    actual_w: Mapped[float] = mapped_column(Float)
    actual_l: Mapped[float] = mapped_column(Float)
    trim_allowance: Mapped[JsonDict] = mapped_column(JSON)
    qty: Mapped[int] = mapped_column(Integer, default=0)
    location: Mapped[str] = mapped_column(String(200), default="")
    is_remnant: Mapped[bool] = mapped_column(Boolean, default=False)
    remnant_code: Mapped[str | None] = mapped_column(String(50), unique=True)
    parent_sheet_id: Mapped[int | None] = mapped_column(ForeignKey("sheet_stock.id"))
    polygon: Mapped[JsonDict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    reserved_for_project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))


class EdgeBandStockRow(Base):
    __tablename__ = "edge_band_stock"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    article: Mapped[str] = mapped_column(String(100), default="")
    thickness: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    decor: Mapped[str] = mapped_column(String(200), default="")
    length_meters_left: Mapped[float] = mapped_column(Float, default=0.0)
    supplier: Mapped[str] = mapped_column(String(200), default="")
    price_per_m: Mapped[float] = mapped_column(Float, default=0.0)


class ToolRow(Base):
    __tablename__ = "tools"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32))
    diameter: Mapped[float] = mapped_column(Float)
    flutes: Mapped[int] = mapped_column(Integer)
    cutting_length: Mapped[float] = mapped_column(Float)
    shank_diameter: Mapped[float] = mapped_column(Float)
    max_plunge_depth: Mapped[float] = mapped_column(Float)
    in_atc: Mapped[bool] = mapped_column(Boolean, default=False)
    atc_position: Mapped[int | None] = mapped_column(Integer)
    life_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    used_minutes: Mapped[float] = mapped_column(Float, default=0.0)


class CuttingModeRow(Base):
    __tablename__ = "cutting_modes"

    id: Mapped[int] = mapped_column(primary_key=True)
    tool_id: Mapped[int] = mapped_column(ForeignKey("tools.id"), index=True)
    material_type: Mapped[str] = mapped_column(String(32))
    thickness_from: Mapped[float] = mapped_column(Float)
    thickness_to: Mapped[float] = mapped_column(Float)
    operation_type: Mapped[str] = mapped_column(String(32))
    rpm: Mapped[int] = mapped_column(Integer)
    feed_xy: Mapped[float] = mapped_column(Float)
    feed_z_plunge: Mapped[float] = mapped_column(Float)
    depth_per_pass: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(16))
    entry: Mapped[str] = mapped_column(String(16))
    ramp_angle: Mapped[float | None] = mapped_column(Float)
    ramp_length: Mapped[float | None] = mapped_column(Float)
    lead_in_type: Mapped[str] = mapped_column(String(16))
    lead_radius: Mapped[float | None] = mapped_column(Float)
    finish_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    finish_allowance: Mapped[float] = mapped_column(Float, default=0.0)
    stepover_pct: Mapped[float] = mapped_column(Float)


class TechProfileRow(Base):
    __tablename__ = "tech_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    material_type: Mapped[str] = mapped_column(String(32), index=True)
    thickness_from: Mapped[float] = mapped_column(Float)
    thickness_to: Mapped[float] = mapped_column(Float)
    operation_type: Mapped[str] = mapped_column(String(32), index=True)
    diameter_from: Mapped[float] = mapped_column(Float)
    diameter_to: Mapped[float] = mapped_column(Float)
    width_from: Mapped[float] = mapped_column(Float)
    width_to: Mapped[float] = mapped_column(Float)
    tool_id: Mapped[int] = mapped_column(ForeignKey("tools.id"))
    mode_id: Mapped[int] = mapped_column(ForeignKey("cutting_modes.id"))
    strategy_params: Mapped[JsonDict] = mapped_column(JSON)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)


class ImportProfileRow(Base):
    __tablename__ = "import_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    layer_signature: Mapped[JsonList] = mapped_column(JSON)
    units: Mapped[str | None] = mapped_column(String(8))
    dims_are: Mapped[str] = mapped_column(String(16))
    one_file_one_part: Mapped[bool] = mapped_column(Boolean, default=False)
    rules: Mapped[list[LayerRuleRow]] = relationship(
        cascade="all, delete-orphan", order_by="LayerRuleRow.priority"
    )


class LayerRuleRow(Base):
    __tablename__ = "layer_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int | None] = mapped_column(ForeignKey("import_profiles.id"), index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    layer_regex: Mapped[str | None] = mapped_column(String(500))
    aci_color: Mapped[int | None] = mapped_column(Integer)
    rgb_color: Mapped[str | None] = mapped_column(String(7))
    linetype: Mapped[str | None] = mapped_column(String(100))
    block_name: Mapped[str | None] = mapped_column(String(200))
    geom_closed: Mapped[str] = mapped_column(String(8))
    diameter_from: Mapped[float | None] = mapped_column(Float)
    diameter_to: Mapped[float | None] = mapped_column(Float)
    area_from: Mapped[float | None] = mapped_column(Float)
    area_to: Mapped[float | None] = mapped_column(Float)
    operation_type: Mapped[str] = mapped_column(String(32))
    depth: Mapped[float | None] = mapped_column(Float)
    depth_ref: Mapped[str] = mapped_column(String(16))
    side: Mapped[str] = mapped_column(String(1))
    extra_params: Mapped[JsonDict] = mapped_column(JSON)


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    customer: Mapped[str] = mapped_column(String(200), default="")
    deadline: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    parts: Mapped[list[PartRow]] = relationship(cascade="all, delete-orphan", order_by="PartRow.id")


class PartRow(Base):
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    article: Mapped[str] = mapped_column(String(100), default="")
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"))
    thickness: Mapped[float] = mapped_column(Float)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    outer_contour: Mapped[JsonDict] = mapped_column(JSON)
    inner_contours: Mapped[JsonList] = mapped_column(JSON)
    grain: Mapped[str] = mapped_column(String(8))
    edge_banding: Mapped[JsonDict] = mapped_column(JSON)
    dims_are: Mapped[str] = mapped_column(String(16))
    edge_allowance: Mapped[JsonDict] = mapped_column(JSON)
    is_two_sided: Mapped[bool] = mapped_column(Boolean, default=False)
    source_file: Mapped[str] = mapped_column(String(500), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    operations: Mapped[list[OperationRow]] = relationship(
        cascade="all, delete-orphan", order_by="OperationRow.id"
    )


class OperationRow(Base):
    __tablename__ = "operations"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    geometry: Mapped[JsonDict] = mapped_column(JSON)
    depth: Mapped[float | None] = mapped_column(Float)
    depth_ref: Mapped[str] = mapped_column(String(16))
    side: Mapped[str] = mapped_column(String(1))
    tool_override: Mapped[int | None] = mapped_column(ForeignKey("tools.id"))
    mode_override: Mapped[int | None] = mapped_column(ForeignKey("cutting_modes.id"))
    params: Mapped[JsonDict] = mapped_column(JSON)
    low_confidence: Mapped[bool] = mapped_column(Boolean, default=False)


class BatchRow(Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    thickness: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(16))
    part_instances: Mapped[list[PartInstanceRow]] = relationship(
        cascade="all, delete-orphan", order_by="PartInstanceRow.index_in_batch"
    )
    nest_results: Mapped[list[NestResultRow]] = relationship(
        cascade="all, delete-orphan", order_by="NestResultRow.sheet_index"
    )


class PartInstanceRow(Base):
    __tablename__ = "part_instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), index=True)
    index_in_batch: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    defect_reason: Mapped[str] = mapped_column(Text, default="")
    reissued_from_id: Mapped[int | None] = mapped_column(ForeignKey("part_instances.id"))


class NestResultRow(Base):
    __tablename__ = "nest_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    sheet_stock_id: Mapped[int] = mapped_column(ForeignKey("sheet_stock.id"))
    sheet_index: Mapped[int] = mapped_column(Integer)
    placements: Mapped[JsonList] = mapped_column(JSON)
    utilization_pct: Mapped[float] = mapped_column(Float)
    waste_area: Mapped[float] = mapped_column(Float)
    remnants: Mapped[JsonList] = mapped_column(JSON)
    seed: Mapped[int] = mapped_column(Integer)
    progress: Mapped[str] = mapped_column(String(8))


class NcProgramRow(Base):
    __tablename__ = "nc_programs"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    sheet_index: Mapped[int] = mapped_column(Integer)
    side: Mapped[str] = mapped_column(String(1))
    tool_number: Mapped[int | None] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(255))
    gcode_path: Mapped[str] = mapped_column(String(1000))
    estimated_seconds: Mapped[float] = mapped_column(Float)
    cut_length: Mapped[float] = mapped_column(Float)
    checks_passed: Mapped[bool] = mapped_column(Boolean)
    generated_at: Mapped[datetime] = mapped_column(DateTime)
    generated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    exported_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(16))


class StockTxnRow(Base):
    __tablename__ = "stock_txns"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(16))
    sheet_stock_id: Mapped[int | None] = mapped_column(ForeignKey("sheet_stock.id"), index=True)
    edge_band_id: Mapped[int | None] = mapped_column(ForeignKey("edge_band_stock.id"), index=True)
    qty: Mapped[float] = mapped_column(Float)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    comment: Mapped[str] = mapped_column(Text, default="")
    reverses_txn_id: Mapped[int | None] = mapped_column(ForeignKey("stock_txns.id"))

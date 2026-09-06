from __future__ import annotations

from sqlalchemy import (
    Boolean,
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
from app.models.enums import DxfSource, FileStatus, ImportStatus


class LayerPreset(Base, TimestampMixin):
    """Сохранённый результат мастера сопоставления слоёв.

    Пользователь один раз назначает каждому слою смысл и сохраняет пресет
    («Базис», «Fusion»). Дальше пресет применяется автоматически, источник
    определяется по сигнатуре DXF-файла.
    """

    __tablename__ = "layer_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default=DxfSource.UNKNOWN)
    # [{"regex": "...", "semantic": "OUTER", "resolve_nesting_by_area": bool}, ...]
    # либо точные имена слоёв: {"layer": "ГАБАРИТ", "semantic": "OUTER"}
    rules: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    thickness_from_layer_regex: Mapped[str | None] = mapped_column(Text)
    # Пресет из config/layer_presets.yaml, не редактируемый напрямую.
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (UniqueConstraint("name", name="uq_layer_presets_name"),)


class ImportBatch(Base, TimestampMixin):
    """Одна загрузка: пачка DXF, ZIP-архив или папка."""

    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ImportStatus.PENDING
    )
    detected_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DxfSource.UNKNOWN
    )
    layer_preset_id: Mapped[int | None] = mapped_column(
        ForeignKey("layer_presets.id", ondelete="SET NULL")
    )
    # Проект/изделие по умолчанию, если из файлов их извлечь не удалось.
    default_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    default_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    default_material_id: Mapped[int | None] = mapped_column(
        ForeignKey("materials.id", ondelete="SET NULL")
    )
    filename_template: Mapped[str | None] = mapped_column(String(64))
    # Сводка: сколько файлов, сколько разобрано, сколько в очереди уточнений.
    stats: Mapped[dict | None] = mapped_column(JSONType)
    error: Mapped[str | None] = mapped_column(Text)

    files: Mapped[list[ImportFile]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class ImportFile(Base, TimestampMixin):
    """Один DXF внутри загрузки. Хранит сырую сводку по слоям — она нужна
    мастеру сопоставления, и по ней видно, почему деталь не разобралась."""

    __tablename__ = "import_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    # Путь внутри архива/папки — из него берётся имя папки для резолвера толщины.
    relpath: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64))
    stored_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=FileStatus.PENDING)
    detected_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DxfSource.UNKNOWN
    )
    # [{"name": "ГАБАРИТ", "count": 4, "types": {"LWPOLYLINE": 4}, "semantic": "OUTER"}]
    raw_layers: Mapped[list | None] = mapped_column(JSONType)
    # Что резолверы нашли и откуда — показывается в очереди уточнений.
    resolve_trace: Mapped[dict | None] = mapped_column(JSONType)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id", ondelete="SET NULL"))
    error: Mapped[str | None] = mapped_column(Text)

    batch: Mapped[ImportBatch] = relationship(back_populates="files")

    __table_args__ = (Index("ix_import_files_batch", "batch_id"),)


class SpecRow(Base, TimestampMixin):
    """Строка импортированной спецификации (Базис CSV/XLSX/XML).

    Связывается с DXF по имени файла или артикулу — это избавляет от
    ручного ввода изделий и карты кромок.
    """

    __tablename__ = "spec_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False
    )
    match_key: Mapped[str] = mapped_column(String(200), nullable=False)
    project_name: Mapped[str | None] = mapped_column(String(200))
    product_name: Mapped[str | None] = mapped_column(String(200))
    part_name: Mapped[str | None] = mapped_column(String(200))
    code: Mapped[str | None] = mapped_column(String(64))
    qty: Mapped[int | None] = mapped_column(Integer)
    length: Mapped[float | None] = mapped_column(Float)
    width: Mapped[float | None] = mapped_column(Float)
    thickness: Mapped[float | None] = mapped_column(Float)
    material_name: Mapped[str | None] = mapped_column(String(200))
    grain: Mapped[str | None] = mapped_column(String(16))
    edge_top: Mapped[str | None] = mapped_column(String(64))
    edge_bottom: Mapped[str | None] = mapped_column(String(64))
    edge_left: Mapped[str | None] = mapped_column(String(64))
    edge_right: Mapped[str | None] = mapped_column(String(64))
    raw: Mapped[dict | None] = mapped_column(JSONType)

    __table_args__ = (
        UniqueConstraint("batch_id", "match_key", name="uq_spec_rows_batch_key"),
    )

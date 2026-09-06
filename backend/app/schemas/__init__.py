"""Pydantic-схемы API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- материалы


class MaterialIn(BaseModel):
    name: str
    thickness: float
    has_grain: bool = False
    sheet_w: float = 2800.0
    sheet_h: float = 2070.0
    price: float | None = None
    supplier: str | None = None
    trim_left: float = 10.0
    trim_right: float = 10.0
    trim_top: float = 10.0
    trim_bottom: float = 10.0
    stock_sheets: int | None = None
    aliases: list[str] = Field(default_factory=list)


class MaterialOut(ORMModel):
    id: int
    name: str
    thickness: float
    has_grain: bool
    sheet_w: float
    sheet_h: float
    price: float | None
    supplier: str | None
    trim_left: float
    trim_right: float
    trim_top: float
    trim_bottom: float
    stock_sheets: int | None
    aliases: list[str] | None


# ------------------------------------------------------- проекты и изделия


class ProjectIn(BaseModel):
    name: str
    client: str | None = None
    deadline: date | None = None
    color: str | None = None
    color_index: int | None = None


class ProductOut(ORMModel):
    id: int
    project_id: int
    name: str
    code: str | None
    shade_index: int
    # Стиль изделия: заливка, штриховка, обводка — заполняется роутером.
    style: dict | None = None
    parts_count: int = 0
    parts_qty: int = 0


class ProjectOut(ORMModel):
    id: int
    name: str
    client: str | None
    color: str
    color_index: int
    deadline: date | None
    status: str
    products: list[ProductOut] = Field(default_factory=list)
    parts_count: int = 0
    needs_clarification: int = 0


# ------------------------------------------------------------------ детали


class PartOut(ORMModel):
    id: int
    product_id: int
    product_name: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    name: str
    code: str | None
    qty: int
    length: float | None
    width: float | None
    thickness: float | None
    material_id: int | None
    material_name: str | None = None
    grain: str
    edge_top: str | None
    edge_bottom: str | None
    edge_left: str | None
    edge_right: str | None
    status: str
    thickness_source: str
    thickness_confidence: float
    material_source: str
    clarification: dict | None
    source_file: str | None
    style: dict | None = None


class PartGeometryOut(BaseModel):
    id: int
    name: str
    geometry: dict | None


class PartPatch(BaseModel):
    name: str | None = None
    code: str | None = None
    qty: int | None = Field(default=None, ge=1)
    thickness: float | None = Field(default=None, gt=0)
    material_id: int | None = None
    grain: str | None = None
    edge_top: str | None = None
    edge_bottom: str | None = None
    edge_left: str | None = None
    edge_right: str | None = None
    product_id: int | None = None


class BulkAssign(BaseModel):
    """Массовое назначение — главный инструмент разбора очереди уточнений."""

    part_ids: list[int] = Field(min_length=1)
    thickness: float | None = Field(default=None, gt=0)
    material_id: int | None = None
    product_id: int | None = None


class BulkAssignResult(BaseModel):
    updated: int
    resolved: int
    still_pending: int


# ------------------------------------------------------------------ импорт


class ImportFileOut(ORMModel):
    id: int
    filename: str
    relpath: str
    status: str
    detected_source: str
    error: str | None
    part_id: int | None
    resolve_trace: dict | None
    detected_sheets: list | None = None


class ImportBatchOut(ORMModel):
    id: int
    name: str | None
    status: str
    detected_source: str
    layer_preset_id: int | None
    filename_template: str | None
    stats: dict | None
    error: str | None
    created_at: datetime


class ImportBatchDetail(ImportBatchOut):
    files: list[ImportFileOut] = Field(default_factory=list)


class ProcessRequest(BaseModel):
    project_name: str | None = None
    product_name: str | None = None
    material_id: int | None = None
    filename_template: str | None = None
    layer_preset_id: int | None = None
    layer_overrides: dict[str, str] = Field(default_factory=dict)


# ------------------------------------------------------------ пресеты слоёв


class LayerRule(BaseModel):
    layer: str | None = None
    regex: str | None = None
    semantic: str
    resolve_nesting_by_area: bool = False


class LayerPresetIn(BaseModel):
    name: str
    source: str = "unknown"
    rules: list[LayerRule]
    thickness_from_layer_regex: str | None = None


class LayerPresetOut(ORMModel):
    id: int
    name: str
    source: str
    rules: list
    thickness_from_layer_regex: str | None
    is_builtin: bool


# ------------------------------------------------------- форматы листов


class SheetFormatIn(BaseModel):
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    price: float | None = None


class SheetFormatOut(ORMModel):
    id: int
    material_id: int
    w: float
    h: float
    price: float | None


# ---------------------------------------------------------------- склад


class StockReceiveIn(BaseModel):
    """Приход на склад."""

    material_id: int
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    qty: int = Field(default=1, ge=1)
    kind: str = "sheet"
    location: str | None = None
    note: str | None = None
    price: float | None = None
    actor: str | None = None


class OffcutIn(BaseModel):
    """Обрезок, который технолог решил оставить."""

    w: float = Field(gt=0)
    h: float = Field(gt=0)
    note: str | None = None
    location: str | None = None


class StockConsumeIn(BaseModel):
    """Отметка «лист отрезан»."""

    qty: int = Field(default=1, ge=1)
    offcuts: list[OffcutIn] = Field(default_factory=list)
    reason: str | None = None
    actor: str | None = None
    sheet_id: int | None = None


class StockAdjustIn(BaseModel):
    new_qty: int = Field(ge=0)
    reason: str | None = None
    actor: str | None = None


class StockScrapIn(BaseModel):
    qty: int = Field(default=1, ge=1)
    reason: str | None = None
    actor: str | None = None


class StockItemOut(ORMModel):
    id: int
    material_id: int
    material_name: str | None = None
    thickness: float | None = None
    kind: str
    w: float
    h: float
    qty: int
    status: str
    location: str | None
    note: str | None
    price: float | None
    source_item_id: int | None
    area_m2: float = 0.0
    # Рекомендация «стоит ли хранить» — для обрезков.
    verdict: dict | None = None


class StockMovementOut(ORMModel):
    id: int
    item_id: int
    kind: str
    qty: int
    reason: str | None
    actor: str | None
    offcut_id: int | None
    created_at: datetime


class StockSummaryRow(BaseModel):
    material_id: int
    material_name: str
    thickness: float | None
    sheets: int
    offcuts: int
    area_m2: float


class StockConsumeResult(BaseModel):
    item: StockItemOut
    offcuts: list[StockItemOut]


class OffcutJudgeOut(BaseModel):
    worth_keeping: bool
    reason: str
    area_m2: float
    thresholds: dict

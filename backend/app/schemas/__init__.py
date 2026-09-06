"""Pydantic-схемы API."""

from __future__ import annotations

from datetime import datetime

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


# ---------------------------------------------------------- заказы и файлы


class FileOut(BaseModel):
    """Файл в буфере: он держит цвет и заказ."""

    id: int
    filename: str
    relpath: str
    order_name: str | None
    color: str
    color_index: int
    status: str
    detected_source: str
    # Листов внутри файла, позиций и экземпляров деталей.
    sheets: int
    positions: int
    parts: int
    # Сколько деталей на каждом листе ВНУТРИ файла: буфер показывает файл
    # деревом «файл → листы», и цифры в нём должны быть настоящими.
    sheet_parts: list[int] = Field(default_factory=list)
    needs_clarification: int
    error: str | None = None


class FilePatch(BaseModel):
    order_name: str | None = None
    color_index: int | None = Field(default=None, ge=0)


class OrderOut(BaseModel):
    """Заказ — просто имя и то, что под ним лежит."""

    name: str
    positions: int
    parts: int
    files: int
    needs_clarification: int


# ------------------------------------------------------------------ детали


class PartOut(ORMModel):
    id: int
    source_file_id: int | None
    source_file: str | None = None
    source_sheet_index: int
    order_name: str | None
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
    order_name: str | None = None


class BulkAssign(BaseModel):
    """Массовое назначение — главный инструмент разбора очереди уточнений."""

    part_ids: list[int] = Field(min_length=1)
    thickness: float | None = Field(default=None, gt=0)
    material_id: int | None = None
    order_name: str | None = None


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
    order_name: str | None = None
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


# ----------------------------------------------------------- траектории


class ToolpathPresetIn(BaseModel):
    slug: str
    name: str
    semantic: str | None = None
    side: str = "outside"
    tool_id: int | None = None
    tool_diameter: float | None = None
    tool_type: str | None = None
    depth: dict = Field(default_factory=dict)
    step_down: float | None = None
    finish_pass: bool = False
    finish_allowance: float | None = None
    direction: str = "climb"
    lead: dict | None = None
    tabs: str = "auto"
    params: dict | None = None
    color: str = "#111827"


class ToolpathPresetOut(ORMModel):
    id: int
    slug: str
    name: str
    semantic: str | None
    side: str
    tool_id: int | None
    tool_diameter: float | None
    tool_type: str | None
    depth: dict
    step_down: float | None
    finish_pass: bool
    finish_allowance: float | None
    direction: str
    lead: dict | None
    tabs: str
    params: dict | None
    color: str
    is_builtin: bool


class ToolpathAssignIn(BaseModel):
    """Назначение пресета на выбранные векторы детали."""

    targets: list[str] = Field(min_length=1)
    preset_id: int
    overrides: dict | None = None
    enabled: bool = True


class ToolpathAssignmentOut(ORMModel):
    id: int
    part_id: int
    target: str
    preset_id: int
    overrides: dict | None
    enabled: bool
    assigned_manually: bool


class PartVectorsOut(BaseModel):
    part_id: int
    part_name: str
    vectors: list[dict]


# --------------------------------------------------------- пресеты раскроя


class CuttingPresetIn(BaseModel):
    """Пресет раскроя со словарём ArtCAM, но на материал, а не на траекторию."""

    slug: str
    name: str
    applies_to: dict = Field(default_factory=dict)
    placement: dict = Field(default_factory=dict)
    depth: dict = Field(default_factory=dict)
    strategy: dict = Field(default_factory=dict)
    tools: dict = Field(default_factory=dict)
    order: list[str] = Field(default_factory=list)
    safety: dict = Field(default_factory=dict)
    post: dict = Field(default_factory=dict)
    is_default: bool = False


class CuttingPresetOut(ORMModel):
    id: int
    slug: str
    name: str
    applies_to: dict
    placement: dict
    depth: dict
    strategy: dict
    tools: dict
    order: list
    safety: dict
    post: dict
    is_default: bool
    is_builtin: bool
    last_utilization: float | None


# ------------------------------------------------------------- раскладка


class NestingJobIn(BaseModel):
    material_id: int
    thickness: float = Field(gt=0)
    name: str | None = None
    operator: str | None = None
    sheet_w: float | None = Field(default=None, gt=0)
    sheet_h: float | None = Field(default=None, gt=0)
    # Не указан — подберётся по паре «материал + толщина».
    preset_id: int | None = None
    auto_arrange: bool = True


class FileDecisionIn(BaseModel):
    """Ответ оператора по одному файлу из диалога добавления."""

    relpath: str
    thickness: float = Field(gt=0)
    material_id: int | None = None
    order_name: str | None = None
    product_name: str | None = None
    # none | along | across — направление волокна, если материал текстурный.
    grain: str = "none"


class ConfirmFilesIn(BaseModel):
    batch_id: int
    files: list[FileDecisionIn] = Field(min_length=1)


class ToolIn(BaseModel):
    """Фреза в библиотеке. Слот пуст — лежит в ящике, ставится вручную."""

    name: str
    type: str = "end_mill"
    diameter: float = Field(gt=0)
    slot: int | None = Field(default=None, ge=1)
    flute_length: float | None = None
    total_length: float | None = None
    flutes: int | None = None
    shank: float | None = None
    article: str | None = None
    rpm: int = 18000
    feed: float = 4000.0
    plunge_feed: float = 1200.0
    step_down: float = 6.0
    resource_used: float = 0.0
    resource_limit: float | None = None
    resource_unit: str = "м"
    modes: list[dict] | None = None


class ToolResourceIn(BaseModel):
    used: float = Field(ge=0)
    limit: float | None = Field(default=None, gt=0)


class TakeJobIn(BaseModel):
    operator: str = Field(min_length=1, max_length=120)


class ChecklistIn(BaseModel):
    items: dict[str, bool]


class JobPresetIn(BaseModel):
    """Смена пресета на задании. ``null`` — снять пресет."""

    preset_id: int | None = None
    rearrange: bool = True


class NestingJobOut(ORMModel):
    id: int
    name: str | None
    material_id: int
    thickness: float
    status: str
    stage: str
    operator: str | None
    version: int
    preset_id: int | None
    utilization: float | None
    params: dict | None
    created_at: datetime


class InstanceMoveIn(BaseModel):
    """Перемещение детали на холсте."""

    instance_id: int
    sheet_index: int | None = None
    x: float | None = None
    y: float | None = None
    rotation: float | None = None
    # Ручная правка фиксирует деталь: пересчёт её не двигает.
    pinned: bool = True


class MoveRequest(BaseModel):
    moves: list[InstanceMoveIn] = Field(min_length=1)


class CollisionOut(BaseModel):
    kind: str
    instance_ids: list[int]
    sheet_index: int
    message: str

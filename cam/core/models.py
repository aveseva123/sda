"""Pydantic-модели домена (раздел 6 ТЗ).

Соглашения:
* внутренние коды перечислений — ASCII (они попадают в базу, YAML и имена файлов),
  русские подписи для интерфейса — через ``.label``;
* ``id`` равен ``None`` до сохранения в базу;
* все размеры в миллиметрах, время — наивный UTC (``utcnow``);
* модели строгие: неизвестное поле — ошибка, чтобы опечатка в конфиге не прошла молча;
* инварианты, влияющие на безопасность (глубина ≤ толщина − 3 мм и т.п.), живут
  в ``validate/checks.py`` с порогами из конфига — здесь только структурные правила.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    NonNegativeFloat,
    NonNegativeInt,
    PositiveFloat,
    PositiveInt,
    model_validator,
)

from cam.core.geometry.primitives import Circle, Contour, Geometry

# ---------------------------------------------------------------------------
# Перечисления
# ---------------------------------------------------------------------------


class LabeledEnum(StrEnum):
    """StrEnum с русской подписью для интерфейса."""

    @property
    def label(self) -> str:
        return _LABELS_RU[self]


class MaterialType(LabeledEnum):
    LDSP = "ldsp"
    MDF = "mdf"
    PLYWOOD = "plywood"
    SOLID_WOOD = "solid_wood"
    ACRYLIC = "acrylic"
    COMPACT = "compact"
    HPL = "hpl"


class ToolType(LabeledEnum):
    END_MILL = "end_mill"
    COMPRESSION = "compression"
    UPCUT = "upcut"
    DOWNCUT = "downcut"
    DRILL = "drill"
    SLOT = "slot"
    V_BIT = "v_bit"
    RADIUS = "radius"
    FORM = "form"


class OperationType(LabeledEnum):
    CONTOUR_OUTER = "contour_outer"
    CONTOUR_INNER = "contour_inner"
    POCKET = "pocket"
    GROOVE = "groove"
    DRILL_THROUGH = "drill_through"
    DRILL_BLIND = "drill_blind"
    ENGRAVE = "engrave"
    CHAMFER = "chamfer"
    EDGE_PROFILE = "edge_profile"


THROUGH_OPERATIONS: frozenset[OperationType] = frozenset(
    {OperationType.CONTOUR_OUTER, OperationType.CONTOUR_INNER, OperationType.DRILL_THROUGH}
)
"""Операции, которые всегда сквозные: глубина задаётся толщиной детали и запилом."""

DRILL_OPERATIONS: frozenset[OperationType] = frozenset(
    {OperationType.DRILL_THROUGH, OperationType.DRILL_BLIND}
)


class CutDirection(LabeledEnum):
    CLIMB = "climb"
    CONVENTIONAL = "conventional"


class EntryType(LabeledEnum):
    PLUNGE = "plunge"
    RAMP = "ramp"
    HELIX = "helix"


class LeadInType(LabeledEnum):
    NONE = "none"
    LINE = "line"
    ARC = "arc"


class DepthRef(LabeledEnum):
    FROM_FACE = "from_face"
    FROM_BACK = "from_back"
    THROUGH = "through"


class Side(LabeledEnum):
    A = "A"
    B = "B"


class GeomClosed(LabeledEnum):
    ANY = "any"
    CLOSED = "closed"
    OPEN = "open"


class Grain(LabeledEnum):
    ALONG = "along"
    ACROSS = "across"
    ANY = "any"


class DimsAre(LabeledEnum):
    FINISHED = "finished"
    CUTTING = "cutting"


class Units(LabeledEnum):
    MM = "mm"
    INCH = "inch"


class PartInstanceStatus(LabeledEnum):
    IN_WORK = "in_work"
    CUT = "cut"
    DEFECT = "defect"
    REISSUED = "reissued"


class ProjectStatus(LabeledEnum):
    NEW = "new"
    IN_WORK = "in_work"
    DONE = "done"
    ARCHIVED = "archived"


class BatchStatus(LabeledEnum):
    DRAFT = "draft"
    NESTED = "nested"
    EXPORTED = "exported"
    IN_WORK = "in_work"
    DONE = "done"
    REVOKED = "revoked"


class NestProgress(LabeledEnum):
    NONE = "none"
    PARTIAL = "partial"
    FULL = "full"


class UserRole(LabeledEnum):
    TECHNOLOGIST = "technologist"
    OPERATOR = "operator"
    STOREKEEPER = "storekeeper"


class StockTxnType(LabeledEnum):
    RECEIPT = "receipt"
    ISSUE = "issue"
    WRITE_OFF = "write_off"
    INVENTORY = "inventory"
    COMPENSATION = "compensation"


class EdgeSide(LabeledEnum):
    TOP = "top"
    RIGHT = "right"
    BOTTOM = "bottom"
    LEFT = "left"


_LABELS_RU: dict[StrEnum, str] = {
    MaterialType.LDSP: "ЛДСП",
    MaterialType.MDF: "МДФ",
    MaterialType.PLYWOOD: "фанера",
    MaterialType.SOLID_WOOD: "массив",
    MaterialType.ACRYLIC: "акрил",
    MaterialType.COMPACT: "компакт",
    MaterialType.HPL: "HPL",
    ToolType.END_MILL: "концевая",
    ToolType.COMPRESSION: "компрессионная",
    ToolType.UPCUT: "спиральная вверх",
    ToolType.DOWNCUT: "спиральная вниз",
    ToolType.DRILL: "сверло",
    ToolType.SLOT: "пазовая",
    ToolType.V_BIT: "V-образная",
    ToolType.RADIUS: "радиусная",
    ToolType.FORM: "фасонная",
    OperationType.CONTOUR_OUTER: "раскрой (наружный контур)",
    OperationType.CONTOUR_INNER: "сквозной вырез",
    OperationType.POCKET: "выборка",
    OperationType.GROOVE: "паз",
    OperationType.DRILL_THROUGH: "присадка сквозная",
    OperationType.DRILL_BLIND: "присадка глухая",
    OperationType.ENGRAVE: "гравировка",
    OperationType.CHAMFER: "фаска",
    OperationType.EDGE_PROFILE: "фрезеровка под ручку-профиль",
    CutDirection.CLIMB: "попутное",
    CutDirection.CONVENTIONAL: "встречное",
    EntryType.PLUNGE: "отвесное врезание",
    EntryType.RAMP: "рампа",
    EntryType.HELIX: "спираль",
    LeadInType.NONE: "без захода",
    LeadInType.LINE: "заход по прямой",
    LeadInType.ARC: "заход дугой",
    DepthRef.FROM_FACE: "от лица",
    DepthRef.FROM_BACK: "от изнанки",
    DepthRef.THROUGH: "насквозь",
    Side.A: "сторона A",
    Side.B: "сторона B",
    GeomClosed.ANY: "любой",
    GeomClosed.CLOSED: "замкнутый",
    GeomClosed.OPEN: "незамкнутый",
    Grain.ALONG: "вдоль текстуры",
    Grain.ACROSS: "поперёк текстуры",
    Grain.ANY: "текстура не важна",
    DimsAre.FINISHED: "готовые (после кромки)",
    DimsAre.CUTTING: "раскроечные (до кромки)",
    Units.MM: "миллиметры",
    Units.INCH: "дюймы",
    PartInstanceStatus.IN_WORK: "в работе",
    PartInstanceStatus.CUT: "вырезано",
    PartInstanceStatus.DEFECT: "брак",
    PartInstanceStatus.REISSUED: "перевыпущено",
    ProjectStatus.NEW: "новый",
    ProjectStatus.IN_WORK: "в работе",
    ProjectStatus.DONE: "выполнен",
    ProjectStatus.ARCHIVED: "в архиве",
    BatchStatus.DRAFT: "черновик",
    BatchStatus.NESTED: "раскроен",
    BatchStatus.EXPORTED: "выгружен",
    BatchStatus.IN_WORK: "в работе",
    BatchStatus.DONE: "выполнен",
    BatchStatus.REVOKED: "отозван",
    NestProgress.NONE: "нет",
    NestProgress.PARTIAL: "частично",
    NestProgress.FULL: "полностью",
    UserRole.TECHNOLOGIST: "технолог",
    UserRole.OPERATOR: "оператор",
    UserRole.STOREKEEPER: "кладовщик",
    StockTxnType.RECEIPT: "приход",
    StockTxnType.ISSUE: "расход",
    StockTxnType.WRITE_OFF: "списание",
    StockTxnType.INVENTORY: "инвентаризация",
    StockTxnType.COMPENSATION: "компенсация",
    EdgeSide.TOP: "верх",
    EdgeSide.RIGHT: "право",
    EdgeSide.BOTTOM: "низ",
    EdgeSide.LEFT: "лево",
}


# ---------------------------------------------------------------------------
# Базовые классы и вспомогательные типы
# ---------------------------------------------------------------------------


def utcnow() -> datetime:
    """Текущее время: наивный UTC — единое представление для базы и моделей."""
    return datetime.now(UTC).replace(tzinfo=None)


class DomainModel(BaseModel):
    """Строгая модель: лишние поля запрещены, читается из ORM-объектов."""

    model_config = ConfigDict(extra="forbid", from_attributes=True, validate_assignment=True)


class Entity(DomainModel):
    """Сущность, хранимая в базе. ``id`` появляется после сохранения."""

    id: int | None = None


def _check_range(name: str, lo: float | None, hi: float | None) -> None:
    if lo is not None and hi is not None and lo > hi:
        raise ValueError(f"{name}_from ({lo}) больше {name}_to ({hi})")


class Margins(DomainModel):
    """Отступы по четырём сторонам, мм (обрезка кромки листа, припуск на кромку)."""

    left: NonNegativeFloat = 0.0
    right: NonNegativeFloat = 0.0
    top: NonNegativeFloat = 0.0
    bottom: NonNegativeFloat = 0.0

    @property
    def horizontal(self) -> float:
        return self.left + self.right

    @property
    def vertical(self) -> float:
        return self.top + self.bottom


# ---------------------------------------------------------------------------
# Материалы и склад
# ---------------------------------------------------------------------------


class Material(Entity):
    name: str = Field(min_length=1)
    article: str = ""
    type: MaterialType
    nominal_thickness: PositiveFloat
    actual_thickness: PositiveFloat
    grain_matters: bool = False
    default_sheet_w: PositiveFloat
    default_sheet_l: PositiveFloat
    supplier: str = ""
    price_per_m2: NonNegativeFloat = 0.0
    batch_code: str = ""


class SheetStock(Entity):
    material_id: int
    nominal_w: PositiveFloat
    nominal_l: PositiveFloat
    actual_w: PositiveFloat
    actual_l: PositiveFloat
    trim_allowance: Margins = Field(default_factory=Margins)
    qty: NonNegativeInt = 0
    location: str = ""
    is_remnant: bool = False
    remnant_code: str | None = None
    parent_sheet_id: int | None = None
    polygon: Contour | None = None
    created_at: datetime = Field(default_factory=utcnow)
    reserved_for_project_id: int | None = None

    @model_validator(mode="after")
    def _remnant_has_code(self) -> Self:
        if self.is_remnant and not self.remnant_code:
            raise ValueError("Деловой обрезок обязан иметь уникальный код (remnant_code)")
        if not self.is_remnant and self.remnant_code:
            raise ValueError("remnant_code задан, но лист не помечен как обрезок")
        if self.trim_allowance.horizontal >= self.actual_w:
            raise ValueError("Обрезка кромки по ширине не меньше самой ширины листа")
        if self.trim_allowance.vertical >= self.actual_l:
            raise ValueError("Обрезка кромки по длине не меньше самой длины листа")
        return self

    @property
    def usable_w(self) -> float:
        return self.actual_w - self.trim_allowance.horizontal

    @property
    def usable_l(self) -> float:
        return self.actual_l - self.trim_allowance.vertical


class EdgeBandStock(Entity):
    name: str = Field(min_length=1)
    article: str = ""
    thickness: PositiveFloat
    width: PositiveFloat
    decor: str = ""
    length_meters_left: NonNegativeFloat = 0.0
    supplier: str = ""
    price_per_m: NonNegativeFloat = 0.0


# ---------------------------------------------------------------------------
# Инструмент, режимы, техкарты
# ---------------------------------------------------------------------------


class Tool(Entity):
    number: PositiveInt = Field(description="Номер T в УП")
    name: str = Field(min_length=1)
    type: ToolType
    diameter: PositiveFloat
    flutes: PositiveInt
    cutting_length: PositiveFloat
    shank_diameter: PositiveFloat
    max_plunge_depth: PositiveFloat
    in_atc: bool = False
    atc_position: int | None = None
    life_minutes: NonNegativeFloat = 0.0
    used_minutes: NonNegativeFloat = 0.0

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.in_atc and self.atc_position is None:
            raise ValueError("Инструмент в магазине ATC обязан иметь позицию (atc_position)")
        if self.max_plunge_depth > self.cutting_length:
            raise ValueError("Глубина врезания за проход больше рабочей длины инструмента")
        return self

    @property
    def radius(self) -> float:
        return 0.5 * self.diameter

    @property
    def life_exceeded(self) -> bool:
        return self.life_minutes > 0 and self.used_minutes > self.life_minutes


class CuttingMode(Entity):
    tool_id: int
    material_type: MaterialType
    thickness_from: PositiveFloat
    thickness_to: PositiveFloat
    operation_type: OperationType
    rpm: PositiveInt
    feed_xy: PositiveFloat
    feed_z_plunge: PositiveFloat
    depth_per_pass: PositiveFloat
    direction: CutDirection
    entry: EntryType
    ramp_angle: PositiveFloat | None = None
    ramp_length: PositiveFloat | None = None
    lead_in_type: LeadInType
    lead_radius: PositiveFloat | None = None
    finish_pass: bool = False
    finish_allowance: NonNegativeFloat = 0.0
    stepover_pct: float = Field(gt=0.0, le=100.0)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _check_range("thickness", self.thickness_from, self.thickness_to)
        if self.entry is EntryType.RAMP and self.ramp_angle is None and self.ramp_length is None:
            raise ValueError("Вход рампой требует ramp_angle или ramp_length")
        if self.lead_in_type is LeadInType.ARC and self.lead_radius is None:
            raise ValueError("Заход дугой требует lead_radius")
        if self.finish_pass and self.finish_allowance <= 0.0:
            raise ValueError("Чистовой проход требует припуск finish_allowance > 0")
        return self


class TechProfile(Entity):
    """Техкарта: материал + толщина + операция + диаметр/ширина → инструмент + режим."""

    name: str = Field(min_length=1)
    material_type: MaterialType
    thickness_from: PositiveFloat
    thickness_to: PositiveFloat
    operation_type: OperationType
    diameter_from: NonNegativeFloat
    diameter_to: PositiveFloat
    width_from: NonNegativeFloat
    width_to: PositiveFloat
    tool_id: int
    mode_id: int
    strategy_params: dict[str, JsonValue] = Field(default_factory=dict)
    verified: bool = Field(
        default=False,
        description="Подтверждена человеком; заготовки из комплекта помечены «ПРОВЕРИТЬ»",
    )

    @model_validator(mode="after")
    def _ranges(self) -> Self:
        _check_range("thickness", self.thickness_from, self.thickness_to)
        _check_range("diameter", self.diameter_from, self.diameter_to)
        _check_range("width", self.width_from, self.width_to)
        return self


# ---------------------------------------------------------------------------
# Импорт: правила и профили
# ---------------------------------------------------------------------------

RGB_HEX = r"^#[0-9A-Fa-f]{6}$"


class LayerRule(Entity):
    profile_id: int | None = None
    priority: int = 0
    layer_regex: str | None = None
    aci_color: int | None = Field(default=None, ge=1, le=255)
    rgb_color: str | None = Field(default=None, pattern=RGB_HEX)
    linetype: str | None = None
    block_name: str | None = None
    geom_closed: GeomClosed = GeomClosed.ANY
    diameter_from: NonNegativeFloat | None = None
    diameter_to: PositiveFloat | None = None
    area_from: NonNegativeFloat | None = None
    area_to: PositiveFloat | None = None
    operation_type: OperationType
    depth: PositiveFloat | None = None
    depth_ref: DepthRef
    side: Side = Side.A
    extra_params: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.layer_regex is not None:
            try:
                re.compile(self.layer_regex)
            except re.error as exc:
                raise ValueError(f"layer_regex не компилируется: {exc}") from exc
        conditions = (
            self.layer_regex,
            self.aci_color,
            self.rgb_color,
            self.linetype,
            self.block_name,
            self.diameter_from,
            self.diameter_to,
            self.area_from,
            self.area_to,
        )
        if all(c is None for c in conditions) and self.geom_closed is GeomClosed.ANY:
            raise ValueError("Правило без единого условия совпадёт с чем угодно")
        _check_range("diameter", self.diameter_from, self.diameter_to)
        _check_range("area", self.area_from, self.area_to)
        _validate_depth(self.operation_type, self.depth_ref, self.depth)
        return self


def _validate_depth(op: OperationType, depth_ref: DepthRef, depth: float | None) -> None:
    """Согласованность типа операции, привязки глубины и самой глубины."""
    if op in THROUGH_OPERATIONS:
        if depth_ref is not DepthRef.THROUGH:
            raise ValueError(f"Операция {op.value} всегда сквозная: depth_ref должен быть through")
        if depth is not None:
            raise ValueError(f"Операция {op.value} сквозная: глубина задаётся толщиной и запилом")
        return
    if depth_ref is DepthRef.THROUGH:
        raise ValueError(f"Операция {op.value} не сквозная: укажите depth_ref from_face/from_back")
    if depth is None:
        raise ValueError(f"Операция {op.value} требует глубину (depth)")


class ImportProfile(Entity):
    name: str = Field(min_length=1)
    layer_signature: list[str] = Field(default_factory=list)
    units: Units | None = Field(default=None, description="Единицы, если в DXF нет $INSUNITS")
    dims_are: DimsAre = DimsAre.CUTTING
    one_file_one_part: bool = False
    rules: list[LayerRule] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Детали, операции, проекты
# ---------------------------------------------------------------------------


class EdgeBand(DomainModel):
    band_id: int | None = None
    thickness: PositiveFloat


class EdgeBanding(DomainModel):
    top: EdgeBand | None = None
    right: EdgeBand | None = None
    bottom: EdgeBand | None = None
    left: EdgeBand | None = None

    def get(self, side: EdgeSide) -> EdgeBand | None:
        return getattr(self, side.value)  # type: ignore[no-any-return]

    @property
    def sides(self) -> list[EdgeSide]:
        return [s for s in EdgeSide if self.get(s) is not None]


class OperationParams(DomainModel):
    diameter: PositiveFloat | None = None
    width: PositiveFloat | None = None
    tabs_count: NonNegativeInt | None = None
    tabs_len: PositiveFloat | None = None
    tabs_height: PositiveFloat | None = None
    islands: list[Contour] = Field(default_factory=list)
    profile_offset: float | None = None


class Operation(Entity):
    part_id: int | None = None
    type: OperationType
    geometry: Geometry
    depth: PositiveFloat | None = None
    depth_ref: DepthRef
    side: Side = Side.A
    tool_override: int | None = None
    mode_override: int | None = None
    params: OperationParams = Field(default_factory=OperationParams)
    low_confidence: bool = Field(
        default=False,
        description="Принята наиболее вероятная гипотеза (9.1), требует подтверждения",
    )

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _validate_depth(self.type, self.depth_ref, self.depth)
        if self.type in DRILL_OPERATIONS and self.drill_diameter is None:
            raise ValueError("Присадка требует окружность в geometry или params.diameter")
        if self.type is OperationType.GROOVE and self.params.width is None:
            raise ValueError(
                "Паз требует ширину (params.width): её задаёт фурнитура, не инструмент"
            )
        if self.type is OperationType.EDGE_PROFILE and self.params.profile_offset is None:
            raise ValueError("Фрезеровка под ручку-профиль требует params.profile_offset")
        return self

    @property
    def drill_diameter(self) -> float | None:
        """Диаметр отверстия: из окружности или из параметров."""
        if isinstance(self.geometry, Circle):
            return self.geometry.diameter
        return self.params.diameter


class Part(Entity):
    project_id: int | None = None
    name: str = Field(min_length=1)
    article: str = ""
    material_id: int | None = None
    thickness: PositiveFloat
    qty: PositiveInt = 1
    outer_contour: Contour
    inner_contours: list[Contour] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    grain: Grain = Grain.ANY
    edge_banding: EdgeBanding = Field(default_factory=EdgeBanding)
    dims_are: DimsAre = DimsAre.CUTTING
    edge_allowance: Margins = Field(default_factory=Margins)
    is_two_sided: bool = False
    source_file: str = ""
    comment: str = ""

    @model_validator(mode="after")
    def _sides(self) -> Self:
        has_side_b = any(op.side is Side.B for op in self.operations)
        if has_side_b and not self.is_two_sided:
            raise ValueError("Есть операции со стороны B, но деталь не помечена двусторонней")
        return self


class Project(Entity):
    name: str = Field(min_length=1)
    customer: str = ""
    deadline: date | None = None
    status: ProjectStatus = ProjectStatus.NEW
    created_at: datetime = Field(default_factory=utcnow)
    parts: list[Part] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Сменные задания, раскрой, УП
# ---------------------------------------------------------------------------


class PartInstance(Entity):
    part_id: int
    batch_id: int | None = None
    index_in_batch: int | None = None
    status: PartInstanceStatus = PartInstanceStatus.IN_WORK
    defect_reason: str = ""
    reissued_from_id: int | None = None

    @model_validator(mode="after")
    def _defect_has_reason(self) -> Self:
        if self.status is PartInstanceStatus.DEFECT and not self.defect_reason.strip():
            raise ValueError("Брак требует причины (defect_reason)")
        return self


Rotation = Literal[0, 90, 180, 270]


class Placement(DomainModel):
    part_instance_id: int
    part_id: int
    project_id: int
    x: float
    y: float
    rotation: Rotation = 0
    mirrored: bool = False
    label_no: PositiveInt


class RemnantCandidate(DomainModel):
    """Деловой обрезок, найденный на карте раскроя (до постановки на склад)."""

    x: float
    y: float
    width: PositiveFloat
    length: PositiveFloat
    polygon: Contour | None = None


class NestResult(Entity):
    batch_id: int
    sheet_stock_id: int
    sheet_index: NonNegativeInt
    placements: list[Placement] = Field(default_factory=list)
    utilization_pct: float = Field(ge=0.0, le=100.0)
    waste_area: NonNegativeFloat
    remnants: list[RemnantCandidate] = Field(default_factory=list)
    seed: int
    progress: NestProgress = NestProgress.NONE

    @model_validator(mode="after")
    def _labels_unique(self) -> Self:
        labels = [p.label_no for p in self.placements]
        if len(labels) != len(set(labels)):
            raise ValueError("Номера позиций (label_no) на листе должны быть уникальны")
        return self


class Batch(Entity):
    name: str = Field(min_length=1)
    material_id: int
    thickness: PositiveFloat
    created_at: datetime = Field(default_factory=utcnow)
    status: BatchStatus = BatchStatus.DRAFT
    part_instances: list[PartInstance] = Field(default_factory=list)
    nest_results: list[NestResult] = Field(default_factory=list)


class NcProgram(Entity):
    batch_id: int
    sheet_index: NonNegativeInt
    side: Side = Side.A
    tool_number: int | None = Field(
        default=None, description="None — все инструменты в одном файле"
    )
    filename: str = Field(min_length=1)
    gcode_path: str = Field(min_length=1)
    estimated_seconds: NonNegativeFloat
    cut_length: NonNegativeFloat
    checks_passed: bool
    generated_at: datetime = Field(default_factory=utcnow)
    generated_by_user_id: int | None = None
    exported_at: datetime | None = None
    revoked_at: datetime | None = None

    @model_validator(mode="after")
    def _export_requires_checks(self) -> Self:
        if self.exported_at is not None and not self.checks_passed:
            raise ValueError("Экспорт УП без пройденных проверок запрещён (раздел 15 ТЗ)")
        return self


class User(Entity):
    name: str = Field(min_length=1)
    role: UserRole


class StockTxn(Entity):
    type: StockTxnType
    sheet_stock_id: int | None = None
    edge_band_id: int | None = None
    qty: float
    batch_id: int | None = None
    project_id: int | None = None
    user_id: int | None = None
    created_at: datetime = Field(default_factory=utcnow)
    comment: str = ""
    reverses_txn_id: int | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if (self.sheet_stock_id is None) == (self.edge_band_id is None):
            raise ValueError("Проводка относится ровно к одному объекту: лист или кромка")
        if self.qty == 0:
            raise ValueError("Проводка с нулевым количеством бессмысленна")
        if self.type is StockTxnType.COMPENSATION and self.reverses_txn_id is None:
            raise ValueError("Компенсирующая проводка обязана ссылаться на отменяемую")
        return self

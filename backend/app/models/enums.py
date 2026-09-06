from enum import StrEnum


class LayerSemantic(StrEnum):
    """Технологический смысл слоя DXF."""

    SHEET = "SHEET"      # контур ЛИСТА, а не детали — даёт габарит листа
    OUTER = "OUTER"      # внешний контур
    INNER = "INNER"      # внутренний вырез
    DRILL = "DRILL"      # присадка
    GROOVE = "GROOVE"    # паз
    POCKET = "POCKET"    # выборка
    MARK = "MARK"        # гравировка/разметка
    INFO = "INFO"        # метаданные, рамка, текст — не режется
    IGNORE = "IGNORE"    # игнорировать полностью


class PartStatus(StrEnum):
    READY = "ready"                          # толщина и материал определены
    NEEDS_CLARIFICATION = "needs_clarification"  # очередь уточнений
    REJECTED = "rejected"                    # файл не разобрался


class ResolveSource(StrEnum):
    """Откуда взята толщина/материал. Всегда сохраняется вместе со значением,
    чтобы технолог видел, чему верить."""

    LAYER_DEPTH = "layer_depth"  # глубина обработки из имени слоя
    LAYER_MAP = "layer_map"
    FILENAME = "filename"
    FOLDER = "folder"
    DXF_ANNOTATION = "dxf_annotation"
    SPEC = "spec"                # спецификация Базиса (CSV/XLSX/XML)
    BATCH_DEFAULT = "batch_default"
    MANUAL = "manual"            # назначено технологом вручную
    UNRESOLVED = "unresolved"


class DxfSource(StrEnum):
    BAZIS = "bazis"
    FUSION = "fusion"
    UNKNOWN = "unknown"


class GrainMode(StrEnum):
    NONE = "none"          # без текстуры — свободный поворот
    ALONG_LENGTH = "length"
    ALONG_WIDTH = "width"


class ImportStatus(StrEnum):
    PENDING = "pending"
    MAPPING_REQUIRED = "mapping_required"   # ждёт мастера сопоставления слоёв
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class FileStatus(StrEnum):
    PENDING = "pending"
    PARSED = "parsed"
    NEEDS_CLARIFICATION = "needs_clarification"
    FAILED = "failed"
    DUPLICATE = "duplicate"       # схлопнут в существующую позицию


class ToolType(StrEnum):
    END_MILL = "end_mill"
    COMPRESSION = "compression"
    DRILL = "drill"
    GROOVE = "groove"


class JobStatus(StrEnum):
    DRAFT = "draft"
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class StockKind(StrEnum):
    SHEET = "sheet"      # целый лист
    OFFCUT = "offcut"    # деловой отход


class StockStatus(StrEnum):
    AVAILABLE = "available"   # доступен для раскроя
    RESERVED = "reserved"     # закреплён за заданием
    USED = "used"             # израсходован
    SCRAPPED = "scrapped"     # списан в мусор как слишком мелкий


class StockMovementKind(StrEnum):
    RECEIPT = "receipt"       # приход
    CONSUME = "consume"       # лист ушёл в раскрой
    OFFCUT = "offcut"         # появился деловой отход
    SCRAP = "scrap"           # списан в мусор
    ADJUST = "adjust"         # ручная корректировка остатка

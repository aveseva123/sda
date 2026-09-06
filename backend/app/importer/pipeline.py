"""Конвейер импорта: файлы → детали в дереве проектов.

Порядок: распаковка → сохранение → сканирование слоёв → (мастер слоёв, если
источник новый) → разбор геометрии → резолверы толщины и материала →
привязка спецификации → дедупликация → создание деталей и их экземпляров.

Деталь, для которой толщина или материал не определились уверенно, НЕ
попадает в дерево молча: она создаётся со статусом «требует уточнения»
вместе с трассировкой, показывающей, что именно система пробовала.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.colors import next_color_index, project_color
from app.core.config_files import app_config
from app.core.settings import get_settings
from app.dxf import build_shapes, read_file
from app.dxf.reader import DxfReadError
from app.importer.archive import IncomingFile, store, unpack
from app.importer.dedup import dedup_enabled, geometry_signature
from app.importer.spec import index_rows, lookup, parse_spec
from app.models import (
    FileStatus,
    ImportBatch,
    ImportFile,
    ImportStatus,
    LayerPreset,
    Material,
    Part,
    PartInstance,
    PartStatus,
    Product,
    Project,
    ResolveSource,
    SpecRow,
)
from app.models.enums import GrainMode
from app.resolve import (
    MaterialRef,
    ResolveContext,
    apply_preset,
    preset_for_source,
    resolve_material,
    resolve_thickness,
    suggest_semantics,
)
from app.toolpath import service as toolpath_service

log = logging.getLogger(__name__)

UNASSIGNED_PROJECT = "Без проекта"
UNASSIGNED_PRODUCT = "Без изделия"


@dataclass(slots=True)
class ImportOptions:
    """Что пользователь выбрал для этой загрузки."""

    project_name: str | None = None
    product_name: str | None = None
    material_id: int | None = None
    filename_template: str | None = None
    layer_preset_id: int | None = None
    # Ручное назначение семантики слоям в мастере — перекрывает пресет.
    layer_overrides: dict[str, str] = field(default_factory=dict)


def batch_dir(batch_id: int) -> Path:
    return get_settings().storage_dir / f"batch_{batch_id}"


# --------------------------------------------------------------------------
# Шаг 1. Приём файлов и сканирование слоёв
# --------------------------------------------------------------------------


def create_batch(db: Session, *, name: str | None, files: list[IncomingFile]) -> ImportBatch:
    batch = ImportBatch(name=name, status=ImportStatus.PENDING)
    db.add(batch)
    db.flush()

    unpacked = unpack(files)
    stored = store(unpacked.dxf + unpacked.spec, batch_dir(batch.id))

    for item in unpacked.dxf:
        db.add(
            ImportFile(
                batch_id=batch.id,
                filename=item.filename,
                relpath=item.relpath,
                sha256=item.sha256,
                stored_path=str(stored.get(item.relpath, "")),
                status=FileStatus.PENDING,
            )
        )

    spec_warnings: list[str] = []
    spec_count = 0
    for item in unpacked.spec:
        parsed = parse_spec(item.filename, item.data)
        spec_warnings.extend(f"{item.filename}: {w}" for w in parsed.warnings)
        for row in parsed.rows:
            db.add(
                SpecRow(
                    batch_id=batch.id,
                    match_key=row.match_key,
                    project_name=row.fields.get("project_name"),
                    product_name=row.fields.get("product_name"),
                    part_name=row.fields.get("part_name"),
                    code=row.fields.get("code"),
                    qty=row.fields.get("qty"),
                    length=row.fields.get("length"),
                    width=row.fields.get("width"),
                    thickness=row.fields.get("thickness"),
                    material_name=row.fields.get("material_name"),
                    grain=row.fields.get("grain"),
                    edge_top=row.fields.get("edge_top"),
                    edge_bottom=row.fields.get("edge_bottom"),
                    edge_left=row.fields.get("edge_left"),
                    edge_right=row.fields.get("edge_right"),
                    raw=row.raw,
                )
            )
            spec_count += 1

    batch.stats = {
        "files_total": len(unpacked.dxf),
        "spec_rows": spec_count,
        "skipped": unpacked.skipped,
        "spec_warnings": spec_warnings,
    }
    db.flush()
    scan_batch(db, batch)
    return batch


def scan_batch(db: Session, batch: ImportBatch) -> None:
    """Читает слои каждого DXF. Разбор геометрии здесь ещё не делается:
    сначала пользователь должен подтвердить карту слоёв."""
    sources: Counter[str] = Counter()

    for record in _files_of(db, batch.id):
        path = Path(record.stored_path or "")
        if not path.exists():
            record.status = FileStatus.FAILED
            record.error = "Файл не найден в хранилище"
            continue
        try:
            scan = read_file(path)
        except DxfReadError as exc:
            record.status = FileStatus.FAILED
            record.error = str(exc)
            continue

        record.raw_layers = [layer.as_dict() for layer in scan.layers]
        record.detected_source = scan.detected_source
        sources[scan.detected_source] += 1

    batch.detected_source = sources.most_common(1)[0][0] if sources else "unknown"
    batch.status = (
        ImportStatus.MAPPING_REQUIRED
        if _needs_mapping(db, batch)
        else ImportStatus.PENDING
    )
    db.flush()


def _needs_mapping(db: Session, batch: ImportBatch) -> bool:
    """Мастер нужен, если для источника нет сохранённого пресета."""
    saved = db.scalar(
        select(LayerPreset).where(LayerPreset.source == batch.detected_source).limit(1)
    )
    return saved is None and preset_for_source(batch.detected_source) is None


def layer_summary(db: Session, batch: ImportBatch) -> dict:
    """Сводка по слоям всей загрузки для Мастера сопоставления слоёв."""
    merged: dict[str, dict] = {}
    for record in _files_of(db, batch.id):
        for layer in record.raw_layers or []:
            name = layer["name"]
            entry = merged.setdefault(
                name,
                {
                    "name": name,
                    "count": 0,
                    "files": 0,
                    "dxftypes": {},
                    "closed_paths": 0,
                    "circles": 0,
                    "texts": 0,
                    "circle_diameters": [],
                    "bbox": None,
                },
            )
            entry["count"] += layer.get("count", 0)
            # Габарит слоя объединяется по всем файлам: без него подсказки
            # мастера теряют геометрический признак и слой контуров листа
            # уже не отличить от сквозного выреза.
            entry["bbox"] = _merge_bbox(entry["bbox"], layer.get("bbox"))
            entry["files"] += 1
            entry["closed_paths"] += layer.get("closed_paths", 0)
            entry["circles"] += layer.get("circles", 0)
            entry["texts"] += layer.get("texts", 0)
            for dxftype, count in (layer.get("dxftypes") or {}).items():
                entry["dxftypes"][dxftype] = entry["dxftypes"].get(dxftype, 0) + count
            for diameter in layer.get("circle_diameters") or []:
                if diameter not in entry["circle_diameters"]:
                    entry["circle_diameters"].append(diameter)

    for entry in merged.values():
        entry["circle_diameters"].sort()

    from app.dxf.model import LayerInfo

    infos = [
        LayerInfo(
            name=e["name"],
            count=e["count"],
            dxftypes=e["dxftypes"],
            closed_paths=e["closed_paths"],
            circles=e["circles"],
            texts=e["texts"],
            circle_diameters=e["circle_diameters"],
            bbox=tuple(e["bbox"]) if e["bbox"] else None,
        )
        for e in merged.values()
    ]
    # Если для источника уже есть пресет — показываем ЕГО карту, а не
    # геометрические догадки: пресет точнее, он подтверждён человеком.
    # Геометрия достраивает только те слои, которых в пресете нет.
    preset = _preset_resolver(db, batch, ImportOptions())(batch.detected_source)
    mapping = apply_preset([info.name for info in infos], preset)
    suggestions = {k: str(v) for k, v in suggest_semantics(infos).items()}
    suggestions.update({k: str(v) for k, v in mapping.semantic_by_layer.items()})

    for entry in merged.values():
        meta = mapping.meta.get(entry["name"])
        entry["depth"] = meta.depth if meta else None
        entry["from_preset"] = entry["name"] in mapping.semantic_by_layer

    return {
        "detected_source": batch.detected_source,
        "preset_name": mapping.preset_name,
        "layers": sorted(merged.values(), key=lambda e: -e["count"]),
        "suggestions": suggestions,
    }


# --------------------------------------------------------------------------
# Шаг 2. Разбор геометрии и создание деталей
# --------------------------------------------------------------------------


def process_batch(db: Session, batch: ImportBatch, options: ImportOptions) -> dict:
    batch.status = ImportStatus.PROCESSING
    batch.layer_preset_id = options.layer_preset_id
    batch.filename_template = options.filename_template
    batch.default_material_id = options.material_id
    db.flush()

    preset_for = _preset_resolver(db, batch, options)
    # Пресеты траекторий из конфига должны существовать до того, как
    # появятся детали: иначе назначать будет нечего.
    toolpath_service.sync_presets(db)
    materials = _material_refs(db)
    known_thicknesses = sorted({m.thickness for m in materials}) or None
    spec_index = index_rows(_spec_rows(db, batch.id))

    counters = Counter()
    for record in _files_of(db, batch.id):
        if record.status == FileStatus.FAILED:
            counters["failed"] += 1
            continue
        try:
            outcome = _process_file(
                db,
                batch=batch,
                record=record,
                options=options,
                preset_for=preset_for,
                materials=materials,
                known_thicknesses=known_thicknesses,
                spec_index=spec_index,
            )
            counters[outcome] += 1
        except Exception as exc:  # один битый файл не должен ронять загрузку
            log.exception("Ошибка разбора %s", record.relpath)
            record.status = FileStatus.FAILED
            record.error = f"{type(exc).__name__}: {exc}"
            counters["failed"] += 1

    stats = dict(batch.stats or {})
    stats.update(
        {
            "parsed": counters["parsed"],
            "needs_clarification": counters["needs_clarification"],
            "duplicates": counters["duplicate"],
            "failed": counters["failed"],
        }
    )
    batch.stats = stats
    batch.status = ImportStatus.DONE
    db.flush()
    return stats


def _process_file(
    db: Session,
    *,
    batch: ImportBatch,
    record: ImportFile,
    options: ImportOptions,
    preset_for,
    materials: list[MaterialRef],
    known_thicknesses: list[float] | None,
    spec_index: dict,
) -> str:
    scan = read_file(Path(record.stored_path))

    # Источник определяется по сигнатуре КАЖДОГО файла: в одной пачке
    # спокойно едут выгрузки и из Базиса, и из Fusion.
    mapping = apply_preset(scan.layer_names(), preset_for(scan.detected_source))
    # Ручные назначения из мастера перекрывают пресет.
    mapping.semantic_by_layer.update(options.layer_overrides)
    for name in list(mapping.unmapped):
        if name in options.layer_overrides:
            mapping.unmapped.remove(name)

    contours = build_shapes(
        scan.primitives, mapping.semantic_by_layer, layer_meta=mapping.meta
    )
    if not contours.shapes:
        record.status = FileStatus.FAILED
        record.error = "; ".join(contours.warnings) or "Замкнутых контуров не найдено"
        return "failed"

    # Габариты листов, найденных в чертеже. Технолог подтверждает их и
    # заводит как формат листа на складе — размеры не выдумываются.
    record.detected_sheets = contours.sheets_as_dicts()

    spec_row = lookup(spec_index, record.filename)

    from app.resolve.filename import parse_filename

    parsed_name = parse_filename(record.filename, template_name=options.filename_template)

    project = _ensure_project(
        db,
        name=_first(
            spec_row.project_name if spec_row else None,
            options.project_name,
            parsed_name.project,
            UNASSIGNED_PROJECT,
        ),
    )
    product = _ensure_product(
        db,
        project=project,
        name=_first(
            spec_row.product_name if spec_row else None,
            options.product_name,
            parsed_name.product,
            UNASSIGNED_PRODUCT,
        ),
    )

    base_name = _first(
        spec_row.part_name if spec_row else None,
        parsed_name.part,
        Path(record.filename).stem,
    )
    qty = int(
        _first(
            spec_row.qty if spec_row else None,
            parsed_name.qty,
            1,
        )
    )

    created_any = False
    duplicated = False
    any_pending = False
    traces: list[dict] = []

    for index, shape in enumerate(contours.shapes):
        # Толщина определяется НА ДЕТАЛЬ: в одном чертеже спокойно лежат
        # лист 18 мм и лист 4 мм, и общий на файл ответ был бы неверным.
        resolved = _resolve_part(
            record=record,
            scan=scan,
            shape=shape,
            mapping=mapping,
            options=options,
            materials=materials,
            known_thicknesses=known_thicknesses,
            spec_row=spec_row,
        )
        accepted = (
            resolved["thickness_accepted"]
            and resolved["material"].accepted
            and not mapping.unmapped
        )
        status = PartStatus.READY if accepted else PartStatus.NEEDS_CLARIFICATION
        any_pending = any_pending or not accepted

        clarification = None
        if not accepted:
            clarification = {
                "thickness": resolved["thickness_res"].as_dict(),
                "material": resolved["material"].as_dict(),
                "unmapped_layers": mapping.unmapped,
                "geometry_warnings": contours.warnings + scan.warnings,
            }

        name = base_name if len(contours.shapes) == 1 else f"{base_name} ({index + 1})"
        part, is_duplicate = _upsert_part(
            db,
            product=product,
            name=name,
            code=spec_row.code if spec_row else None,
            qty=qty,
            geometry=shape.as_dict(),
            shape=shape,
            thickness=resolved["thickness"],
            thickness_source=resolved["thickness_source"],
            thickness_confidence=resolved["thickness_res"].confidence,
            material_res=resolved["material"],
            spec_row=spec_row,
            status=status,
            clarification=clarification,
            source_file=record.relpath,
        )
        # Векторы детали сразу получают траектории по семантике: технолог
        # правит назначения в редакторе, а не расставляет их с нуля.
        toolpath_service.auto_assign(db, part)

        record.part_id = part.id
        created_any = True
        duplicated = duplicated or is_duplicate
        if index < 5:  # трассировка нужна для разбора, а не для архива
            traces.append(
                {
                    "part": name,
                    "sheet_index": shape.sheet_index,
                    "layer": shape.source_layer,
                    "thickness": resolved["thickness_res"].as_dict(),
                    "material": resolved["material"].as_dict(),
                }
            )

    record.resolve_trace = {
        "filename": parsed_name.as_dict(),
        "layer_mapping": mapping.as_dict(),
        "sheets": record.detected_sheets,
        "geometry_warnings": contours.warnings + scan.warnings,
        "spec_matched": spec_row is not None,
        "parts": traces,
        "parts_total": len(contours.shapes),
    }

    if not created_any:
        record.status = FileStatus.FAILED
        return "failed"

    if any_pending:
        record.status = FileStatus.NEEDS_CLARIFICATION
        return "needs_clarification"

    if duplicated:
        record.status = FileStatus.DUPLICATE
        return "duplicate"

    record.status = FileStatus.PARSED
    return "parsed"



def _resolve_part(
    *,
    record: ImportFile,
    scan,
    shape,
    mapping,
    options: ImportOptions,
    materials: list[MaterialRef],
    known_thicknesses: list[float] | None,
    spec_row,
) -> dict:
    """Определяет толщину и материал ОДНОЙ детали.

    Порядок источников: глубина контура из имени слоя -> общая цепочка
    резолверов по файлу -> спецификация (перекрывает всё, она достовернее).
    """
    thickness_res = resolve_thickness(
        ResolveContext(
            filename=record.filename,
            relpath=record.relpath,
            layer_names=scan.layer_names(),
            texts=scan.texts,
            layer_depth=shape.thickness_hint,
            layer_thickness_regex=mapping.thickness_regex,
            filename_template=options.filename_template,
            known_thicknesses=known_thicknesses or [],
        )
    )

    thickness = thickness_res.value
    thickness_source = thickness_res.source
    thickness_accepted = thickness_res.accepted
    if spec_row is not None and spec_row.thickness:
        thickness = float(spec_row.thickness)
        thickness_source = ResolveSource.SPEC
        thickness_accepted = True

    material_res = resolve_material(
        filename=record.filename,
        relpath=record.relpath,
        texts=scan.texts,
        materials=materials,
        thickness=thickness,
        batch_default_id=options.material_id,
    )
    if spec_row is not None and spec_row.material_name:
        matched = _material_by_name(materials, spec_row.material_name, thickness)
        if matched is not None:
            material_res.material_id = matched.id
            material_res.material_name = matched.name
            material_res.source = ResolveSource.SPEC
            material_res.confidence = 1.0
            material_res.accepted = True
            material_res.note = f"из спецификации: «{spec_row.material_name}»"
        else:
            material_res.accepted = False
            material_res.note = (
                f"материал «{spec_row.material_name}» из спецификации "
                "отсутствует в справочнике"
            )

    return {
        "thickness": thickness,
        "thickness_source": thickness_source,
        "thickness_accepted": thickness_accepted,
        "thickness_res": thickness_res,
        "material": material_res,
    }


def _upsert_part(
    db: Session,
    *,
    product: Product,
    name: str,
    code: str | None,
    qty: int,
    geometry: dict,
    shape,
    thickness: float | None,
    thickness_source: str,
    thickness_confidence: float,
    material_res,
    spec_row,
    status: str,
    clarification: dict | None,
    source_file: str,
) -> tuple[Part, bool]:
    """Создаёт деталь или увеличивает количество у уже существующей такой же."""
    signature = geometry_signature(geometry, thickness)

    if dedup_enabled() and signature:
        for existing in _parts_of(db, product.id):
            if not existing.geometry:
                continue
            # Материал — часть идентичности детали наравне с геометрией и
            # толщиной: одинаковый по форме бок из белого ЛДСП и из дуба —
            # это две разные позиции, а не одна с количеством 2.
            if existing.material_id != material_res.material_id:
                continue
            if geometry_signature(existing.geometry, existing.thickness) == signature:
                existing.qty += qty
                _make_instances(db, existing, qty)
                return existing, True

    part = Part(
        product_id=product.id,
        name=name,
        code=code,
        qty=qty,
        length=spec_row.length if spec_row and spec_row.length else shape.length,
        width=spec_row.width if spec_row and spec_row.width else shape.width,
        thickness=thickness,
        material_id=material_res.material_id,
        grain=(spec_row.grain if spec_row and spec_row.grain else GrainMode.NONE),
        edge_top=spec_row.edge_top if spec_row else None,
        edge_bottom=spec_row.edge_bottom if spec_row else None,
        edge_left=spec_row.edge_left if spec_row else None,
        edge_right=spec_row.edge_right if spec_row else None,
        geometry=geometry,
        source_file=source_file,
        status=status,
        thickness_source=thickness_source,
        thickness_confidence=thickness_confidence,
        material_source=material_res.source,
        clarification=clarification,
    )
    db.add(part)
    db.flush()
    _make_instances(db, part, qty)
    return part, False


def _make_instances(db: Session, part: Part, qty: int) -> None:
    """Создаёт недостающие экземпляры детали. Каждый экземпляр получает
    сквозной uid — он попадает в QR на стикере."""
    start = (
        db.scalar(
            select(func.count()).select_from(PartInstance).where(
                PartInstance.part_id == part.id
            )
        )
        or 0
    )
    for i in range(qty):
        db.add(
            PartInstance(
                part_id=part.id,
                uid=f"P{part.product_id:04d}-D{part.id:06d}-{start + i + 1:03d}",
            )
        )
    db.flush()


# --------------------------------------------------------------------------
# Вспомогательное
# --------------------------------------------------------------------------


def _merge_bbox(current: list | None, incoming: list | None) -> list | None:
    if not incoming:
        return current
    if not current:
        return list(incoming)
    return [
        min(current[0], incoming[0]),
        min(current[1], incoming[1]),
        max(current[2], incoming[2]),
        max(current[3], incoming[3]),
    ]


def _first(*values):
    for value in values:
        if value is not None and str(value).strip() != "":
            return value
    return None


def _files_of(db: Session, batch_id: int) -> list[ImportFile]:
    return list(
        db.scalars(
            select(ImportFile).where(ImportFile.batch_id == batch_id).order_by(ImportFile.id)
        ).all()
    )


def _spec_rows(db: Session, batch_id: int) -> list[SpecRow]:
    return list(db.scalars(select(SpecRow).where(SpecRow.batch_id == batch_id)).all())


def _parts_of(db: Session, product_id: int) -> list[Part]:
    return list(db.scalars(select(Part).where(Part.product_id == product_id)).all())


def _material_refs(db: Session) -> list[MaterialRef]:
    return [
        MaterialRef(
            id=m.id,
            name=m.name,
            thickness=m.thickness,
            aliases=list(m.aliases or []),
        )
        for m in db.scalars(select(Material)).all()
    ]


def _material_by_name(
    materials: list[MaterialRef], name: str, thickness: float | None
) -> MaterialRef | None:
    target = name.strip().lower()
    candidates = [
        m
        for m in materials
        if m.name.strip().lower() == target
        or target in {a.strip().lower() for a in m.aliases}
    ]
    if thickness is not None:
        exact = [m for m in candidates if abs(m.thickness - thickness) < 0.01]
        if exact:
            return exact[0]
    return candidates[0] if candidates else None


def _ensure_project(db: Session, *, name: str) -> Project:
    project = db.scalar(select(Project).where(Project.name == name))
    if project is not None:
        return project
    used = [p.color_index for p in db.scalars(select(Project)).all()]
    index = next_color_index(used)
    project = Project(name=name, color_index=index, color=project_color(index))
    db.add(project)
    db.flush()
    return project


def _ensure_product(db: Session, *, project: Project, name: str) -> Product:
    product = db.scalar(
        select(Product).where(Product.project_id == project.id, Product.name == name)
    )
    if product is not None:
        return product
    siblings = db.scalars(select(Product).where(Product.project_id == project.id)).all()
    product = Product(project_id=project.id, name=name, shade_index=len(siblings))
    db.add(product)
    db.flush()
    return product


def _preset_resolver(db: Session, batch: ImportBatch, options: ImportOptions):
    """Возвращает функцию «источник файла → пресет слоёв».

    Приоритет: пресет, явно выбранный пользователем для всей загрузки →
    сохранённый пресет для источника этого файла → встроенный из конфига →
    пресет для источника пачки (если у файла источник не определился).
    """
    explicit: dict | None = None
    if options.layer_preset_id:
        saved = db.get(LayerPreset, options.layer_preset_id)
        if saved is not None:
            explicit = _preset_to_dict(saved)

    cache: dict[str, dict | None] = {}

    def resolve(source: str) -> dict | None:
        if explicit is not None:
            return explicit
        if source not in cache:
            saved = db.scalar(
                select(LayerPreset).where(LayerPreset.source == source).limit(1)
            )
            preset = _preset_to_dict(saved) if saved is not None else preset_for_source(source)
            if preset is None and source != batch.detected_source:
                preset = resolve(batch.detected_source)
            cache[source] = preset
        return cache[source]

    return resolve


def _preset_to_dict(preset: LayerPreset) -> dict:
    return {
        "name": preset.name,
        "source": preset.source,
        "rules": preset.rules or [],
        "thickness_from_layer_regex": preset.thickness_from_layer_regex,
    }


def max_upload_bytes() -> int:
    return int(app_config().get("import", {}).get("max_upload_mb", 512)) * 1024 * 1024

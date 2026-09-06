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
                },
            )
            entry["count"] += layer.get("count", 0)
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
        )
        for e in merged.values()
    ]
    return {
        "detected_source": batch.detected_source,
        "layers": sorted(merged.values(), key=lambda e: -e["count"]),
        "suggestions": {k: str(v) for k, v in suggest_semantics(infos).items()},
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

    contours = build_shapes(scan.primitives, mapping.semantic_by_layer)
    if not contours.shapes:
        record.status = FileStatus.FAILED
        record.error = "; ".join(contours.warnings) or "Замкнутых контуров не найдено"
        return "failed"

    spec_row = lookup(spec_index, record.filename)

    thickness_res = resolve_thickness(
        ResolveContext(
            filename=record.filename,
            relpath=record.relpath,
            layer_names=scan.layer_names(),
            texts=scan.texts,
            layer_thickness_regex=mapping.thickness_regex,
            filename_template=options.filename_template,
            known_thicknesses=known_thicknesses or [],
        )
    )

    thickness = thickness_res.value
    thickness_source = thickness_res.source
    thickness_accepted = thickness_res.accepted
    if spec_row is not None and spec_row.thickness:
        # Спецификация — самый достоверный источник, она перекрывает эвристики.
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

    accepted = thickness_accepted and material_res.accepted and not mapping.unmapped
    status = PartStatus.READY if accepted else PartStatus.NEEDS_CLARIFICATION

    clarification = None
    if not accepted:
        clarification = {
            "thickness": thickness_res.as_dict(),
            "material": material_res.as_dict(),
            "unmapped_layers": mapping.unmapped,
            "geometry_warnings": contours.warnings + scan.warnings,
        }

    record.resolve_trace = {
        "thickness": thickness_res.as_dict(),
        "material": material_res.as_dict(),
        "filename": parsed_name.as_dict(),
        "layer_mapping": mapping.as_dict(),
        "geometry_warnings": contours.warnings + scan.warnings,
        "spec_matched": spec_row is not None,
    }

    created_any = False
    duplicated = False
    for index, shape in enumerate(contours.shapes):
        name = base_name if len(contours.shapes) == 1 else f"{base_name} ({index + 1})"
        geometry = shape.as_dict()
        part, is_duplicate = _upsert_part(
            db,
            product=product,
            name=name,
            code=spec_row.code if spec_row else None,
            qty=qty,
            geometry=geometry,
            shape=shape,
            thickness=thickness,
            thickness_source=thickness_source,
            thickness_confidence=thickness_res.confidence,
            material_res=material_res,
            spec_row=spec_row,
            status=status,
            clarification=clarification,
            source_file=record.relpath,
        )
        record.part_id = part.id
        created_any = True
        duplicated = duplicated or is_duplicate

    if not created_any:
        record.status = FileStatus.FAILED
        return "failed"

    if duplicated:
        record.status = FileStatus.DUPLICATE
        return "duplicate"

    record.status = (
        FileStatus.PARSED if status == PartStatus.READY else FileStatus.NEEDS_CLARIFICATION
    )
    return "parsed" if status == PartStatus.READY else "needs_clarification"


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

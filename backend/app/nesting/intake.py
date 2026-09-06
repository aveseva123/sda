"""Добавление DXF в раскрой.

Порядок работы цеха: сначала заводится раскрой — материал, толщина, оператор,
— и только потом в него добавляются файлы. Откуда выгружен DXF, платформе
безразлично: она смотрит на геометрию, а имя файла и слои читает как подсказку.

На каждый файл оператор отвечает в диалоге: толщина, проект, изделие,
направление волокна. Поля предзаполняются разбором имени файла и глубинами из
слоёв — но последнее слово за человеком, он смотрит на настоящий лист.

Правило «один файл — одна толщина» задал заказчик. Платформа его соблюдает,
но не молчит: если слои чертежа говорят о другой толщине, расхождение
показывается прямо в отчёте о добавлении.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config_files import app_config
from app.dxf import build_shapes, read_file
from app.importer import (
    ImportOptions,
    IncomingFile,
    create_batch,
    process_batch,
    scan_batch,
)
from app.importer.pipeline import _preset_resolver
from app.models import (
    GrainMode,
    ImportBatch,
    ImportFile,
    Material,
    NestingJob,
    Part,
    PartStatus,
)
from app.resolve import apply_preset
from app.resolve.filename import parse_filename


@dataclass(slots=True)
class FileCard:
    """Что платформа предлагает по файлу — и что оператор правит в диалоге."""

    file_id: int
    filename: str
    relpath: str
    # Предзаполнено из имени файла.
    order_name: str | None
    product_name: str | None
    part_name: str | None
    qty: int
    # Толщина: предложение и всё, что нашлось в слоях.
    thickness: float | None
    thickness_source: str
    detected_thicknesses: list[float]
    parts: int
    detected_source: str
    warnings: list[str]

    def as_dict(self) -> dict:
        return {
            "file_id": self.file_id,
            "filename": self.filename,
            "relpath": self.relpath,
            "order_name": self.order_name,
            "product_name": self.product_name,
            "part_name": self.part_name,
            "qty": self.qty,
            "thickness": self.thickness,
            "thickness_source": self.thickness_source,
            "detected_thicknesses": self.detected_thicknesses,
            "parts": self.parts,
            "detected_source": self.detected_source,
            "warnings": self.warnings,
        }


def analyze(db: Session, job: NestingJob, files: list[IncomingFile]) -> dict:
    """Первый шаг: файлы приняты, разобраны, но деталей ещё нет.

    Возвращает карточки для диалога. Ничего не создаётся до подтверждения —
    оператор может передумать и убрать файл.
    """
    batch = create_batch(db, name=f"Раскрой №{job.id}", files=files)
    scan_batch(db, batch)
    preset_for = _preset_resolver(db, batch, ImportOptions())

    cards: list[FileCard] = []
    for record in db.scalars(
        select(ImportFile).where(ImportFile.batch_id == batch.id).order_by(ImportFile.id)
    ).all():
        cards.append(_card(record, preset_for=preset_for, job=job))

    db.flush()
    return {"batch_id": batch.id, "files": [card.as_dict() for card in cards]}


def snap_thickness(value: float) -> float:
    """Приводит глубину из слоя к известной толщине материала.

    В чертеже глубина пишется с запасом на подрез: «16.10» — это лист 16 мм,
    а не отдельная толщина. Показывать оператору обе бессмысленно.
    """
    cfg = app_config().get("thicknesses", {}) or {}
    tolerance = float(cfg.get("match_tolerance", 0.5))
    known = [float(v) for v in cfg.get("known", [])]
    for candidate in known:
        if abs(candidate - value) <= tolerance:
            return candidate
    return round(value, 1)


def _card(record: ImportFile, *, preset_for, job: NestingJob) -> FileCard:
    parsed = parse_filename(record.filename)
    warnings: list[str] = []
    thicknesses: list[float] = []
    parts = 0

    try:
        scan = read_file(Path(record.stored_path))
        mapping = apply_preset(scan.layer_names(), preset_for(scan.detected_source))
        contours = build_shapes(
            scan.primitives, mapping.semantic_by_layer, layer_meta=mapping.meta
        )
        parts = len(contours.shapes)
        found = Counter(
            snap_thickness(shape.thickness_hint)
            for shape in contours.shapes
            if shape.thickness_hint is not None
        )
        thicknesses = sorted(found)
        warnings.extend(contours.warnings[:3])
        if not parts:
            warnings.append("Замкнутых контуров не найдено — файл не даст деталей.")
    except Exception as exc:  # битый файл не должен ронять диалог
        warnings.append(f"Файл не читается: {type(exc).__name__}: {exc}")

    # Что подставить в поле толщины. Файл добавляют в конкретный раскрой,
    # поэтому если его толщина в чертеже есть — предлагается она: скорее
    # всего оператор принёс файл именно ради этих деталей.
    matching = [value for value in thicknesses if abs(value - job.thickness) < 0.01]
    if matching:
        thickness, source = matching[0], "толщина раскроя найдена в чертеже"
    elif len(thicknesses) == 1:
        thickness, source = thicknesses[0], "слои чертежа"
    elif parsed.thickness is not None:
        thickness, source = parsed.thickness, "имя файла"
    elif thicknesses:
        thickness, source = thicknesses[0], "слои чертежа"
    else:
        thickness, source = job.thickness, "толщина раскроя"

    if len(thicknesses) > 1:
        listed = ", ".join(f"{value:g}" for value in thicknesses)
        warnings.append(
            f"В файле встречаются толщины: {listed} мм. "
            "Один файл — одна толщина: выберите нужную, остальные детали "
            "будут отнесены к ней же."
        )

    return FileCard(
        file_id=record.id,
        filename=record.filename,
        relpath=record.relpath,
        order_name=parsed.order,
        product_name=parsed.group,
        part_name=parsed.part,
        qty=parsed.qty or 1,
        thickness=thickness,
        thickness_source=source,
        detected_thicknesses=thicknesses,
        parts=parts,
        detected_source=record.detected_source,
        warnings=warnings,
    )


def confirm(db: Session, job: NestingJob, batch_id: int, decisions: list[dict]) -> dict:
    """Второй шаг: решения оператора приняты, детали заводятся и ложатся на лист.

    ``decisions`` — по одному на файл: relpath, thickness, order_name,
    product_name, grain. Файл, которого нет в списке, в раскрой не идёт.
    """
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise ValueError("Загрузка не найдена")

    overrides: dict[str, dict] = {}
    for decision in decisions:
        relpath = decision.get("relpath")
        if not relpath:
            continue
        overrides[relpath] = {
            "thickness": decision.get("thickness"),
            "material_id": decision.get("material_id") or job.material_id,
            "order_name": decision.get("order_name"),
            "product_name": decision.get("product_name"),
            "grain": decision.get("grain") or GrainMode.NONE,
        }

    # Файлы, которые оператор не подтвердил, не разбираются вовсе.
    for record in db.scalars(
        select(ImportFile).where(ImportFile.batch_id == batch.id)
    ).all():
        if record.relpath not in overrides:
            db.delete(record)
    db.flush()

    stats = process_batch(
        db,
        batch,
        ImportOptions(material_id=job.material_id, file_overrides=overrides),
    )

    added = 0
    foreign: Counter[float] = Counter()
    conflicts: list[dict] = []
    for record in db.scalars(
        select(ImportFile).where(ImportFile.batch_id == batch.id)
    ).all():
        trace = record.resolve_trace or {}
        for conflict in trace.get("thickness_conflicts", []):
            conflicts.append({"file": record.filename, **conflict})
        for part in db.scalars(select(Part).where(Part.source_file_id == record.id)).all():
            if part.thickness is not None and abs(part.thickness - job.thickness) > 0.01:
                foreign[part.thickness] += 1
            else:
                added += 1

    material = db.get(Material, job.material_id)
    warnings: list[str] = []
    for thickness, count in sorted(foreign.items()):
        warnings.append(
            f"{count} деталей толщиной {thickness:g} мм в этот раскрой не попадут: "
            f"он на {job.thickness:g} мм. Заведите для них отдельный раскрой."
        )
    for conflict in conflicts:
        parts = conflict.get("parts", 1)
        warnings.append(
            f"«{conflict['file']}»: слой «{conflict.get('layer') or '—'}» "
            f"объявляет {conflict['thickness']:g} мм у {parts} дет. — "
            "проверьте толщину."
        )

    return {
        "batch_id": batch.id,
        "added": added,
        "material": material.name if material else None,
        "stats": stats,
        "warnings": warnings,
    }


def pending_parts(db: Session, job: NestingJob) -> int:
    """Сколько деталей раскроя всё ещё требуют уточнения."""
    return len(
        db.scalars(
            select(Part).where(
                Part.material_id == job.material_id,
                Part.thickness == job.thickness,
                Part.status == PartStatus.NEEDS_CLARIFICATION,
            )
        ).all()
    )

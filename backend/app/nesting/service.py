"""Задания на раскрой: создание, автораскладка, ручные правки.

Раскрой всегда идёт по паре «материал + толщина» — разные толщины никогда
не попадают на один лист. Задание собирает все готовые детали этой пары,
раскладывает их и отдаёт редактору всё, что нужно для отрисовки холста
одним запросом.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.colors import part_style
from app.cutting import service as cutting
from app.models import (
    CuttingPreset,
    ImportFile,
    JobStage,
    JobStatus,
    Material,
    NestingJob,
    Part,
    PartInstance,
    PartStatus,
    Sheet,
    StockItem,
)
from app.nesting.layout import EPS, Piece, pack


class NestingError(RuntimeError):
    pass


@dataclass(slots=True)
class InstanceView:
    """Экземпляр детали на холсте."""

    instance_id: int
    part_id: int
    uid: str
    sheet_index: int | None
    x: float | None
    y: float | None
    rotation: float
    pinned: bool


def create_job(
    db: Session,
    *,
    material_id: int,
    thickness: float,
    name: str | None = None,
    sheet_w: float | None = None,
    sheet_h: float | None = None,
    preset_id: int | None = None,
    operator: str | None = None,
    auto_arrange: bool = True,
) -> NestingJob:
    """Создаёт задание и, если попросили, сразу раскладывает детали.

    Пресет раскроя подбирается по паре «материал + толщина», если его не
    указали явно. Если подходящего пресета нет, задание остаётся без него —
    ничего не выдумываем молча, технолог выберет пресет руками.
    """
    material = db.get(Material, material_id)
    if material is None:
        raise NestingError("Материал не найден")

    # Толщина — часть идентичности материала: «ЛДСП 16» и «ЛДСП 28» это две
    # разные записи справочника, а не одна с параметром. Раскрой, заведённый
    # на ЛДСП 28 с объявленной толщиной 16, взял бы формат листа и обрезку
    # кромок от одной записи, а глубины резания — от другой: фреза ушла бы на
    # двенадцать миллиметров мимо. В интерфейсе так не сделать — там материал
    # и толщина выбираются одним списком, — но через API можно было.
    if abs(float(material.thickness) - float(thickness)) > 0.001:
        raise NestingError(
            f"Материал «{material.name}» — это {material.thickness:g} мм, "
            f"а раскрой заводится на {thickness:g} мм. "
            "Выберите запись справочника с нужной толщиной."
        )

    if preset_id is None:
        preset = cutting.preset_for(db, material=material, thickness=thickness)
    else:
        preset = db.get(CuttingPreset, preset_id)
        if preset is None:
            raise NestingError("Пресет раскроя не найден")

    job = NestingJob(
        name=name or f"{material.name} {thickness:g} мм",
        material_id=material_id,
        thickness=thickness,
        operator=(operator or None),
        stage=JobStage.PLANNING,
        status=JobStatus.DRAFT,
        params={
            "sheet_w": sheet_w or material.sheet_w,
            "sheet_h": sheet_h or material.sheet_h,
        },
    )
    _apply_preset(job, preset)
    db.add(job)
    db.flush()

    # Раскладывать нечего, пока в раскрой не добавили файлы: пустое задание
    # — это нормальное начало работы, а не ошибка.
    if auto_arrange and job_instances(db, job):
        arrange(db, job)
    return job


def _apply_preset(job: NestingJob, preset: CuttingPreset | None) -> None:
    """Записывает в задание пресет и снимок его параметров раскладки."""
    job.preset_id = preset.id if preset else None
    if preset is None:
        job.preset_snapshot = None
        return
    job.preset_snapshot = {
        "slug": preset.slug,
        "name": preset.name,
        "placement": preset.placement or {},
        "depth": preset.depth or {},
        "strategy": preset.strategy or {},
        "tools": preset.tools or {},
        "order": list(preset.order or []),
        "safety": preset.safety or {},
        "post": preset.post or {},
        # Параметры раскладки считаются один раз и остаются в задании:
        # правка пресета не должна незаметно менять уже посчитанный раскрой.
        "layout": cutting.placement_params(preset),
    }


def tune_placement(db: Session, job: NestingJob, values: dict) -> NestingJob:
    """Правка раскладки на одном раскрое.

    Технолог смотрит на конкретный лист и решает: тут мостик побольше, тут
    деталь нельзя вертеть. Общий шаблон траекторий при этом не меняется —
    у соседнего раскроя свои условия.
    """
    snapshot = dict(job.preset_snapshot or {})
    layout = dict(snapshot.get("layout") or {})

    if values.get("part_gap") is not None:
        layout["part_gap"] = float(values["part_gap"])
    if values.get("sheet_margin") is not None:
        layout["sheet_margin"] = float(values["sheet_margin"])
    if values.get("respect_grain") is not None:
        layout["respect_grain"] = bool(values["respect_grain"])
    rotation = values.get("rotation")
    if rotation == "none":
        layout["rotations"] = [0.0]
    elif rotation in {"quarter", "free"}:
        layout.pop("rotations", None)
        layout["rotation_step"] = 90

    snapshot["layout"] = layout
    job.preset_snapshot = snapshot
    db.flush()
    return job


def set_preset(db: Session, job: NestingJob, preset_id: int | None) -> NestingJob:
    """Смена пресета на задании. Раскладку пересчитывает вызывающий."""
    preset = db.get(CuttingPreset, preset_id) if preset_id is not None else None
    if preset_id is not None and preset is None:
        raise NestingError("Пресет раскроя не найден")
    _apply_preset(job, preset)
    db.flush()
    return job


# Чеклист закрытия раскроя — ровно то, что цех проверяет у стола.
CHECKLIST: tuple[tuple[str, str], ...] = (
    ("marking", "Маркировка сделана"),
    ("sorted", "Детали отсортированы по проектам и изделиям"),
    ("counted", "Количество деталей посчитано"),
)


def checklist_state(job: NestingJob) -> list[dict]:
    saved = job.checklist or {}
    return [
        {"key": key, "title": title, "done": bool(saved.get(key))}
        for key, title in CHECKLIST
    ]


def take(db: Session, job: NestingJob, operator: str) -> NestingJob:
    """«Взял в работу»: у листа появляется хозяин.

    Учётных записей в платформе нет — в цеху их не заводят, поэтому оператор
    просто называет себя. Имя уходит в журнал и в стикеры.
    """
    operator = (operator or "").strip()
    if not operator:
        raise NestingError("Назовите оператора — кто берёт лист в работу")
    job.operator = operator
    job.stage = JobStage.IN_PROGRESS
    job.taken_at = datetime.now(UTC)
    db.flush()
    return job


def set_checklist(db: Session, job: NestingJob, values: dict) -> NestingJob:
    """Отметки чеклиста. Ставятся по ходу работы, до завершения."""
    known = {key for key, _ in CHECKLIST}
    saved = dict(job.checklist or {})
    for key, value in values.items():
        if key in known:
            saved[key] = bool(value)
    job.checklist = saved
    db.flush()
    return job


def finish(db: Session, job: NestingJob) -> NestingJob:
    """«Раскрой завершён». Закрывается только по полному чеклисту.

    Незакрытый пункт — это несделанная работа: неразмеченные детали в цеху
    никто не найдёт, а несосчитанные всплывут на сборке.

    Здесь же закрывается круг со складом: листы, которые ушли под фрезу,
    списываются, а свободная полоса каждого листа возвращается деловым
    отходом — если она достаточно велика, чтобы её стоило хранить.
    """
    if job.stage != JobStage.IN_PROGRESS:
        raise NestingError("Сначала возьмите раскрой в работу")
    missing = [item["title"] for item in checklist_state(job) if not item["done"]]
    if missing:
        raise NestingError("Не отмечено: " + "; ".join(missing))

    job.stage = JobStage.FINISHED
    job.finished_at = datetime.now(UTC)
    db.flush()
    consume_stock(db, job)
    return job


def part_footprint(part: Part) -> tuple[float, float]:
    """Габарит детали так, как она лежит на чертеже: ширина по X, высота по Y.

    ``part.length`` и ``part.width`` — это больший и меньший размеры: они
    годятся для спецификации и стикера, но теряют ориентацию. Раскладчик,
    считая по ним, резервировал под вертикальную деталь горизонтальное место,
    а холст рисовал её как есть — детали налезали друг на друга уже на карте,
    и раскрой уходил на станок с наложением.
    """
    geometry = part.geometry or {}
    bbox = geometry.get("bbox") if isinstance(geometry, dict) else None
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        w = float(bbox[2]) - float(bbox[0])
        h = float(bbox[3]) - float(bbox[1])
        if w > 0 and h > 0:
            return round(w, 3), round(h, 3)
    return float(part.length or 0.0), float(part.width or 0.0)


def _sheet_offcut(db: Session, job: NestingJob, sheet: Sheet) -> dict | None:
    """Свободная полоса листа сверху — то, что останется после раскроя."""
    material = db.get(Material, job.material_id)
    trim_top = material.trim_top if material else 0.0
    trim_left = material.trim_left if material else 0.0
    trim_right = material.trim_right if material else 0.0

    top = material.trim_bottom if material else 0.0
    for instance, part in job_instances(db, job):
        if instance.sheet_id != sheet.id or instance.y is None:
            continue
        footprint_w, footprint_h = part_footprint(part)
        height = footprint_h
        if int(instance.rotation or 0) % 180 == 90:
            height = footprint_w
        top = max(top, float(instance.y) + height)

    height = sheet.h - trim_top - top
    width = sheet.w - trim_left - trim_right
    if height <= 0 or width <= 0:
        return None
    return {"w": round(width, 1), "h": round(height, 1)}


def consume_stock(db: Session, job: NestingJob) -> dict:
    """Списывает израсходованные листы и возвращает на склад обрезки.

    Поведение включается ``stock.consume_on_cut`` в config/app.yaml: у кого-то
    склад ведётся в другой системе, и тогда платформа не должна в него лезть.
    Целые листы, которых не хватило на складе, не выдумываются: сколько было,
    столько и списывается, остальное остаётся расхождением для кладовщика.
    """
    from app.core.config_files import app_config
    from app.stock import service as stock

    cfg = (app_config().get("stock", {}) or {})
    if not cfg.get("consume_on_cut", True):
        return {"consumed": 0, "offcuts": 0, "skipped": "выключено в конфиге"}

    sheets = list(
        db.scalars(select(Sheet).where(Sheet.job_id == job.id).order_by(Sheet.index)).all()
    )
    available = stock.available_items(db, material_id=job.material_id, kind="sheet")

    consumed = 0
    offcuts = 0
    for sheet in sheets:
        source = next((item for item in available if item.qty > 0), None)
        if source is None:
            break
        rest = _sheet_offcut(db, job, sheet)
        spec = []
        if rest is not None:
            verdict = stock.judge_offcut(rest["w"], rest["h"])
            if verdict.worth_keeping:
                spec.append(
                    stock.OffcutSpec(
                        w=rest["w"],
                        h=rest["h"],
                        note=f"остаток листа {sheet.index + 1} · раскрой №{job.id}",
                    )
                )
        result = stock.consume(
            db,
            item_id=source.id,
            qty=1,
            offcuts=spec,
            reason=f"раскрой №{job.id}",
            actor=job.operator,
            sheet_id=sheet.id,
        )
        consumed += 1
        offcuts += len(result.get("offcuts", []))
        if source.qty <= 0:
            available = [item for item in available if item.id != source.id]

    db.flush()
    return {"consumed": consumed, "offcuts": offcuts, "sheets": len(sheets)}


def job_instances(db: Session, job: NestingJob) -> list[tuple[PartInstance, Part]]:
    """Экземпляры деталей, которые должны лечь в это задание.

    Деталь принадлежит раскрою, в который её добавили. Свободная деталь —
    та, что пришла старым импортом мимо раскроя, — достаётся первому раскрою
    своей пары «материал + толщина», который её разложит, и дальше остаётся
    за ним. Иначе два раскроя 16 мм тянули бы одни и те же детали, и второй
    пересчёт разбрасывал бы листы первого.

    Берутся только готовые детали: из очереди уточнений деталь в раскрой не
    попадает — иначе она уедет на чужой лист.
    """
    rows = db.execute(
        select(PartInstance, Part)
        .join(Part, Part.id == PartInstance.part_id)
        .where(
            Part.material_id == job.material_id,
            Part.thickness == job.thickness,
            Part.status == PartStatus.READY,
            or_(Part.job_id == job.id, Part.job_id.is_(None)),
        )
        .order_by(PartInstance.id)
    ).all()
    return [(instance, part) for instance, part in rows]


def arrange(db: Session, job: NestingJob, *, keep_pinned: bool = True) -> dict:
    """Автораскладка. Зафиксированные детали остаются на своих местах."""
    _require_open(job)
    material = db.get(Material, job.material_id)
    params = job.params or {}
    sheet_w = float(params.get("sheet_w") or material.sheet_w)
    sheet_h = float(params.get("sheet_h") or material.sheet_h)

    # Раскладка идёт по снимку пресета, а не по текущему конфигу: задание
    # обязано пересчитываться так же, как считалось в первый раз.
    layout_params = dict((job.preset_snapshot or {}).get("layout") or {})
    respect_grain = layout_params.pop("respect_grain", None)

    pairs = job_instances(db, job)
    if not pairs:
        raise NestingError(
            "Для этой пары «материал + толщина» нет готовых деталей. "
            "Проверьте очередь уточнений."
        )

    # Разложенная деталь закрепляется за этим раскроем: соседний раскрой той
    # же толщины её больше не увидит и не сдвинет.
    for _, part in pairs:
        if part.job_id is None:
            part.job_id = job.id
    db.flush()

    existing_sheets = {
        sheet.index: sheet
        for sheet in db.scalars(select(Sheet).where(Sheet.job_id == job.id)).all()
    }
    index_by_sheet_id = {sheet.id: index for index, sheet in existing_sheets.items()}

    pieces: list[Piece] = []
    for instance, part in pairs:
        pinned = bool(instance.pinned) and keep_pinned
        footprint_w, footprint_h = part_footprint(part)
        pieces.append(
            Piece(
                instance_id=instance.id,
                part_id=part.id,
                w=footprint_w,
                h=footprint_h,
                grain=part.grain,
                pinned=pinned and instance.x is not None,
                x=instance.x,
                y=instance.y,
                rotation=instance.rotation or 0.0,
            )
        )

    result = pack(
        pieces,
        sheet_w=sheet_w,
        sheet_h=sheet_h,
        trim=(
            material.trim_left,
            material.trim_right,
            material.trim_bottom,
            material.trim_top,
        ),
        has_grain=material.has_grain and respect_grain is not False,
        params=layout_params,
    )

    # Листы задания приводятся к результату раскладки.
    for plan in result.sheets:
        sheet = existing_sheets.get(plan.index)
        if sheet is None:
            sheet = Sheet(
                job_id=job.id,
                index=plan.index,
                material_id=job.material_id,
                w=sheet_w,
                h=sheet_h,
            )
            db.add(sheet)
            db.flush()
            existing_sheets[plan.index] = sheet
        sheet.utilization = plan.utilization
        index_by_sheet_id[sheet.id] = plan.index

    for index, sheet in list(existing_sheets.items()):
        if index >= len(result.sheets):
            db.delete(sheet)
            del existing_sheets[index]
    db.flush()

    by_instance = {
        placement.instance_id: (placement, plan)
        for plan in result.sheets
        for placement in plan.placements
    }
    for instance, _ in pairs:
        found = by_instance.get(instance.id)
        if found is None:
            instance.sheet_id = None
            instance.x = instance.y = None
            continue
        placement, plan = found
        sheet = existing_sheets[plan.index]
        instance.sheet_id = sheet.id
        instance.x = placement.x
        instance.y = placement.y
        instance.rotation = placement.rotation
        # Закрепление означает «эту деталь поставил человек, не трогать».
        # Полный пересчёт её всё равно переложил, значит ручного места больше
        # нет — флаг снимается. Иначе следующее «Уплотнить» замораживало бы
        # координаты, выбранные машиной, и переставало что-либо делать.
        if not keep_pinned:
            instance.pinned = False

    # КИМ считается одной формулой на всю платформу — от полной площади листа.
    # Укладчик делит на ПОЛЕЗНУЮ площадь (лист минус обрезка кромок), и из-за
    # этого число прыгало: разложил — 91 %, сдвинул деталь на миллиметр и
    # пересчёт после правки показал 89,6 %. Обрезка кромок — тоже купленный
    # материал, поэтому знаменатель здесь полный лист.
    db.flush()
    _recalculate_utilization(db, job)
    job.status = JobStatus.DONE
    # Карточка пресета показывает КИМ последнего задания, посчитанного им.
    if job.preset_id:
        preset = db.get(CuttingPreset, job.preset_id)
        if preset is not None:
            preset.last_utilization = job.utilization
    db.flush()

    return {
        "sheets": len(result.sheets),
        "placed": len(by_instance),
        "unplaced": len(result.unplaced),
        "utilization": job.utilization or 0.0,
        "warnings": result.warnings,
    }


def layout_payload(db: Session, job: NestingJob) -> dict:
    """Всё, что нужно холсту для отрисовки, одним запросом.

    Собирать это на фронте отдельными вызовами нельзя: на листе бывает
    больше сотни деталей, и каждая тянула бы за собой геометрию, цвет
    проекта и назначенные траектории.
    """
    material = db.get(Material, job.material_id)
    sheets = list(
        db.scalars(select(Sheet).where(Sheet.job_id == job.id).order_by(Sheet.index)).all()
    )
    sheet_index = {sheet.id: sheet.index for sheet in sheets}

    pairs = job_instances(db, job)
    part_ids = {part.id for _, part in pairs}
    parts = {part.id: part for _, part in pairs}

    files = {
        record.id: record
        for record in db.scalars(
            select(ImportFile).where(
                ImportFile.id.in_(
                    {part.source_file_id for part in parts.values() if part.source_file_id}
                )
            )
        ).all()
    }

    from app.toolpath.service import assignments_of, vectors_of

    assignments = assignments_of(db, list(part_ids))

    part_payload = {}
    for part in parts.values():
        source = files.get(part.source_file_id) if part.source_file_id else None
        # Цвет — по файлу, штриховка — по листу внутри файла.
        style = part_style(
            source.color if source else "#7D82C5", part.source_sheet_index or 0
        )
        assigned = {row.target: row for row in assignments.get(part.id, [])}
        part_payload[part.id] = {
            "id": part.id,
            "name": part.name,
            "order_name": part.order_name,
            "source_file_id": part.source_file_id,
            "source_file": source.filename if source else None,
            "source_sheet_index": part.source_sheet_index,
            "style": style,
            "length": part.length,
            "width": part.width,
            "thickness": part.thickness,
            "grain": part.grain,
            "geometry": part.geometry,
            "vectors": [
                {
                    **vector.as_dict(),
                    "preset_id": assigned[vector.target].preset_id
                    if vector.target in assigned
                    else None,
                    "enabled": assigned[vector.target].enabled
                    if vector.target in assigned
                    else False,
                    # Значок «АВТО» в панели траекторий: назначено по
                    # геометрии или руками технолога.
                    "assigned_manually": assigned[vector.target].assigned_manually
                    if vector.target in assigned
                    else False,
                }
                for vector in vectors_of(part).vectors
            ],
        }

    instances = [
        {
            "id": instance.id,
            "part_id": instance.part_id,
            "uid": instance.uid,
            "sheet_index": sheet_index.get(instance.sheet_id),
            "x": instance.x,
            "y": instance.y,
            "rotation": instance.rotation,
            "pinned": instance.pinned,
        }
        for instance, _ in pairs
    ]

    return {
        "job": {
            "id": job.id,
            "name": job.name,
            "material_id": job.material_id,
            "material_name": material.name if material else None,
            "has_grain": material.has_grain if material else False,
            "thickness": job.thickness,
            "status": job.status,
            "utilization": job.utilization,
            "params": job.params,
            "preset": cutting.summary(
                db.get(CuttingPreset, job.preset_id) if job.preset_id else None
            ),
            "preset_snapshot": job.preset_snapshot,
            "operator": job.operator,
            "stage": job.stage,
            "checklist": checklist_state(job),
        },
        "sheets": [
            {
                "id": sheet.id,
                "index": sheet.index,
                "w": sheet.w,
                "h": sheet.h,
                "utilization": sheet.utilization,
                "is_offcut": sheet.is_offcut,
                "trim": {
                    "left": material.trim_left if material else 0.0,
                    "right": material.trim_right if material else 0.0,
                    "top": material.trim_top if material else 0.0,
                    "bottom": material.trim_bottom if material else 0.0,
                },
            }
            for sheet in sheets
        ],
        "parts": part_payload,
        "instances": instances,
        "stock": _stock_summary(db, job),
    }


def _stock_summary(db: Session, job: NestingJob) -> dict:
    """Хватает ли листов на складе под это задание."""
    available = db.scalar(
        select(func.coalesce(func.sum(StockItem.qty), 0)).where(
            StockItem.material_id == job.material_id,
            StockItem.status == "available",
        )
    )
    needed = db.scalar(
        select(func.count()).select_from(Sheet).where(Sheet.job_id == job.id)
    )
    return {"available": int(available or 0), "needed": int(needed or 0)}


def move_instances(db: Session, job: NestingJob, moves: list[dict]) -> dict:
    """Ручная правка раскладки из редактора.

    Каждое перемещение фиксирует деталь: пересчёт раскладки её больше не
    двигает. Это прямое требование — последнее слово за технологом.
    """
    _require_open(job)
    sheets = {
        sheet.index: sheet
        for sheet in db.scalars(select(Sheet).where(Sheet.job_id == job.id)).all()
    }
    own = {instance.id for instance, _ in job_instances(db, job)}
    updated = 0
    for move in moves:
        instance = db.get(PartInstance, move["instance_id"])
        if instance is None:
            continue
        # Двигать можно только свои детали: чужая деталь принадлежит другому
        # раскрою, и её положение — чужая производственная запись.
        if instance.id not in own:
            raise NestingError(
                f"Деталь #{instance.id} не принадлежит этому раскрою"
            )
        if "sheet_index" in move and move["sheet_index"] is not None:
            sheet = sheets.get(int(move["sheet_index"]))
            if sheet is None:
                raise NestingError(f"Листа №{move['sheet_index']} нет в задании")
            instance.sheet_id = sheet.id
        if move.get("x") is not None:
            instance.x = float(move["x"])
        if move.get("y") is not None:
            instance.y = float(move["y"])
        if move.get("rotation") is not None:
            instance.rotation = float(move["rotation"]) % 360
        instance.pinned = bool(move.get("pinned", True))
        updated += 1

    db.flush()
    _recalculate_utilization(db, job)
    return {"updated": updated, "utilization": job.utilization}


def _require_open(job: NestingJob) -> None:
    """Завершённый раскрой не переставляется.

    Лист уже отрезан, детали размечены и посчитаны, лист списан со склада.
    Переложить карту после этого — значит сделать её описанием того, чего в
    цеху не было: маркировка на деталях перестанет совпадать с экраном.
    """
    if job.stage == JobStage.FINISHED:
        raise NestingError(
            "Раскрой завершён: лист отрезан и списан. Раскладку менять нельзя — "
            "заведите новый раскрой."
        )


def _recalculate_utilization(db: Session, job: NestingJob) -> None:
    pairs = {instance.id: part for instance, part in job_instances(db, job)}
    sheets = list(db.scalars(select(Sheet).where(Sheet.job_id == job.id)).all())
    total_area = 0.0
    used_total = 0.0

    for sheet in sheets:
        used = 0.0
        for instance in db.scalars(
            select(PartInstance).where(PartInstance.sheet_id == sheet.id)
        ).all():
            part = pairs.get(instance.id)
            if part is not None:
                footprint_w, footprint_h = part_footprint(part)
                used += footprint_w * footprint_h
        sheet.utilization = round(used / (sheet.w * sheet.h), 4) if sheet.w and sheet.h else 0.0
        total_area += sheet.w * sheet.h
        used_total += used

    job.utilization = round(used_total / total_area, 4) if total_area else 0.0
    db.flush()


def collisions(db: Session, job: NestingJob) -> list[dict]:
    """Пересечения деталей и выходы за габарит листа.

    Ручная правка не запрещается — технолог может знать, что делает, — но
    проблема должна быть видна сразу.
    """
    from app.core.config_files import app_config

    # Зазор проверяется тот же, с которым задание считалось: иначе ручная
    # правка «краснела» бы по чужим правилам.
    cfg = {
        **(app_config().get("nesting", {}) or {}),
        **((job.preset_snapshot or {}).get("layout") or {}),
    }
    gap = float(cfg.get("kerf", 8.0)) + float(cfg.get("part_gap", 0.0))

    material = db.get(Material, job.material_id)
    sheets = {
        sheet.id: sheet
        for sheet in db.scalars(select(Sheet).where(Sheet.job_id == job.id)).all()
    }
    parts = {part.id: part for _, part in job_instances(db, job)}

    boxes: dict[int, list[tuple]] = {}
    issues: list[dict] = []

    for instance, part in job_instances(db, job):
        if instance.sheet_id is None or instance.x is None or instance.y is None:
            continue
        w, h = part_footprint(part)
        if int(instance.rotation or 0) % 180 == 90:
            w, h = h, w
        boxes.setdefault(instance.sheet_id, []).append(
            (instance.id, instance.x, instance.y, w, h, part.name)
        )

    for sheet_id, items in boxes.items():
        sheet = sheets.get(sheet_id)
        if sheet is None:
            continue
        min_x = material.trim_left if material else 0.0
        min_y = material.trim_bottom if material else 0.0
        max_x = sheet.w - (material.trim_right if material else 0.0)
        max_y = sheet.h - (material.trim_top if material else 0.0)

        for instance_id, x, y, w, h, name in items:
            if (
                x < min_x - EPS
                or y < min_y - EPS
                or x + w > max_x + EPS
                or y + h > max_y + EPS
            ):
                issues.append(
                    {
                        "kind": "out_of_sheet",
                        "instance_ids": [instance_id],
                        "sheet_index": sheet.index,
                        "message": f"«{name}» выходит за полезную область листа",
                    }
                )

        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a_id, ax, ay, aw, ah, a_name = items[i]
                b_id, bx, by, bw, bh, b_name = items[j]
                if not (
                    ax + aw + gap <= bx + EPS
                    or bx + bw + gap <= ax + EPS
                    or ay + ah + gap <= by + EPS
                    or by + bh + gap <= ay + EPS
                ):
                    issues.append(
                        {
                            "kind": "overlap",
                            "instance_ids": [a_id, b_id],
                            "sheet_index": sheet.index,
                            "message": (
                                f"«{a_name}» и «{b_name}» ближе {gap:g} мм "
                                "(ширина реза + мостик)"
                            ),
                        }
                    )
    del parts
    return issues

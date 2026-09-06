from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.importer import ImportOptions, IncomingFile, create_batch, layer_summary
from app.importer import process_batch as run_process
from app.importer.pipeline import max_upload_bytes
from app.models import ImportBatch, ImportFile
from app.schemas import ImportBatchDetail, ImportBatchOut, ImportFileOut, ProcessRequest

router = APIRouter(prefix="/imports", tags=["Импорт"])


@router.post("", response_model=ImportBatchDetail, status_code=201)
async def upload(
    files: list[UploadFile] = File(..., description="DXF, ZIP или спецификация"),
    name: str | None = Form(default=None),
    relpaths: list[str] | None = Form(default=None),
    db: Session = Depends(get_db),
) -> ImportBatchDetail:
    """Загрузка пачки: множественный выбор, ZIP-архив или перетащенная папка.

    ``relpaths`` — пути файлов внутри перетащенной папки (браузер отдаёт их
    в ``webkitRelativePath``). Из них резолвер толщины берёт имя папки.
    """
    if not files:
        raise HTTPException(400, "Не выбрано ни одного файла")

    limit = max_upload_bytes()
    total = 0
    incoming: list[IncomingFile] = []
    for index, upload_file in enumerate(files):
        data = await upload_file.read()
        total += len(data)
        if total > limit:
            raise HTTPException(413, f"Суммарный размер загрузки больше {limit // 1024 // 1024} МБ")
        filename = PurePosixPath((upload_file.filename or "file").replace("\\", "/")).name
        relpath = filename
        if relpaths and index < len(relpaths) and relpaths[index]:
            relpath = relpaths[index].replace("\\", "/")
        incoming.append(IncomingFile(filename=filename, relpath=relpath, data=data))

    batch = create_batch(db, name=name, files=incoming)
    db.flush()
    return _detail(db, batch)


@router.get("", response_model=list[ImportBatchOut])
def list_batches(db: Session = Depends(get_db)) -> list[ImportBatch]:
    return list(db.scalars(select(ImportBatch).order_by(ImportBatch.id.desc())).all())


@router.get("/{batch_id}", response_model=ImportBatchDetail)
def get_batch(batch_id: int, db: Session = Depends(get_db)) -> ImportBatchDetail:
    return _detail(db, _require(db, batch_id))


@router.get("/{batch_id}/layers", response_model=dict)
def get_layers(batch_id: int, db: Session = Depends(get_db)) -> dict:
    """Данные для Мастера сопоставления слоёв: все найденные слои со
    статистикой и предзаполненными подсказками семантики."""
    batch = _require(db, batch_id)
    summary = layer_summary(db, batch)
    from app.resolve import semantics_catalog

    summary["semantics"] = semantics_catalog()
    return summary


@router.get("/{batch_id}/layers/{layer_name}/preview", response_model=dict)
def layer_preview(batch_id: int, layer_name: str, db: Session = Depends(get_db)) -> dict:
    """Превью: какая геометрия подсветится, если выбрать этот слой."""
    batch = _require(db, batch_id)
    record = db.scalar(
        select(ImportFile)
        .where(ImportFile.batch_id == batch.id, ImportFile.stored_path.isnot(None))
        .order_by(ImportFile.id)
    )
    if record is None:
        raise HTTPException(404, "В загрузке нет разобранных файлов")

    from app.dxf import read_file
    from app.resolve import preview_paths

    scan = read_file(record.stored_path)
    return {
        "file": record.filename,
        "layer": layer_name,
        "paths": preview_paths(scan.primitives, layer_name),
    }


@router.get("/{batch_id}/sheets", response_model=list[dict])
def detected_sheets(batch_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Габариты листов, найденные в чертежах загрузки.

    Размеры берутся со слоя контуров листа, а не выдумываются. Технолог
    подтверждает их и одним действием заводит формат листа и приход на склад.
    """
    batch = _require(db, batch_id)
    merged: dict[tuple, dict] = {}
    for record in db.scalars(
        select(ImportFile).where(ImportFile.batch_id == batch.id)
    ).all():
        for sheet in record.detected_sheets or []:
            key = (round(sheet.get("w", 0), 1), round(sheet.get("h", 0), 1),
                   sheet.get("thickness"))
            entry = merged.setdefault(
                key,
                {
                    "w": key[0],
                    "h": key[1],
                    "thickness": key[2],
                    "count": 0,
                    "files": [],
                },
            )
            entry["count"] += 1
            if record.filename not in entry["files"]:
                entry["files"].append(record.filename)
    return sorted(merged.values(), key=lambda e: (-(e["w"] * e["h"]), e["w"]))


@router.post("/{batch_id}/process", response_model=ImportBatchDetail)
def process(
    batch_id: int, payload: ProcessRequest, db: Session = Depends(get_db)
) -> ImportBatchDetail:
    """Разбор геометрии и создание деталей — после подтверждения карты слоёв."""
    batch = _require(db, batch_id)
    run_process(
        db,
        batch,
        ImportOptions(
            project_name=payload.project_name,
            product_name=payload.product_name,
            material_id=payload.material_id,
            filename_template=payload.filename_template,
            layer_preset_id=payload.layer_preset_id,
            layer_overrides=payload.layer_overrides,
        ),
    )
    return _detail(db, batch)


@router.delete("/{batch_id}", status_code=204)
def delete_batch(batch_id: int, db: Session = Depends(get_db)) -> None:
    db.delete(_require(db, batch_id))
    db.flush()


def _require(db: Session, batch_id: int) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "Загрузка не найдена")
    return batch


def _detail(db: Session, batch: ImportBatch) -> ImportBatchDetail:
    files = db.scalars(
        select(ImportFile).where(ImportFile.batch_id == batch.id).order_by(ImportFile.id)
    ).all()
    detail = ImportBatchDetail.model_validate(batch)
    detail.files = [ImportFileOut.model_validate(f) for f in files]
    return detail

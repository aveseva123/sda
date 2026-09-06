from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.importer import IncomingFile
from app.importer.pipeline import max_upload_bytes
from app.models import NestingJob
from app.nesting import intake, service
from app.schemas import (
    ChecklistIn,
    CollisionOut,
    ConfirmFilesIn,
    JobPresetIn,
    MoveRequest,
    NestingJobIn,
    NestingJobOut,
    TakeJobIn,
)

router = APIRouter(prefix="/nesting", tags=["Раскрой"])


def _require(db: Session, job_id: int) -> NestingJob:
    job = db.get(NestingJob, job_id)
    if job is None:
        raise HTTPException(404, "Задание на раскрой не найдено")
    return job


@router.get("/jobs", response_model=list[NestingJobOut])
def list_jobs(db: Session = Depends(get_db)) -> list[NestingJob]:
    return list(db.scalars(select(NestingJob).order_by(NestingJob.id.desc())).all())


@router.post("/jobs", response_model=NestingJobOut, status_code=201)
def create_job(payload: NestingJobIn, db: Session = Depends(get_db)) -> NestingJob:
    try:
        return service.create_job(db, **payload.model_dump())
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/jobs/{job_id}/files", response_model=dict)
async def add_files(
    job_id: int,
    files: list[UploadFile] = File(..., description="DXF, ZIP или папка"),
    db: Session = Depends(get_db),
) -> dict:
    """Первый шаг добавления файлов: разбор и карточки для диалога.

    Деталей ещё не создаётся: сначала оператор подтверждает толщину, проект,
    изделие и волокно по каждому файлу.
    """
    job = _require(db, job_id)
    if not files:
        raise HTTPException(400, "Не выбрано ни одного файла")

    limit = max_upload_bytes()
    total = 0
    incoming: list[IncomingFile] = []
    for upload_file in files:
        data = await upload_file.read()
        total += len(data)
        if total > limit:
            raise HTTPException(
                413, f"Суммарный размер загрузки больше {limit // 1024 // 1024} МБ"
            )
        filename = PurePosixPath((upload_file.filename or "file").replace("\\", "/")).name
        incoming.append(IncomingFile(filename=filename, relpath=filename, data=data))

    return intake.analyze(db, job, incoming)


@router.post("/jobs/{job_id}/files/confirm", response_model=dict)
def confirm_files(
    job_id: int, payload: ConfirmFilesIn, db: Session = Depends(get_db)
) -> dict:
    """Второй шаг: решения оператора приняты, детали ложатся на листы."""
    job = _require(db, job_id)
    try:
        result = intake.confirm(
            db, job, payload.batch_id, [d.model_dump() for d in payload.files]
        )
        if result["added"]:
            result["layout"] = service.arrange(db, job)
    except (ValueError, service.NestingError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


@router.post("/jobs/{job_id}/take", response_model=dict)
def take_job(job_id: int, payload: TakeJobIn, db: Session = Depends(get_db)) -> dict:
    """«Взял в работу»: у листа появляется оператор."""
    job = _require(db, job_id)
    try:
        service.take(db, job, payload.operator)
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"stage": job.stage, "operator": job.operator}


@router.put("/jobs/{job_id}/checklist", response_model=dict)
def set_checklist(job_id: int, payload: ChecklistIn, db: Session = Depends(get_db)) -> dict:
    """Отметки чеклиста: маркировка, сортировка, подсчёт."""
    job = _require(db, job_id)
    service.set_checklist(db, job, payload.items)
    return {"checklist": service.checklist_state(job)}


@router.post("/jobs/{job_id}/finish", response_model=dict)
def finish_job(job_id: int, db: Session = Depends(get_db)) -> dict:
    """«Раскрой завершён» — только при полностью отмеченном чеклисте."""
    job = _require(db, job_id)
    try:
        service.finish(db, job)
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"stage": job.stage, "finished_at": job.finished_at}


@router.get("/jobs/{job_id}/layout", response_model=dict)
def layout(job_id: int, db: Session = Depends(get_db)) -> dict:
    """Всё для холста одним запросом: листы, детали с геометрией, экземпляры,
    цвета проектов и назначенные траектории."""
    return service.layout_payload(db, _require(db, job_id))


@router.post("/jobs/{job_id}/arrange", response_model=dict)
def arrange(
    job_id: int,
    keep_pinned: bool = Query(default=True, description="не двигать закреплённые детали"),
    db: Session = Depends(get_db),
) -> dict:
    """Автораскладка. Закреплённые вручную детали остаются на местах."""
    try:
        return service.arrange(db, _require(db, job_id), keep_pinned=keep_pinned)
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.put("/jobs/{job_id}/preset", response_model=dict)
def set_preset(job_id: int, payload: JobPresetIn, db: Session = Depends(get_db)) -> dict:
    """Смена пресета раскроя на задании.

    По умолчанию раскладка сразу пересчитывается: у другого пресета другой
    зазор и другие отступы, и старая раскладка ему уже не соответствует.
    """
    job = _require(db, job_id)
    try:
        service.set_preset(db, job, payload.preset_id)
        result = service.arrange(db, job) if payload.rearrange else {}
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"preset": job.preset_snapshot, "layout": result}


@router.post("/jobs/{job_id}/move", response_model=dict)
def move(job_id: int, payload: MoveRequest, db: Session = Depends(get_db)) -> dict:
    """Ручная правка раскладки: перетаскивание, поворот, перенос между листами."""
    try:
        return service.move_instances(
            db, _require(db, job_id), [m.model_dump() for m in payload.moves]
        )
    except service.NestingError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/jobs/{job_id}/collisions", response_model=list[CollisionOut])
def collisions(job_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Пересечения и выходы за лист. Ручная правка не блокируется —
    проблема просто становится видна."""
    return service.collisions(db, _require(db, job_id))


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db)) -> None:
    db.delete(_require(db, job_id))
    db.flush()

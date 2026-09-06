from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import NestingJob
from app.nesting import service
from app.schemas import CollisionOut, MoveRequest, NestingJobIn, NestingJobOut

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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.colors import next_color_index, product_style, project_color
from app.core.db import get_db
from app.models import Part, PartStatus, Product, Project
from app.schemas import ProductOut, ProjectIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["Проекты"])


def _product_out(product: Product, project_color_hex: str, stats: dict) -> ProductOut:
    data = ProductOut.model_validate(product)
    data.style = product_style(project_color_hex, product.shade_index)
    data.parts_count = stats.get("count", 0)
    data.parts_qty = stats.get("qty", 0)
    return data


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    """Дерево проектов с цветами, количеством деталей и счётчиком уточнений."""
    projects = list(db.scalars(select(Project).order_by(Project.name)).all())
    products = list(db.scalars(select(Product).order_by(Product.name)).all())

    per_product: dict[int, dict] = {}
    for product_id, count, qty in db.execute(
        select(Part.product_id, func.count(Part.id), func.coalesce(func.sum(Part.qty), 0))
        .group_by(Part.product_id)
    ):
        per_product[product_id] = {"count": count, "qty": int(qty)}

    pending: dict[int, int] = {}
    for project_id, count in db.execute(
        select(Product.project_id, func.count(Part.id))
        .join(Part, Part.product_id == Product.id)
        .where(Part.status == PartStatus.NEEDS_CLARIFICATION)
        .group_by(Product.project_id)
    ):
        pending[project_id] = count

    by_project: dict[int, list[Product]] = {}
    for product in products:
        by_project.setdefault(product.project_id, []).append(product)

    out: list[ProjectOut] = []
    for project in projects:
        children = by_project.get(project.id, [])
        item = ProjectOut.model_validate(project)
        item.products = [
            _product_out(p, project.color, per_product.get(p.id, {})) for p in children
        ]
        item.parts_count = sum(c.parts_count for c in item.products)
        item.needs_clarification = pending.get(project.id, 0)
        out.append(item)
    return out


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectIn, db: Session = Depends(get_db)) -> ProjectOut:
    if db.scalar(select(Project).where(Project.name == payload.name)) is not None:
        raise HTTPException(409, f"Проект «{payload.name}» уже существует")
    used = [p.color_index for p in db.scalars(select(Project)).all()]
    index = payload.color_index if payload.color_index is not None else next_color_index(used)
    project = Project(
        name=payload.name,
        client=payload.client,
        deadline=payload.deadline,
        color_index=index,
        color=payload.color or project_color(index),
    )
    db.add(project)
    db.flush()
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int, payload: ProjectIn, db: Session = Depends(get_db)
) -> ProjectOut:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Проект не найден")
    project.name = payload.name
    project.client = payload.client
    project.deadline = payload.deadline
    if payload.color_index is not None:
        project.color_index = payload.color_index
        project.color = payload.color or project_color(payload.color_index)
    elif payload.color:
        project.color = payload.color
    db.flush()
    return ProjectOut.model_validate(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Проект не найден")
    db.delete(project)


@router.get("/palette", response_model=dict)
def palette() -> dict:
    """Палитра проектов и штриховки изделий — для легенды и настроек."""
    from app.core.colors import PRODUCT_PATTERNS, PROJECT_PALETTE

    return {
        "projects": list(PROJECT_PALETTE),
        "patterns": list(PRODUCT_PATTERNS),
        "note": (
            "Палитра различима при дальтонизме; изделия дополнительно "
            "отличаются штриховкой, а не только оттенком."
        ),
    }

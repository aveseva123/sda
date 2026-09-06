"""Демо-данные, чтобы посмотреть интерфейс без установки Postgres.

Поднимает базу в одном файле SQLite, заводит четыре материала, импортирует
эталонные DXF из tests/fixtures/real и считает по ним раскрой. Это способ
открыть вёрстку с настоящими деталями, а не с пустым экраном; для работы в
цеху база всё равно Postgres (docker compose up).

    cd backend
    DATABASE_URL="sqlite+pysqlite:///./demo.db" .venv/bin/python scripts/demo_seed.py
"""

from __future__ import annotations

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
os.environ.setdefault("CONFIG_DIR", str(ROOT / "config"))
os.environ.setdefault("STORAGE_DIR", str(ROOT / "backend" / ".demo-storage"))
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///./demo.db")
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.importer import (  # noqa: E402
    ImportOptions,
    IncomingFile,
    create_batch,
    process_batch,
)
from app.models import Material, Part, PartStatus  # noqa: E402
from app.nesting import service as nesting  # noqa: E402
from app.stock import service as stock  # noqa: E402

# Материалы цеха: формат листа — тот, что стоит в реальных выгрузках Базиса.
MATERIALS = [
    ("ЛДСП Белый", 16.0, False),
    ("ЛДСП Дуб", 18.0, True),
    ("ЛДСП Серый", 12.0, False),
    ("ХДФ", 4.0, False),
]


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()

    if not db.scalars(select(Material)).first():
        db.add_all(
            [
                Material(
                    name=name,
                    thickness=thickness,
                    has_grain=has_grain,
                    sheet_w=2070.0,
                    sheet_h=2800.0,
                )
                for name, thickness, has_grain in MATERIALS
            ]
        )
        db.commit()

    fixtures = ROOT / "backend" / "tests" / "fixtures" / "real"
    files = [
        IncomingFile(path.name, path.name, path.read_bytes())
        for path in sorted(fixtures.glob("*.dxf"))
    ]
    batch = create_batch(db, name="Демонстрация", files=files)
    process_batch(db, batch, ImportOptions())
    db.commit()

    # Материал детали подбирается по толщине: это ровно то, что технолог
    # подтверждает руками в очереди уточнений.
    materials = {m.thickness: m for m in db.scalars(select(Material)).all()}
    ready = 0
    for part in db.scalars(select(Part)).all():
        material = materials.get(part.thickness)
        if material is None:
            continue
        part.material_id = material.id
        part.status = PartStatus.READY
        ready += 1
    db.commit()

    for material in materials.values():
        stock.receive(db, material_id=material.id, w=material.sheet_w, h=material.sheet_h, qty=12)
    db.commit()

    job = nesting.create_job(db, material_id=materials[16.0].id, thickness=16.0)
    db.commit()

    print(
        f"Готово: деталей {ready}, задание «{job.name}» — "
        f"листов {len(job.sheets)}, КИМ {(job.utilization or 0) * 100:.1f} %"
    )
    print("Дальше: uvicorn app.main:app --port 8000  и  npm run dev в frontend/")


if __name__ == "__main__":
    main()

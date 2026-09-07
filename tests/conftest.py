"""Общие фикстуры. Qt поднимается только в offscreen-режиме — тесты идут без дисплея."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from cam.core import models as m
from cam.core.config import AppDefaults, load_defaults
from cam.core.geometry.primitives import Circle, Contour, LineSegment, Point
from cam.core.storage.db import Database, open_database
from cam.core.storage.repository import Repository


@pytest.fixture(scope="session")
def defaults() -> AppDefaults:
    return load_defaults()


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def database(data_dir: Path, defaults: AppDefaults) -> Iterator[Database]:
    db = open_database(data_dir, backups_keep=defaults.storage.backups_keep, make_backup=False)
    yield db
    db.dispose()


@pytest.fixture
def session(database: Database) -> Iterator[Session]:
    with database.session() as s:
        yield s


@pytest.fixture
def repo(session: Session) -> Repository:
    return Repository(session)


# ------------------------------------------------------------------ геометрия и модели


def rect_contour(w: float, h: float, x0: float = 0.0, y0: float = 0.0) -> Contour:
    """Прямоугольник против часовой стрелки из четырёх отрезков."""
    p = [Point(x=x0, y=y0), Point(x=x0 + w, y=y0), Point(x=x0 + w, y=y0 + h), Point(x=x0, y=y0 + h)]
    return Contour(
        segments=[LineSegment(start=p[i], end=p[(i + 1) % 4]) for i in range(4)],
    )


def make_material(**overrides: object) -> m.Material:
    data: dict[str, object] = {
        "name": "ЛДСП 16 белый",
        "type": m.MaterialType.LDSP,
        "nominal_thickness": 16.0,
        "actual_thickness": 15.8,
        "default_sheet_w": 2070.0,
        "default_sheet_l": 2800.0,
    }
    data.update(overrides)
    return m.Material.model_validate(data)


def make_tool(**overrides: object) -> m.Tool:
    data: dict[str, object] = {
        "number": 1,
        "name": "Компрессионная D6",
        "type": m.ToolType.COMPRESSION,
        "diameter": 6.0,
        "flutes": 2,
        "cutting_length": 22.0,
        "shank_diameter": 6.0,
        "max_plunge_depth": 17.0,
    }
    data.update(overrides)
    return m.Tool.model_validate(data)


def make_mode(tool_id: int, **overrides: object) -> m.CuttingMode:
    data: dict[str, object] = {
        "tool_id": tool_id,
        "material_type": m.MaterialType.LDSP,
        "thickness_from": 15.0,
        "thickness_to": 19.0,
        "operation_type": m.OperationType.CONTOUR_OUTER,
        "rpm": 18000,
        "feed_xy": 4000.0,
        "feed_z_plunge": 1500.0,
        "depth_per_pass": 17.0,
        "direction": m.CutDirection.CLIMB,
        "entry": m.EntryType.RAMP,
        "ramp_angle": 10.0,
        "lead_in_type": m.LeadInType.ARC,
        "lead_radius": 1.5,
        "stepover_pct": 45.0,
    }
    data.update(overrides)
    return m.CuttingMode.model_validate(data)


def make_operation(**overrides: object) -> m.Operation:
    data: dict[str, object] = {
        "type": m.OperationType.DRILL_BLIND,
        "geometry": Circle(center=Point(x=50.0, y=37.0), radius=4.0),
        "depth": 12.0,
        "depth_ref": m.DepthRef.FROM_FACE,
    }
    data.update(overrides)
    return m.Operation.model_validate(data)


def make_part(**overrides: object) -> m.Part:
    data: dict[str, object] = {
        "name": "Бок левый",
        "thickness": 16.0,
        "outer_contour": rect_contour(720.0, 500.0),
        "operations": [make_operation()],
    }
    data.update(overrides)
    return m.Part.model_validate(data)

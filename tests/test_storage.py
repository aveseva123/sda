"""SQLite: создание, WAL, миграции, бэкапы, репозиторий."""

from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from cam.core import models as m
from cam.core.config import AppDefaults
from cam.core.paths import backup_dir, db_path
from cam.core.storage import migrate
from cam.core.storage.db import (
    Database,
    backup_database,
    journal_mode,
    list_backups,
    make_engine,
    open_database,
)
from cam.core.storage.repository import NotFoundError, Repository
from tests.conftest import (
    make_material,
    make_mode,
    make_operation,
    make_part,
    make_tool,
    rect_contour,
)

# ------------------------------------------------------------------ открытие базы


def test_open_creates_file_migrates_and_enables_wal(database: Database, data_dir: Path) -> None:
    assert database.path == db_path(data_dir)
    assert database.path.is_file()
    assert journal_mode(database.engine) == "wal"
    assert migrate.current_revision(database.engine) == migrate.head_revision()


def test_migrations_match_orm_metadata(database: Database) -> None:
    """Главная защита от расхождения orm.py и versions/: автогенерация не находит изменений."""
    assert migrate.pending_schema_changes(database.engine) == []


def test_migration_downgrade_to_base_and_back(database: Database) -> None:
    migrate.downgrade(database.engine, "base")
    assert migrate.current_revision(database.engine) is None
    with database.engine.connect() as conn:
        tables = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).scalars()
        assert set(tables) <= {"alembic_version"}
    migrate.upgrade(database.engine)
    assert migrate.pending_schema_changes(database.engine) == []


def test_foreign_keys_are_enforced(database: Database) -> None:
    with database.session() as s, pytest.raises(IntegrityError):
        s.execute(
            text(
                "INSERT INTO parts (name, thickness, qty, outer_contour, inner_contours, grain,"
                " edge_banding, dims_are, edge_allowance, is_two_sided, source_file, comment,"
                " material_id) VALUES ('x', 16, 1, '{}', '[]', 'any', '{}', 'cutting', '{}', 0,"
                " '', '', 999)"
            )
        )
        s.flush()


def test_reopen_existing_database_is_idempotent(data_dir: Path, defaults: AppDefaults) -> None:
    keep = defaults.storage.backups_keep
    first = open_database(data_dir, backups_keep=keep, make_backup=False)
    with first.session() as s:
        Repository(s).add(make_material())
        s.commit()
    first.dispose()
    second = open_database(data_dir, backups_keep=keep, make_backup=False)
    try:
        with second.session() as s:
            assert Repository(s).count(m.Material) == 1
    finally:
        second.dispose()


# ------------------------------------------------------------------ резервные копии


def test_backup_is_skipped_when_db_missing(data_dir: Path) -> None:
    assert backup_database(db_path(data_dir), keep=10) is None


def test_backup_rotation_keeps_last_n(database: Database, data_dir: Path) -> None:
    with database.session() as s:
        Repository(s).add(make_material())
        s.commit()
    path = database.path
    keep = 3
    made = [backup_database(path, keep=keep, now=datetime(2026, 1, 1, 12, 0, i)) for i in range(5)]
    remaining = list_backups(backup_dir(data_dir), path)
    assert [p.name for p in remaining] == [p.name for p in made[-keep:] if p is not None]
    # Копия — рабочая база: в ней есть наши данные.
    engine = make_engine(remaining[-1])
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM materials")).scalar_one() == 1
    finally:
        engine.dispose()


def test_open_database_makes_backup_of_existing_file(data_dir: Path) -> None:
    keep = 10
    db = open_database(data_dir, backups_keep=keep, make_backup=True)
    db.dispose()
    assert list_backups(backup_dir(data_dir), db_path(data_dir)) == []  # первой базы ещё не было
    db = open_database(data_dir, backups_keep=keep, make_backup=True)
    db.dispose()
    assert len(list_backups(backup_dir(data_dir), db_path(data_dir))) == 1


# ------------------------------------------------------------------ репозиторий: плоские сущности


def test_material_round_trip(repo: Repository) -> None:
    saved = repo.add(make_material(batch_code="П-17"))
    assert saved.id is not None
    loaded = repo.require(m.Material, saved.id)
    assert loaded == saved
    assert loaded.type is m.MaterialType.LDSP
    assert loaded.batch_code == "П-17"


def test_tool_mode_and_tech_profile_round_trip(repo: Repository) -> None:
    tool = repo.add(make_tool())
    assert tool.id is not None
    mode = repo.add(make_mode(tool.id, finish_pass=True, finish_allowance=0.2))
    assert mode.id is not None
    profile = repo.add(
        m.TechProfile(
            name="ЛДСП 16 раскрой",
            material_type=m.MaterialType.LDSP,
            thickness_from=15.0,
            thickness_to=19.0,
            operation_type=m.OperationType.CONTOUR_OUTER,
            diameter_from=0.0,
            diameter_to=1000.0,
            width_from=0.0,
            width_to=1000.0,
            tool_id=tool.id,
            mode_id=mode.id,
            strategy_params={"tabs": {"count": 4, "len": 8.0}},
        )
    )
    assert profile.id is not None
    loaded = repo.require(m.TechProfile, profile.id)
    assert loaded.strategy_params == {"tabs": {"count": 4, "len": 8.0}}
    assert loaded.verified is False
    assert repo.require(m.CuttingMode, mode.id).direction is m.CutDirection.CLIMB


def test_sheet_stock_with_polygon_and_datetime(repo: Repository) -> None:
    material = repo.add(make_material())
    assert material.id is not None
    sheet = repo.add(
        m.SheetStock(
            material_id=material.id,
            nominal_w=2070.0,
            nominal_l=2800.0,
            actual_w=2060.0,
            actual_l=2790.0,
            trim_allowance=m.Margins(left=10.0, bottom=10.0),
            qty=1,
            is_remnant=True,
            remnant_code="ОБР-0341",
            polygon=rect_contour(600.0, 400.0),
        )
    )
    assert sheet.id is not None
    loaded = repo.require(m.SheetStock, sheet.id)
    assert loaded.polygon == rect_contour(600.0, 400.0)
    assert loaded.trim_allowance.left == 10.0
    assert isinstance(loaded.created_at, datetime)
    assert loaded.created_at == sheet.created_at


def test_unique_remnant_code_is_enforced_by_db(repo: Repository) -> None:
    material = repo.add(make_material())
    assert material.id is not None

    def remnant(code: str) -> m.SheetStock:
        return m.SheetStock(
            material_id=material.id or 0,
            nominal_w=1.0,
            nominal_l=1.0,
            actual_w=500.0,
            actual_l=400.0,
            qty=1,
            is_remnant=True,
            remnant_code=code,
        )

    repo.add(remnant("ОБР-1"))
    with pytest.raises(IntegrityError):
        repo.add(remnant("ОБР-1"))


# ------------------------------------------------------------------ репозиторий: агрегаты


def test_project_with_parts_and_operations_round_trip(repo: Repository) -> None:
    project = m.Project(
        name="Кухня Иванов",
        customer="Иванов",
        parts=[
            make_part(name="Бок левый"),
            make_part(
                name="Полка",
                operations=[
                    make_operation(),
                    make_operation(
                        type=m.OperationType.CONTOUR_OUTER,
                        geometry=rect_contour(700.0, 300.0),
                        depth=None,
                        depth_ref=m.DepthRef.THROUGH,
                        params=m.OperationParams(tabs_count=4, tabs_len=8.0, tabs_height=1.5),
                        low_confidence=True,
                    ),
                ],
            ),
        ],
    )
    saved = repo.add(project)
    assert saved.id is not None
    assert [p.name for p in saved.parts] == ["Бок левый", "Полка"]
    assert all(p.id is not None and p.project_id == saved.id for p in saved.parts)
    assert all(op.id is not None for p in saved.parts for op in p.operations)

    loaded = repo.require(m.Project, saved.id)
    assert loaded == saved
    polka = loaded.parts[1]
    assert polka.outer_contour == rect_contour(720.0, 500.0)
    outer = polka.operations[1]
    assert outer.type is m.OperationType.CONTOUR_OUTER
    assert outer.geometry == rect_contour(700.0, 300.0)
    assert outer.params.tabs_count == 4 and outer.low_confidence is True
    assert repo.count(m.Part) == 2 and repo.count(m.Operation) == 3


def test_update_replaces_aggregate_children(repo: Repository) -> None:
    saved = repo.add(m.Project(name="П1", parts=[make_part(name="A"), make_part(name="B")]))
    assert saved.id is not None
    # Убираем B, меняем A, добавляем C без id.
    edited = saved.model_copy(
        update={
            "parts": [
                saved.parts[0].model_copy(update={"name": "A2"}),
                make_part(name="C"),
            ]
        }
    )
    updated = repo.update(edited)
    assert [p.name for p in updated.parts] == ["A2", "C"]
    assert updated.parts[0].id == saved.parts[0].id
    assert repo.count(m.Part) == 2
    assert repo.count(m.Operation) == 2  # операции B удалены каскадом


def test_delete_project_cascades(repo: Repository) -> None:
    saved = repo.add(m.Project(name="П1", parts=[make_part()]))
    assert saved.id is not None
    repo.delete(m.Project, saved.id)
    assert repo.get(m.Project, saved.id) is None
    assert repo.count(m.Part) == 0 and repo.count(m.Operation) == 0


def test_batch_with_instances_and_nest_results(repo: Repository) -> None:
    material = repo.add(make_material())
    assert material.id is not None
    project = repo.add(m.Project(name="П1", parts=[make_part()]))
    part_id = project.parts[0].id
    assert part_id is not None and project.id is not None
    sheet = repo.add(
        m.SheetStock(
            material_id=material.id,
            nominal_w=2070.0,
            nominal_l=2800.0,
            actual_w=2060.0,
            actual_l=2790.0,
            qty=1,
        )
    )
    assert sheet.id is not None
    batch = repo.add(
        m.Batch(
            name="Смена 1",
            material_id=material.id,
            thickness=16.0,
            part_instances=[m.PartInstance(part_id=part_id, index_in_batch=i) for i in range(3)],
        )
    )
    assert batch.id is not None
    inst_ids = [pi.id for pi in batch.part_instances]
    assert all(i is not None for i in inst_ids)
    nest = m.NestResult(
        batch_id=batch.id,
        sheet_stock_id=sheet.id,
        sheet_index=0,
        placements=[
            m.Placement(
                part_instance_id=inst_ids[i] or 0,
                part_id=part_id,
                project_id=project.id,
                x=10.0 + i * 730.0,
                y=10.0,
                rotation=90 if i == 2 else 0,
                label_no=i + 1,
            )
            for i in range(3)
        ],
        utilization_pct=18.7,
        waste_area=4_600_000.0,
        remnants=[m.RemnantCandidate(x=0.0, y=520.0, width=2060.0, length=2270.0)],
        seed=7,
    )
    updated = repo.update(batch.model_copy(update={"nest_results": [nest]}))
    loaded = repo.require(m.Batch, batch.id)
    assert loaded == updated
    assert len(loaded.nest_results) == 1
    assert loaded.nest_results[0].placements[2].rotation == 90
    assert loaded.nest_results[0].remnants[0].width == 2060.0
    assert loaded.status is m.BatchStatus.DRAFT


def test_import_profile_with_rules_round_trip(repo: Repository) -> None:
    profile = m.ImportProfile(
        name="Базис",
        layer_signature=["CONTUR", "SVERLO_*"],
        units=m.Units.MM,
        rules=[
            m.LayerRule(
                priority=10,
                layer_regex="^SVERLO_8$",
                operation_type=m.OperationType.DRILL_BLIND,
                depth=12.0,
                depth_ref=m.DepthRef.FROM_FACE,
                extra_params={"note": "шкант"},
            ),
            m.LayerRule(
                priority=1,
                layer_regex="^CONTUR$",
                geom_closed=m.GeomClosed.CLOSED,
                operation_type=m.OperationType.CONTOUR_OUTER,
                depth_ref=m.DepthRef.THROUGH,
            ),
        ],
    )
    saved = repo.add(profile)
    assert saved.id is not None
    loaded = repo.require(m.ImportProfile, saved.id)
    # relationship упорядочивает правила по приоритету
    assert [r.priority for r in loaded.rules] == [1, 10]
    assert loaded.rules[1].extra_params == {"note": "шкант"}
    assert all(r.profile_id == saved.id for r in loaded.rules)


# ------------------------------------------------------------------ репозиторий: ошибки


def test_repository_errors(repo: Repository) -> None:
    with pytest.raises(NotFoundError):
        repo.require(m.Material, 12345)
    with pytest.raises(NotFoundError):
        repo.delete(m.Material, 12345)
    with pytest.raises(NotFoundError):
        repo.update(make_material(id=12345))
    with pytest.raises(ValueError, match="используйте update"):
        repo.add(make_material(id=1))
    with pytest.raises(ValueError, match="используйте add"):
        repo.update(make_material())
    with pytest.raises(TypeError):
        repo.list(m.Margins)  # type: ignore[type-var]


def test_list_returns_in_id_order(repo: Repository) -> None:
    names = ["c", "a", "b"]
    for name in names:
        repo.add(make_material(name=name))
    assert [x.name for x in repo.list(m.Material)] == names

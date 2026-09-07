"""Инварианты доменных моделей (раздел 6 ТЗ)."""

from datetime import datetime

import pytest
from pydantic import ValidationError

from cam.core import models as m
from cam.core.geometry.primitives import Circle, Contour, Point
from tests.conftest import (
    make_material,
    make_mode,
    make_operation,
    make_part,
    make_tool,
    rect_contour,
)

# ------------------------------------------------------------------ перечисления


def test_every_enum_member_has_russian_label() -> None:
    enums = [
        cls
        for cls in vars(m).values()
        if isinstance(cls, type) and issubclass(cls, m.LabeledEnum) and cls is not m.LabeledEnum
    ]
    assert len(enums) >= 15
    for enum_cls in enums:
        for member in enum_cls:
            assert member.label, f"{enum_cls.__name__}.{member.name} без подписи"
            assert member.value.isascii(), f"{enum_cls.__name__}.{member.name}: код не ASCII"


def test_operation_codes_match_spec() -> None:
    assert {op.value for op in m.OperationType} == {
        "contour_outer",
        "contour_inner",
        "pocket",
        "groove",
        "drill_through",
        "drill_blind",
        "engrave",
        "chamfer",
        "edge_profile",
    }
    assert m.OperationType.POCKET.label == "выборка"
    assert m.OperationType.CONTOUR_OUTER.label.startswith("раскрой")


# ------------------------------------------------------------------ общие правила


def test_extra_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        make_material(colour="white")


def test_utcnow_is_naive() -> None:
    now = m.utcnow()
    assert isinstance(now, datetime) and now.tzinfo is None


# ------------------------------------------------------------------ материалы и склад


def test_material_requires_positive_dimensions() -> None:
    with pytest.raises(ValidationError):
        make_material(nominal_thickness=0.0)
    with pytest.raises(ValidationError):
        make_material(default_sheet_w=-1.0)


def sheet(**overrides: object) -> m.SheetStock:
    data: dict[str, object] = {
        "material_id": 1,
        "nominal_w": 2070.0,
        "nominal_l": 2800.0,
        "actual_w": 2060.0,
        "actual_l": 2790.0,
        "qty": 3,
    }
    data.update(overrides)
    return m.SheetStock.model_validate(data)


def test_sheet_usable_size_subtracts_trim_allowance() -> None:
    s = sheet(trim_allowance=m.Margins(left=10.0, bottom=10.0))
    assert s.usable_w == pytest.approx(2050.0)
    assert s.usable_l == pytest.approx(2780.0)


def test_remnant_requires_code_and_vice_versa() -> None:
    with pytest.raises(ValidationError, match="remnant_code"):
        sheet(is_remnant=True)
    with pytest.raises(ValidationError, match="не помечен как обрезок"):
        sheet(remnant_code="ОБР-0341")
    ok = sheet(is_remnant=True, remnant_code="ОБР-0341", parent_sheet_id=7, qty=1)
    assert ok.remnant_code == "ОБР-0341"


def test_trim_allowance_cannot_eat_whole_sheet() -> None:
    with pytest.raises(ValidationError, match="ширин"):
        sheet(trim_allowance=m.Margins(left=1500.0, right=600.0))


# ------------------------------------------------------------------ инструмент и режимы


def test_tool_in_atc_needs_position() -> None:
    with pytest.raises(ValidationError, match="atc_position"):
        make_tool(in_atc=True)
    assert make_tool(in_atc=True, atc_position=3).atc_position == 3


def test_tool_plunge_depth_not_beyond_cutting_length() -> None:
    with pytest.raises(ValidationError, match="рабочей длины"):
        make_tool(cutting_length=10.0, max_plunge_depth=12.0)


def test_tool_life_exceeded() -> None:
    assert not make_tool().life_exceeded
    assert not make_tool(life_minutes=100.0, used_minutes=99.0).life_exceeded
    assert make_tool(life_minutes=100.0, used_minutes=101.0).life_exceeded


def test_mode_thickness_range_ordered() -> None:
    with pytest.raises(ValidationError, match="thickness_from"):
        make_mode(1, thickness_from=19.0, thickness_to=15.0)


def test_mode_ramp_requires_angle_or_length() -> None:
    with pytest.raises(ValidationError, match="ramp"):
        make_mode(1, entry=m.EntryType.RAMP, ramp_angle=None, ramp_length=None)
    assert make_mode(1, entry=m.EntryType.RAMP, ramp_angle=None, ramp_length=20.0).ramp_length


def test_mode_arc_lead_requires_radius() -> None:
    with pytest.raises(ValidationError, match="lead_radius"):
        make_mode(1, lead_in_type=m.LeadInType.ARC, lead_radius=None)
    assert make_mode(1, lead_in_type=m.LeadInType.NONE, lead_radius=None).lead_radius is None


def test_mode_finish_pass_requires_allowance() -> None:
    with pytest.raises(ValidationError, match="finish_allowance"):
        make_mode(1, finish_pass=True, finish_allowance=0.0)


def test_mode_stepover_within_percent() -> None:
    with pytest.raises(ValidationError):
        make_mode(1, stepover_pct=0.0)
    with pytest.raises(ValidationError):
        make_mode(1, stepover_pct=120.0)


def tech_profile(**overrides: object) -> m.TechProfile:
    data: dict[str, object] = {
        "name": "ЛДСП 16 присадка Ø8",
        "material_type": m.MaterialType.LDSP,
        "thickness_from": 15.0,
        "thickness_to": 19.0,
        "operation_type": m.OperationType.DRILL_BLIND,
        "diameter_from": 7.8,
        "diameter_to": 8.2,
        "width_from": 0.0,
        "width_to": 1000.0,
        "tool_id": 1,
        "mode_id": 1,
    }
    data.update(overrides)
    return m.TechProfile.model_validate(data)


def test_tech_profile_key_requires_diameter_and_width_ranges() -> None:
    with pytest.raises(ValidationError):
        m.TechProfile.model_validate(
            {k: v for k, v in tech_profile().model_dump().items() if not k.startswith("diameter")}
        )
    with pytest.raises(ValidationError, match="diameter_from"):
        tech_profile(diameter_from=9.0, diameter_to=8.0)
    with pytest.raises(ValidationError, match="width_from"):
        tech_profile(width_from=9.0, width_to=8.0)


def test_tech_profile_is_unverified_by_default() -> None:
    assert tech_profile().verified is False


# ------------------------------------------------------------------ правила импорта


def rule(**overrides: object) -> m.LayerRule:
    data: dict[str, object] = {
        "layer_regex": r"^DRILL_8$",
        "geom_closed": m.GeomClosed.CLOSED,
        "diameter_from": 7.8,
        "diameter_to": 8.2,
        "operation_type": m.OperationType.DRILL_BLIND,
        "depth": 12.0,
        "depth_ref": m.DepthRef.FROM_FACE,
    }
    data.update(overrides)
    return m.LayerRule.model_validate(data)


def test_rule_regex_must_compile() -> None:
    with pytest.raises(ValidationError, match="layer_regex"):
        rule(layer_regex="([unclosed")


def test_rule_without_conditions_is_rejected() -> None:
    with pytest.raises(ValidationError, match="без единого условия"):
        m.LayerRule(
            operation_type=m.OperationType.POCKET, depth=5.0, depth_ref=m.DepthRef.FROM_FACE
        )


def test_rule_color_constraints() -> None:
    with pytest.raises(ValidationError):
        rule(aci_color=0)
    with pytest.raises(ValidationError):
        rule(rgb_color="ff0000")
    assert rule(aci_color=1, rgb_color="#FF0000").rgb_color == "#FF0000"


def test_rule_depth_consistency() -> None:
    # Сквозные операции: depth_ref=through и без глубины.
    with pytest.raises(ValidationError, match="всегда сквозная"):
        rule(operation_type=m.OperationType.CONTOUR_OUTER, depth=None)
    with pytest.raises(ValidationError, match="сквозная"):
        rule(
            operation_type=m.OperationType.CONTOUR_OUTER,
            depth=16.0,
            depth_ref=m.DepthRef.THROUGH,
        )
    ok = rule(
        operation_type=m.OperationType.CONTOUR_OUTER, depth=None, depth_ref=m.DepthRef.THROUGH
    )
    assert ok.depth is None
    # Несквозные: нужна глубина и привязка от лица/изнанки.
    with pytest.raises(ValidationError, match="требует глубину"):
        rule(depth=None)
    with pytest.raises(ValidationError, match="не сквозная"):
        rule(depth_ref=m.DepthRef.THROUGH, depth=None)


def test_import_profile_holds_rules() -> None:
    profile = m.ImportProfile(name="Базис-Мебельщик", rules=[rule(), rule(priority=5)])
    assert len(profile.rules) == 2
    assert profile.dims_are is m.DimsAre.CUTTING
    assert profile.units is None


# ------------------------------------------------------------------ детали и операции


def test_operation_drill_needs_diameter_from_circle_or_params() -> None:
    op = make_operation()
    assert op.drill_diameter == pytest.approx(8.0)
    with pytest.raises(ValidationError, match="Присадка"):
        make_operation(geometry=rect_contour(10.0, 10.0))
    op2 = make_operation(geometry=rect_contour(10.0, 10.0), params=m.OperationParams(diameter=5.0))
    assert op2.drill_diameter == 5.0


def test_operation_through_types_have_no_depth() -> None:
    with pytest.raises(ValidationError, match="сквозная"):
        make_operation(type=m.OperationType.DRILL_THROUGH, depth=16.0, depth_ref=m.DepthRef.THROUGH)
    ok = make_operation(
        type=m.OperationType.DRILL_THROUGH, depth=None, depth_ref=m.DepthRef.THROUGH
    )
    assert ok.depth is None


def test_operation_groove_requires_width_from_fitting() -> None:
    line = rect_contour(300.0, 0.0).segments[0]
    with pytest.raises(ValidationError, match="ширину"):
        make_operation(
            type=m.OperationType.GROOVE,
            geometry=Contour(segments=[line]),
            depth=8.0,
        )
    ok = make_operation(
        type=m.OperationType.GROOVE,
        geometry=Contour(segments=[line]),
        depth=8.0,
        params=m.OperationParams(width=4.0),
    )
    assert ok.params.width == 4.0


def test_operation_edge_profile_requires_offset() -> None:
    with pytest.raises(ValidationError, match="profile_offset"):
        make_operation(type=m.OperationType.EDGE_PROFILE, geometry=rect_contour(500.0, 20.0))


def test_part_two_sided_flag_must_match_operations() -> None:
    side_b = make_operation(side=m.Side.B)
    with pytest.raises(ValidationError, match="двусторонней"):
        make_part(operations=[side_b])
    part = make_part(operations=[side_b], is_two_sided=True)
    assert part.is_two_sided


def test_part_defaults() -> None:
    part = make_part()
    assert part.qty == 1
    assert part.grain is m.Grain.ANY
    assert part.dims_are is m.DimsAre.CUTTING
    assert part.edge_banding.sides == []
    banded = make_part(
        edge_banding=m.EdgeBanding(top=m.EdgeBand(thickness=2.0), left=m.EdgeBand(thickness=0.4))
    )
    assert banded.edge_banding.sides == [m.EdgeSide.TOP, m.EdgeSide.LEFT]
    assert banded.edge_banding.get(m.EdgeSide.TOP) is not None


def test_project_aggregates_parts() -> None:
    project = m.Project(name="Кухня Иванов", customer="Иванов", parts=[make_part(), make_part()])
    assert len(project.parts) == 2
    assert project.status is m.ProjectStatus.NEW


# ------------------------------------------------------------------ задания и раскрой


def test_part_instance_defect_needs_reason() -> None:
    with pytest.raises(ValidationError, match="причины"):
        m.PartInstance(part_id=1, status=m.PartInstanceStatus.DEFECT)
    ok = m.PartInstance(part_id=1, status=m.PartInstanceStatus.DEFECT, defect_reason="скол кромки")
    assert ok.defect_reason


def placement(label_no: int, **overrides: object) -> m.Placement:
    data: dict[str, object] = {
        "part_instance_id": label_no,
        "part_id": 1,
        "project_id": 1,
        "x": 10.0,
        "y": 10.0,
        "label_no": label_no,
    }
    data.update(overrides)
    return m.Placement.model_validate(data)


def test_placement_rotation_is_quarter_turns_only() -> None:
    with pytest.raises(ValidationError):
        placement(1, rotation=45)
    assert placement(1, rotation=270).rotation == 270


def test_nest_result_labels_unique_and_utilization_bounded() -> None:
    base: dict[str, object] = {
        "batch_id": 1,
        "sheet_stock_id": 1,
        "sheet_index": 0,
        "utilization_pct": 83.5,
        "waste_area": 1000.0,
        "seed": 42,
    }
    with pytest.raises(ValidationError, match="уникальны"):
        m.NestResult.model_validate({**base, "placements": [placement(1), placement(1)]})
    with pytest.raises(ValidationError):
        m.NestResult.model_validate({**base, "utilization_pct": 101.0})
    ok = m.NestResult.model_validate({**base, "placements": [placement(1), placement(2)]})
    assert ok.progress is m.NestProgress.NONE


def test_nc_program_cannot_be_exported_without_checks() -> None:
    base: dict[str, object] = {
        "batch_id": 1,
        "sheet_index": 0,
        "filename": "Kuhnya_LDSP_16_L1_A_T1.nc",
        "gcode_path": "/machine/Kuhnya_LDSP_16_L1_A_T1.nc",
        "estimated_seconds": 600.0,
        "cut_length": 12000.0,
        "checks_passed": False,
    }
    assert m.NcProgram.model_validate(base).exported_at is None
    with pytest.raises(ValidationError, match="без пройденных проверок"):
        m.NcProgram.model_validate({**base, "exported_at": m.utcnow()})


# ------------------------------------------------------------------ складские проводки


def test_stock_txn_targets_exactly_one_object() -> None:
    with pytest.raises(ValidationError, match="ровно к одному"):
        m.StockTxn(type=m.StockTxnType.ISSUE, qty=1.0)
    with pytest.raises(ValidationError, match="ровно к одному"):
        m.StockTxn(type=m.StockTxnType.ISSUE, qty=1.0, sheet_stock_id=1, edge_band_id=1)
    ok = m.StockTxn(type=m.StockTxnType.ISSUE, qty=-3.0, sheet_stock_id=1)
    assert ok.qty == -3.0


def test_stock_txn_zero_qty_and_compensation_link() -> None:
    with pytest.raises(ValidationError, match="нулевым"):
        m.StockTxn(type=m.StockTxnType.ISSUE, qty=0.0, sheet_stock_id=1)
    with pytest.raises(ValidationError, match="ссылаться"):
        m.StockTxn(type=m.StockTxnType.COMPENSATION, qty=3.0, sheet_stock_id=1)
    ok = m.StockTxn(type=m.StockTxnType.COMPENSATION, qty=3.0, sheet_stock_id=1, reverses_txn_id=10)
    assert ok.reverses_txn_id == 10


def test_circle_center_point_is_frozen_inside_operation() -> None:
    op = make_operation()
    assert isinstance(op.geometry, Circle)
    assert op.geometry.center == Point(x=50.0, y=37.0)

import math

import pytest
from pydantic import TypeAdapter, ValidationError

from cam.core.geometry.primitives import (
    ArcSegment,
    BBox,
    Circle,
    Contour,
    Geometry,
    LineSegment,
    Point,
)
from tests.conftest import rect_contour

TOL = 0.01
ORIGIN = Point(x=0.0, y=0.0)


# ------------------------------------------------------------------ Point / BBox


def test_point_distance_and_closeness() -> None:
    a, b = Point(x=0.0, y=0.0), Point(x=3.0, y=4.0)
    assert a.distance_to(b) == pytest.approx(5.0)
    assert a.is_close(Point(x=0.0, y=0.009), TOL)
    assert not a.is_close(Point(x=0.0, y=0.011), TOL)


def test_point_is_frozen_and_strict() -> None:
    with pytest.raises(ValidationError):
        Point(x=1.0, y=2.0, z=3.0)  # type: ignore[call-arg]
    p = Point(x=1.0, y=2.0)
    with pytest.raises(ValidationError):
        p.x = 5.0  # type: ignore[misc]


def test_angle_from_center_is_in_0_2pi() -> None:
    assert Point(x=1.0, y=0.0).angle_from(ORIGIN) == pytest.approx(0.0)
    assert Point(x=0.0, y=1.0).angle_from(ORIGIN) == pytest.approx(math.pi / 2)
    assert Point(x=0.0, y=-1.0).angle_from(ORIGIN) == pytest.approx(1.5 * math.pi)


def test_bbox_union_and_validation() -> None:
    a = BBox(min_x=0.0, min_y=0.0, max_x=1.0, max_y=1.0)
    b = BBox(min_x=-1.0, min_y=0.5, max_x=0.5, max_y=2.0)
    u = a.union(b)
    assert (u.min_x, u.min_y, u.max_x, u.max_y) == (-1.0, 0.0, 1.0, 2.0)
    assert u.width == 2.0 and u.height == 2.0
    with pytest.raises(ValidationError):
        BBox(min_x=1.0, min_y=0.0, max_x=0.0, max_y=1.0)
    with pytest.raises(ValueError, match="пустой"):
        BBox.of_points([])


# ------------------------------------------------------------------ LineSegment


def test_line_length_bbox_reverse() -> None:
    seg = LineSegment(start=Point(x=1.0, y=1.0), end=Point(x=4.0, y=5.0))
    assert seg.length == pytest.approx(5.0)
    assert seg.bbox == BBox(min_x=1.0, min_y=1.0, max_x=4.0, max_y=5.0)
    assert seg.reversed().start == seg.end and seg.reversed().end == seg.start


def test_zero_length_line_is_allowed_here() -> None:
    # Нулевые сегменты удаляет нормализация (M1) по допуску из конфига,
    # сам примитив их не запрещает — иначе нечего было бы чистить.
    seg = LineSegment(start=ORIGIN, end=ORIGIN)
    assert seg.length == 0.0


# ------------------------------------------------------------------ ArcSegment


def quarter_arc_ccw() -> ArcSegment:
    """Четверть окружности R=10 из (10,0) в (0,10) против часовой."""
    return ArcSegment(start=Point(x=10.0, y=0.0), end=Point(x=0.0, y=10.0), center=ORIGIN, ccw=True)


def test_arc_basic_properties() -> None:
    arc = quarter_arc_ccw()
    assert arc.radius == pytest.approx(10.0)
    assert arc.sweep == pytest.approx(math.pi / 2)
    assert arc.length == pytest.approx(5.0 * math.pi)
    assert arc.radius_mismatch == pytest.approx(0.0)


def test_arc_cw_is_the_complement() -> None:
    arc = quarter_arc_ccw().model_copy(update={"ccw": False})
    assert arc.sweep == pytest.approx(1.5 * math.pi)
    assert arc.length == pytest.approx(15.0 * math.pi)


def test_arc_reversed_keeps_geometry() -> None:
    arc = quarter_arc_ccw()
    rev = arc.reversed()
    assert rev.start == arc.end and rev.end == arc.start and rev.ccw is False
    assert rev.sweep == pytest.approx(arc.sweep)
    assert rev.length == pytest.approx(arc.length)


def test_arc_bbox_short_arc_is_hull_of_endpoints_plus_extreme() -> None:
    # Дуга в первом квадранте: крайние точки по осям не внутри — bbox по концам.
    arc = ArcSegment(
        start=Point(x=10.0, y=0.0),
        end=Point(x=10.0 * math.cos(1.0), y=10.0 * math.sin(1.0)),
        center=ORIGIN,
        ccw=True,
    )
    box = arc.bbox
    assert box.min_x == pytest.approx(10.0 * math.cos(1.0))
    assert box.max_x == pytest.approx(10.0)
    assert box.min_y == pytest.approx(0.0)
    assert box.max_y == pytest.approx(10.0 * math.sin(1.0))


def test_arc_bbox_crossing_axis_extends_to_radius() -> None:
    # Дуга через верхнюю точку (0,R): от 45° до 135° — max_y должен быть ровно R.
    s = 10.0 * math.sqrt(0.5)
    arc = ArcSegment(start=Point(x=s, y=s), end=Point(x=-s, y=s), center=ORIGIN, ccw=True)
    box = arc.bbox
    assert box.max_y == pytest.approx(10.0)
    assert box.min_y == pytest.approx(s)
    assert box.min_x == pytest.approx(-s) and box.max_x == pytest.approx(s)


def test_arc_bbox_three_quarters_cw() -> None:
    # По часовой из (10,0) в (0,10): проходит через (0,-10) и (-10,0).
    arc = quarter_arc_ccw().model_copy(update={"ccw": False})
    box = arc.bbox
    assert (box.min_x, box.min_y, box.max_x, box.max_y) == pytest.approx((-10.0, -10.0, 10.0, 10.0))


def test_arc_crossing_zero_angle() -> None:
    # Дуга через направление 0° (из четвёртого квадранта в первый).
    arc = ArcSegment(start=Point(x=0.0, y=-10.0), end=Point(x=0.0, y=10.0), center=ORIGIN, ccw=True)
    assert arc.sweep == pytest.approx(math.pi)
    assert arc.contains_angle(0.0)
    assert not arc.contains_angle(math.pi)
    assert arc.bbox.max_x == pytest.approx(10.0)
    assert arc.bbox.min_x == pytest.approx(0.0)


def test_arc_degenerate_cases_are_rejected() -> None:
    p = Point(x=10.0, y=0.0)
    with pytest.raises(ValidationError, match="Circle"):
        ArcSegment(start=p, end=p, center=ORIGIN, ccw=True)
    with pytest.raises(ValidationError, match="нулевой радиус"):
        ArcSegment(start=ORIGIN, end=p, center=ORIGIN, ccw=True)


def test_arc_radius_mismatch_is_reported_not_hidden() -> None:
    arc = ArcSegment(start=Point(x=10.0, y=0.0), end=Point(x=0.0, y=10.5), center=ORIGIN, ccw=True)
    assert arc.radius_mismatch == pytest.approx(0.5)


# ------------------------------------------------------------------ Circle


def test_circle_properties() -> None:
    c = Circle(center=Point(x=5.0, y=5.0), radius=2.5)
    assert c.diameter == 5.0
    assert c.length == pytest.approx(5.0 * math.pi)
    assert c.bbox == BBox(min_x=2.5, min_y=2.5, max_x=7.5, max_y=7.5)
    with pytest.raises(ValidationError):
        Circle(center=ORIGIN, radius=0.0)


# ------------------------------------------------------------------ Contour


def test_rect_contour_is_closed_and_measured() -> None:
    c = rect_contour(720.0, 500.0)
    assert c.is_connected(TOL) and c.is_closed(TOL)
    assert c.length == pytest.approx(2 * (720.0 + 500.0))
    assert c.bbox == BBox(min_x=0.0, min_y=0.0, max_x=720.0, max_y=500.0)


def test_contour_gap_within_tolerance_is_closed_and_beyond_is_open() -> None:
    segs = list(rect_contour(100.0, 50.0).segments)
    last = segs[-1]
    assert isinstance(last, LineSegment)
    segs[-1] = LineSegment(start=last.start, end=Point(x=0.0, y=0.009))
    assert Contour(segments=segs).is_closed(TOL)
    segs[-1] = LineSegment(start=last.start, end=Point(x=0.0, y=0.02))
    open_contour = Contour(segments=segs)
    assert open_contour.is_connected(TOL)
    assert not open_contour.is_closed(TOL)


def test_contour_with_internal_break_is_not_connected() -> None:
    segs = list(rect_contour(100.0, 50.0).segments)
    second = segs[1]
    assert isinstance(second, LineSegment)
    segs[1] = LineSegment(start=second.start.translated(0.0, 0.5), end=second.end)
    c = Contour(segments=segs)
    assert not c.is_connected(TOL)
    assert not c.is_closed(TOL)


def test_contour_mixed_lines_and_arcs() -> None:
    # Стадион: два отрезка и две полуокружности R=10, центры в (0,0) и (50,0).
    c = Contour(
        segments=[
            LineSegment(start=Point(x=0.0, y=-10.0), end=Point(x=50.0, y=-10.0)),
            ArcSegment(
                start=Point(x=50.0, y=-10.0),
                end=Point(x=50.0, y=10.0),
                center=Point(x=50.0, y=0.0),
                ccw=True,
            ),
            LineSegment(start=Point(x=50.0, y=10.0), end=Point(x=0.0, y=10.0)),
            ArcSegment(
                start=Point(x=0.0, y=10.0), end=Point(x=0.0, y=-10.0), center=ORIGIN, ccw=True
            ),
        ]
    )
    assert c.is_closed(TOL)
    assert c.length == pytest.approx(100.0 + 20.0 * math.pi)
    assert c.bbox == BBox(min_x=-10.0, min_y=-10.0, max_x=60.0, max_y=10.0)
    rev = c.reversed()
    assert rev.is_closed(TOL)
    assert rev.length == pytest.approx(c.length)
    assert rev.start == c.end


def test_contour_requires_segments() -> None:
    with pytest.raises(ValidationError):
        Contour(segments=[])


def test_geometry_json_round_trip_keeps_segment_types() -> None:
    adapter: TypeAdapter[Contour | Circle] = TypeAdapter(Geometry)
    stadium = Contour(
        segments=[
            LineSegment(start=ORIGIN, end=Point(x=10.0, y=0.0)),
            ArcSegment(
                start=Point(x=10.0, y=0.0), end=Point(x=0.0, y=10.0), center=ORIGIN, ccw=True
            ),
        ]
    )
    for geom in (stadium, Circle(center=ORIGIN, radius=4.0)):
        dumped = adapter.dump_python(geom, mode="json")
        restored = adapter.validate_python(dumped)
        assert restored == geom
        assert type(restored) is type(geom)
    restored_contour = adapter.validate_python(adapter.dump_python(stadium, mode="json"))
    assert isinstance(restored_contour, Contour)
    assert isinstance(restored_contour.segments[1], ArcSegment)

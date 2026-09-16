"""Sheet primitives. Coordinates are millimetres on the sheet, origin bottom-left, Y up."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

Pt = Tuple[float, float]

# line weights, mm
W_THICK = 0.5
W_MEDIUM = 0.35
W_THIN = 0.18

# dash patterns, mm
DASHES: Dict[str, List[float]] = {
    "hidden": [2.0, 1.0],
    "center": [8.0, 1.5, 1.5, 1.5],
    "phantom": [8.0, 1.5, 1.5, 1.5, 1.5, 1.5],
}

FONT_SIZE = 3.5     # default text height, mm
FONT_SMALL = 2.5


@dataclass
class Line:
    x1: float
    y1: float
    x2: float
    y2: float
    width: float = W_THIN
    dash: Optional[str] = None
    layer: str = "GEOM"


@dataclass
class Polyline:
    points: List[Pt]
    closed: bool = False
    width: float = W_THICK
    dash: Optional[str] = None
    layer: str = "GEOM"


@dataclass
class Polygon:
    """Filled polygon with holes (even-odd), optional stroke. Used for painter's algorithm."""
    loops: List[List[Pt]]
    fill: Optional[str] = "#ffffff"
    stroke: bool = True
    width: float = W_THICK
    layer: str = "GEOM"


@dataclass
class Circle:
    cx: float
    cy: float
    r: float
    width: float = W_THICK
    dash: Optional[str] = None
    fill: Optional[str] = None
    layer: str = "GEOM"


@dataclass
class Arc:
    cx: float
    cy: float
    r: float
    a0: float          # degrees, counter-clockwise from +X
    a1: float
    width: float = W_THIN
    dash: Optional[str] = None
    layer: str = "GEOM"


@dataclass
class Text:
    x: float
    y: float
    text: str
    size: float = FONT_SIZE
    anchor: str = "start"      # start | middle | end
    rotate: float = 0.0        # degrees, counter-clockwise
    bold: bool = False
    valign: str = "baseline"   # baseline | middle
    layer: str = "TEXT"


Primitive = Any  # Line | Polyline | Polygon | Circle | Arc | Text


@dataclass
class Sheet:
    width: float
    height: float
    prims: List[Primitive] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)   # kind, title, file_name, number, total, scale

    def add(self, *prims: Primitive) -> None:
        self.prims.extend(prims)

    def extend(self, prims: Sequence[Primitive]) -> None:
        self.prims.extend(prims)


def translate(prims: Sequence[Primitive], dx: float, dy: float, scale: float = 1.0) -> List[Primitive]:
    """Returns copies of the primitives scaled about the origin and shifted. Text size is kept."""
    out: List[Primitive] = []

    def tp(p: Pt) -> Pt:
        return (p[0] * scale + dx, p[1] * scale + dy)

    for p in prims:
        if isinstance(p, Line):
            (x1, y1), (x2, y2) = tp((p.x1, p.y1)), tp((p.x2, p.y2))
            out.append(Line(x1, y1, x2, y2, p.width, p.dash, p.layer))
        elif isinstance(p, Polyline):
            out.append(Polyline([tp(q) for q in p.points], p.closed, p.width, p.dash, p.layer))
        elif isinstance(p, Polygon):
            out.append(Polygon([[tp(q) for q in loop] for loop in p.loops], p.fill, p.stroke, p.width, p.layer))
        elif isinstance(p, Circle):
            cx, cy = tp((p.cx, p.cy))
            out.append(Circle(cx, cy, p.r * scale, p.width, p.dash, p.fill, p.layer))
        elif isinstance(p, Arc):
            cx, cy = tp((p.cx, p.cy))
            out.append(Arc(cx, cy, p.r * scale, p.a0, p.a1, p.width, p.dash, p.layer))
        elif isinstance(p, Text):
            x, y = tp((p.x, p.y))
            out.append(Text(x, y, p.text, p.size, p.anchor, p.rotate, p.bold, p.valign, p.layer))
    return out


def text_width(text: str, size: float) -> float:
    """Rough advance width for layout decisions (DejaVu Sans average ≈ 0.6 em)."""
    return 0.6 * size * len(text)

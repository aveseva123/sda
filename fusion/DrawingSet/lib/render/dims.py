"""Dimension and leader primitives in sheet coordinates (mm)."""
from __future__ import annotations

import math
from typing import List, Optional, Tuple

from .prims import Circle, FONT_SIZE, Line, Polygon, Primitive, Text, W_THIN

Pt = Tuple[float, float]
ARROW_LEN = 2.5
ARROW_W = 0.8
EXT_GAP = 1.0      # gap between the object and the extension line
EXT_OVER = 2.0     # extension beyond the dimension line
TEXT_GAP = 1.0


def fmt(value: float) -> str:
    text = f"{value:.1f}".rstrip("0").rstrip(".")
    return text.replace(".", ",") if text else "0"


def arrow(tip: Pt, direction: Pt) -> Polygon:
    """Filled arrow head with the tip at `tip` pointing along `direction`."""
    dx, dy = direction
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    px, py = -uy, ux
    bx, by = tip[0] - ux * ARROW_LEN, tip[1] - uy * ARROW_LEN
    return Polygon([[tip, (bx + px * ARROW_W, by + py * ARROW_W), (bx - px * ARROW_W, by - py * ARROW_W)]],
                   fill="#000000", stroke=False, layer="DIM")


def linear_h(x1: float, x2: float, y_obj: float, y_dim: float, text: Optional[str] = None,
             value: Optional[float] = None, size: float = FONT_SIZE) -> List[Primitive]:
    """Horizontal dimension between x1 and x2. y_obj: object edge (start of extension lines)."""
    if x1 > x2:
        x1, x2 = x2, x1
    text = text if text is not None else fmt(value if value is not None else (x2 - x1))
    up = y_dim >= y_obj
    sgn = 1 if up else -1
    prims: List[Primitive] = [
        Line(x1, y_obj + sgn * EXT_GAP, x1, y_dim + sgn * EXT_OVER, W_THIN, layer="DIM"),
        Line(x2, y_obj + sgn * EXT_GAP, x2, y_dim + sgn * EXT_OVER, W_THIN, layer="DIM"),
        Line(x1, y_dim, x2, y_dim, W_THIN, layer="DIM"),
    ]
    inside = (x2 - x1) > 2 * ARROW_LEN + 1
    if inside:
        prims += [arrow((x1, y_dim), (-1, 0)), arrow((x2, y_dim), (1, 0))]
    else:
        prims += [arrow((x1, y_dim), (1, 0)), arrow((x2, y_dim), (-1, 0)),
                  Line(x1 - ARROW_LEN - 2, y_dim, x1, y_dim, W_THIN, layer="DIM"),
                  Line(x2, y_dim, x2 + ARROW_LEN + 2, y_dim, W_THIN, layer="DIM")]
    prims.append(Text((x1 + x2) / 2, y_dim + TEXT_GAP, text, size, "middle", layer="DIM"))
    return prims


def linear_v(y1: float, y2: float, x_obj: float, x_dim: float, text: Optional[str] = None,
             value: Optional[float] = None, size: float = FONT_SIZE) -> List[Primitive]:
    """Vertical dimension between y1 and y2, text rotated 90°, readable from the right."""
    if y1 > y2:
        y1, y2 = y2, y1
    text = text if text is not None else fmt(value if value is not None else (y2 - y1))
    right = x_dim >= x_obj
    sgn = 1 if right else -1
    prims: List[Primitive] = [
        Line(x_obj + sgn * EXT_GAP, y1, x_dim + sgn * EXT_OVER, y1, W_THIN, layer="DIM"),
        Line(x_obj + sgn * EXT_GAP, y2, x_dim + sgn * EXT_OVER, y2, W_THIN, layer="DIM"),
        Line(x_dim, y1, x_dim, y2, W_THIN, layer="DIM"),
    ]
    inside = (y2 - y1) > 2 * ARROW_LEN + 1
    if inside:
        prims += [arrow((x_dim, y1), (0, -1)), arrow((x_dim, y2), (0, 1))]
    else:
        prims += [arrow((x_dim, y1), (0, 1)), arrow((x_dim, y2), (0, -1)),
                  Line(x_dim, y1 - ARROW_LEN - 2, x_dim, y1, W_THIN, layer="DIM"),
                  Line(x_dim, y2, x_dim, y2 + ARROW_LEN + 2, W_THIN, layer="DIM")]
    prims.append(Text(x_dim - TEXT_GAP, (y1 + y2) / 2, text, size, "middle", rotate=90, layer="DIM"))
    return prims


def leader(anchor: Pt, text_pos: Pt, text: str, size: float = FONT_SIZE, dot: bool = False) -> List[Primitive]:
    """Leader line from anchor to a horizontal shoulder with text after it."""
    shoulder = 4.0
    sx = text_pos[0] + (shoulder if text_pos[0] >= anchor[0] else -shoulder)
    prims: List[Primitive] = [Line(anchor[0], anchor[1], text_pos[0], text_pos[1], W_THIN, layer="DIM"),
                              Line(text_pos[0], text_pos[1], sx, text_pos[1], W_THIN, layer="DIM")]
    if dot:
        prims.append(Circle(anchor[0], anchor[1], 0.6, fill="#000000", layer="DIM"))
    else:
        prims.append(arrow(anchor, (anchor[0] - text_pos[0], anchor[1] - text_pos[1])))
    anchor_text = "start" if sx >= text_pos[0] else "end"
    prims.append(Text(sx + (0.8 if anchor_text == "start" else -0.8), text_pos[1] + 0.8, text, size, anchor_text, layer="DIM"))
    return prims


def diameter_text(r: float, depth: Optional[float] = None, count: int = 1, through: bool = True) -> str:
    d = fmt(2 * r)
    s = f"{count}×" if count > 1 else ""
    s += f"⌀{d}"
    if not through and depth:
        s += f" гл. {fmt(depth)}"
    return s

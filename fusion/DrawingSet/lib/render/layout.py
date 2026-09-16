"""Sheet formats, drawing region and view placement with automatic scale."""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from ..geom import pick_scale, scale_label
from .prims import Primitive, Sheet, Text, translate, FONT_SIZE
from .tables import TITLE_H, TITLE_W, frame, title_block
from .views import ViewImage

SHEET_SIZES: Dict[str, Tuple[float, float]] = {   # portrait (short, long)
    "A4": (210.0, 297.0), "A3": (297.0, 420.0), "A2": (420.0, 594.0), "A1": (594.0, 841.0), "A0": (841.0, 1189.0),
    "A": (215.9, 279.4), "B": (279.4, 431.8), "C": (431.8, 558.8), "D": (558.8, 863.6), "E": (863.6, 1117.6),
}
MARGIN = 10.0
GAP = 18.0          # gap between views, mm (room for dimensions)


def sheet_dims(size: str, orientation: str) -> Tuple[float, float]:
    short, long = SHEET_SIZES.get(size, SHEET_SIZES["A3"])
    return (long, short) if orientation.lower().startswith("l") else (short, long)


@dataclass
class Region:
    x: float
    y: float
    w: float
    h: float

    @property
    def x1(self) -> float:
        return self.x + self.w

    @property
    def y1(self) -> float:
        return self.y + self.h


def new_sheet(size: str, orientation: str, meta: Dict[str, str], reserve_bottom: float = 0.0) -> Tuple[Sheet, Region]:
    """Creates a sheet with frame and title block; returns it with the free drawing region."""
    w, h = sheet_dims(size, orientation)
    sheet = Sheet(w, h, meta=dict(meta))
    sheet.extend(frame(w, h, MARGIN))
    fields = dict(meta)
    fields.setdefault("date", _dt.date.today().strftime("%d.%m.%Y"))
    sheet.extend(title_block(w, h, MARGIN, fields))
    region = Region(MARGIN + 4, MARGIN + TITLE_H + 6 + reserve_bottom, w - 2 * MARGIN - 8,
                    h - 2 * MARGIN - TITLE_H - 12 - reserve_bottom)
    return sheet, region


@dataclass
class Placed:
    image: ViewImage
    scale: float
    ox: float          # sheet x of model x = 0 (after scale)
    oy: float

    def to_sheet(self, p: Tuple[float, float]) -> Tuple[float, float]:
        return (p[0] * self.scale + self.ox, p[1] * self.scale + self.oy)

    def bbox(self) -> Tuple[float, float, float, float]:
        x0, y0 = self.to_sheet((self.image.bbox[0], self.image.bbox[1]))
        x1, y1 = self.to_sheet((self.image.bbox[2], self.image.bbox[3]))
        return (x0, y0, x1, y1)

    def anchors(self) -> Dict[str, Tuple[float, float]]:
        return {k: self.to_sheet(v) for k, v in self.image.anchors.items()}


def place(sheet: Sheet, image: ViewImage, scale: float, left: float, bottom: float) -> Placed:
    """Places the image so that its bbox's bottom-left corner lands at (left, bottom)."""
    ox = left - image.bbox[0] * scale
    oy = bottom - image.bbox[1] * scale
    sheet.extend(translate(image.prims, ox, oy, scale))
    return Placed(image, scale, ox, oy)


def fit_scale(images: Sequence[ViewImage], cols_w: Sequence[float], rows_h: Sequence[float],
              region: Region, gap: float = GAP, max_scale: float = 1.0) -> float:
    """Scale so that a grid of views (column widths / row heights in model mm) fits the region."""
    total_w = sum(cols_w)
    total_h = sum(rows_h)
    avail_w = region.w - gap * (len(cols_w) + 1)
    avail_h = region.h - gap * (len(rows_h) + 1)
    s = pick_scale(total_w, total_h, avail_w, avail_h)
    return min(s, max_scale)


def label(sheet: Sheet, x: float, y: float, text: str, size: float = FONT_SIZE, bold: bool = True) -> None:
    sheet.add(Text(x, y, text, size, "start", bold=bold))


def scale_text(s: float) -> str:
    return scale_label(s)

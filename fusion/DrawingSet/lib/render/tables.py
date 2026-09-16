"""Tables, sheet frame and title block (sheet coordinates, mm)."""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

from .prims import FONT_SIZE, FONT_SMALL, Line, Polyline, Primitive, Text, W_MEDIUM, W_THICK, W_THIN, text_width

Column = Tuple[str, float, str]   # title, width, align (start|middle|end)


def draw_table(x: float, y_top: float, columns: Sequence[Column], rows: Sequence[Sequence[str]],
               row_h: float = 7.0, font: float = FONT_SMALL, header: bool = True,
               title: str = "") -> Tuple[List[Primitive], float]:
    """Draws a grid table growing downwards from y_top. Returns (prims, total height)."""
    prims: List[Primitive] = []
    width = sum(c[1] for c in columns)
    n_rows = len(rows) + (1 if header else 0) + (1 if title else 0)
    height = n_rows * row_h
    y = y_top
    if title:
        prims.append(Text(x + width / 2, y - row_h / 2, title, font + 0.5, "middle", bold=True, valign="middle"))
        y -= row_h
    if header:
        cx = x
        for name, w, _ in columns:
            prims.append(Text(cx + w / 2, y - row_h / 2, name, font, "middle", bold=True, valign="middle"))
            cx += w
        y -= row_h
    for row in rows:
        cx = x
        for (name, w, align), value in zip(columns, list(row) + [""] * len(columns)):
            value = str(value)
            max_chars = max(1, int((w - 2) / (0.6 * font)))
            if len(value) > max_chars:
                value = value[:max_chars - 1] + "…"
            tx = cx + 1.0 if align == "start" else (cx + w - 1.0 if align == "end" else cx + w / 2)
            prims.append(Text(tx, y - row_h / 2, value, font, align, valign="middle"))
            cx += w
        y -= row_h
    # grid
    prims.append(Polyline([(x, y_top), (x + width, y_top), (x + width, y_top - height), (x, y_top - height)],
                          closed=True, width=W_MEDIUM, layer="FRAME"))
    yy = y_top - (row_h if title else 0)
    for _ in range(n_rows - (1 if title else 0) - 1):
        yy -= row_h
        prims.append(Line(x, yy, x + width, yy, W_THIN, layer="FRAME"))
    cx = x
    y_start = y_top - (row_h if title else 0)
    for _, w, _ in columns[:-1]:
        cx += w
        prims.append(Line(cx, y_start, cx, y_top - height, W_THIN, layer="FRAME"))
    return prims, height


TITLE_W = 185.0
TITLE_H = 30.0


def frame(width: float, height: float, margin: float) -> List[Primitive]:
    return [Polyline([(margin, margin), (width - margin, margin), (width - margin, height - margin),
                      (margin, height - margin)], closed=True, width=W_THICK, layer="FRAME")]


def title_block(width: float, height: float, margin: float, fields: Dict[str, str]) -> List[Primitive]:
    """Simplified title block in the bottom-right corner.

    fields: project, product, view, kind, title, scale, sheet, date, material, author
    """
    x0 = width - margin - TITLE_W
    y0 = margin
    prims: List[Primitive] = [Polyline([(x0, y0), (x0 + TITLE_W, y0), (x0 + TITLE_W, y0 + TITLE_H), (x0, y0 + TITLE_H)],
                                       closed=True, width=W_THICK, layer="FRAME")]
    row = TITLE_H / 3
    # horizontal separators
    for i in (1, 2):
        prims.append(Line(x0, y0 + i * row, x0 + TITLE_W, y0 + i * row, W_THIN, layer="FRAME"))
    col1 = 110.0   # main text column
    col2 = 40.0    # scale / sheet
    prims.append(Line(x0 + col1, y0, x0 + col1, y0 + TITLE_H, W_THIN, layer="FRAME"))
    prims.append(Line(x0 + col1 + col2, y0, x0 + col1 + col2, y0 + 2 * row, W_THIN, layer="FRAME"))

    def cell(x: float, y: float, label: str, value: str, w: float) -> None:
        prims.append(Text(x + 1.0, y + row - 2.2, label, 1.8, "start", layer="TEXT"))
        max_chars = max(1, int((w - 2) / (0.6 * FONT_SIZE)))
        if len(value) > max_chars:
            value = value[:max_chars - 1] + "…"
        prims.append(Text(x + 1.0, y + 1.6, value, FONT_SIZE, "start", layer="TEXT"))

    cell(x0, y0 + 2 * row, "Изделие / проект", f"{fields.get('product', '')}  {fields.get('project', '')}".strip(), col1)
    cell(x0, y0 + row, "Наименование", fields.get("title", ""), col1)
    cell(x0, y0, "Материал / примечание", fields.get("material", ""), col1)
    cell(x0 + col1, y0 + 2 * row, "Вид / тип", f"{fields.get('view', '')} {fields.get('kind', '')}".strip(), col2)
    cell(x0 + col1, y0 + row, "Масштаб", fields.get("scale", ""), col2)
    cell(x0 + col1 + col2, y0 + 2 * row, "Лист", fields.get("sheet", ""), TITLE_W - col1 - col2)
    cell(x0 + col1 + col2, y0 + row, "Дата", fields.get("date", ""), TITLE_W - col1 - col2)
    cell(x0 + col1, y0, "Выпустил", fields.get("author", "DrawingSet"), TITLE_W - col1)
    return prims

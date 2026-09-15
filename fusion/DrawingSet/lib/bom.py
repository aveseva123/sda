"""Bill of materials: part records, grouping of identical parts, table rows and CSV output.

Pure module. Lengths are in millimetres. CSV output follows the convention of
the other scripts in the pipeline: ';' separator, decimal comma, UTF-8 with BOM.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

SPEC_HEADER = ["Поз.", "Наименование", "Материал", "Толщина", "Размер (Д×Ш)", "Кол-во", "Примечание"]
HARDWARE_HEADER = ["Поз.", "Наименование", "Кол-во", "Примечание"]
BEND_HEADER = ["Деталь", "Гиб №", "Угол, °", "Направление", "Радиус, мм", "K-фактор", "Толщина, мм"]


@dataclass
class PartRecord:
    """One occurrence of a part in the model (before grouping)."""
    occ_id: str                     # unique key of the occurrence (fullPathName)
    component_id: str               # Fusion component id (all instances share it)
    raw_name: str
    title: str
    position: str = ""              # position from the name ("03"), may be empty
    project: str = ""
    view: str = ""
    material: str = ""
    thickness_mm: float = 0.0
    length_mm: float = 0.0
    width_mm: float = 0.0
    category: str = "panel"         # panel|facade|back|shelf|top|bottom|side|drawer|hardware|other|assembly
    is_sheet_metal: bool = False
    edge: str = ""                  # edge banding note
    note: str = ""
    hole_count: int = 0
    level: int = 1
    parent_id: Optional[str] = None
    is_hardware: bool = False

    def identity_key(self) -> Tuple:
        """Parts with equal key are treated as identical and merged in the spec."""
        if self.position:
            return ("pos", self.position, self.title.lower())
        return (
            "geom",
            self.title.lower(),
            self.material.lower(),
            round(self.thickness_mm, 1),
            round(self.length_mm, 1),
            round(self.width_mm, 1),
            self.edge,
        )


@dataclass
class SpecRow:
    position: str
    title: str
    material: str
    thickness_mm: float
    length_mm: float
    width_mm: float
    quantity: int
    note: str = ""
    is_hardware: bool = False
    is_sheet_metal: bool = False
    component_ids: List[str] = field(default_factory=list)
    occ_ids: List[str] = field(default_factory=list)

    def size_text(self) -> str:
        if self.length_mm <= 0 and self.width_mm <= 0:
            return ""
        return f"{fmt_mm(self.length_mm)}×{fmt_mm(self.width_mm)}"


@dataclass
class BendRow:
    part: str
    index: int
    angle_deg: float
    direction: str      # "вверх" / "вниз"
    radius_mm: float
    k_factor: float
    thickness_mm: float


def fmt_mm(value: float, digits: int = 1) -> str:
    """Formats a millimetre value with decimal comma and without trailing zeros."""
    if value is None:
        return ""
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return text.replace(".", ",") if text else "0"


def _pos_sort_key(pos: str) -> Tuple[int, str]:
    digits = "".join(ch for ch in pos if ch.isdigit())
    return (int(digits) if digits else 10**9, pos)


def group_parts(parts: Iterable[PartRecord]) -> List[SpecRow]:
    """Merges identical parts and sums their quantities. Order: by position, then by title."""
    rows: Dict[Tuple, SpecRow] = {}
    order: List[Tuple] = []
    for p in parts:
        if p.category == "assembly":
            continue
        key = p.identity_key()
        row = rows.get(key)
        if row is None:
            note_parts = [t for t in (p.edge and f"Кромка: {p.edge}", p.note) if t]
            row = SpecRow(
                position=p.position,
                title=p.title,
                material=p.material,
                thickness_mm=p.thickness_mm,
                length_mm=p.length_mm,
                width_mm=p.width_mm,
                quantity=0,
                note="; ".join(note_parts),
                is_hardware=p.is_hardware,
                is_sheet_metal=p.is_sheet_metal,
            )
            rows[key] = row
            order.append(key)
        row.quantity += 1
        if p.component_id not in row.component_ids:
            row.component_ids.append(p.component_id)
        row.occ_ids.append(p.occ_id)
    result = [rows[k] for k in order]
    result.sort(key=lambda r: (r.is_hardware, _pos_sort_key(r.position), r.title.lower()))
    return result


def spec_rows(rows: Iterable[SpecRow]) -> List[List[str]]:
    out = []
    for r in rows:
        if r.is_hardware:
            continue
        note = r.note
        if r.is_sheet_metal:
            note = "; ".join(t for t in ("Листовой металл, развёртка", note) if t)
        out.append([
            r.position, r.title, r.material, fmt_mm(r.thickness_mm), r.size_text(), str(r.quantity), note,
        ])
    return out


def hardware_rows(rows: Iterable[SpecRow]) -> List[List[str]]:
    return [[r.position, r.title, str(r.quantity), r.note] for r in rows if r.is_hardware]


def bend_rows(bends: Iterable[BendRow]) -> List[List[str]]:
    return [[
        b.part, str(b.index), fmt_mm(b.angle_deg, 1), b.direction,
        fmt_mm(b.radius_mm, 2), fmt_mm(b.k_factor, 3), fmt_mm(b.thickness_mm, 2),
    ] for b in bends]


def to_csv(header: List[str], rows: Iterable[List[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def write_csv(path: str, header: List[str], rows: Iterable[List[str]]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write(to_csv(header, rows))


def description_text(p: PartRecord) -> str:
    """Text written into Component.description so that Fusion's parts list shows it."""
    bits = []
    if p.material:
        bits.append(p.material)
    if p.thickness_mm > 0:
        bits.append(f"{fmt_mm(p.thickness_mm)} мм")
    if p.length_mm > 0 and p.width_mm > 0:
        bits.append(f"{fmt_mm(p.length_mm)}×{fmt_mm(p.width_mm)}")
    if p.edge:
        bits.append(f"кромка {p.edge}")
    if p.note:
        bits.append(p.note)
    return "; ".join(bits)


def spec_table_cells(rows: Iterable[SpecRow]) -> List[List[str]]:
    """Header + rows for a custom table on the assembly sheet."""
    return [SPEC_HEADER] + spec_rows(rows)

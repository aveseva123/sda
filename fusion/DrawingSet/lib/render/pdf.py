"""Minimal PDF writer with an embedded TrueType font (CIDFontType2, Identity-H) for Cyrillic text."""
from __future__ import annotations

import math
import os
import zlib
from typing import Dict, List, Optional, Sequence

from .prims import Arc, Circle, DASHES, Line, Polygon, Polyline, Sheet, Text
from .ttf import TrueTypeFont

PT = 72.0 / 25.4   # points per millimetre
KAPPA = 0.5522847498

FONT_CANDIDATES = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "resources", "fonts", "DejaVuSans.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def find_font(explicit: Optional[str] = None) -> Optional[str]:
    for p in ([explicit] if explicit else []) + FONT_CANDIDATES:
        if p and os.path.exists(p):
            return p
    return None


def _f(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"


class PdfWriter:
    def __init__(self, font_path: Optional[str] = None):
        path = find_font(font_path)
        if path is None:
            raise FileNotFoundError("Не найден TrueType-шрифт для PDF (положите DejaVuSans.ttf в resources/fonts).")
        with open(path, "rb") as fh:
            self.font_data = fh.read()
        self.font = TrueTypeFont(self.font_data)
        self.font_name = os.path.splitext(os.path.basename(path))[0].replace(" ", "")
        self.pages: List[bytes] = []
        self.page_sizes: List[tuple] = []
        self.used_gids: Dict[int, int] = {}

    # ------------------------------------------------------------------
    def add_sheet(self, sheet: Sheet) -> None:
        ops: List[str] = ["0 0 0 RG 0 0 0 rg 1 J 1 j"]
        for p in sheet.prims:
            ops.append(self._prim(p))
        self.pages.append("\n".join(ops).encode("latin-1", "replace"))
        self.page_sizes.append((sheet.width * PT, sheet.height * PT))

    def _dash(self, dash: Optional[str]) -> str:
        if not dash:
            return "[] 0 d"
        arr = " ".join(_f(d * PT) for d in DASHES.get(dash, [2, 1]))
        return f"[{arr}] 0 d"

    def _circle_path(self, cx: float, cy: float, r: float) -> str:
        k = KAPPA * r
        return (f"{_f(cx + r)} {_f(cy)} m "
                f"{_f(cx + r)} {_f(cy + k)} {_f(cx + k)} {_f(cy + r)} {_f(cx)} {_f(cy + r)} c "
                f"{_f(cx - k)} {_f(cy + r)} {_f(cx - r)} {_f(cy + k)} {_f(cx - r)} {_f(cy)} c "
                f"{_f(cx - r)} {_f(cy - k)} {_f(cx - k)} {_f(cy - r)} {_f(cx)} {_f(cy - r)} c "
                f"{_f(cx + k)} {_f(cy - r)} {_f(cx + r)} {_f(cy - k)} {_f(cx + r)} {_f(cy)} c h")

    def _arc_path(self, cx: float, cy: float, r: float, a0: float, a1: float) -> str:
        while a1 <= a0:
            a1 += 360.0
        segs = max(1, int(math.ceil((a1 - a0) / 90.0)))
        step = math.radians((a1 - a0) / segs)
        a = math.radians(a0)
        out = [f"{_f(cx + r * math.cos(a))} {_f(cy + r * math.sin(a))} m"]
        for _ in range(segs):
            b = a + step
            t = 4.0 / 3.0 * math.tan((b - a) / 4.0)
            x0, y0 = cx + r * math.cos(a), cy + r * math.sin(a)
            x3, y3 = cx + r * math.cos(b), cy + r * math.sin(b)
            x1, y1 = x0 - t * r * math.sin(a), y0 + t * r * math.cos(a)
            x2, y2 = x3 + t * r * math.sin(b), y3 - t * r * math.cos(b)
            out.append(f"{_f(x1)} {_f(y1)} {_f(x2)} {_f(y2)} {_f(x3)} {_f(y3)} c")
            a = b
        return " ".join(out)

    def _prim(self, p) -> str:
        if isinstance(p, Line):
            return (f"{_f(p.width * PT)} w {self._dash(p.dash)} {_f(p.x1 * PT)} {_f(p.y1 * PT)} m "
                    f"{_f(p.x2 * PT)} {_f(p.y2 * PT)} l S")
        if isinstance(p, Polyline):
            if len(p.points) < 2:
                return ""
            pts = " ".join(f"{_f(x * PT)} {_f(y * PT)} {'m' if i == 0 else 'l'}" for i, (x, y) in enumerate(p.points))
            return f"{_f(p.width * PT)} w {self._dash(p.dash)} {pts} {'h S' if p.closed else 'S'}"
        if isinstance(p, Polygon):
            path = []
            for loop in p.loops:
                if len(loop) < 2:
                    continue
                path.append(" ".join(f"{_f(x * PT)} {_f(y * PT)} {'m' if i == 0 else 'l'}" for i, (x, y) in enumerate(loop)) + " h")
            if not path:
                return ""
            fill = p.fill
            ops = [f"{_f(p.width * PT)} w [] 0 d"]
            if fill and fill != "none":
                ops.append(f"{self._rgb(fill)} rg")
                ops.append(" ".join(path) + (" B*" if p.stroke else " f*"))
                ops.append("0 0 0 rg")
            elif p.stroke:
                ops.append(" ".join(path) + " S")
            return " ".join(ops)
        if isinstance(p, Circle):
            ops = [f"{_f(p.width * PT)} w {self._dash(p.dash)}", self._circle_path(p.cx * PT, p.cy * PT, p.r * PT)]
            if p.fill and p.fill != "none":
                ops.insert(0, f"{self._rgb(p.fill)} rg")
                ops.append("B 0 0 0 rg")
            else:
                ops.append("S")
            return " ".join(ops)
        if isinstance(p, Arc):
            return f"{_f(p.width * PT)} w {self._dash(p.dash)} {self._arc_path(p.cx * PT, p.cy * PT, p.r * PT, p.a0, p.a1)} S"
        if isinstance(p, Text):
            return self._text(p)
        return ""

    @staticmethod
    def _rgb(color: str) -> str:
        c = color.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        try:
            r, g, b = int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255
        except ValueError:
            r = g = b = 1.0
        return f"{_f(r)} {_f(g)} {_f(b)}"

    def _text(self, t: Text) -> str:
        if not t.text:
            return ""
        size = t.size * PT
        gids = [self.font.glyph_id(ch) or self.font.glyph_id("?") for ch in t.text]
        for g in gids:
            self.used_gids[g] = 1
        width = sum(self.font.advance_1000(g) for g in gids) * size / 1000.0
        dx = 0.0
        if t.anchor == "middle":
            dx = -width / 2.0
        elif t.anchor == "end":
            dx = -width
        dy = -self.font.cap_height * size / self.font.units_per_em / 2.0 if t.valign == "middle" else 0.0
        a = math.radians(t.rotate)
        cos_a, sin_a = math.cos(a), math.sin(a)
        x = t.x * PT + dx * cos_a - dy * sin_a
        y = t.y * PT + dx * sin_a + dy * cos_a
        hexs = "".join(f"{g:04X}" for g in gids)
        mode = "2 Tr " + f"{_f(size * 0.03)} w " if t.bold else "0 Tr "
        return (f"BT /F1 {_f(size)} Tf {mode}{_f(cos_a)} {_f(sin_a)} {_f(-sin_a)} {_f(cos_a)} {_f(x)} {_f(y)} Tm "
                f"<{hexs}> Tj ET")

    # ------------------------------------------------------------------
    def build(self) -> bytes:
        objs: List[bytes] = []

        def add(body: bytes) -> int:
            objs.append(body)
            return len(objs)

        def stream(dict_entries: str, data: bytes) -> bytes:
            comp = zlib.compress(data)
            return (f"<< {dict_entries} /Length {len(comp)} /Filter /FlateDecode >>\nstream\n".encode("latin-1")
                    + comp + b"\nendstream")

        font_file = add(stream(f"/Length1 {len(self.font_data)}", self.font_data))
        f = self.font
        scale = 1000.0 / f.units_per_em
        bbox = " ".join(_f(v * scale) for v in f.bbox)
        descriptor = add((f"<< /Type /FontDescriptor /FontName /{self.font_name} /Flags 32 /FontBBox [{bbox}] "
                          f"/ItalicAngle {_f(f.italic_angle)} /Ascent {_f(f.ascent * scale)} /Descent {_f(f.descent * scale)} "
                          f"/CapHeight {_f(f.cap_height * scale)} /StemV 80 /FontFile2 {font_file} 0 R >>").encode("latin-1"))
        widths = " ".join(f"{g} [{_f(f.advance_1000(g))}]" for g in sorted(self.used_gids))
        cid_font = add((f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{self.font_name} "
                        f"/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
                        f"/FontDescriptor {descriptor} 0 R /DW 600 /W [{widths}] /CIDToGIDMap /Identity >>").encode("latin-1"))
        to_unicode = add(stream("", self._to_unicode().encode("latin-1")))
        font = add((f"<< /Type /Font /Subtype /Type0 /BaseFont /{self.font_name} /Encoding /Identity-H "
                    f"/DescendantFonts [{cid_font} 0 R] /ToUnicode {to_unicode} 0 R >>").encode("latin-1"))
        page_ids: List[int] = []
        pages_placeholder = add(b"")  # filled later
        for content, (w, h) in zip(self.pages, self.page_sizes):
            c = add(stream("", content))
            page_ids.append(add((f"<< /Type /Page /Parent {pages_placeholder} 0 R /MediaBox [0 0 {_f(w)} {_f(h)}] "
                                 f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {c} 0 R >>").encode("latin-1")))
        kids = " ".join(f"{i} 0 R" for i in page_ids)
        objs[pages_placeholder - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1")
        catalog = add(f"<< /Type /Catalog /Pages {pages_placeholder} 0 R >>".encode("latin-1"))
        info = add("<< /Producer (DrawingSet) >>".encode("latin-1"))

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: List[int] = []
        for i, body in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode("latin-1") + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode("latin-1")
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode("latin-1")
        out += (f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\n"
                f"startxref\n{xref}\n%%EOF\n").encode("latin-1")
        return bytes(out)

    def _to_unicode(self) -> str:
        rev: Dict[int, int] = {}
        for cp, gid in self.font.cmap.items():
            if gid in self.used_gids and gid not in rev:
                rev[gid] = cp
        lines = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
                 "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
                 "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
                 "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"]
        items = sorted(rev.items())
        for i in range(0, len(items), 100):
            chunk = items[i:i + 100]
            lines.append(f"{len(chunk)} beginbfchar")
            for gid, cp in chunk:
                if cp > 0xFFFF:
                    hi = 0xD800 + ((cp - 0x10000) >> 10)
                    lo = 0xDC00 + ((cp - 0x10000) & 0x3FF)
                    lines.append(f"<{gid:04X}> <{hi:04X}{lo:04X}>")
                else:
                    lines.append(f"<{gid:04X}> <{cp:04X}>")
            lines.append("endbfchar")
        lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
        return "\n".join(lines)


def write_pdf(path: str, sheets: Sequence[Sheet], font_path: Optional[str] = None) -> str:
    w = PdfWriter(font_path)
    for s in sheets:
        w.add_sheet(s)
    with open(path, "wb") as fh:
        fh.write(w.build())
    return path

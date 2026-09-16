"""Tiny TrueType reader: enough to embed a font in PDF (glyph ids, advance widths, metrics)."""
from __future__ import annotations

import struct
from typing import Dict, Tuple


class TrueTypeFont:
    def __init__(self, data: bytes):
        self.data = data
        self.tables: Dict[str, Tuple[int, int]] = {}
        num_tables = struct.unpack(">H", data[4:6])[0]
        for i in range(num_tables):
            off = 12 + 16 * i
            tag = data[off:off + 4].decode("latin-1")
            t_off, t_len = struct.unpack(">II", data[off + 8:off + 16])
            self.tables[tag] = (t_off, t_len)
        head = self._table("head")
        self.units_per_em = struct.unpack(">H", head[18:20])[0] or 1000
        self.bbox = struct.unpack(">hhhh", head[36:44])
        hhea = self._table("hhea")
        self.ascent, self.descent = struct.unpack(">hh", hhea[4:8])
        num_hmetrics = struct.unpack(">H", hhea[34:36])[0]
        maxp = self._table("maxp")
        self.num_glyphs = struct.unpack(">H", maxp[4:6])[0]
        hmtx = self._table("hmtx")
        self.advances = [struct.unpack(">H", hmtx[4 * i:4 * i + 2])[0] for i in range(num_hmetrics)]
        self.cmap: Dict[int, int] = self._parse_cmap()
        try:
            os2 = self._table("OS/2")
            self.cap_height = struct.unpack(">h", os2[88:90])[0] if len(os2) >= 90 else int(self.ascent * 0.72)
        except KeyError:
            self.cap_height = int(self.ascent * 0.72)
        try:
            post = self._table("post")
            self.italic_angle = struct.unpack(">i", post[4:8])[0] / 65536.0
        except KeyError:
            self.italic_angle = 0.0

    def _table(self, tag: str) -> bytes:
        off, ln = self.tables[tag]
        return self.data[off:off + ln]

    def _parse_cmap(self) -> Dict[int, int]:
        cmap = self._table("cmap")
        n = struct.unpack(">H", cmap[2:4])[0]
        best = None
        for i in range(n):
            pid, eid, off = struct.unpack(">HHI", cmap[4 + 8 * i:12 + 8 * i])
            fmt = struct.unpack(">H", cmap[off:off + 2])[0]
            if fmt == 4 and ((pid == 3 and eid in (1, 10)) or pid == 0):
                best = off
                if pid == 3:
                    break
        result: Dict[int, int] = {}
        if best is None:
            return result
        sub = cmap[best:]
        seg_x2 = struct.unpack(">H", sub[6:8])[0]
        seg = seg_x2 // 2
        ends = struct.unpack(f">{seg}H", sub[14:14 + seg_x2])
        starts = struct.unpack(f">{seg}H", sub[16 + seg_x2:16 + 2 * seg_x2])
        deltas = struct.unpack(f">{seg}h", sub[16 + 2 * seg_x2:16 + 3 * seg_x2])
        range_off_pos = 16 + 3 * seg_x2
        range_offs = struct.unpack(f">{seg}H", sub[range_off_pos:range_off_pos + seg_x2])
        for i in range(seg):
            s, e, d, ro = starts[i], ends[i], deltas[i], range_offs[i]
            if s == 0xFFFF:
                continue
            for c in range(s, e + 1):
                if ro == 0:
                    gid = (c + d) & 0xFFFF
                else:
                    pos = range_off_pos + 2 * i + ro + 2 * (c - s)
                    if pos + 2 > len(sub):
                        continue
                    gid = struct.unpack(">H", sub[pos:pos + 2])[0]
                    if gid:
                        gid = (gid + d) & 0xFFFF
                if gid:
                    result[c] = gid
        return result

    def glyph_id(self, ch: str) -> int:
        return self.cmap.get(ord(ch), 0)

    def advance_units(self, gid: int) -> int:
        if gid < len(self.advances):
            return self.advances[gid]
        return self.advances[-1] if self.advances else self.units_per_em // 2

    def advance_1000(self, gid: int) -> float:
        return self.advance_units(gid) * 1000.0 / self.units_per_em

    def text_width(self, text: str, size: float) -> float:
        return sum(self.advance_1000(self.glyph_id(ch)) for ch in text) * size / 1000.0

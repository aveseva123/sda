"""Offline preview: builds the sample cabinet drawing set into a folder (PDF, SVG, DXF).

    python3 tests/preview.py /tmp/out
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib import bom, docbuild  # noqa: E402
from lib.config import Settings  # noqa: E402
from lib.explode import ExplodeParams, compute_explode  # noqa: E402
from lib.render.svg import sheet_to_svg  # noqa: E402
from tests.sample_cabinet import build  # noqa: E402


def main(out_dir: str) -> None:
    data, scene = build()
    settings = Settings(out_dir=out_dir, export_dxf=True, export_summary_pdf=True, asm_subassembly_sheets=False,
                        explode_stagger=0.35)
    rows = bom.group_parts(data.parts)
    explode = compute_explode(data.explode_items, ExplodeParams(front_fallback=(0, 0, -1), hardware_mode=settings.hardware_mode))
    doc = docbuild.build_document(data, scene, settings, explode, rows)
    os.makedirs(out_dir, exist_ok=True)
    for i, s in enumerate(doc.sheets, start=1):
        with open(os.path.join(out_dir, f"sheet{i:02d}_{s.meta.get('kind')}.svg"), "w", encoding="utf-8") as fh:
            fh.write(sheet_to_svg(s))
    files = docbuild.export_document(doc, data, scene, settings, rows)
    print(f"sheets: {len(doc.sheets)}  files: {len(files)}")
    for w in doc.warnings:
        print("warning:", w)
    for f in files:
        print(" ", f)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "preview_out")

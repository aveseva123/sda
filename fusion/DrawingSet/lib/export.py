"""Export of drawings and side files: PDF via the API, DXF/DWG via UI commands, CSV tables."""
from __future__ import annotations

import os
from typing import Any, List, Optional

from .bom import BEND_HEADER, HARDWARE_HEADER, SPEC_HEADER, bend_rows, hardware_rows, spec_rows, write_csv


def unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(f"{base} ({i}){ext}"):
        i += 1
    return f"{base} ({i}){ext}"


def export_pdf(drawing_doc: Any, path: str, log=None) -> Optional[str]:
    import adsk.drawing as drw  # type: ignore
    drawing = drw.Drawing.cast(drawing_doc.products.itemByProductType("DrawingProductType"))
    if drawing is None:
        drawing = drawing_doc.drawing
    os.makedirs(os.path.dirname(path), exist_ok=True)
    path = unique_path(path)
    opts = drawing.exportManager.createPDFExportOptions(path)
    try:
        opts.sheetsToExport = drw.PDFSheetsExport.AllPDFSheetsExport
    except Exception:
        pass
    try:
        opts.openPDF = False
        opts.useLineWeights = True
    except Exception:
        pass
    if not drawing.exportManager.execute(opts):
        if log:
            log.error(f"Экспорт PDF не выполнен: {path}")
        return None
    if log:
        log.info(f"PDF: {path}")
    return path


def export_by_command(app: Any, command_id: str, label: str, log=None) -> bool:
    """Runs a UI export command (DWG/DXF). The user completes the dialog; not fully automatic."""
    if not command_id:
        if log:
            log.warn(f"{label}: id команды экспорта не задан (см. «Проверка API», поле в настройках).")
        return False
    cmd = app.userInterface.commandDefinitions.itemById(command_id)
    if cmd is None:
        if log:
            log.warn(f"{label}: команда «{command_id}» не найдена.")
        return False
    try:
        cmd.execute()
        if log:
            log.info(f"{label}: запущена команда «{command_id}» — завершите диалог экспорта.")
        return True
    except Exception as exc:
        if log:
            log.error(f"{label}: команда «{command_id}» не запустилась", exc)
        return False


def export_flat_pattern_dxf(design: Any, flat_pattern: Any, path: str, log=None) -> Optional[str]:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        path = unique_path(path)
        opts = design.exportManager.createDXFFlatPatternExportOptions(path, flat_pattern)
        if design.exportManager.execute(opts):
            if log:
                log.info(f"DXF развёртки: {path}")
            return path
    except Exception as exc:
        if log:
            log.warn(f"DXF развёртки не экспортирован ({path}): {exc}")
    return None


def write_tables(out_dir: str, base_name: str, rows, bends, log=None) -> List[str]:
    """Writes specification / hardware / bend CSV files. Returns the written paths."""
    os.makedirs(out_dir, exist_ok=True)
    written: List[str] = []
    spec = spec_rows(rows)
    if spec:
        p = os.path.join(out_dir, f"{base_name}_Спецификация.csv")
        write_csv(p, SPEC_HEADER, spec)
        written.append(p)
    hw = hardware_rows(rows)
    if hw:
        p = os.path.join(out_dir, f"{base_name}_Фурнитура.csv")
        write_csv(p, HARDWARE_HEADER, hw)
        written.append(p)
    br = bend_rows(bends)
    if br:
        p = os.path.join(out_dir, f"{base_name}_Гибы.csv")
        write_csv(p, BEND_HEADER, br)
        written.append(p)
    if log:
        for p in written:
            log.info(f"CSV: {p}")
    return written

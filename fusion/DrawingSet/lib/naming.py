"""Component name parsing, classification and output file naming.

The add-in never invents names or positions: it only reads what the earlier
scripts in the pipeline have already written into component names.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Iterable, Optional

_INVALID_FILE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


@dataclass
class ParsedName:
    raw: str
    project: str = ""
    view: str = ""
    position: str = ""      # as written in the name, e.g. "П03"
    pos_number: str = ""    # digits only, leading zeros kept, e.g. "03"
    title: str = ""         # human readable part name, e.g. "Боковина"
    matched: bool = False

    @property
    def display_position(self) -> str:
        return self.pos_number or self.position or ""


def strip_instance_suffix(name: str) -> str:
    """Removes the ':1' occurrence suffix Fusion appends to occurrence names."""
    return re.sub(r":\d+$", "", name or "").strip()


def parse_name(name: str, pattern: str) -> ParsedName:
    clean = strip_instance_suffix(name)
    result = ParsedName(raw=clean, title=clean)
    try:
        rx = re.compile(pattern)
    except re.error:
        return result
    m = rx.match(clean)
    if not m:
        # Partial fallback: find a position token anywhere in the name.
        pm = re.search(r"(?:^|_)(?P<pos>[A-Za-zА-Яа-я]?\d{1,4}[A-Za-zА-Яа-я]?)(?:_|$)", clean)
        if pm:
            result.position = pm.group("pos")
            result.pos_number = _digits(pm.group("pos"))
        return result
    gd = m.groupdict()
    result.project = (gd.get("project") or "").strip()
    result.view = (gd.get("view") or "").strip()
    result.position = (gd.get("pos") or "").strip()
    result.pos_number = _digits(result.position)
    result.title = (gd.get("title") or clean).strip()
    result.matched = True
    return result


def _digits(token: str) -> str:
    m = re.search(r"\d+", token or "")
    return m.group(0) if m else ""


def keyword_list(csv: str) -> list[str]:
    return [k.strip().lower() for k in (csv or "").split(",") if k.strip()]


def matches_keywords(text: str, keywords: Iterable[str]) -> bool:
    low = (text or "").lower()
    return any(k and k in low for k in keywords)


def classify(title: str, category_keywords: Dict[str, str]) -> str:
    """Returns a category name from the keyword table, or 'panel' if nothing matches.

    Categories are checked in a fixed priority order so that e.g. "Задняя стенка"
    is a back panel and not a side ("стенк") one.
    """
    order = ("back", "facade", "drawer", "shelf", "top", "bottom", "side")
    low = (title or "").lower()
    for cat in order:
        kws = keyword_list(category_keywords.get(cat, ""))
        if matches_keywords(low, kws):
            return cat
    return "panel"


def is_hardware_name(title: str, hardware_keywords: str) -> bool:
    return matches_keywords(title, keyword_list(hardware_keywords))


def sanitize_filename(text: str, replacement: str = "-") -> str:
    text = _INVALID_FILE_CHARS.sub(replacement, text or "")
    text = re.sub(r"\s+", " ", text).strip().strip(".")
    return text or "untitled"


def build_file_name(mask: str, *, project: str, view: str, product: str, kind: str,
                    extra: Optional[Dict[str, str]] = None) -> str:
    """Expands the file mask. Both Russian and English placeholders are accepted."""
    values = {
        "проект": project, "project": project,
        "вид": view, "view": view,
        "изделие": product, "product": product,
        "тип": kind, "type": kind,
    }
    if extra:
        values.update(extra)
    out = mask or "{проект}_{вид}_{изделие}_{тип}"
    for key, val in values.items():
        out = out.replace("{" + key + "}", val or "")
    out = re.sub(r"_{2,}", "_", out).strip("_ ")
    return sanitize_filename(out)

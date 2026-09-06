"""Определение материала детали.

Раскрой идёт по паре «материал + толщина», поэтому одной толщины мало:
без материала деталь тоже попадает в очередь уточнений.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import PurePosixPath

from app.core.config_files import thickness_rules
from app.models.enums import ResolveSource


@dataclass(slots=True)
class MaterialRef:
    id: int
    name: str
    thickness: float
    aliases: list[str] = field(default_factory=list)

    def tokens(self) -> list[str]:
        return [self.name, *self.aliases]


@dataclass(slots=True)
class MaterialResolution:
    material_id: int | None = None
    material_name: str | None = None
    confidence: float = 0.0
    source: str = ResolveSource.UNRESOLVED
    accepted: bool = False
    note: str = ""

    def as_dict(self) -> dict:
        data = asdict(self)
        data["source"] = str(self.source)
        data["confidence"] = round(self.confidence, 3)
        return data


def _normalize(text: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", text.lower()).strip()


def resolve_material(
    *,
    filename: str,
    relpath: str = "",
    texts: list[str] | None = None,
    materials: list[MaterialRef],
    thickness: float | None,
    batch_default_id: int | None = None,
) -> MaterialResolution:
    cfg = thickness_rules().get("material", {}) or {}
    single_ok = bool(cfg.get("single_candidate_ok", True))
    allow_default = bool(cfg.get("allow_default_from_batch", True))

    haystack = " ".join(
        [
            _normalize(PurePosixPath(filename.replace("\\", "/")).stem),
            _normalize(relpath.replace("\\", "/").replace("/", " ")),
            _normalize(" ".join(texts or [])),
        ]
    )

    # 1. Прямое совпадение имени материала или его алиаса.
    best: tuple[MaterialRef, str] | None = None
    for material in materials:
        for token in material.tokens():
            norm = _normalize(token)
            if len(norm) < 3:
                continue
            if re.search(rf"(?:^|\s){re.escape(norm)}(?:\s|$)", haystack):
                if best is None or len(norm) > len(_normalize(best[1])):
                    best = (material, token)
    if best is not None:
        material, token = best
        return MaterialResolution(
            material_id=material.id,
            material_name=material.name,
            confidence=0.9,
            source=ResolveSource.FILENAME,
            accepted=True,
            note=f"по алиасу «{token}»",
        )

    # 2. Единственный материал подходящей толщины.
    if thickness is not None:
        candidates = [m for m in materials if abs(m.thickness - thickness) < 0.01]
        if len(candidates) == 1 and single_ok:
            material = candidates[0]
            return MaterialResolution(
                material_id=material.id,
                material_name=material.name,
                confidence=0.6,
                source=ResolveSource.BATCH_DEFAULT,
                accepted=True,
                note=f"единственный материал толщиной {thickness} мм",
            )
        if len(candidates) > 1:
            names = ", ".join(m.name for m in candidates)
            return MaterialResolution(
                confidence=0.0,
                source=ResolveSource.UNRESOLVED,
                accepted=False,
                note=f"толщине {thickness} мм соответствует несколько материалов: {names}",
            )

    # 3. Материал по умолчанию, выбранный для всей загрузки.
    if batch_default_id is not None and allow_default:
        material = next((m for m in materials if m.id == batch_default_id), None)
        if material is not None:
            return MaterialResolution(
                material_id=material.id,
                material_name=material.name,
                confidence=0.7,
                source=ResolveSource.BATCH_DEFAULT,
                accepted=True,
                note="материал по умолчанию для этой загрузки",
            )

    return MaterialResolution(
        note="материал не определён ни по имени файла, ни по толщине",
    )

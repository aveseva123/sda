"""Определение толщины детали.

Порядок резолверов задан в ``config/thickness_rules.yaml``:
слой DXF → токен в имени файла → имя папки → аннотация внутри DXF.

Каждый резолвер возвращает значение, уверенность и источник. Если ни один
не сработал или итоговая уверенность ниже порога — деталь уходит в очередь
«требует уточнения» вместе с трассировкой попыток. Молча угадывать нельзя:
это прямое требование ТЗ и причина боли №1 у заказчика.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import PurePosixPath

from app.core.config_files import app_config, thickness_rules
from app.models.enums import ResolveSource
from app.resolve.filename import parse_filename


@dataclass(slots=True)
class Attempt:
    resolver: str
    matched: bool
    value: float | None = None
    pattern: str | None = None
    confidence: float = 0.0
    note: str = ""


@dataclass(slots=True)
class ThicknessResolution:
    value: float | None = None
    confidence: float = 0.0
    source: str = ResolveSource.UNRESOLVED
    known: bool = False
    accepted: bool = False
    attempts: list[Attempt] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "value": self.value,
            "confidence": round(self.confidence, 3),
            "source": str(self.source),
            "known": self.known,
            "accepted": self.accepted,
            "attempts": [asdict(a) for a in self.attempts],
        }


@dataclass(slots=True)
class ResolveContext:
    """Всё, из чего можно извлечь толщину для одного файла."""

    filename: str
    relpath: str = ""
    layer_names: list[str] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    # thickness_from_layer_regex активного пресета слоёв.
    layer_thickness_regex: str | None = None
    filename_template: str | None = None
    # Толщины, реально доступные в справочнике материалов. Пусто — берём из конфига.
    known_thicknesses: list[float] = field(default_factory=list)


def _known_list(ctx: ResolveContext) -> list[float]:
    if ctx.known_thicknesses:
        return sorted({float(t) for t in ctx.known_thicknesses})
    return sorted({float(t) for t in app_config().get("thicknesses", {}).get("known", [])})


def _snap(value: float, known: list[float], tolerance: float) -> float | None:
    """Подтягивает найденное число к известной толщине, если оно рядом."""
    best = None
    best_delta = tolerance
    for candidate in known:
        delta = abs(candidate - value)
        if delta <= best_delta:
            best, best_delta = candidate, delta
    return best


def _plausible(value: float) -> bool:
    cfg = app_config().get("thicknesses", {})
    return float(cfg.get("min", 3)) <= value <= float(cfg.get("max", 60))


def _search(patterns: list[dict], haystacks: list[str]) -> tuple[float, dict, str] | None:
    for pattern in patterns:
        regex = pattern.get("regex")
        if not regex:
            continue
        for text in haystacks:
            match = re.search(regex, text)
            if not match:
                continue
            try:
                value = float(match.group("value").replace(",", "."))
            except (IndexError, ValueError):
                continue
            if not _plausible(value):
                continue
            return value, pattern, text
    return None


def resolve_thickness(ctx: ResolveContext) -> ThicknessResolution:
    rules = thickness_rules()
    acceptance = rules.get("acceptance", {}) or {}
    min_confidence = float(acceptance.get("min_confidence", 0.7))
    require_known = bool(acceptance.get("require_known_thickness", True))
    penalty = float(acceptance.get("unknown_thickness_penalty", 0.5))

    known = _known_list(ctx)
    tolerance = float(app_config().get("thicknesses", {}).get("match_tolerance", 0.6))

    result = ThicknessResolution()
    stem = PurePosixPath(ctx.filename.replace("\\", "/")).stem

    for step in rules.get("chain", []) or []:
        found: tuple[float, dict, str] | None = None
        source = ResolveSource.UNRESOLVED
        pattern_name = None

        if step == "layer_map":
            source = ResolveSource.LAYER_MAP
            if ctx.layer_thickness_regex:
                found = _search(
                    [{"regex": ctx.layer_thickness_regex, "confidence": 0.9, "name": "layer"}],
                    ctx.layer_names,
                )
            else:
                result.attempts.append(
                    Attempt(step, False, note="в пресете слоёв нет правила толщины")
                )
                continue

        elif step == "filename_token":
            source = ResolveSource.FILENAME
            # Сначала — шаблон имени целиком (Fusion): он надёжнее токена.
            parsed = parse_filename(ctx.filename, template_name=ctx.filename_template)
            if parsed.matched and parsed.thickness is not None:
                found = (parsed.thickness, {"name": parsed.template, "confidence": 0.95}, stem)
            else:
                found = _search(rules.get("filename_token", {}).get("patterns", []), [stem])

        elif step == "folder_name":
            source = ResolveSource.FOLDER
            folders = [p for p in PurePosixPath(ctx.relpath.replace("\\", "/")).parts[:-1]]
            found = _search(rules.get("folder_name", {}).get("patterns", []), folders)

        elif step == "dxf_annotation":
            source = ResolveSource.DXF_ANNOTATION
            found = _search(rules.get("dxf_annotation", {}).get("patterns", []), ctx.texts)

        else:
            result.attempts.append(Attempt(step, False, note="неизвестный резолвер"))
            continue

        if found is None:
            result.attempts.append(Attempt(step, False, note="совпадений нет"))
            continue

        raw_value, pattern, matched_text = found
        pattern_name = pattern.get("name")
        confidence = float(pattern.get("confidence", 0.5))

        snapped = _snap(raw_value, known, tolerance)
        if snapped is not None:
            value, is_known = snapped, True
            note = f"найдено «{matched_text}» → {value} мм"
        else:
            # Список толщин расширяемый: незнакомое, но правдоподобное число
            # не отбрасываем, а понижаем доверие и отправляем на подтверждение.
            value, is_known = raw_value, False
            confidence *= penalty
            note = (
                f"найдено «{matched_text}» → {value} мм, "
                "такой толщины нет в справочнике материалов"
            )

        result.attempts.append(
            Attempt(step, True, value=value, pattern=pattern_name,
                    confidence=round(confidence, 3), note=note)
        )
        result.value = value
        result.confidence = confidence
        result.source = source
        result.known = is_known
        break

    result.accepted = (
        result.value is not None
        and result.confidence >= min_confidence
        and (result.known or not require_known)
    )
    return result

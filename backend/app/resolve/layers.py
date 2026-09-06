"""Мастер сопоставления слоёв: применение пресетов и подсказки семантики.

Имена слоёв нигде не зашиты в код. При первом импорте из нового источника
пользователь видит реальные слои файла со статистикой и назначает каждому
смысл; результат сохраняется как именованный пресет и дальше применяется
автоматически по сигнатуре файла.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.core.config_files import layer_presets
from app.dxf.model import LayerInfo
from app.models.enums import LayerSemantic

# Диаметры, характерные для мебельной присадки. Только для ПОДСКАЗКИ
# в мастере — решение всё равно принимает пользователь.
_DRILL_HINT_DIAMETERS = (5.0, 8.0, 10.0, 15.0, 20.0, 26.0, 35.0)
_DRILL_HINT_TOLERANCE = 0.6


@dataclass(slots=True)
class LayerMapping:
    semantic_by_layer: dict[str, str] = field(default_factory=dict)
    unmapped: list[str] = field(default_factory=list)
    preset_name: str | None = None
    thickness_regex: str | None = None
    # Для слоёв этого пресета вложенность определяется по площади, а не по слою.
    resolve_nesting_by_area: bool = False

    def as_dict(self) -> dict:
        return {
            "semantic_by_layer": self.semantic_by_layer,
            "unmapped": self.unmapped,
            "preset_name": self.preset_name,
            "thickness_regex": self.thickness_regex,
            "resolve_nesting_by_area": self.resolve_nesting_by_area,
        }


def builtin_presets() -> list[dict]:
    """Стартовые пресеты из конфига. Сохранённые в БД имеют приоритет."""
    return list(layer_presets().get("presets", []) or [])


def semantics_catalog() -> dict[str, dict]:
    """Справочник семантик с описанием обработки — для UI мастера."""
    return dict(layer_presets().get("semantics", {}) or {})


def apply_preset(layer_names: list[str], preset: dict | None) -> LayerMapping:
    """Применяет пресет к списку слоёв файла."""
    mapping = LayerMapping()
    if not preset:
        mapping.unmapped = list(layer_names)
        return mapping

    mapping.preset_name = preset.get("name")
    mapping.thickness_regex = preset.get("thickness_from_layer_regex")
    rules = preset.get("rules", []) or []

    for name in layer_names:
        semantic = None
        for rule in rules:
            # Правило может быть задано точным именем слоя или регуляркой.
            exact = rule.get("layer")
            pattern = rule.get("regex")
            if exact is not None and exact == name:
                semantic = rule.get("semantic")
            elif pattern and re.search(pattern, name):
                semantic = rule.get("semantic")
            if semantic is not None:
                if rule.get("resolve_nesting_by_area"):
                    mapping.resolve_nesting_by_area = True
                break
        if semantic is None:
            mapping.unmapped.append(name)
        else:
            mapping.semantic_by_layer[name] = semantic
    return mapping


def preset_for_source(source: str, presets: list[dict] | None = None) -> dict | None:
    for preset in presets if presets is not None else builtin_presets():
        if preset.get("source") == source:
            return preset
    return None


def suggest_semantics(layers: list[LayerInfo]) -> dict[str, str]:
    """Подсказки для мастера: что этот слой, скорее всего, означает.

    Подсказка строится по геометрии слоя, а не только по имени — именно
    поэтому она работает и для Fusion, где имена слоёв ни о чём не говорят.
    Пользователь видит подсказку предзаполненной и может её изменить.
    """
    suggestions: dict[str, str] = {}
    if not layers:
        return suggestions

    geometric = [layer for layer in layers if layer.bbox is not None]
    widest = max(
        geometric,
        key=lambda layer: (layer.bbox[2] - layer.bbox[0]) * (layer.bbox[3] - layer.bbox[1]),
        default=None,
    )

    for layer in layers:
        if layer.count == layer.texts and layer.texts > 0:
            suggestions[layer.name] = LayerSemantic.INFO
            continue

        if layer.circles and layer.circles == layer.count:
            looks_like_drilling = all(
                any(
                    abs(d - hint) <= _DRILL_HINT_TOLERANCE
                    for hint in _DRILL_HINT_DIAMETERS
                )
                for d in layer.circle_diameters
            )
            suggestions[layer.name] = (
                LayerSemantic.DRILL if looks_like_drilling else LayerSemantic.INNER
            )
            continue

        if layer is widest and layer.closed_paths:
            suggestions[layer.name] = LayerSemantic.OUTER
            continue

        if layer.closed_paths:
            suggestions[layer.name] = LayerSemantic.INNER
            continue

        suggestions[layer.name] = LayerSemantic.GROOVE

    return suggestions


def preview_paths(primitives, layer_name: str, limit: int = 400) -> list[list[list[float]]]:
    """Геометрия одного слоя для превью в мастере: что подсветится,
    если выбрать этот слой."""
    paths: list[list[list[float]]] = []
    for prim in primitives:
        if prim.layer != layer_name or not prim.points:
            continue
        paths.append([[round(x, 3), round(y, 3)] for x, y in prim.points])
        if len(paths) >= limit:
            break
    return paths

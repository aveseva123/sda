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
from app.dxf.layer_meta import (
    LayerMeta,
    looks_like_drill,
    parse_layer_attributes,
)
from app.dxf.model import LayerInfo
from app.models.enums import LayerSemantic


@dataclass(slots=True)
class LayerMapping:
    semantic_by_layer: dict[str, str] = field(default_factory=dict)
    meta: dict[str, LayerMeta] = field(default_factory=dict)
    unmapped: list[str] = field(default_factory=list)
    preset_name: str | None = None
    thickness_regex: str | None = None
    # Для слоёв этого пресета вложенность определяется по площади, а не по слою.
    resolve_nesting_by_area: bool = False

    def depth_of(self, layer: str) -> float | None:
        entry = self.meta.get(layer)
        return entry.depth if entry else None

    def as_dict(self) -> dict:
        return {
            "semantic_by_layer": self.semantic_by_layer,
            "meta": {name: entry.as_dict() for name, entry in self.meta.items()},
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
        matched: dict = {}
        for rule in rules:
            # Правило может быть задано точным именем слоя или регуляркой.
            exact = rule.get("layer")
            pattern = rule.get("regex")
            if exact is not None and exact == name:
                semantic = rule.get("semantic")
            elif pattern and re.search(pattern, name):
                semantic = rule.get("semantic")
            if semantic is not None:
                matched = rule
                if rule.get("resolve_nesting_by_area"):
                    mapping.resolve_nesting_by_area = True
                break
        if semantic is None:
            mapping.unmapped.append(name)
            continue

        mapping.semantic_by_layer[name] = semantic
        attributes = parse_layer_attributes(name)
        mapping.meta[name] = LayerMeta(
            name=name,
            semantic=semantic,
            depth=attributes.get("depth"),
            hole_diameter=attributes.get("hole_diameter"),
            circles_as_drill=bool(matched.get("circles_as_drill")),
        )
    return mapping


def preset_for_source(source: str, presets: list[dict] | None = None) -> dict | None:
    for preset in presets if presets is not None else builtin_presets():
        if preset.get("source") == source:
            return preset
    return None


def suggest_semantics(layers: list[LayerInfo]) -> dict[str, str]:
    """Подсказки для мастера: что этот слой, скорее всего, означает.

    Нужны там, где пресета ещё нет и имена слоёв ни о чём не говорят
    (Fusion кладёт всё в слой ``0``). Опора — геометрия слоя и то, что
    источник сам написал в имя слоя по регуляркам из конфига:

      * только текст                          -> метаданные;
      * в имени объявлен диаметр отверстия,
        либо слой состоит из окружностей
        мебельных диаметров                   -> присадка;
      * крупнейший контур без глубины, и в
        чертеже есть что-то ещё               -> контур листа;
      * глубина меньше максимальной И слой
        лежит внутри сквозного слоя           -> выборка, не насквозь;
      * габарит вложен в габарит другого слоя -> внутренний вырез;
      * остальное с замкнутыми контурами      -> внешний контур.

    Это именно подсказки: пользователь видит их предзаполненными и меняет.
    """
    suggestions: dict[str, str] = {}
    if not layers:
        return suggestions

    def area_of(layer: LayerInfo) -> float:
        if layer.bbox is None:
            return 0.0
        return (layer.bbox[2] - layer.bbox[0]) * (layer.bbox[3] - layer.bbox[1])

    attributes = {layer.name: parse_layer_attributes(layer.name) for layer in layers}
    depths = {name: attr.get("depth") for name, attr in attributes.items()}
    known_depths = [d for d in depths.values() if d is not None]
    max_depth = max(known_depths) if known_depths else None

    drill_layers = {
        layer.name
        for layer in layers
        if "hole_diameter" in attributes[layer.name] or _looks_like_drill_layer(layer)
    }

    geometric = [
        layer for layer in layers if layer.bbox is not None and layer.name not in drill_layers
    ]

    # Контур листа: крупнейший слой без глубины в имени и с небольшим числом
    # замкнутых контуров — листов на чертеже единицы, деталей десятки.
    # Единственный слой чертежа листом быть не может: тогда деталей не осталось бы.
    sheet_layer = None
    if len(geometric) > 1:
        candidates = [
            layer
            for layer in geometric
            if depths[layer.name] is None
            and layer.closed_paths
            and layer.closed_paths <= 8
        ]
        sheet_layer = max(candidates, key=area_of, default=None)

    body_layers = [layer for layer in geometric if layer is not sheet_layer]

    for layer in layers:
        if layer.count == layer.texts and layer.texts > 0:
            suggestions[layer.name] = LayerSemantic.INFO
            continue

        if layer.name in drill_layers:
            suggestions[layer.name] = LayerSemantic.DRILL
            continue

        if layer is sheet_layer:
            suggestions[layer.name] = LayerSemantic.SHEET
            continue

        depth = depths[layer.name]
        if depth is not None and max_depth is not None and depth < max_depth - 0.5:
            # Выборка обязана лежать внутри того, что режется насквозь.
            # Иначе это не мелкая обработка, а сквозной рез на ДРУГОМ листе:
            # в одном чертеже соседствуют лист 18 мм и лист 4 мм, и «4 < 18»
            # само по себе ничего не значит.
            through = [
                other
                for other in body_layers
                if other is not layer
                and depths[other.name] is not None
                and depths[other.name] >= max_depth - 0.5
            ]
            if any(_bbox_overlaps(other.bbox, layer.bbox) for other in through):
                suggestions[layer.name] = LayerSemantic.POCKET
                continue

        # Окружность — тоже замкнутый контур: круглая деталь ⌀268 приходит
        # одной окружностью, а не полилинией.
        if not layer.closed_paths and not layer.circles:
            suggestions[layer.name] = LayerSemantic.GROOVE
            continue

        # Габарит слоя целиком лежит внутри габарита другого слоя деталей —
        # значит, это вырезы внутри тех деталей, а не сами детали.
        if any(
            other is not layer and _bbox_contains(other.bbox, layer.bbox)
            for other in body_layers
        ):
            suggestions[layer.name] = LayerSemantic.INNER
            continue

        suggestions[layer.name] = LayerSemantic.OUTER

    return suggestions


def _looks_like_drill_layer(layer: LayerInfo) -> bool:
    """Слой только из окружностей мебельных диаметров — это присадка."""
    if not layer.circles or layer.circles != layer.count:
        return False
    if not layer.circle_diameters:
        return False
    return all(looks_like_drill(d) for d in layer.circle_diameters)


def _bbox_overlaps(a, b) -> bool:
    if a is None or b is None:
        return False
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _bbox_contains(outer, inner) -> bool:
    if outer is None or inner is None:
        return False
    return (
        outer[0] <= inner[0]
        and outer[1] <= inner[1]
        and outer[2] >= inner[2]
        and outer[3] >= inner[3]
        and (outer[2] - outer[0]) * (outer[3] - outer[1])
        > (inner[2] - inner[0]) * (inner[3] - inner[1])
    )


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

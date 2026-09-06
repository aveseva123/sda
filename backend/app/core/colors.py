"""Цветовая система: проект → цвет, изделие → оттенок и штриховка.

Требование ТЗ: различимость не должна опираться только на оттенок, иначе
карта раскроя нечитаема для дальтоников и в ч/б печати. Поэтому:
  * проект получает цвет из палитры Окабэ–Ито (проверена на дейтеранопию,
    протанопию и тританопию);
  * изделие внутри проекта получает и осветление/затемнение базового цвета,
    и собственную штриховку — паттерн читается даже без цвета.
"""

from __future__ import annotations

# Палитра Окабэ–Ито без чёрного: заливки должны оставаться различимыми.
PROJECT_PALETTE: tuple[str, ...] = (
    "#0072B2",  # синий
    "#E69F00",  # оранжевый
    "#009E73",  # зелёный
    "#CC79A7",  # розово-пурпурный
    "#56B4E9",  # голубой
    "#D55E00",  # киноварь
    "#F0E442",  # жёлтый
    "#8C564B",  # коричневый
    "#7F3C8D",  # фиолетовый
    "#3B7C70",  # тёмно-бирюзовый
)

# Штриховки изделий. Порядок важен: первое изделие проекта остаётся сплошным,
# чтобы самый частый случай был самым читаемым.
PRODUCT_PATTERNS: tuple[str, ...] = (
    "solid",
    "diagonal",
    "cross",
    "dots",
    "horizontal",
    "vertical",
    "diagonal-back",
    "grid",
)

# Коэффициенты осветления/затемнения по индексу изделия.
_SHADE_STEPS: tuple[float, ...] = (0.0, 0.18, -0.18, 0.34, -0.32, 0.5, -0.45, 0.62)


def project_color(color_index: int) -> str:
    return PROJECT_PALETTE[color_index % len(PROJECT_PALETTE)]


def next_color_index(used: list[int]) -> int:
    """Первый свободный индекс палитры; после исчерпания — по кругу."""
    taken = set(used)
    for i in range(len(PROJECT_PALETTE)):
        if i not in taken:
            return i
    return len(used) % len(PROJECT_PALETTE)


def product_pattern(shade_index: int) -> str:
    return PRODUCT_PATTERNS[shade_index % len(PRODUCT_PATTERNS)]


def product_color(base_hex: str, shade_index: int) -> str:
    """Оттенок базового цвета проекта для конкретного изделия."""
    return _adjust(base_hex, _SHADE_STEPS[shade_index % len(_SHADE_STEPS)])


def _adjust(hex_color: str, amount: float) -> str:
    """amount > 0 — осветление к белому, < 0 — затемнение к чёрному."""
    r, g, b = _to_rgb(hex_color)
    if amount >= 0:
        r = r + (255 - r) * amount
        g = g + (255 - g) * amount
        b = b + (255 - b) * amount
    else:
        factor = 1.0 + amount
        r, g, b = r * factor, g * factor, b * factor
    channels = (
        int(round(max(0, min(255, r)))),
        int(round(max(0, min(255, g)))),
        int(round(max(0, min(255, b)))),
    )
    return "#{:02X}{:02X}{:02X}".format(*channels)


def _to_rgb(hex_color: str) -> tuple[float, float, float]:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Некорректный цвет: {hex_color}")
    return (
        float(int(value[0:2], 16)),
        float(int(value[2:4], 16)),
        float(int(value[4:6], 16)),
    )


def contrast_text_color(hex_color: str) -> str:
    """Цвет подписи поверх заливки — по относительной яркости."""
    r, g, b = _to_rgb(hex_color)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return "#000000" if luminance > 0.6 else "#FFFFFF"


def product_style(base_hex: str, shade_index: int) -> dict:
    """Полный стиль изделия для карты раскроя, легенды и стикера."""
    fill = product_color(base_hex, shade_index)
    return {
        "fill": fill,
        "pattern": product_pattern(shade_index),
        "stroke": _adjust(base_hex, -0.35),
        "text": contrast_text_color(fill),
    }

"""Цветовая система: цвет закреплён за файлом, штриховка — за листом в файле.

Так устроен макет «Нестор»: в раскрое рядом лежат детали из разных DXF, и
вопрос «откуда эта деталь» — это вопрос «из какого файла». Проектов,
изделий и клиентов в платформе нет: заказ — это просто имя.

Штриховкой размечается номер листа ВНУТРИ файла. Файл на 3 листа даёт три
разных штриховки одного цвета, и на карте раскроя видно не только «чей это
кусок», но и «с какого листа исходника он приехал».

Палитра Окабэ–Ито: различима при дальтонизме и в чёрно-белой печати,
поэтому принадлежность читается не только по оттенку.
"""

from __future__ import annotations

# Палитра файлов. Без чёрного: заливки должны оставаться различимыми.
FILE_PALETTE: tuple[str, ...] = (
    "#7D82C5",  # сине-фиолетовый
    "#23AC74",  # зелёный
    "#9D3725",  # терракота
    "#861CB4",  # фиолетовый
    "#0072B2",  # синий
    "#E69F00",  # оранжевый
    "#CC79A7",  # розово-пурпурный
    "#56B4E9",  # голубой
    "#D55E00",  # киноварь
    "#3B7C70",  # тёмно-бирюзовый
)

# Штриховки листов внутри файла. Первый лист остаётся сплошным: самый
# частый случай должен быть самым читаемым.
SHEET_PATTERNS: tuple[str, ...] = (
    "solid",
    "diagonal",
    "cross",
    "dots",
    "horizontal",
    "vertical",
    "diagonal-back",
    "grid",
)

# Осветление/затемнение по номеру листа — вдобавок к штриховке.
_SHADE_STEPS: tuple[float, ...] = (0.0, 0.14, -0.14, 0.26, -0.24, 0.38, -0.34, 0.48)


def file_color(color_index: int) -> str:
    return FILE_PALETTE[color_index % len(FILE_PALETTE)]


def next_color_index(used: list[int]) -> int:
    """Первый свободный индекс палитры; после исчерпания — по кругу."""
    taken = set(used)
    for i in range(len(FILE_PALETTE)):
        if i not in taken:
            return i
    return len(used) % len(FILE_PALETTE)


def sheet_pattern(sheet_index: int) -> str:
    return SHEET_PATTERNS[sheet_index % len(SHEET_PATTERNS)]


def sheet_color(base_hex: str, sheet_index: int) -> str:
    """Оттенок цвета файла для конкретного листа внутри него."""
    return _adjust(base_hex, _SHADE_STEPS[sheet_index % len(_SHADE_STEPS)])


def part_style(base_hex: str, sheet_index: int = 0) -> dict:
    """Полный стиль детали для холста, легенды и стикера."""
    fill = sheet_color(base_hex, sheet_index)
    return {
        "fill": fill,
        "pattern": sheet_pattern(sheet_index),
        "stroke": _adjust(base_hex, -0.35),
        "text": contrast_text_color(fill),
    }


def contrast_text_color(hex_color: str) -> str:
    """Цвет подписи поверх заливки — по относительной яркости."""
    r, g, b = _to_rgb(hex_color)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return "#000000" if luminance > 0.6 else "#FFFFFF"


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

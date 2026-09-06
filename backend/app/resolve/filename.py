"""Разбор имён файлов по настраиваемому шаблону.

Критично для Fusion 360: он не пишет в DXF ни проекта, ни изделия, поэтому
метаданные едут в имени файла. Шаблон, разделитель и порядок полей
настраиваются в ``config/filename_templates.yaml``. Если ни один шаблон не
совпал — деталь идёт в очередь «требует уточнения», а не угадывается.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PurePosixPath

from app.core.config_files import app_config, filename_templates

# Старые имена полей продолжают работать: конфиги у заказчика уже написаны.
_FIELD_ALIASES = {"project": "order", "product": "group"}


@dataclass(slots=True)
class FilenameParse:
    template: str | None = None
    # Заказ — просто имя. Группа — необязательная подпапка смысла внутри заказа.
    order: str | None = None
    group: str | None = None
    part: str | None = None
    thickness: float | None = None
    qty: int | None = None
    # Почему не совпало — показывается технологу в очереди уточнений.
    tried: list[str] = field(default_factory=list)

    @property
    def matched(self) -> bool:
        return self.template is not None

    def as_dict(self) -> dict:
        return {
            "template": self.template,
            "order": self.order,
            "group": self.group,
            "part": self.part,
            "thickness": self.thickness,
            "qty": self.qty,
            "tried": self.tried,
        }


def _humanize(value: str) -> str:
    return value.replace("-", " ").replace("_", " ").strip()


def _plausible_thickness(value: float) -> bool:
    cfg = app_config().get("thicknesses", {})
    return float(cfg.get("min", 3)) <= value <= float(cfg.get("max", 60))


def parse_filename(filename: str, *, template_name: str | None = None) -> FilenameParse:
    """Разбирает имя файла по шаблонам из конфига.

    ``template_name`` фиксирует шаблон для всей загрузки; без него шаблоны
    перебираются по порядку и выигрывает первый полностью совпавший.
    """
    cfg = filename_templates()
    templates = cfg.get("templates", []) or []
    normalize = cfg.get("normalize", {}) or {}
    humanize_fields = {
        _FIELD_ALIASES.get(f, f) for f in normalize.get("humanize_fields", []) or []
    }
    qty_min = int(normalize.get("qty_min", 1))
    qty_max = int(normalize.get("qty_max", 999))

    stem = PurePosixPath(filename.replace("\\", "/")).stem
    result = FilenameParse()

    if template_name:
        templates = [t for t in templates if t.get("name") == template_name] or templates
    else:
        default = cfg.get("default")
        if default:
            templates = sorted(templates, key=lambda t: t.get("name") != default)

    for tpl in templates:
        name = tpl.get("name", "?")
        delimiter = tpl.get("delimiter", "_")
        fields = [_FIELD_ALIASES.get(f, f) for f in tpl.get("fields", [])]
        required = set(tpl.get("required", []) or [])
        chunks = stem.split(delimiter)

        if len(chunks) != len(fields):
            result.tried.append(
                f"{name}: ожидалось полей {len(fields)}, в имени {len(chunks)}"
            )
            continue

        values = dict(zip(fields, chunks, strict=True))

        thickness: float | None = None
        if "thickness" in fields:
            raw = values["thickness"].replace(",", ".")
            try:
                thickness = float(raw)
            except ValueError:
                result.tried.append(f"{name}: «{raw}» не число в поле толщины")
                continue
            if not _plausible_thickness(thickness):
                result.tried.append(
                    f"{name}: толщина {thickness} вне диапазона правдоподобия"
                )
                continue

        qty: int | None = None
        if "qty" in fields:
            try:
                qty = int(values["qty"])
            except ValueError:
                result.tried.append(f"{name}: «{values['qty']}» не целое в поле количества")
                continue
            if not qty_min <= qty <= qty_max:
                result.tried.append(f"{name}: количество {qty} вне допустимого диапазона")
                continue

        if any(not values.get(f, "").strip() for f in required):
            result.tried.append(f"{name}: пустое обязательное поле")
            continue

        result.template = name
        result.thickness = thickness
        result.qty = qty
        for key in ("order", "group", "part"):
            raw = values.get(key)
            if raw is None:
                continue
            setattr(result, key, _humanize(raw) if key in humanize_fields else raw)
        return result

    return result

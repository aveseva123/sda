"""Схема и загрузка настроек по умолчанию (``resources/defaults.yaml``).

Конфиги читаются только через ``yaml.safe_load`` — никакого ``eval`` (раздел 4 ТЗ).
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, PositiveFloat

from cam.core.paths import resources_dir

DEFAULTS_FILE_NAME = "defaults.yaml"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class GeometryDefaults(_StrictModel):
    chord_tolerance_mm: PositiveFloat
    stitch_tolerance_mm: PositiveFloat
    min_segment_length_mm: PositiveFloat


class StorageDefaults(_StrictModel):
    backups_keep: int = Field(ge=0)


class UiDefaults(_StrictModel):
    font_point_size: int = Field(ge=6, le=48)
    window_title: str = Field(min_length=1)


class AppDefaults(_StrictModel):
    geometry: GeometryDefaults
    storage: StorageDefaults
    ui: UiDefaults


class ConfigError(ValueError):
    """Ошибка чтения или валидации конфига."""


def defaults_path() -> Path:
    return resources_dir() / DEFAULTS_FILE_NAME


def load_defaults(path: Path | None = None) -> AppDefaults:
    """Прочитать и провалидировать ``defaults.yaml``.

    Любая ошибка схемы — исключение с указанием файла: тихих подстановок нет.
    """
    file = path or defaults_path()
    try:
        raw = yaml.safe_load(file.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не удалось прочитать конфиг {file}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"Конфиг {file}: ожидался словарь верхнего уровня")
    try:
        return AppDefaults.model_validate(raw)
    except ValueError as exc:
        raise ConfigError(f"Конфиг {file} не прошёл проверку:\n{exc}") from exc

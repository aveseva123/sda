"""Загрузка YAML-конфигов.

Вся настраиваемая логика платформы живёт в ``config/*.yaml``: толщины,
карты слоёв, шаблоны имён файлов, правила глубин, диалект постпроцессора.
Код читает эти файлы и не дублирует их значения константами — это
требование ТЗ: заказчик должен менять поведение, не трогая исходники.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import yaml

from app.core.settings import get_settings

_cache: dict[str, Any] = {}
_lock = threading.Lock()


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Не найден конфиг: {path}")
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load(name: str, *, refresh: bool = False) -> dict[str, Any]:
    """Читает ``config/<name>.yaml`` с кэшированием.

    ``name`` может содержать подкаталог: ``post/daihong_ncstudio``.
    """
    with _lock:
        if refresh or name not in _cache:
            _cache[name] = _read(get_settings().config_dir / f"{name}.yaml")
        return _cache[name]


def reload_all() -> None:
    """Сбрасывает кэш — вызывается после правки конфигов из UI."""
    with _lock:
        _cache.clear()


def app_config() -> dict[str, Any]:
    return load("app")


def thickness_rules() -> dict[str, Any]:
    return load("thickness_rules")


def layer_presets() -> dict[str, Any]:
    return load("layer_presets")


def filename_templates() -> dict[str, Any]:
    return load("filename_templates")


def depth_rules() -> dict[str, Any]:
    return load("depth_rules")


def geometry_config() -> dict[str, Any]:
    return app_config().get("geometry", {})

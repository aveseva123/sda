# -*- coding: utf-8 -*-
"""Настройки: settings.json рядом с add-in. Загрузка сливается с DEFAULT_SETTINGS,
чтобы новые ключи появлялись автоматически, а старые значения пользователя сохранялись."""
import copy
import json
import os

from .. import config


def _merge(base, override):
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load(path=None):
    path = path or config.SETTINGS_FILE
    data = {}
    try:
        if os.path.isfile(path):
            with open(path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
    except Exception:
        data = {}
    return _merge(config.DEFAULT_SETTINGS, data)


def save(settings, path=None):
    """Сохраняет настройки. Если папка add-in недоступна для записи — кладёт файл
    в папку пользователя и возвращает фактический путь."""
    path = path or config.SETTINGS_FILE
    candidates = [path, os.path.join(os.path.expanduser('~'), '.' + config.ADDIN_NAME + '.settings.json')]
    last_error = None
    for candidate in candidates:
        try:
            with open(candidate, 'w', encoding='utf-8') as fh:
                json.dump(settings, fh, ensure_ascii=False, indent=2)
            return candidate
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise last_error


def split_list(text):
    """'_, tmp_ ;HW_' -> ['_', 'tmp_', 'HW_']"""
    items = []
    for chunk in str(text or '').replace(';', ',').split(','):
        chunk = chunk.strip()
        if chunk:
            items.append(chunk)
    return items


def join_list(items):
    return ', '.join(items or [])

# -*- coding: utf-8 -*-
"""Настройка окружения тестов: папка fusion/ в sys.path (пакет FL_Prep),
и заглушка adsk, если настоящий модуль Fusion недоступен."""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ADDIN_DIR = os.path.dirname(_HERE)
_FUSION_DIR = os.path.dirname(_ADDIN_DIR)
# Папка add-in не должна быть в sys.path: иначе «import FL_Prep» найдёт файл FL_Prep.py,
# а не пакет-папку FL_Prep/ (как это делает Fusion при загрузке add-in).
sys.path[:] = [p for p in sys.path if os.path.abspath(p or os.getcwd()) != _ADDIN_DIR]
if _FUSION_DIR not in sys.path:
    sys.path.insert(0, _FUSION_DIR)
try:
    import adsk.core  # noqa: F401
except ImportError:
    sys.path.insert(0, os.path.join(_HERE, 'fake_adsk'))

# -*- coding: utf-8 -*-
"""Единицы: Fusion API работает в сантиметрах, add-in снаружи показывает миллиметры.
Чистые функции, без adsk."""


def cm_to_mm(value_cm):
    return float(value_cm) * 10.0


def mm_to_cm(value_mm):
    return float(value_mm) / 10.0


def fmt_mm(value_mm, digits=1):
    """Форматирует миллиметры для отчёта: 1200.0 -> '1200', 16.04 -> '16'."""
    v = round(float(value_mm), digits)
    if abs(v - round(v)) < 10 ** (-digits):
        return str(int(round(v)))
    return ('{:.%df}' % digits).format(v)

# -*- coding: utf-8 -*-
"""Проба preview/скрытого API в рантайме. Ничего не вызывает с побочными эффектами —
только hasattr и безопасные чтения. Результат: словарь имя -> (доступно, примечание)."""
import adsk.core
import adsk.fusion

from . import log

try:
    import adsk.drawing as _drawing_mod
except Exception:  # noqa: BLE001
    _drawing_mod = None


def _safe(fn, default=False):
    try:
        return bool(fn())
    except Exception:  # noqa: BLE001
        return default


def probe(design):
    caps = {}

    # Drawing API (скрытый, появился в заголовках April 2026)
    if _drawing_mod is not None:
        caps['adsk.drawing'] = (True, 'модуль импортируется')
        has_mgr = hasattr(_drawing_mod, 'DrawingManager')
        caps['adsk.drawing.DrawingManager'] = (
            has_mgr, 'создание чертежа через API' if has_mgr else 'скрытый API отсутствует в этой сборке — шаг 7 через штатную команду')
        has_input = hasattr(_drawing_mod, 'CreateDrawingInput')
        caps['adsk.drawing.CreateDrawingInput'] = (has_input, '')
    else:
        caps['adsk.drawing'] = (False, 'модуль не импортируется')
        caps['adsk.drawing.DrawingManager'] = (False, '')
        caps['adsk.drawing.CreateDrawingInput'] = (False, '')

    # Animation API (в стабах с May 2026, не документирован)
    has_am = hasattr(adsk.fusion.Design, 'animationManager') and _safe(lambda: design.animationManager is not None)
    caps['Design.animationManager'] = (has_am, 'доступ к раскадровкам' if has_am else 'шаг 6, вариант B недоступен — только C')
    has_sb_add = has_am and _safe(lambda: hasattr(design.animationManager.storyboards, 'add'))
    caps['Storyboards.add'] = (has_sb_add, '')
    caps['Storyboard actions (transform/explode)'] = (False, 'в API нет — вариант A невозможен')

    # OBB и толщина
    has_obb = hasattr(adsk.fusion.BRepBody, 'orientedMinimumBoundingBox')
    caps['BRepBody.orientedMinimumBoundingBox'] = (has_obb, 'минимальный OBB' if has_obb else 'запасной расчёт OBB по вершинам')
    has_thk = hasattr(adsk.fusion.BRepBody, 'findThicknessAtFace')
    caps['BRepBody.findThicknessAtFace'] = (has_thk, 'preview' if has_thk else 'толщина из OBB')

    # Виды и позиции
    caps['NamedViews.add'] = (hasattr(adsk.core.NamedViews, 'add'), '')
    caps['Design.snapshots'] = (hasattr(adsk.fusion.Design, 'snapshots'), '')

    # Файлы
    caps['DataFile.copy'] = (hasattr(adsk.core.DataFile, 'copy'), '')
    caps['DataFile.copyWithInput'] = (hasattr(adsk.core.DataFile, 'copyWithInput'), 'preview: копия без чертежей')

    for name, (ok, note) in caps.items():
        log.debug('capability {}: {} {}'.format(name, ok, note))
    return caps


def fill_report(report, caps):
    for name, (ok, note) in caps.items():
        report.capability(name, ok, note)

# -*- coding: utf-8 -*-
"""Оркестрация шагов. Вызывается из execute-обработчика команды."""
import datetime

from . import audit
from . import capabilities
from . import exporter
from . import geom_pure as gp
from . import log
from .report import Report

STEP_TITLES = {
    1: 'Аудит', 2: 'Нормализация структуры', 3: 'Свойства для спецификации', 4: 'Очистка видимости',
    5: 'Ориентация и виды', 6: 'Взрыв-схема', 7: 'Создание чертежа', 8: 'Отчёт',
    9: 'Экспорт пакета для генератора чертежей',
}
STEP_KEYS = {1: 'audit', 2: 'normalize', 3: 'props', 4: 'visibility', 5: 'views', 6: 'explode', 7: 'drawing',
             8: 'report', 9: 'export'}
STEP_ORDER = (1, 2, 3, 4, 5, 6, 7, 9)   # шаг 8 (отчёт) всегда последний
IMPLEMENTED = {1, 8, 9}


class NullProgress(object):
    def update(self, value, maximum, message=''):
        return False  # True = отмена

    def finish(self):
        pass


def resolve_project_code(settings, document_name):
    code = (settings.get('project_code') or '').strip()
    if code:
        return code
    return gp.parse_project_code(document_name) or (document_name or 'noname')


def run(design, document, settings, progress=None):
    """Выполняет включённые шаги. Возвращает (report, html_path, csv_path)."""
    progress = progress or NullProgress()
    doc_name = ''
    try:
        doc_name = document.name
    except Exception:  # noqa: BLE001
        pass
    code = resolve_project_code(settings, doc_name)
    report = Report(code, doc_name, dry_run=settings.get('dry_run', True))
    report.settings_used = {
        'Код проекта': code,
        'dry-run': settings.get('dry_run', True),
        'Режим разнесения': settings.get('explode_mode'),
        'Коэффициент разнесения': settings.get('explode_factor'),
        'Мин. зазор, мм': settings.get('explode_min_gap_mm'),
        'Уровень подсборок': settings.get('explode_subassembly_level'),
        'Префиксы помощников': ', '.join(settings.get('helper_prefixes', [])),
        'Префиксы фурнитуры': ', '.join(settings.get('hardware_prefixes', [])),
        'Допуск дублей, мм': settings.get('duplicate_tol_mm'),
    }
    log.info('Запуск FL_Prep для «{}», код {}'.format(doc_name, code))

    caps = capabilities.probe(design)
    capabilities.fill_report(report, caps)

    steps = settings.get('steps', {})
    measures = {}
    export_path = None
    for step in STEP_ORDER:
        if not steps.get(STEP_KEYS[step]):
            continue
        if step not in IMPLEMENTED:
            report.skip(step, '{}: шаг будет реализован на следующем этапе'.format(STEP_TITLES[step]))
            continue
        try:
            if step == 1:
                measures = audit.run(design, document, settings, caps, report, progress)
            elif step == 9:
                export_path = exporter.run(design, document, settings, caps, report, progress, code)
        except Exception as exc:  # noqa: BLE001
            log.error('Шаг {} завершился ошибкой: {}'.format(step, exc))
            report.error(step, 'X00_internal', 'Внутренняя ошибка шага: {}'.format(exc))

    html_path = csv_path = None
    if steps.get('report', True):
        html_path, csv_path = report.write(settings.get('report_folder') or '.', datetime.datetime.now())
        log.info('Отчёт: {}'.format(html_path))
    progress.finish()
    report.export_path = export_path
    return report, html_path, csv_path

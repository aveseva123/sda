# -*- coding: utf-8 -*-
"""Константы add-in и значения по умолчанию для всех настраиваемых мест.

Все [ВСТАВЬ]-места из ТЗ собраны здесь, чтобы их можно было поменять в одном файле
(и/или через диалог — значения диалога сохраняются в settings.json рядом с add-in).
"""
import os

ADDIN_NAME = 'FL_Prep'
ADDIN_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_DIR = os.path.join(ADDIN_DIR, 'resources')
SETTINGS_FILE = os.path.join(ADDIN_DIR, 'settings.json')
LOG_DIR = os.path.join(ADDIN_DIR, 'logs')

# Идентификаторы UI
WORKSPACE_ID = 'FusionSolidEnvironment'
TAB_ID = 'ToolsTab'                      # вкладка UTILITIES
PANEL_ID = 'FL_PrepPanel'
PANEL_NAME = 'FL Prep'
PREP_CMD_ID = 'FL_Prep_PrepareCmd'
PREP_CMD_NAME = 'Подготовка к чертежам'
PREP_CMD_DESC = ('Аудит и подготовка модели изделия к сборочному чертежу, '
                 'взрыв-схеме и деталировке')
SELECT_CMD_ID = 'FL_Prep_SelectByTokenCmd'
SELECT_CMD_NAME = 'Выделить по токену'
SELECT_CMD_DESC = 'Выделяет в модели деталь по токену из отчёта FL_Prep'

# Группа атрибутов, которые пишет этот add-in
ATTR_GROUP = 'FL_PREP'

# Значения по умолчанию (переопределяются settings.json и диалогом)
DEFAULT_SETTINGS = {
    # Шаги пайплайна
    'steps': {
        'audit': True, 'normalize': False, 'props': False, 'visibility': False,
        'views': False, 'explode': False, 'drawing': False, 'report': True,
    },
    'dry_run': True,
    'open_report': True,

    # Код проекта: если пусто — определяется из имени документа (например «37-4»)
    'project_code': '',
    # Схема Part Number: {code} — код проекта, {view} — номер вида, {n} — № детали
    'part_number_template': '{code}-{view}-{n:02d}',
    # Группа атрибутов ваших скриптов (нумерация, кромка). Пусто — не проверять.
    'external_attr_group': '',

    # Разнесение
    'explode_mode': 'by_normal',          # radial | by_normal | by_axis
    'explode_factor': 1.5,
    'explode_min_gap_mm': 30.0,
    'explode_subassembly_level': 1,

    # Фильтры
    'helper_prefixes': ['_', 'tmp_'],
    'hardware_prefixes': ['HW_', 'Фурнитура', 'Furn_'],
    'hardware_material_keywords': ['фурнитур', 'hardware', 'fastener', 'крепеж'],

    # Допуски аудита
    'duplicate_tol_mm': 0.01,
    'duplicate_rel_tol': 1e-4,

    # Отчёт
    'report_folder': os.path.join(os.path.expanduser('~'), 'Documents', 'FL_Prep_reports'),

    # Справочник материалов: имя, подстроки для поиска в имени материала Fusion, толщины (мм).
    'materials': [
        {'name': 'ЛДСП', 'patterns': ['лдсп', 'ldsp', 'chipboard', 'particle'], 'thicknesses_mm': [16, 18, 25]},
        {'name': 'Фанера', 'patterns': ['фанер', 'plywood', 'birch'], 'thicknesses_mm': [4, 6, 9, 12, 15, 18, 21, 24]},
        {'name': 'МДФ', 'patterns': ['мдф', 'mdf'], 'thicknesses_mm': [6, 8, 10, 12, 16, 18, 19, 22, 25]},
        {'name': 'HPL', 'patterns': ['hpl', 'compact', 'компакт'], 'thicknesses_mm': [0.8, 1, 12]},
        {'name': 'Массив', 'patterns': ['массив', 'solid wood', 'oak', 'ash', 'дуб', 'ясен', 'сосн', 'бук'], 'thicknesses_mm': [20, 25, 30, 40]},
        {'name': 'Нержавейка', 'patterns': ['нерж', 'stainless', 'aisi'], 'thicknesses_mm': [0.8, 1, 1.2, 1.5, 2, 3]},
        {'name': 'Стекло', 'patterns': ['стекл', 'glass'], 'thicknesses_mm': [4, 5, 6, 8, 10]},
    ],
}

# -*- coding: utf-8 -*-
"""Команда «Подготовка к чертежам»: диалог с настройками и запуск пайплайна."""
import os
import pathlib
import webbrowser

import adsk.core
import adsk.fusion

from ... import config
from ...lib import fusion_utils as fu
from ...lib import log
from ...lib import pipeline
from ...lib import settings as settings_mod

_local_handlers = []
_EXPLODE_MODES = [('by_normal', 'по нормали панели (основной для корпусной мебели)'),
                  ('radial', 'радиально от центра сборки'),
                  ('by_axis', 'по ближайшей оси X/Y/Z')]


# ---------------------------------------------------------------- регистрация

def start():
    app, ui = fu.app_and_ui()
    cmd_def = ui.commandDefinitions.itemById(config.PREP_CMD_ID)
    if cmd_def is None:
        cmd_def = ui.commandDefinitions.addButtonDefinition(
            config.PREP_CMD_ID, config.PREP_CMD_NAME, config.PREP_CMD_DESC,
            os.path.join(config.RESOURCES_DIR, 'prep'))
    fu.add_handler(cmd_def.commandCreated, command_created)
    panel = _panel(ui)
    control = panel.controls.itemById(config.PREP_CMD_ID)
    if control is None:
        control = panel.controls.addCommand(cmd_def)
    control.isPromoted = True
    control.isPromotedByDefault = True


def stop():
    app, ui = fu.app_and_ui()
    panel = _panel(ui, create=False)
    if panel is not None:
        control = panel.controls.itemById(config.PREP_CMD_ID)
        if control is not None:
            control.deleteMe()
        if panel.controls.count == 0:
            panel.deleteMe()
    cmd_def = ui.commandDefinitions.itemById(config.PREP_CMD_ID)
    if cmd_def is not None:
        cmd_def.deleteMe()


def _panel(ui, create=True):
    workspace = ui.workspaces.itemById(config.WORKSPACE_ID)
    tab = workspace.toolbarTabs.itemById(config.TAB_ID)
    panel = tab.toolbarPanels.itemById(config.PANEL_ID)
    if panel is None and create:
        panel = tab.toolbarPanels.add(config.PANEL_ID, config.PANEL_NAME, 'SolidScriptsAddinsPanel', False)
    return panel


# ---------------------------------------------------------------- диалог

def command_created(args):
    args = adsk.core.CommandCreatedEventArgs.cast(args)
    cmd = args.command
    cmd.okButtonText = 'Выполнить'
    cmd.isRepeatable = False
    design = fu.active_design()
    if design is None:
        fu.app_and_ui()[1].messageBox('Откройте документ Fusion Design.', 'FL_Prep')
        return
    st = settings_mod.load()
    _build_inputs(cmd.commandInputs, st, design)
    fu.add_handler(cmd.execute, command_execute, _local_handlers)
    fu.add_handler(cmd.destroy, command_destroy, _local_handlers)


def _build_inputs(inputs, st, design):
    steps = st['steps']
    tab_steps = inputs.addTabCommandInput('tab_steps', 'Шаги').children
    tab_steps.addBoolValueInput('dry_run', 'Режим dry-run (только проверка, модель не меняется)', True, '', st['dry_run'])
    doc_name = ''
    try:
        doc_name = design.parentDocument.name
    except Exception:  # noqa: BLE001
        pass
    code_input = tab_steps.addStringValueInput('project_code', 'Код проекта', st['project_code'] or
                                               (pipeline.resolve_project_code(st, doc_name)))
    code_input.tooltip = 'Используется в именах отчёта, раскадровки и чертежа. Пусто — из имени документа.'
    grp = tab_steps.addGroupCommandInput('grp_steps', 'Включить шаги').children
    for number in range(1, 9):
        key = pipeline.STEP_KEYS[number]
        item = grp.addBoolValueInput('step_' + key, '{}. {}'.format(number, pipeline.STEP_TITLES[number]), True, '',
                                     bool(steps.get(key)) if number in pipeline.IMPLEMENTED else False)
        if number not in pipeline.IMPLEMENTED:
            item.isEnabled = False
            item.tooltip = 'Будет реализовано на следующем этапе'

    tab_explode = inputs.addTabCommandInput('tab_explode', 'Разнесение').children
    dd = tab_explode.addDropDownCommandInput('explode_mode', 'Режим', adsk.core.DropDownStyles.TextListDropDownStyle)
    for key, title in _EXPLODE_MODES:
        dd.listItems.add(title, key == st['explode_mode'], '')
    tab_explode.addFloatSpinnerCommandInput('explode_factor', 'Коэффициент разнесения', '', 0.1, 20.0, 0.1,
                                            float(st['explode_factor']))
    tab_explode.addFloatSpinnerCommandInput('explode_min_gap_mm', 'Мин. зазор между деталями, мм', '', 0.0, 2000.0, 5.0,
                                            float(st['explode_min_gap_mm']))
    tab_explode.addIntegerSpinnerCommandInput('explode_subassembly_level', 'Подсборки как целое до уровня', 0, 10, 1,
                                              int(st['explode_subassembly_level']))

    tab_filters = inputs.addTabCommandInput('tab_filters', 'Фильтры').children
    tab_filters.addStringValueInput('helper_prefixes', 'Префиксы помощников (через запятую)',
                                    settings_mod.join_list(st['helper_prefixes']))
    tab_filters.addStringValueInput('hardware_prefixes', 'Префиксы фурнитуры',
                                    settings_mod.join_list(st['hardware_prefixes']))
    tab_filters.addStringValueInput('hardware_material_keywords', 'Материалы фурнитуры (подстроки)',
                                    settings_mod.join_list(st['hardware_material_keywords']))
    tab_filters.addFloatSpinnerCommandInput('duplicate_tol_mm', 'Допуск сравнения дублей, мм', '', 0.001, 5.0, 0.01,
                                            float(st['duplicate_tol_mm']))

    tab_out = inputs.addTabCommandInput('tab_output', 'Вывод').children
    tab_out.addStringValueInput('report_folder', 'Папка отчётов', st['report_folder'])
    tab_out.addBoolValueInput('open_report', 'Открыть HTML-отчёт после выполнения', True, '', st['open_report'])
    note = tab_out.addTextBoxCommandInput('note', '', 'Справочник материалов и шаблон Part Number редактируются в '
                                          'settings.json рядом с add-in. Лог: ' + log.log_file_path(), 4, True)
    note.isFullWidth = True


def _read_inputs(inputs, st):
    def value(id_, cast):
        item = inputs.itemById(id_)
        return cast(item).value if item is not None else None

    bool_in = adsk.core.BoolValueCommandInput.cast
    str_in = adsk.core.StringValueCommandInput.cast
    float_in = adsk.core.FloatSpinnerCommandInput.cast
    int_in = adsk.core.IntegerSpinnerCommandInput.cast

    st['dry_run'] = bool(value('dry_run', bool_in))
    st['project_code'] = (value('project_code', str_in) or '').strip()
    for number in range(1, 9):
        key = pipeline.STEP_KEYS[number]
        v = value('step_' + key, bool_in)
        if v is not None:
            st['steps'][key] = bool(v)
    dd = adsk.core.DropDownCommandInput.cast(inputs.itemById('explode_mode'))
    if dd is not None and dd.selectedItem is not None:
        st['explode_mode'] = _EXPLODE_MODES[dd.selectedItem.index][0]
    st['explode_factor'] = float(value('explode_factor', float_in))
    st['explode_min_gap_mm'] = float(value('explode_min_gap_mm', float_in))
    st['explode_subassembly_level'] = int(value('explode_subassembly_level', int_in))
    st['helper_prefixes'] = settings_mod.split_list(value('helper_prefixes', str_in))
    st['hardware_prefixes'] = settings_mod.split_list(value('hardware_prefixes', str_in))
    st['hardware_material_keywords'] = settings_mod.split_list(value('hardware_material_keywords', str_in))
    st['duplicate_tol_mm'] = float(value('duplicate_tol_mm', float_in))
    st['report_folder'] = (value('report_folder', str_in) or '').strip() or config.DEFAULT_SETTINGS['report_folder']
    st['open_report'] = bool(value('open_report', bool_in))
    return st


# ---------------------------------------------------------------- выполнение

class _DialogProgress(object):
    """Обёртка ProgressDialog: update() возвращает True, если пользователь нажал «Отмена»."""

    def __init__(self, ui):
        self.dialog = ui.createProgressDialog()
        self.dialog.cancelButtonText = 'Отмена'
        self.dialog.isBackgroundTranslucent = False
        self.dialog.isCancelButtonShown = True
        self.shown = False

    def update(self, value, maximum, message=''):
        if not self.shown:
            self.dialog.show('FL_Prep', '%m', 0, max(1, maximum), 0)
            self.shown = True
        self.dialog.maximumValue = max(1, maximum)
        self.dialog.message = message or '%v из %m'
        self.dialog.progressValue = value
        adsk.doEvents()
        return self.dialog.wasCancelled

    def finish(self):
        if self.shown:
            self.dialog.hide()
            self.shown = False


def command_execute(args):
    """Все изменения модели выполняются здесь — Fusion откатывает их одним Ctrl+Z."""
    args = adsk.core.CommandEventArgs.cast(args)
    app, ui = fu.app_and_ui()
    design = fu.active_design()
    if design is None:
        ui.messageBox('Нет активного документа Design.', 'FL_Prep')
        return
    st = _read_inputs(args.command.commandInputs, settings_mod.load())
    try:
        saved_to = settings_mod.save(st)
        log.debug('Настройки сохранены: ' + saved_to)
    except Exception as exc:  # noqa: BLE001
        log.warning('Не удалось сохранить настройки: {}'.format(exc))

    progress = _DialogProgress(ui)
    try:
        report, html_path, csv_path = pipeline.run(design, app.activeDocument, st, progress)
    finally:
        progress.finish()

    summary = ('Готово. Ошибок: {}, предупреждений: {}, инфо: {}.'.format(
        report.count('error'), report.count('warning'), report.count('info')))
    if report.skipped:
        summary += '\nПропущено шагов: {}.'.format(len(report.skipped))
    if html_path:
        summary += '\nОтчёт: {}'.format(html_path)
        if st.get('open_report'):
            try:
                webbrowser.open(pathlib.Path(html_path).as_uri())
            except Exception as exc:  # noqa: BLE001
                log.warning('Не удалось открыть отчёт: {}'.format(exc))
    log.info(summary.replace('\n', ' '))
    ui.messageBox(summary, 'FL_Prep')


def command_destroy(args):
    fu.clear_handlers(_local_handlers)

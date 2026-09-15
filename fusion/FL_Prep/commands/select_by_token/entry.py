# -*- coding: utf-8 -*-
"""Команда «Выделить по токену»: вставить entityToken из отчёта → деталь выделяется в модели."""
import os

import adsk.core
import adsk.fusion

from ... import config
from ...lib import fusion_utils as fu
from ...lib import log

_local_handlers = []


def start():
    app, ui = fu.app_and_ui()
    cmd_def = ui.commandDefinitions.itemById(config.SELECT_CMD_ID)
    if cmd_def is None:
        cmd_def = ui.commandDefinitions.addButtonDefinition(
            config.SELECT_CMD_ID, config.SELECT_CMD_NAME, config.SELECT_CMD_DESC,
            os.path.join(config.RESOURCES_DIR, 'select'))
    fu.add_handler(cmd_def.commandCreated, command_created)
    workspace = ui.workspaces.itemById(config.WORKSPACE_ID)
    tab = workspace.toolbarTabs.itemById(config.TAB_ID)
    panel = tab.toolbarPanels.itemById(config.PANEL_ID)
    if panel is None:
        panel = tab.toolbarPanels.add(config.PANEL_ID, config.PANEL_NAME, 'SolidScriptsAddinsPanel', False)
    if panel.controls.itemById(config.SELECT_CMD_ID) is None:
        panel.controls.addCommand(cmd_def)


def stop():
    app, ui = fu.app_and_ui()
    workspace = ui.workspaces.itemById(config.WORKSPACE_ID)
    tab = workspace.toolbarTabs.itemById(config.TAB_ID)
    panel = tab.toolbarPanels.itemById(config.PANEL_ID)
    if panel is not None:
        control = panel.controls.itemById(config.SELECT_CMD_ID)
        if control is not None:
            control.deleteMe()
        if panel.controls.count == 0:
            panel.deleteMe()
    cmd_def = ui.commandDefinitions.itemById(config.SELECT_CMD_ID)
    if cmd_def is not None:
        cmd_def.deleteMe()


def command_created(args):
    args = adsk.core.CommandCreatedEventArgs.cast(args)
    cmd = args.command
    cmd.okButtonText = 'Выделить'
    inputs = cmd.commandInputs
    inputs.addStringValueInput('token', 'Токен из отчёта', '')
    inputs.addBoolValueInput('fit', 'Показать в окне (Fit)', True, '', True)
    fu.add_handler(cmd.execute, command_execute, _local_handlers)
    fu.add_handler(cmd.destroy, command_destroy, _local_handlers)


def command_execute(args):
    args = adsk.core.CommandEventArgs.cast(args)
    app, ui = fu.app_and_ui()
    design = fu.active_design()
    if design is None:
        ui.messageBox('Нет активного документа Design.', 'FL_Prep')
        return
    inputs = args.command.commandInputs
    token = (adsk.core.StringValueCommandInput.cast(inputs.itemById('token')).value or '').strip()
    fit = adsk.core.BoolValueCommandInput.cast(inputs.itemById('fit')).value
    if not token:
        return
    entities = design.findEntityByToken(token)
    if not entities:
        ui.messageBox('Объект с таким токеном не найден (возможно, модель изменилась).', 'FL_Prep')
        return
    ui.activeSelections.clear()
    for ent in entities:
        try:
            ui.activeSelections.add(ent)
        except Exception as exc:  # noqa: BLE001
            log.warning('Не удалось выделить: {}'.format(exc))
    if fit:
        try:
            app.activeViewport.fit()
        except Exception:  # noqa: BLE001
            pass
    log.info('Выделено объектов по токену: {}'.format(len(entities)))


def command_destroy(args):
    fu.clear_handlers(_local_handlers)

# -*- coding: utf-8 -*-
"""Точка входа add-in FL_Prep.

Fusion вызывает run(context) при загрузке и stop(context) при выгрузке.
Вся логика — в пакетах commands/ и lib/.
"""
import traceback

import adsk.core

from .lib import log as _log
from .commands.prep import entry as prep_cmd
from .commands.select_by_token import entry as select_cmd

_COMMANDS = (prep_cmd, select_cmd)


def run(context):
    try:
        _log.setup()
        for cmd in _COMMANDS:
            cmd.start()
        _log.info('FL_Prep загружен')
    except Exception:
        _report_failure('run')


def stop(context):
    try:
        for cmd in reversed(_COMMANDS):
            cmd.stop()
        _log.info('FL_Prep выгружен')
        _log.teardown()
    except Exception:
        _report_failure('stop')


def _report_failure(where):
    text = 'FL_Prep: ошибка в {}:\n{}'.format(where, traceback.format_exc())
    try:
        _log.error(text)
    except Exception:
        pass
    try:
        adsk.core.Application.get().userInterface.messageBox(text)
    except Exception:
        pass

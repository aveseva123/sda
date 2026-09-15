# -*- coding: utf-8 -*-
"""Обёртки над событиями Fusion: регистрация обработчиков с хранением ссылок,
единый перехват ошибок."""
import sys
import traceback

import adsk.core

from . import log

_handlers = []


def add_handler(event, callback, local_handlers=None):
    """Подписывает callback(args) на событие Fusion. Обработчик хранится, чтобы не был собран GC."""
    module = sys.modules[event.__module__]
    handler_type = module.__dict__[event.classType().split('::')[-1] + 'Handler']
    name = getattr(callback, '__name__', 'handler')

    class Handler(handler_type):
        def __init__(self):
            super().__init__()

        def notify(self, args):
            try:
                callback(args)
            except Exception:  # noqa: BLE001
                handle_error(name)

    handler = Handler()
    (local_handlers if local_handlers is not None else _handlers).append(handler)
    event.add(handler)
    return handler


def clear_handlers(local_handlers=None):
    target = local_handlers if local_handlers is not None else _handlers
    del target[:]


def handle_error(where, show_message=True):
    text = 'Ошибка в {}:\n{}'.format(where, traceback.format_exc())
    log.error(text)
    if show_message:
        try:
            adsk.core.Application.get().userInterface.messageBox(text, 'FL_Prep')
        except Exception:
            pass


def app_and_ui():
    app = adsk.core.Application.get()
    return app, app.userInterface


def active_design():
    """Активный Design или None."""
    app = adsk.core.Application.get()
    try:
        import adsk.fusion
        return adsk.fusion.Design.cast(app.activeProduct)
    except Exception:
        return None

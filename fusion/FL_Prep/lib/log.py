# -*- coding: utf-8 -*-
"""Логирование: файл logs/FL_Prep.log рядом с add-in + окно Text Commands Fusion."""
import datetime
import logging
import os

from .. import config

_logger = None
_file_handler = None


def setup():
    global _logger, _file_handler
    _logger = logging.getLogger(config.ADDIN_NAME)
    _logger.setLevel(logging.DEBUG)
    _logger.propagate = False
    if _file_handler is None:
        try:
            os.makedirs(config.LOG_DIR, exist_ok=True)
            path = os.path.join(config.LOG_DIR, config.ADDIN_NAME + '.log')
            _file_handler = logging.FileHandler(path, encoding='utf-8')
            _file_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
            _logger.addHandler(_file_handler)
        except Exception:
            _file_handler = None


def teardown():
    global _file_handler
    if _logger is not None and _file_handler is not None:
        _logger.removeHandler(_file_handler)
        _file_handler.close()
    _file_handler = None


def _text_commands(message):
    """Сообщение в окно TEXT COMMANDS (Application.log с типом консоли)."""
    try:
        import adsk.core
        adsk.core.Application.log('[{}] {}'.format(config.ADDIN_NAME, message))
    except Exception:
        pass


def _emit(level, message, to_text_commands=True):
    if _logger is None:
        setup()
    try:
        _logger.log(level, message)
    except Exception:
        pass
    if to_text_commands:
        _text_commands(message)


def debug(message):
    _emit(logging.DEBUG, message, to_text_commands=False)


def info(message):
    _emit(logging.INFO, message)


def warning(message):
    _emit(logging.WARNING, message)


def error(message):
    _emit(logging.ERROR, message)


def log_file_path():
    return os.path.join(config.LOG_DIR, config.ADDIN_NAME + '.log')


def timestamp():
    return datetime.datetime.now().strftime('%Y%m%d_%H%M')

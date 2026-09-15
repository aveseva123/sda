# -*- coding: utf-8 -*-
"""Отчёт: сбор находок и запись HTML + CSV. Без adsk — тестируется обычным python3."""
import csv
import datetime
import html
import os

LEVEL_ERROR = 'error'
LEVEL_WARNING = 'warning'
LEVEL_INFO = 'info'
LEVELS = (LEVEL_ERROR, LEVEL_WARNING, LEVEL_INFO)
LEVEL_TITLES = {LEVEL_ERROR: 'Ошибка', LEVEL_WARNING: 'Предупреждение', LEVEL_INFO: 'Инфо'}


class Finding(object):
    __slots__ = ('level', 'step', 'code', 'message', 'entity', 'path', 'token', 'details', 'fixed')

    def __init__(self, level, step, code, message, entity='', path='', token='', details='', fixed=False):
        self.level = level
        self.step = step
        self.code = code
        self.message = message
        self.entity = entity or ''
        self.path = path or ''
        self.token = token or ''
        self.details = details or ''
        self.fixed = bool(fixed)

    def as_row(self):
        return [LEVEL_TITLES.get(self.level, self.level), str(self.step), self.code, self.message,
                self.entity, self.path, self.token, self.details, 'да' if self.fixed else 'нет']


class Report(object):
    """Накопитель результатов прогона."""

    CSV_HEADER = ['Уровень', 'Шаг', 'Код', 'Сообщение', 'Объект', 'Путь', 'Токен', 'Подробности', 'Исправлено']

    def __init__(self, project_code, document_name='', dry_run=True):
        self.project_code = project_code or 'noname'
        self.document_name = document_name
        self.dry_run = dry_run
        self.findings = []
        self.actions = []          # что сделано автоматически: (шаг, текст)
        self.skipped = []          # пропущенные шаги: (шаг, причина)
        self.instructions = []     # ручные инструкции: (заголовок, [строки])
        self.capabilities = []     # (имя, доступно(bool), примечание)
        self.settings_used = {}
        self.summary = {}          # произвольные счётчики для шапки
        self.export_path = None    # путь к JSON-пакету, если экспорт выполнялся
        self.started = datetime.datetime.now()

    # ---- добавление
    def add(self, level, step, code, message, entity='', path='', token='', details='', fixed=False):
        f = Finding(level, step, code, message, entity, path, token, details, fixed)
        self.findings.append(f)
        return f

    def error(self, step, code, message, **kw):
        return self.add(LEVEL_ERROR, step, code, message, **kw)

    def warning(self, step, code, message, **kw):
        return self.add(LEVEL_WARNING, step, code, message, **kw)

    def info(self, step, code, message, **kw):
        return self.add(LEVEL_INFO, step, code, message, **kw)

    def action(self, step, text):
        self.actions.append((step, text))

    def skip(self, step, reason):
        self.skipped.append((step, reason))

    def instruction(self, title, lines):
        self.instructions.append((title, list(lines)))

    def capability(self, name, available, note=''):
        self.capabilities.append((name, bool(available), note))

    # ---- статистика
    def count(self, level):
        return sum(1 for f in self.findings if f.level == level)

    def remaining(self):
        return [f for f in self.findings if not f.fixed and f.level != LEVEL_INFO]

    # ---- имена файлов
    def base_name(self, now=None):
        now = now or self.started
        safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in self.project_code)
        return '{}_prep_{}'.format(safe, now.strftime('%Y%m%d_%H%M'))

    def write(self, folder, now=None):
        """Пишет HTML и CSV, возвращает (html_path, csv_path)."""
        folder = os.path.abspath(os.path.expanduser(folder or '.'))
        os.makedirs(folder, exist_ok=True)
        base = self.base_name(now)
        html_path = os.path.join(folder, base + '.html')
        csv_path = os.path.join(folder, base + '.csv')
        with open(html_path, 'w', encoding='utf-8') as fh:
            fh.write(self.to_html())
        with open(csv_path, 'w', encoding='utf-8-sig', newline='') as fh:
            writer = csv.writer(fh, delimiter=';')
            writer.writerow(self.CSV_HEADER)
            for f in self.findings:
                writer.writerow(f.as_row())
        return html_path, csv_path

    # ---- HTML
    def to_html(self):
        e = html.escape
        order = {LEVEL_ERROR: 0, LEVEL_WARNING: 1, LEVEL_INFO: 2}
        findings = sorted(self.findings, key=lambda f: (order.get(f.level, 9), f.step, f.code))
        parts = []
        parts.append('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">')
        parts.append('<title>FL_Prep {} — отчёт</title>'.format(e(self.project_code)))
        parts.append('<style>' + _CSS + '</style></head><body>')
        parts.append('<h1>FL_Prep — подготовка к чертежам: {}</h1>'.format(e(self.project_code)))
        parts.append('<p class="meta">Документ: <b>{}</b> · {} · режим: <b>{}</b></p>'.format(
            e(self.document_name), self.started.strftime('%d.%m.%Y %H:%M'),
            'dry-run (только проверка)' if self.dry_run else 'с изменениями'))

        # Сводка
        parts.append('<div class="cards">')
        for level in LEVELS:
            parts.append('<div class="card {0}"><div class="num">{1}</div><div>{2}</div></div>'.format(
                level, self.count(level), e(LEVEL_TITLES[level])))
        parts.append('<div class="card fixed"><div class="num">{}</div><div>Исправлено автоматически</div></div>'.format(
            len(self.actions) + sum(1 for f in self.findings if f.fixed)))
        parts.append('<div class="card"><div class="num">{}</div><div>Осталось (ошибки и предупреждения)</div></div>'.format(
            len(self.remaining())))
        parts.append('</div>')
        if self.summary:
            parts.append('<table class="kv">')
            for key, value in self.summary.items():
                parts.append('<tr><th>{}</th><td>{}</td></tr>'.format(e(str(key)), e(str(value))))
            parts.append('</table>')

        # Пропущенные шаги
        if self.skipped:
            parts.append('<h2>Пропущенные шаги</h2><ul>')
            for step, reason in self.skipped:
                parts.append('<li><b>Шаг {}</b>: {}</li>'.format(e(str(step)), e(reason)))
            parts.append('</ul>')

        # Находки
        parts.append('<h2>Список проблем</h2>')
        parts.append('<p class="hint">Кнопка «токен» копирует entityToken детали. В Fusion: '
                     'UTILITIES → FL Prep → «Выделить по токену» — вставьте токен, деталь будет выделена в модели.</p>')
        parts.append('<table class="findings"><thead><tr><th>Уровень</th><th>Шаг</th><th>Код</th>'
                     '<th>Сообщение</th><th>Объект</th><th>Путь</th><th>Подробности</th><th>Исправлено</th><th></th></tr></thead><tbody>')
        for f in findings:
            btn = ('<button class="tok" data-token="{}" onclick="copyToken(this)">токен</button>'.format(e(f.token))
                   if f.token else '')
            parts.append('<tr class="{lvl}"><td>{lvl_t}</td><td>{step}</td><td><code>{code}</code></td><td>{msg}</td>'
                         '<td>{ent}</td><td class="path">{path}</td><td>{det}</td><td>{fixed}</td><td>{btn}</td></tr>'.format(
                             lvl=e(f.level), lvl_t=e(LEVEL_TITLES.get(f.level, f.level)), step=e(str(f.step)),
                             code=e(f.code), msg=e(f.message), ent=e(f.entity), path=e(f.path),
                             det=e(f.details), fixed='да' if f.fixed else '', btn=btn))
        if not findings:
            parts.append('<tr><td colspan="9">Проблем не найдено.</td></tr>')
        parts.append('</tbody></table>')

        # Действия
        parts.append('<h2>Исправлено автоматически</h2>')
        if self.actions:
            parts.append('<ul>')
            for step, text in self.actions:
                parts.append('<li><b>Шаг {}</b>: {}</li>'.format(e(str(step)), e(text)))
            parts.append('</ul>')
        else:
            parts.append('<p>Ничего (режим dry-run или изменений не требовалось).</p>')

        # Инструкции
        if self.instructions:
            parts.append('<h2>Что доделать вручную</h2>')
            for title, lines in self.instructions:
                parts.append('<h3>{}</h3><ol>'.format(e(title)))
                for line in lines:
                    parts.append('<li>{}</li>'.format(e(line)))
                parts.append('</ol>')

        # Возможности API
        if self.capabilities:
            parts.append('<h2>Возможности API в этой версии Fusion</h2><table class="caps">')
            parts.append('<tr><th>Функция</th><th>Доступна</th><th>Примечание</th></tr>')
            for name, available, note in self.capabilities:
                parts.append('<tr><td><code>{}</code></td><td class="{}">{}</td><td>{}</td></tr>'.format(
                    e(name), 'yes' if available else 'no', 'да' if available else 'нет', e(note)))
            parts.append('</table>')

        # Настройки
        if self.settings_used:
            parts.append('<h2>Настройки прогона</h2><table class="kv">')
            for key, value in self.settings_used.items():
                parts.append('<tr><th>{}</th><td>{}</td></tr>'.format(e(str(key)), e(str(value))))
            parts.append('</table>')

        parts.append('<script>' + _JS + '</script></body></html>')
        return '\n'.join(parts)


_CSS = """
body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;margin:24px;color:#222;background:#fff}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #ddd}
h3{font-size:14px;margin:12px 0 4px}.meta,.hint{color:#666;margin:4px 0 12px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
.card{border:1px solid #ddd;border-radius:6px;padding:8px 14px;min-width:120px}
.card .num{font-size:22px;font-weight:bold}.card.error{border-color:#d33;background:#fff2f2}
.card.warning{border-color:#e6a100;background:#fff8e6}.card.info{border-color:#3a7bd5;background:#eef4fd}
.card.fixed{border-color:#2a9d4a;background:#eefaf1}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f4f4f4}tr.error td:first-child{color:#c00;font-weight:bold}tr.warning td:first-child{color:#b37400;font-weight:bold}
tr.info td:first-child{color:#3a7bd5}.path{color:#666;font-size:12px}code{font-size:12px}
table.kv{width:auto;margin:8px 0}table.kv th{width:260px}
td.yes{color:#2a9d4a;font-weight:bold}td.no{color:#c00;font-weight:bold}
button.tok{font-size:12px;cursor:pointer}
"""

_JS = """
function copyToken(btn){var t=btn.getAttribute('data-token');
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){btn.textContent='скопировано';setTimeout(function(){btn.textContent='токен';},1200);});}
 else{window.prompt('Токен детали:',t);}}
"""

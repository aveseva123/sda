# -*- coding: utf-8 -*-
"""Собирает BOM.csv и BOM.md из bom_data.py. Запуск: python3 make_bom.py (Fusion не нужен)."""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bom_data import BOM

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = ['№', 'Группа', 'Наименование', 'Требования', 'На стенд', 'На линию (6 ст.)', 'Примечание']


def main():
    with open(os.path.join(HERE, 'BOM.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(HEAD)
        for i, row in enumerate(BOM, 1):
            w.writerow([i] + list(row))
    lines = ['# Покупные комплектующие — визуальная счётная станция', '',
             'Кол-во «на стенд» — прототип станции, «на линию» — 6 станций (по одной на вид метиза). ',
             'Марки не заданы: выбирать по параметрам из доступного, ограничение — бюджет.', '',
             '| ' + ' | '.join(HEAD) + ' |', '|' + '---|' * len(HEAD)]
    for i, row in enumerate(BOM, 1):
        lines.append('| ' + ' | '.join([str(i)] + [c.replace('|', '/') for c in row]) + ' |')
    with open(os.path.join(HERE, 'BOM.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('BOM.csv и BOM.md: %d позиций' % len(BOM))


if __name__ == '__main__':
    main()

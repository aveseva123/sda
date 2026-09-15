# -*- coding: utf-8 -*-
"""Шаг 1. Аудит модели — только чтение."""
import adsk.core
import adsk.fusion

from . import geom_pure as gp
from . import log
from . import traversal
from .units import cm_to_mm, fmt_mm

STEP = 1


# ---------------------------------------------------------------- измерения

def measure_component(rec, caps):
    """Габариты (мм, отсортированы Д>=Ш>=Т), объём (см³), площадь (см²), число граней.
    None, если у компонента нет тел."""
    comp = rec.component
    bodies = list(comp.bRepBodies)
    if not bodies:
        return None
    volume = 0.0
    area = 0.0
    faces = 0
    for body in bodies:
        try:
            volume += body.volume
            area += body.area
            faces += body.faces.count
        except Exception:  # noqa: BLE001
            pass
    dims = None
    source = ''
    if caps.get('BRepBody.orientedMinimumBoundingBox', (False, ''))[0]:
        try:
            obb = comp.orientedMinimumBoundingBox
            if obb is not None:
                dims = gp.sorted_dims(cm_to_mm(obb.length), cm_to_mm(obb.width), cm_to_mm(obb.height))
                source = 'api'
        except Exception as exc:  # noqa: BLE001
            log.debug('orientedMinimumBoundingBox не сработал для {}: {}'.format(rec.name, exc))
    if dims is None:
        points = [(cm_to_mm(x), cm_to_mm(y), cm_to_mm(z)) for x, y, z in traversal.component_points(comp)]
        normal = traversal.largest_planar_face_normal(comp)
        obb = gp.obb_from_points(points, normal) if normal else None
        if obb is None:
            obb = gp.aabb_from_points(points)
            source = 'aabb'
        else:
            source = 'faces'
        if obb is not None:
            dims = gp.sorted_dims(obb['length'], obb['width'], obb['thickness'])
    return {'dims_mm': dims, 'volume': volume, 'area': area, 'faces': faces, 'source': source}


def dims_text(dims):
    if not dims:
        return ''
    return '×'.join(fmt_mm(d) for d in dims) + ' мм'


# ---------------------------------------------------------------- проверки

def _material_name(entity):
    try:
        mat = entity.material
        return mat.name if mat is not None else ''
    except Exception:  # noqa: BLE001
        return ''


def check_root_bodies(root, report):
    count = 0
    for body in root.bRepBodies:
        count += 1
        report.error(STEP, 'A01_root_body', 'Тело лежит в корневом компоненте — нужен отдельный компонент',
                     entity=body.name, path=root.name, token=traversal.safe_token(body))
    return count


def check_structure(records, report):
    for rec in records:
        if rec.body_count > 1:
            names = ', '.join(b.name for b in rec.component.bRepBodies)
            report.warning(STEP, 'A02_multi_body', 'Компонент содержит несколько тел ({})'.format(rec.body_count),
                           entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first), details=names)
        elif rec.body_count == 0 and rec.is_leaf:
            report.info(STEP, 'A03_empty_component', 'Компонент без тел и без вложенных компонентов',
                        entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))


def check_materials(records, report, reference):
    for rec in records:
        if rec.body_count == 0:
            continue
        name = _material_name(rec.component)
        if not name:
            report.warning(STEP, 'A04_no_material', 'У компонента не задан материал',
                           entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))
        elif gp.find_material(name, reference) is None:
            report.warning(STEP, 'A05_material_unknown', 'Материал «{}» не из справочника'.format(name),
                           entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))
        for body in rec.component.bRepBodies:
            body_mat = _material_name(body)
            if body_mat and name and body_mat != name:
                report.info(STEP, 'A06_body_material_differs',
                            'Материал тела «{}» отличается от материала компонента «{}»'.format(body_mat, name),
                            entity=body.name, path=rec.path, token=traversal.safe_token(body))


def check_names(records, report):
    seen = {}
    for rec in records:
        if gp.is_default_name(rec.name):
            report.warning(STEP, 'A07_default_name', 'Имя компонента дефолтное или пустое',
                           entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))
        for body in rec.component.bRepBodies:
            if gp.is_default_name(body.name):
                report.info(STEP, 'A08_default_body_name', 'Имя тела дефолтное или пустое',
                            entity=body.name, path=rec.path, token=traversal.safe_token(body))
        key = (rec.name or '').strip().lower()
        seen.setdefault(key, []).append(rec)
    for key, recs in seen.items():
        if key and len(recs) > 1:
            paths = '; '.join(r.path for r in recs)
            report.warning(STEP, 'A09_duplicate_name',
                           'Одно имя у {} разных компонентов (спецификация их не различит)'.format(len(recs)),
                           entity=recs[0].name, path=recs[0].path, token=traversal.safe_token(recs[0].first),
                           details=paths)


def check_geometric_duplicates(records, measures, report, tol_mm, rel_tol):
    items = []
    for rec in records:
        m = measures.get(rec.token)
        if not m or not m['dims_mm'] or not rec.is_leaf:
            continue
        items.append((rec.token, gp.signature(m['volume'], m['area'], m['faces'], m['dims_mm'])))
    by_token = {rec.token: rec for rec in records}
    groups = gp.group_duplicates(items, tol=tol_mm, rel_tol=rel_tol)
    for group in groups:
        recs = [by_token[t] for t in group]
        first = recs[0]
        names = ', '.join('{} (×{})'.format(r.name, r.instance_count) for r in recs)
        report.warning(STEP, 'A10_geometric_duplicate',
                       'Геометрически одинаковые детали сделаны {} разными компонентами — '
                       'в спецификации будут разными позициями. Предложение: оставить «{}», '
                       'остальные заменить экземплярами'.format(len(recs), first.name),
                       entity=first.name, path=first.path, token=traversal.safe_token(first.first),
                       details='{}; габарит {}'.format(names, dims_text(measures[first.token]['dims_mm'])))
    return groups


def check_visibility(records, report):
    for rec in records:
        for occ in rec.occurrences:
            try:
                hidden = not occ.isLightBulbOn
            except Exception:  # noqa: BLE001
                hidden = False
            if hidden:
                report.warning(STEP, 'A11_hidden_component', 'Компонент скрыт — в чертёж и спецификацию не попадёт',
                               entity=occ.name, path=_occ_path(occ), token=traversal.safe_token(occ))
        for body in rec.component.bRepBodies:
            try:
                hidden = not body.isLightBulbOn
            except Exception:  # noqa: BLE001
                hidden = False
            if hidden:
                report.warning(STEP, 'A12_hidden_body', 'Тело скрыто — в чертёж не попадёт',
                               entity=body.name, path=rec.path, token=traversal.safe_token(body))


def check_positions(design, report):
    try:
        pending = design.snapshots.hasPendingSnapshot
    except Exception:  # noqa: BLE001
        pending = False
    if pending:
        report.warning(STEP, 'A13_pending_position',
                       'Есть перемещённые компоненты без Capture Position — при обновлении сборка может «вернуться»',
                       entity=design.rootComponent.name)


def check_external_references(design, document, records, report):
    for rec in records:
        if rec.is_external:
            report.info(STEP, 'A15_external_component', 'Внешний (связанный) компонент',
                        entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))
    try:
        refs = document.documentReferences
    except Exception:  # noqa: BLE001
        refs = None
    if refs is None:
        return
    for ref in refs:
        try:
            out_of_date = ref.isOutOfDate
        except Exception:  # noqa: BLE001
            continue
        if out_of_date:
            name = ''
            try:
                name = ref.dataFile.name
            except Exception:  # noqa: BLE001
                pass
            report.error(STEP, 'A14_reference_out_of_date',
                         'Внешняя ссылка не обновлена до последней версии', entity=name)


def check_design_type(design, report):
    try:
        if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            report.warning(STEP, 'A16_direct_design', 'Документ не в параметрическом режиме (нет таймлайна)')
    except Exception:  # noqa: BLE001
        pass


def _occ_path(occ):
    try:
        return occ.fullPathName
    except Exception:  # noqa: BLE001
        return occ.name


# ---------------------------------------------------------------- запуск

def run(design, document, settings, caps, report, progress=None):
    """Полный аудит. Возвращает dict с измерениями по токену компонента (для следующих шагов)."""
    root, records = traversal.collect(design)
    n = max(1, len(records))
    measures = {}
    for i, rec in enumerate(records):
        if progress is not None:
            if progress.update(i, n, 'Аудит: {} ({} из {})'.format(rec.name, i + 1, n)):
                report.skip(STEP, 'аудит прерван пользователем')
                return measures
        try:
            m = measure_component(rec, caps)
            if m:
                measures[rec.token] = m
        except Exception as exc:  # noqa: BLE001
            log.warning('Не удалось измерить {}: {}'.format(rec.name, exc))

    check_design_type(design, report)
    root_bodies = check_root_bodies(root, report)
    check_structure(records, report)
    check_materials(records, report, settings.get('materials', []))
    check_names(records, report)
    groups = check_geometric_duplicates(records, measures, report,
                                        settings.get('duplicate_tol_mm', 0.01), settings.get('duplicate_rel_tol', 1e-4))
    check_visibility(records, report)
    check_positions(design, report)
    check_external_references(design, document, records, report)

    leaf_parts = [r for r in records if r.is_leaf and r.body_count > 0]
    report.summary['Уникальных компонентов'] = len(records)
    report.summary['Вхождений (occurrences)'] = sum(r.instance_count for r in records)
    report.summary['Деталей (компонентов с телами без вложений)'] = len(leaf_parts)
    report.summary['Экземпляров деталей всего'] = sum(r.instance_count for r in leaf_parts)
    report.summary['Тел в корне'] = root_bodies
    report.summary['Групп геометрических дублей'] = len(groups)
    for rec in leaf_parts:
        m = measures.get(rec.token)
        if m and m['dims_mm']:
            report.info(STEP, 'A00_part', 'Деталь: {} · ×{} · материал: {}'.format(
                dims_text(m['dims_mm']), rec.instance_count, _material_name(rec.component) or '—'),
                entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first),
                details='OBB: ' + m['source'])
    return measures

# -*- coding: utf-8 -*-
"""Шаг 9. Экспорт пакета JSON для внешнего генератора чертежей.
Только чтение модели. Все размеры в пакете — мм, матрицы — 16 чисел row-major."""
import datetime
import json
import os

import adsk.core
import adsk.fusion

from .. import config
from . import geom_pure as gp
from . import log
from . import pack_pure as pp
from . import traversal
from .units import cm_to_mm

STEP = 9


# ---------------------------------------------------------------- вспомогательные чтения

def _pt_mm(p):
    return (cm_to_mm(p.x), cm_to_mm(p.y), cm_to_mm(p.z))


def _vec(v):
    return (v.x, v.y, v.z)


def _attrs(entity, groups):
    result = {}
    for group in groups:
        if not group:
            continue
        try:
            items = entity.attributes.itemsByGroup(group)
        except Exception:  # noqa: BLE001
            items = None
        if items:
            result[group] = dict((a.name, a.value) for a in items)
    return result


def _material_name(entity):
    try:
        mat = entity.material
        return mat.name if mat is not None else ''
    except Exception:  # noqa: BLE001
        return ''


def _outward_normal(face):
    """Наружная нормаль плоской грани (с учётом isParamReversed) или None."""
    try:
        ok, normal = face.evaluator.getNormalAtPoint(face.pointOnFace)
        if ok:
            return gp.v_norm(_vec(normal))
    except Exception:  # noqa: BLE001
        pass
    try:
        n = _vec(face.geometry.normal)
        if getattr(face, 'isParamReversed', False):
            n = gp.v_scale(n, -1.0)
        return gp.v_norm(n)
    except Exception:  # noqa: BLE001
        return None


def _planar_faces(body):
    faces = []
    for face in body.faces:
        try:
            if face.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
                faces.append(face)
        except Exception:  # noqa: BLE001
            continue
    return faces


# ---------------------------------------------------------------- OBB и система координат детали

def _component_obb(component, caps):
    """OBB в локальных координатах компонента, мм. Возвращает dict как в geom_pure.obb_from_points."""
    points = [tuple(cm_to_mm(c) for c in p) for p in traversal.component_points(component)]
    if not points:
        return None, 'none'
    if caps.get('BRepBody.orientedMinimumBoundingBox', (False, ''))[0]:
        try:
            obb = component.orientedMinimumBoundingBox
            if obb is not None:
                dims = [(cm_to_mm(obb.length), _vec(obb.lengthDirection)),
                        (cm_to_mm(obb.width), _vec(obb.widthDirection)),
                        (cm_to_mm(obb.height), _vec(obb.heightDirection))]
                dims.sort(key=lambda d: -d[0])
                return {'length': dims[0][0], 'width': dims[1][0], 'thickness': dims[2][0],
                        'dir_length': gp.v_norm(dims[0][1]), 'dir_width': gp.v_norm(dims[1][1]),
                        'dir_thickness': gp.v_norm(dims[2][1]), 'center': _pt_mm(obb.centerPoint)}, 'api'
        except Exception as exc:  # noqa: BLE001
            log.debug('orientedMinimumBoundingBox: {}'.format(exc))
    normal = traversal.largest_planar_face_normal(component)
    obb = gp.obb_from_points(points, normal) if normal else None
    if obb is not None:
        return obb, 'faces'
    box = gp.aabb_from_points(points)
    box.update({'dir_length': (1.0, 0.0, 0.0), 'dir_width': (0.0, 1.0, 0.0), 'dir_thickness': (0.0, 0.0, 1.0)})
    return box, 'aabb'


def _main_face(component):
    """Самая большая плоская грань среди тел компонента: (face, body, наружная нормаль, площадь мм²)."""
    best = None
    for body in component.bRepBodies:
        for face in _planar_faces(body):
            try:
                area = face.area * 100.0
            except Exception:  # noqa: BLE001
                continue
            if best is None or area > best[3]:
                n = _outward_normal(face)
                if n is not None:
                    best = (face, body, n, area)
    return best


# ---------------------------------------------------------------- контуры и отверстия

def _edge_segment(coedge, frame, tol_cm):
    """Сегмент контура ребра в 2D-координатах детали (u, v)."""
    edge = coedge.edge
    geom = edge.geometry
    try:
        ctype = geom.curveType
    except Exception:  # noqa: BLE001
        ctype = -1
    ev = edge.evaluator
    ok, p0, p1 = ev.getParameterExtents()
    ok2, pts = ev.getStrokes(p0, p1, tol_cm)
    if not (ok and ok2) or not pts:
        return None
    pts3 = [pp.to_frame(_pt_mm(p), frame) for p in pts]
    if coedge.isOpposedToEdge:
        pts3.reverse()
    pts2 = [[pp.rnd(p[0]), pp.rnd(p[1])] for p in pts3]
    seg = {'type': 'polyline', 'points': pts2}
    if ctype == adsk.core.Curve3DTypes.Line3DCurveType:
        seg['type'] = 'line'
        seg['points'] = [pts2[0], pts2[-1]]
    elif ctype in (adsk.core.Curve3DTypes.Arc3DCurveType, adsk.core.Curve3DTypes.Circle3DCurveType):
        c = pp.to_frame(_pt_mm(geom.center), frame)
        seg['type'] = 'circle' if ctype == adsk.core.Curve3DTypes.Circle3DCurveType else 'arc'
        seg['center'] = [pp.rnd(c[0]), pp.rnd(c[1])]
        seg['radius'] = pp.rnd(cm_to_mm(geom.radius))
        seg['ccw'] = pp.arc_is_ccw(pts2, seg['center'])
    return seg


def _face_loops(face, frame, tol_cm):
    outer = []
    inner = []
    for loop in face.loops:
        segs = []
        for coedge in loop.coEdges:
            seg = _edge_segment(coedge, frame, tol_cm)
            if seg is not None:
                segs.append(seg)
        if not segs:
            continue
        if loop.isOuter:
            outer.append(segs)
        else:
            inner.append(segs)
    return outer, inner


def _drillings(component, frame, tol_cm):
    """Круглые внутренние петли на плоских гранях всех тел — отверстия."""
    found = []
    for body in component.bRepBodies:
        for face in _planar_faces(body):
            n = _outward_normal(face)
            if n is None:
                continue
            kind = pp.face_kind(n, frame['z'])
            # локальная 2D-система грани: для main/back используем систему детали, для торцов — свою
            for loop in face.loops:
                if loop.isOuter:
                    continue
                segs3 = []
                for coedge in loop.coEdges:
                    edge = coedge.edge
                    geom = edge.geometry
                    try:
                        ctype = geom.curveType
                    except Exception:  # noqa: BLE001
                        continue
                    if ctype not in (adsk.core.Curve3DTypes.Arc3DCurveType, adsk.core.Curve3DTypes.Circle3DCurveType):
                        segs3 = None
                        break
                    segs3.append((pp.to_frame(_pt_mm(geom.center), frame), cm_to_mm(geom.radius), ctype))
                if not segs3:
                    continue
                c0, r0, _ = segs3[0]
                same = all(abs(c[0] - c0[0]) < 0.01 and abs(c[1] - c0[1]) < 0.01 and abs(c[2] - c0[2]) < 0.01
                           and abs(r - r0) < 0.01 for c, r, _ in segs3)
                if not same:
                    continue
                if len(segs3) > 1 and not all(t == adsk.core.Curve3DTypes.Arc3DCurveType for _, _, t in segs3):
                    continue
                axis = gp.v_scale(n, -1.0)  # ось сверления — внутрь материала
                found.append({'center': [pp.rnd(c0[0]), pp.rnd(c0[1]), pp.rnd(c0[2])],
                              'diameter': pp.rnd(2.0 * r0),
                              'axis': [pp.rnd(a, 6) for a in (gp.v_dot(axis, frame['x']), gp.v_dot(axis, frame['y']),
                                                             gp.v_dot(axis, frame['z']))],
                              'face': kind, 'body': body.name})
    return pp.dedupe_drillings(found)


# ---------------------------------------------------------------- сетка

def _mesh(component, tol_cm):
    verts = []
    tris = []
    offset = 0
    for body in component.bRepBodies:
        try:
            calc = body.meshManager.createMeshCalculator()
            calc.setQuality(adsk.fusion.TriangleMeshQualityOptions.LowQualityTriangleMesh)
            try:
                calc.surfaceTolerance = tol_cm
            except Exception:  # noqa: BLE001
                pass
            mesh = calc.calculate()
            if mesh is None:
                continue
            coords = list(mesh.nodeCoordinatesAsFloat)
            idx = list(mesh.nodeIndices)
        except Exception as exc:  # noqa: BLE001
            log.warning('Сетка тела {}: {}'.format(body.name, exc))
            continue
        verts.extend(pp.rnd(cm_to_mm(c), 2) for c in coords)
        tris.extend(int(i) + offset for i in idx)
        offset += len(coords) // 3
    return {'vertices': verts, 'triangles': tris}


# ---------------------------------------------------------------- компоненты и вхождения

def _export_component(rec, kind, settings, caps):
    comp = rec.component
    tol_cm = float(settings.get('export_mesh_tolerance_mm', 0.5)) / 10.0
    item = {
        'id': rec.token, 'name': rec.name, 'kind': kind, 'instances': rec.instance_count,
        'is_external': rec.is_external, 'body_count': rec.body_count,
        'part_number': '', 'description': '', 'material': _material_name(comp), 'material_ref': None,
        'attributes': _attrs(comp, [config.ATTR_GROUP, settings.get('external_attr_group', '')]),
        'obb': None, 'frame': None, 'grain_axis': None, 'panel': None, 'mesh': None,
    }
    try:
        item['part_number'] = comp.partNumber or ''
        item['description'] = comp.description or ''
    except Exception:  # noqa: BLE001
        pass
    ref = gp.find_material(item['material'], settings.get('materials', []))
    item['material_ref'] = ref['name'] if ref else None
    if rec.body_count == 0:
        return item

    obb, source = _component_obb(comp, caps)
    main = _main_face(comp)
    if obb is not None:
        dims = gp.sorted_dims(obb['length'], obb['width'], obb['thickness'])
        frame = pp.part_frame(obb, main[2] if main else None)
        item['obb'] = {'length': pp.rnd(dims[0]), 'width': pp.rnd(dims[1]), 'thickness': pp.rnd(dims[2]),
                       'source': source}
        item['frame'] = pp.frame_as_dict(frame)
        item['grain_axis'] = 'x'
        main_area = main[3] if main else 0.0
        if kind == 'part' and pp.is_panel(dims, main_area):
            outer, inner = _face_loops(main[0], frame, tol_cm)
            item['panel'] = {'main_face_body': main[1].name, 'main_face_area': pp.rnd(main_area, 1),
                             'outline': {'outer': outer, 'inner': inner},
                             'drillings': _drillings(comp, frame, tol_cm)}
    if kind in ('part', 'hardware', 'assembly'):
        item['mesh'] = _mesh(comp, tol_cm)
    return item


def _export_occurrences(records, comp_ids, include_hidden):
    occs = []
    path_to_token = {}
    for rec in records:
        for occ in rec.occurrences:
            try:
                path_to_token[occ.fullPathName] = traversal.safe_token(occ)
            except Exception:  # noqa: BLE001
                continue
    for rec in records:
        if rec.token not in comp_ids:
            continue
        for occ in rec.occurrences:
            try:
                visible = bool(occ.isLightBulbOn)
            except Exception:  # noqa: BLE001
                visible = True
            if not visible and not include_hidden:
                continue
            try:
                path = occ.fullPathName
            except Exception:  # noqa: BLE001
                path = occ.name
            try:
                matrix = pp.matrix_cm_to_mm(occ.transform2.asArray())
            except Exception:  # noqa: BLE001
                matrix = pp.matrix_cm_to_mm([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
            try:
                grounded = bool(occ.isGrounded)
            except Exception:  # noqa: BLE001
                grounded = False
            parent = pp.parent_path(path)
            occs.append({
                'id': traversal.safe_token(occ), 'name': occ.name, 'path': path,
                'parent': path_to_token.get(parent) if parent else None,
                'component': rec.token, 'depth': path.count('+'),
                'transform': matrix, 'transform_space': 'root',
                'visible': visible, 'grounded': grounded,
            })
    return occs


# ---------------------------------------------------------------- запуск

def build_package(design, document, settings, caps, report, progress=None, project_code=''):
    root, records = traversal.collect(design)
    include_helpers = bool(settings.get('export_include_helpers', False))
    include_hidden = bool(settings.get('export_include_hidden', False))
    components = []
    comp_ids = set()
    n = max(1, len(records))
    for i, rec in enumerate(records):
        if progress is not None and progress.update(i, n, 'Экспорт: {} ({} из {})'.format(rec.name, i + 1, n)):
            report.skip(STEP, 'экспорт прерван пользователем')
            return None
        kind = pp.component_kind(rec.name, _material_name(rec.component), not rec.is_leaf, rec.body_count, settings)
        if kind == 'helper' and not include_helpers:
            continue
        try:
            components.append(_export_component(rec, kind, settings, caps))
            comp_ids.add(rec.token)
        except Exception as exc:  # noqa: BLE001
            log.error('Экспорт компонента {}: {}'.format(rec.name, exc))
            report.error(STEP, 'E01_component_failed', 'Не удалось экспортировать компонент: {}'.format(exc),
                         entity=rec.name, path=rec.path, token=traversal.safe_token(rec.first))
    occurrences = _export_occurrences(records, comp_ids, include_hidden)

    doc = {'name': '', 'version': None, 'is_saved': None}
    try:
        doc['name'] = document.name
        doc['is_saved'] = bool(document.isSaved)
        doc['version'] = document.dataFile.versionNumber
    except Exception:  # noqa: BLE001
        pass
    # тела корневого компонента (их не должно быть — аудит ругается), но не теряем
    root_bodies = []
    for body in root.bRepBodies:
        root_bodies.append({'name': body.name, 'token': traversal.safe_token(body)})

    package = {
        'format': pp.FORMAT_NAME, 'version': pp.FORMAT_VERSION, 'units': 'mm',
        'exported_at': datetime.datetime.now().isoformat(timespec='seconds'),
        'exporter': config.ADDIN_NAME,
        'project_code': project_code, 'document': doc,
        'root': {'name': root.name, 'token': traversal.safe_token(root), 'bodies': root_bodies},
        'settings': {'part_number_template': settings.get('part_number_template'),
                     'helper_prefixes': settings.get('helper_prefixes'),
                     'hardware_prefixes': settings.get('hardware_prefixes'),
                     'materials': settings.get('materials')},
        'components': components,
        'occurrences': occurrences,
    }
    return package


def write_package(package, folder, project_code, now=None):
    now = now or datetime.datetime.now()
    folder = os.path.abspath(os.path.expanduser(folder or '.'))
    os.makedirs(folder, exist_ok=True)
    safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in (project_code or 'noname'))
    stamped = os.path.join(folder, '{}_export_{}.json'.format(safe, now.strftime('%Y%m%d_%H%M')))
    latest = os.path.join(folder, '{}_export.json'.format(safe))
    text = json.dumps(package, ensure_ascii=False, separators=(',', ':'))
    for path in (stamped, latest):
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)
    return stamped, latest


def run(design, document, settings, caps, report, progress=None, project_code=''):
    package = build_package(design, document, settings, caps, report, progress, project_code)
    if package is None:
        return None
    stamped, latest = write_package(package, settings.get('report_folder') or '.', project_code)
    parts = [c for c in package['components'] if c['kind'] == 'part']
    panels = [c for c in parts if c.get('panel')]
    report.summary['Пакет экспорта'] = stamped
    report.summary['Экспортировано компонентов / деталей / панелей'] = '{} / {} / {}'.format(
        len(package['components']), len(parts), len(panels))
    report.info(STEP, 'E00_export', 'Пакет для генератора чертежей записан: {} компонентов, {} вхождений'.format(
        len(package['components']), len(package['occurrences'])), details=stamped)
    for c in parts:
        if not c.get('panel'):
            report.info(STEP, 'E02_not_panel', 'Деталь не распознана как панель — контур не экспортирован, только сетка',
                        entity=c['name'], token=c['id'])
    log.info('Экспорт: {}'.format(stamped))
    return stamped

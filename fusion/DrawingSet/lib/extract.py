"""Extracts the Scene (faces, edges, holes, flat patterns) from the Fusion model.

Fusion-only module. Geometry is read through occurrence proxies, so points come back in
root-component coordinates (centimetres) and are converted to millimetres here.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from .geom import Vec3, cross, dot, mul, norm, sub, unit
from .model import ModelData
from .scene import BodyGeom, EdgeGeom, FaceGeom, FlatPatternGeom, Hole, LocalFrame, PartGeom, Scene

CM = 10.0
STROKE_TOL_CM = 0.02      # 0.2 mm chord tolerance for curved edges
HOLE_MAX_RADIUS_MM = 25.0


def _p(pt: Any) -> Vec3:
    return (float(pt.x) * CM, float(pt.y) * CM, float(pt.z) * CM)


def _v(vec: Any) -> Vec3:
    return (float(vec.x), float(vec.y), float(vec.z))


def edge_points(edge: Any) -> List[Vec3]:
    """Polyline of an edge (mm). Straight edges give two points, curves are stroked."""
    try:
        geom = edge.geometry
        ctype = geom.curveType
    except Exception:
        geom, ctype = None, -1
    try:
        import adsk.core  # type: ignore
        if ctype == adsk.core.Curve3DTypes.Line3DCurveType:
            return [_p(edge.startVertex.geometry), _p(edge.endVertex.geometry)]
    except Exception:
        pass
    try:
        ev = edge.evaluator
        ok, t0, t1 = ev.getParameterExtents()
        if ok:
            ok2, pts = ev.getStrokes(t0, t1, STROKE_TOL_CM)
            if ok2 and pts:
                return [_p(q) for q in pts]
    except Exception:
        pass
    try:
        return [_p(edge.startVertex.geometry), _p(edge.endVertex.geometry)]
    except Exception:
        return []


def _circle_info(edge: Any) -> Optional[Tuple[Vec3, Vec3, float]]:
    try:
        import adsk.core  # type: ignore
        geom = edge.geometry
        if geom.curveType == adsk.core.Curve3DTypes.Circle3DCurveType:
            return (_p(geom.center), _v(geom.normal), float(geom.radius) * CM)
    except Exception:
        pass
    return None


def loop_points(loop: Any) -> List[Vec3]:
    """Ordered points of a loop, following the co-edges so the polygon is continuous."""
    pts: List[Vec3] = []
    try:
        coedges = list(loop.coEdges)
    except Exception:
        coedges = []
    if coedges:
        for ce in coedges:
            try:
                seg = edge_points(ce.edge)
                if ce.isOpposedToEdge:
                    seg = list(reversed(seg))
            except Exception:
                continue
            if pts and seg and _close(pts[-1], seg[0]):
                seg = seg[1:]
            pts.extend(seg)
    else:
        for e in loop.edges:
            seg = edge_points(e)
            if pts and seg and _close(pts[-1], seg[0]):
                seg = seg[1:]
            pts.extend(seg)
    if len(pts) > 1 and _close(pts[0], pts[-1]):
        pts.pop()
    return pts


def _close(a: Vec3, b: Vec3, tol: float = 0.01) -> bool:
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol and abs(a[2] - b[2]) < tol


def _face_normal(face: Any, pts: List[Vec3]) -> Vec3:
    try:
        import adsk.core  # type: ignore
        geom = face.geometry
        if geom.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
            n = unit(_v(geom.normal))
            try:
                ok, nrm = face.evaluator.getNormalAtPoint(face.pointOnFace)
                if ok:
                    n = unit(_v(nrm))
            except Exception:
                pass
            return n
    except Exception:
        pass
    # polygon normal via Newell's method
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % len(pts)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    return unit((nx, ny, nz))


def extract_body(body: Any, log=None) -> BodyGeom:
    import adsk.core  # type: ignore
    out = BodyGeom()
    cyl_faces: List[Tuple[Any, float]] = []
    for face in body.faces:
        try:
            geom = face.geometry
            stype = geom.surfaceType
        except Exception:
            continue
        planar = stype == adsk.core.SurfaceTypes.PlaneSurfaceType
        loops: List[List[Vec3]] = []
        outer: Optional[List[Vec3]] = None
        for loop in face.loops:
            pts = loop_points(loop)
            if len(pts) < 2:
                continue
            if loop.isOuter and outer is None:
                outer = pts
            else:
                loops.append(pts)
        if outer is None:
            if not loops:
                continue
            outer = loops.pop(0)
        all_loops = [outer] + loops
        radius = 0.0
        if stype == adsk.core.SurfaceTypes.CylinderSurfaceType:
            radius = float(geom.radius) * CM
            if radius <= HOLE_MAX_RADIUS_MM:
                cyl_faces.append((face, radius))
        out.faces.append(FaceGeom(all_loops, _face_normal(face, outer) if planar else (0.0, 0.0, 0.0),
                                  planar=planar, cylinder_radius=radius))
    out.holes = _holes_from_cylinders(cyl_faces, body)
    return out


def _holes_from_cylinders(cyl_faces: List[Tuple[Any, float]], body: Any) -> List[Hole]:
    """A hole = a small cylindrical face whose circular edges touch the surrounding planar faces."""
    holes: List[Hole] = []
    seen_axes: List[Tuple[Vec3, Vec3, float]] = []
    for face, radius in cyl_faces:
        circles: List[Tuple[Vec3, Vec3, float, float]] = []   # center, normal, radius, adjacent planar area
        for edge in face.edges:
            ci = _circle_info(edge)
            if ci is None:
                continue
            center, normal, r = ci
            if abs(r - radius) > 0.05:
                continue
            adj_area = 0.0
            try:
                for f2 in edge.faces:
                    if f2 == face:
                        continue
                    try:
                        import adsk.core  # type: ignore
                        if f2.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
                            adj_area = max(adj_area, float(f2.area) * CM * CM)
                    except Exception:
                        continue
            except Exception:
                pass
            circles.append((center, unit(normal), r, adj_area))
        if len(circles) < 2:
            continue
        # entry = the circle sitting on the largest planar face; bottom = the other extreme
        circles.sort(key=lambda c: -c[3])
        entry_c, entry_n, r, entry_area = circles[0]
        far = max(circles[1:], key=lambda c: norm(sub(c[0], entry_c)))
        depth = norm(sub(far[0], entry_c))
        if depth < 0.1:
            continue
        axis = unit(sub(far[0], entry_c))
        cross_area = math.pi * r * r
        through = far[3] > 3.0 * cross_area and entry_area > 3.0 * cross_area
        key = (entry_c, axis, r)
        if any(_close(k[0], entry_c, 0.05) and abs(k[2] - r) < 0.05 for k in seen_axes):
            continue
        seen_axes.append(key)
        holes.append(Hole(entry=entry_c, axis=axis, radius=r, depth=depth, through=through))
    return holes


def _frame_of(entity: Any) -> Optional[LocalFrame]:
    try:
        box = entity.orientedMinimumBoundingBox
        if box is None:
            return None
        return LocalFrame(center=_p(box.centerPoint),
                          axes=(unit(_v(box.lengthDirection)), unit(_v(box.widthDirection)), unit(_v(box.heightDirection))),
                          dims=(float(box.length) * CM, float(box.width) * CM, float(box.height) * CM))
    except Exception:
        return None


def extract_scene(data: ModelData, log=None, progress=None) -> Scene:
    """Builds the Scene for every part occurrence in the model data."""
    scene = Scene()
    done_components: Dict[str, PartGeom] = {}
    total = len(data.parts)
    for i, rec in enumerate(data.parts):
        if rec.category == "assembly":
            continue
        occ = data.occurrences.get(rec.occ_id)
        if occ is None:
            continue
        if progress:
            progress(i, total, rec.raw_name)
        part = PartGeom(id=rec.occ_id)
        try:
            bodies = [b for b in occ.bRepBodies if b.isSolid and b.isVisible]
        except Exception:
            bodies = []
        for body in bodies:
            try:
                part.bodies.append(extract_body(body, log))
            except Exception as exc:
                if log:
                    log.warn(f"«{rec.raw_name}»: тело не прочитано: {exc}")
        part.frame = _frame_of(bodies[0]) if len(bodies) == 1 else _frame_of(occ)
        scene.parts[rec.occ_id] = part
        done_components[rec.component_id] = part
    for sm in data.sheet_metal:
        fp = sm.flat_pattern
        if fp is None:
            continue
        try:
            comp_id = str(getattr(sm.component, "id", ""))
            flat_body = extract_body(fp.flatBody, log)
            bends: List[List[Vec3]] = []
            try:
                for e in fp.bendLinesBody.edges:
                    pts = edge_points(e)
                    if len(pts) >= 2:
                        bends.append(pts)
            except Exception:
                pass
            thickness = 0.0
            try:
                thickness = float(sm.component.activeSheetMetalRule.thickness.value) * CM
            except Exception:
                pass
            scene.flat_patterns[comp_id] = FlatPatternGeom(body=flat_body, bend_lines=bends, thickness=thickness)
        except Exception as exc:
            if log:
                log.warn(f"«{sm.title}»: развёртка не прочитана: {exc}")
    return scene

"""Builds the exploded representation in Fusion.

Route A (storyboard): the designer made an Auto Explode storyboard by hand; the add-in only
activates it and moves the playhead to the end.

Route B (copy): saves a copy of the design, converts it to direct modelling, removes joints
and moves each occurrence with ``Occurrence.transform2`` by the offsets from ``lib.explode``.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

from .config import Settings
from .explode import ExplodeParams, ExplodeResult, axis_vector, compute_explode
from .model import ModelData

CM = 10.0


def explode_params(settings: Settings) -> ExplodeParams:
    return ExplodeParams(
        factor=settings.explode_factor, step_mm=settings.explode_step_mm,
        facade_mult=settings.explode_facade_mult, back_mult=settings.explode_back_mult,
        shelf_mult=settings.explode_shelf_mult, stagger=settings.explode_stagger,
        sub_scale=settings.explode_sub_scale, explode_subassemblies=settings.explode_subassemblies,
        hardware_mode=settings.hardware_mode, up=axis_vector(settings.up_axis),
        front_fallback=axis_vector(settings.front_axis))


def compute(data: ModelData, settings: Settings) -> ExplodeResult:
    return compute_explode(data.explode_items, explode_params(settings))


# ----------------------------------------------------------------------
def find_storyboard(design: Any, name: str):
    try:
        am = design.animationManager
        sb = am.storyboards.itemByName(name)
        return sb
    except Exception:
        return None


def activate_storyboard(design: Any, storyboard: Any, log=None) -> bool:
    try:
        storyboard.activate()
        try:
            storyboard.playheadPosition = storyboard.end
        except Exception:
            pass
        if log:
            log.info(f"Активирована раскадровка «{getattr(storyboard, 'name', '?')}», плейхед в конце.")
        return True
    except Exception as exc:
        if log:
            log.warn(f"Не удалось активировать раскадровку: {exc}")
        return False


# ----------------------------------------------------------------------
def _wait_upload(future: Any, timeout_s: float = 300.0, log=None):
    import adsk.core  # type: ignore
    finished = adsk.core.UploadStates.UploadFinished
    failed = getattr(adsk.core.UploadStates, "UploadFailed", -1)
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        state = future.uploadState
        if state == finished:
            return future.dataFile
        if state == failed:
            raise RuntimeError("Загрузка копии дизайна завершилась с ошибкой.")
        adsk.doEvents()
        time.sleep(0.25)
    raise RuntimeError("Истекло время ожидания загрузки копии дизайна.")


def save_copy(app: Any, doc: Any, root_component: Any, name: str, log=None):
    """Saves the root component as a new design next to the original. Returns DataFile."""
    folder = doc.dataFile.parentFolder
    future = root_component.saveCopyAs(name, folder, "Разнесённая копия для комплекта чертежей (DrawingSet)", "")
    df = _wait_upload(future, log=log)
    if log:
        log.info(f"Сохранена копия «{df.name}» (v{df.versionNumber}).")
    return df


def _world_matrix_of_parent(occ: Any):
    """Product of transform2 of all ancestors (rotation used to map world vectors)."""
    import adsk.core  # type: ignore
    m = adsk.core.Matrix3D.create()
    chain = []
    cur = getattr(occ, "assemblyContext", None)
    while cur is not None:
        chain.append(cur)
        cur = getattr(cur, "assemblyContext", None)
    for anc in reversed(chain):
        native = getattr(anc, "nativeObject", None) or anc
        m.transformBy(native.transform2)
    return m


def apply_offsets(copy_design: Any, result: ExplodeResult, data: ModelData, log=None) -> Tuple[int, int]:
    """Moves occurrences of the copy according to the explode result. Returns (moved, hidden)."""
    import adsk.core  # type: ignore
    import adsk.fusion  # type: ignore

    root = copy_design.rootComponent
    by_path: Dict[str, Any] = {}

    def index(parent: Any, is_root: bool) -> None:
        occs = parent.occurrences if is_root else parent.childOccurrences
        for o in occs:
            by_path[o.fullPathName] = o
            index(o, False)

    index(root, True)

    # joints would fight the transforms: the copy is disposable, remove them
    removed = 0
    for coll_name in ("allJoints", "allAsBuiltJoints", "allRigidGroups", "allAssemblyConstraints"):
        try:
            items = list(getattr(root, coll_name))
        except Exception:
            items = []
        for j in items:
            try:
                if j.deleteMe():
                    removed += 1
            except Exception:
                pass
    if removed and log:
        log.info(f"В копии удалено соединений/групп: {removed}.")

    moved = hidden = 0
    unmatched = []
    hidden_set = set(result.hidden)
    for occ_id, offset in result.offsets.items():
        occ = by_path.get(occ_id)
        if occ is None:
            unmatched.append(occ_id)
            continue
        if occ_id in hidden_set:
            try:
                occ.isLightBulbOn = False
                hidden += 1
            except Exception:
                pass
            continue
        if offset == (0.0, 0.0, 0.0):
            continue
        try:
            occ.isGrounded = False
        except Exception:
            pass
        try:
            parent_world = _world_matrix_of_parent(occ)
            inv = parent_world.copy()
            inv.invert()
            v = adsk.core.Vector3D.create(offset[0] / CM, offset[1] / CM, offset[2] / CM)
            v.transformBy(inv)
            # transforms are edited on the native occurrence (relative to its parent component)
            native = getattr(occ, "nativeObject", None) or occ
            m = native.transform2
            t = m.translation
            t.add(v)
            m.translation = t
            native.transform2 = m
            moved += 1
        except Exception as exc:
            if log:
                log.warn(f"Не удалось сдвинуть «{occ_id}»: {exc}")
    if unmatched and log:
        log.warn(f"В копии не найдены вхождения ({len(unmatched)}): {', '.join(unmatched[:5])}"
                 + (" …" if len(unmatched) > 5 else ""))
    try:
        if copy_design.snapshots.hasPendingSnapshot:
            copy_design.snapshots.add()
    except Exception:
        pass
    return moved, hidden


def build_exploded_copy(app: Any, doc: Any, design: Any, data: ModelData, settings: Settings, log=None):
    """Creates and saves the exploded copy. Returns (copy_document, data_file, explode_result)."""
    import adsk.core  # type: ignore
    import adsk.fusion  # type: ignore

    result = compute(data, settings)
    for n in result.notes:
        if log:
            log.info(n)
    base_name = data.product or doc.name
    copy_name = f"{base_name}_EXPLODE"
    df = save_copy(app, doc, design.rootComponent, copy_name, log)
    copy_doc = app.documents.open(df, True)
    copy_design = adsk.fusion.Design.cast(copy_doc.products.itemByProductType("DesignProductType"))
    try:
        if copy_design.designType == adsk.fusion.DesignTypes.ParametricDesignType:
            copy_design.designType = adsk.fusion.DesignTypes.DirectDesignType
    except Exception as exc:
        if log:
            log.warn(f"Копию не удалось перевести в прямое моделирование: {exc}")
    moved, hidden = apply_offsets(copy_design, result, data, log)
    if log:
        log.info(f"Разнесение: сдвинуто {moved}, скрыто {hidden} вхождений.")
    copy_doc.save("DrawingSet: exploded view")
    adsk.doEvents()
    # make sure the saved version is complete before handing it to the drawing generator
    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            if copy_doc.dataFile.isComplete:
                break
        except Exception:
            break
        adsk.doEvents()
        time.sleep(0.25)
    return copy_doc, copy_doc.dataFile, result

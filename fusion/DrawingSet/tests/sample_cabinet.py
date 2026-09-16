"""A synthetic cabinet (model data + scene) shared by tests and the offline preview."""
from __future__ import annotations

from typing import Tuple

from lib.bom import BendRow, PartRecord
from lib.explode import ExplodeItem
from lib.model import ModelData
from lib.scene import BodyGeom, EdgeGeom, FaceGeom, FlatPatternGeom, Scene
from tests.synth import box_part

# Y up, front = -Z (the back panel sits at +Z). 800 wide × 720 high × 400 deep, 16 mm panels.
SPEC = [
    # id, title, pos, material, category, center, dims, holes
    ("left", "Боковина", "01", "ЛДСП Egger W980", "side", (-392, 0, 0), (16, 720, 400),
     [("+x", 100, 150, 2.5, 12), ("+x", -100, 150, 2.5, 12), ("+x", 100, -150, 2.5, 12), ("+x", -100, -150, 2.5, 12),
      ("+x", 336, 0, 4.0, None), ("+x", -336, 0, 4.0, None), ("-z", 0, -100, 4.0, 30)]),
    ("right", "Боковина", "01", "ЛДСП Egger W980", "side", (392, 0, 0), (16, 720, 400),
     [("-x", 100, 150, 2.5, 12), ("-x", -100, 150, 2.5, 12), ("-x", 100, -150, 2.5, 12), ("-x", -100, -150, 2.5, 12)]),
    ("top", "Крышка", "02", "ЛДСП Egger W980", "top", (0, 352, 0), (768, 16, 400),
     [("+y", 300, 0, 2.5, 12), ("+y", -300, 0, 2.5, 12), ("+y", 300, 150, 2.5, 12), ("+y", -300, 150, 2.5, 12)]),
    ("bottom", "Дно", "03", "ЛДСП Egger W980", "bottom", (0, -352, 0), (768, 16, 400), []),
    ("shelf", "Полка", "04", "ЛДСП Egger W980", "shelf", (0, 0, 10), (768, 16, 380),
     [("-x", 0, -100, 2.5, 12), ("+x", 0, -100, 2.5, 12)]),
    ("back", "Задняя стенка", "05", "ХДФ белый", "back", (0, 0, 196), (768, 688, 4), []),
    ("door", "Фасад", "06", "МДФ эмаль", "facade", (0, 0, -209), (796, 716, 18),
     [("+z", -370, 250, 17.5, 13), ("+z", -370, -250, 17.5, 13)]),
    ("screw1", "Конфирмат 7x50", "10", "Сталь", "hardware", (380, 336, 0), (7, 7, 50), []),
    ("screw2", "Конфирмат 7x50", "10", "Сталь", "hardware", (-380, 336, 0), (7, 7, 50), []),
    ("bracket", "Кронштейн", "07", "Нержавеющая сталь AISI 304", "other", (0, -330, -150), (120, 2, 60), []),
]


def build() -> Tuple[ModelData, Scene]:
    data = ModelData(product="Шкаф барный", project="37-4", view="В1")
    scene = Scene()
    for pid, title, pos, material, cat, center, dims, holes in SPEC:
        occ_id = f"37-4_В1_П{pos}_{title}:{pid}"
        part = box_part(occ_id, center, dims, holes)
        scene.parts[occ_id] = part
        sd = sorted(dims, reverse=True)
        hw = cat == "hardware"
        data.parts.append(PartRecord(
            occ_id=occ_id, component_id=f"c_{pid if pid not in ('right', 'screw2') else ('left' if pid == 'right' else 'screw1')}",
            raw_name=occ_id.split(":")[0], title=title, position=pos, project="37-4", view="В1", material=material,
            thickness_mm=sd[2], length_mm=sd[0], width_mm=sd[1], category=cat, is_hardware=hw,
            is_sheet_metal=(pid == "bracket"), edge="ПВХ 2 мм" if pid == "door" else ""))
        data.explode_items.append(ExplodeItem(id=occ_id, center=center, axes=part.frame.axes, dims=dims,
                                              category=cat, is_hardware=hw))
    # flat pattern for the bracket: L-bracket 120 × (60 + 40) with one bend
    outline = [(0.0, 0.0, 0.0), (120.0, 0.0, 0.0), (120.0, 100.0, 0.0), (0.0, 100.0, 0.0)]
    body = BodyGeom(faces=[FaceGeom([outline, ], (0.0, 0.0, 1.0), planar=True)])
    scene.flat_patterns["c_bracket"] = FlatPatternGeom(body=body, bend_lines=[[(0.0, 60.0, 0.0), (120.0, 60.0, 0.0)]],
                                                       thickness=2.0)
    data.bends.append(BendRow("07 Кронштейн", 1, 90.0, "вверх", 2.0, 0.44, 2.0))
    data.sheet_metal = []
    data.section_markers = ["Шкаф барный: РАЗРЕЗ А-А"]
    return data, scene

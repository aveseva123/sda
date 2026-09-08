// Calibration target definition: four ArUco markers (DICT_4X4_50, ids 0..3) whose centres form a rectangle.
// Target frame: millimetres, origin at the centre of marker id0, X to the right (towards id1), Y down (towards id3).

export const DEFAULT_TARGET = Object.freeze({
  dictionary: 'DICT_4X4_50',
  ids: [0, 1, 2, 3],
  markerSideMm: 40,
  spacingXMm: 130,
  spacingYMm: 210,
  printScale: 1.0,
});

export function markerCentersMm(target = DEFAULT_TARGET) {
  const s = target.printScale || 1;
  const sx = target.spacingXMm * s;
  const sy = target.spacingYMm * s;
  const [id0, id1, id2, id3] = target.ids;
  return [
    { id: id0, x: 0, y: 0 },
    { id: id1, x: sx, y: 0 },
    { id: id2, x: sx, y: sy },
    { id: id3, x: 0, y: sy },
  ];
}

// Corners in ArUco order: top-left, top-right, bottom-right, bottom-left (as printed, Y down).
export function markerCornersMm(target, id) {
  const c = markerCentersMm(target).find((m) => m.id === id);
  if (!c) return null;
  const h = (target.markerSideMm * (target.printScale || 1)) / 2;
  return [
    [c.x - h, c.y - h],
    [c.x + h, c.y - h],
    [c.x + h, c.y + h],
    [c.x - h, c.y + h],
  ];
}

export function allCorrespondences(target = DEFAULT_TARGET) {
  const out = [];
  for (const { id } of markerCentersMm(target)) {
    const corners = markerCornersMm(target, id);
    corners.forEach(([x, y], cornerIndex) => out.push({ id, cornerIndex, x, y }));
  }
  return out;
}

export function targetBoundsMm(target = DEFAULT_TARGET, marginMm = 10) {
  const h = (target.markerSideMm * (target.printScale || 1)) / 2;
  const s = target.printScale || 1;
  return {
    minX: -h - marginMm,
    minY: -h - marginMm,
    maxX: target.spacingXMm * s + h + marginMm,
    maxY: target.spacingYMm * s + h + marginMm,
  };
}

export function targetPolygonMm(target = DEFAULT_TARGET, marginMm = 10) {
  const b = targetBoundsMm(target, marginMm);
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
}

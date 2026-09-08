import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hungarian } from '../src/match/hungarian.js';
import { partDiscrepancy, matchParts } from '../src/match/assign.js';

// Deterministic PRNG (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalCost(cost, pairs) {
  let s = 0;
  for (const [i, j] of pairs) s += cost[i][j];
  return s;
}

// Brute force: enumerate ordered selections of min(rows, cols) distinct columns (or rows).
function bruteForce(cost) {
  const rows = cost.length; const cols = rows ? cost[0].length : 0;
  if (!rows || !cols) return 0;
  const transpose = rows > cols;
  const M = transpose ? cost[0].map((_, j) => cost.map((r) => r[j])) : cost;
  const n = M.length; const m = M[0].length;
  let best = Infinity;
  const used = new Array(m).fill(false);
  const rec = (i, acc) => {
    if (i === n) { if (acc < best) best = acc; return; }
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      used[j] = true; rec(i + 1, acc + M[i][j]); used[j] = false;
    }
  };
  rec(0, 0);
  return best;
}

function assertValidAssignment(cost, pairs) {
  const rows = cost.length; const cols = rows ? cost[0].length : 0;
  assert.equal(pairs.length, Math.min(rows, cols), 'pair count');
  const rs = new Set(); const cs = new Set();
  for (const [i, j] of pairs) {
    assert.ok(Number.isInteger(i) && i >= 0 && i < rows, `row ${i}`);
    assert.ok(Number.isInteger(j) && j >= 0 && j < cols, `col ${j}`);
    assert.ok(!rs.has(i), 'row used twice'); assert.ok(!cs.has(j), 'col used twice');
    rs.add(i); cs.add(j);
  }
}

test('hungarian: classic 3x3 matrix gives cost 5', () => {
  const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
  const pairs = hungarian(cost);
  assertValidAssignment(cost, pairs);
  assert.equal(totalCost(cost, pairs), 5);
  assert.deepEqual(pairs, [[0, 1], [1, 0], [2, 2]]);
});

test('hungarian: matches brute force on 200 random 5x5 matrices', () => {
  const rng = mulberry32(12345);
  for (let t = 0; t < 200; t++) {
    const cost = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => Math.round(rng() * 1000) / 10));
    const pairs = hungarian(cost);
    assertValidAssignment(cost, pairs);
    const c = totalCost(cost, pairs); const b = bruteForce(cost);
    assert.ok(Math.abs(c - b) < 1e-9, `5x5 #${t}: hungarian ${c} vs brute ${b}`);
  }
});

test('hungarian: matches brute force on 200 random 4x6 matrices (and 200 transposed 6x4)', () => {
  const rng = mulberry32(777);
  for (const [rows, cols] of [[4, 6], [6, 4]]) {
    for (let t = 0; t < 200; t++) {
      const cost = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(rng() * 1000) / 10));
      const pairs = hungarian(cost);
      assertValidAssignment(cost, pairs);
      const c = totalCost(cost, pairs); const b = bruteForce(cost);
      assert.ok(Math.abs(c - b) < 1e-9, `${rows}x${cols} #${t}: hungarian ${c} vs brute ${b}`);
    }
  }
});

test('hungarian: rectangular matrices return min(rows, cols) pairs', () => {
  const wide = [[10, 1, 10, 10], [10, 10, 10, 1]];
  const p1 = hungarian(wide);
  assertValidAssignment(wide, p1);
  assert.deepEqual(p1, [[0, 1], [1, 3]]);
  const tall = [[10, 10], [1, 10], [10, 10], [10, 1]];
  const p2 = hungarian(tall);
  assertValidAssignment(tall, p2);
  assert.deepEqual(p2, [[1, 0], [3, 1]]);
  const single = [[5, 3, 9]];
  assert.deepEqual(hungarian(single), [[0, 1]]);
  const column = [[5], [3], [9]];
  assert.deepEqual(hungarian(column), [[1, 0]]);
});

test('hungarian: big costs (1e6 + d) and Infinity are avoided when possible', () => {
  const cost = [[1e6 + 1, 2], [1e6 + 3, 1e6 + 4]];
  const pairs = hungarian(cost);
  assertValidAssignment(cost, pairs);
  assert.equal(totalCost(cost, pairs), 1e6 + 5);
  assert.deepEqual(pairs, [[0, 1], [1, 0]]);

  const inf = [[Infinity, 1], [1, Infinity]];
  const p2 = hungarian(inf);
  assertValidAssignment(inf, p2);
  assert.deepEqual(p2, [[0, 1], [1, 0]]);

  // A row with only Infinity still gets assigned (count must stay min(rows, cols)).
  const allInf = [[Infinity, Infinity], [1, 2]];
  const p3 = hungarian(allInf);
  assertValidAssignment(allInf, p3);
  assert.deepEqual(p3, [[0, 1], [1, 0]]);

  // A row made only of 1e6 + d costs (the matchParts "out of tolerance" encoding) is still assigned,
  // and the cheapest big entry is chosen for it without disturbing the finite row.
  const bigRow = [[1e6 + 1, 1e6 + 2, 1e6 + 0.5], [3, 1e6 + 4, 1e6 + 5]];
  const pb = hungarian(bigRow);
  assertValidAssignment(bigRow, pb);
  assert.deepEqual(pb, [[0, 2], [1, 0]]);
  assert.ok(Math.abs(totalCost(bigRow, pb) - (1e6 + 3.5)) < 1e-6);
  assert.ok(Math.abs(totalCost(bigRow, pb) - bruteForce(bigRow)) < 1e-6);

  // Mixed: three finite rows plus big costs; optimal must pick the small ones.
  const mixed = [
    [0.5, 1e6 + 0.1, 1e6 + 0.2],
    [1e6 + 0.3, 0.7, 1e6 + 0.4],
    [1e6 + 0.5, 1e6 + 0.6, 1.2],
  ];
  const p4 = hungarian(mixed);
  assertValidAssignment(mixed, p4);
  assert.ok(Math.abs(totalCost(mixed, p4) - 2.4) < 1e-9);
  assert.ok(Math.abs(totalCost(mixed, p4) - bruteForce(mixed)) < 1e-9);
});

test('hungarian: empty inputs', () => {
  assert.deepEqual(hungarian([]), []);
  assert.deepEqual(hungarian([[]]), []);
  assert.deepEqual(hungarian([[], []]), []);
});

test('hungarian: negative costs and ties are handled', () => {
  const cost = [[-5, 2, 3], [1, -4, 6], [2, 2, 2]];
  const pairs = hungarian(cost);
  assertValidAssignment(cost, pairs);
  assert.ok(Math.abs(totalCost(cost, pairs) - bruteForce(cost)) < 1e-9);
  const ties = [[1, 1], [1, 1]];
  assertValidAssignment(ties, hungarian(ties));
});

test('partDiscrepancy: same and rotated orientations, ties prefer same', () => {
  const same = partDiscrepancy({ lengthMm: 381, widthMm: 241.2 }, { lengthMm: 380, widthMm: 240 });
  assert.equal(same.orientation, 'same');
  assert.ok(Math.abs(same.discrepancyMm - 1.2) < 1e-9);
  assert.ok(Math.abs(same.dL - 1) < 1e-9 && Math.abs(same.dW - 1.2) < 1e-9);

  const rot = partDiscrepancy({ lengthMm: 240.8, widthMm: 379.4 }, { lengthMm: 380, widthMm: 240 });
  assert.equal(rot.orientation, 'rotated');
  assert.ok(Math.abs(rot.discrepancyMm - 0.8) < 1e-9);
  assert.ok(Math.abs(rot.dL - (-0.6)) < 1e-9 && Math.abs(rot.dW - 0.8) < 1e-9);

  const sq = partDiscrepancy({ lengthMm: 100, widthMm: 100 }, { lengthMm: 100, widthMm: 100 });
  assert.equal(sq.orientation, 'same');
  assert.equal(sq.discrepancyMm, 0);

  // Plan part not normalised (width > length) still works.
  const unnorm = partDiscrepancy({ lengthMm: 300, widthMm: 200 }, { lengthMm: 200, widthMm: 300 });
  assert.equal(unnorm.orientation, 'rotated');
  assert.equal(unnorm.discrepancyMm, 0);
});

const PLAN = [
  { id: 'SHELF-04', lengthMm: 380, widthMm: 240, qty: 2 },
  { id: 'PLATE-A', lengthMm: 500, widthMm: 120.5, qty: 1 },
  { id: 'SQ', lengthMm: 100, widthMm: 100, qty: 1 },
];
const MEASURED = [
  { lengthMm: 240.8, widthMm: 379.4 },
  { lengthMm: 381, widthMm: 241.2 },
  { lengthMm: 499.1, widthMm: 121 },
  { lengthMm: 150, widthMm: 150 },
];

test('matchParts: SPEC scenario (qty expansion, rotation, missing, extra)', () => {
  const r = matchParts(MEASURED, PLAN, { toleranceMm: 3, ambiguityMm: 5 });

  assert.equal(r.matches.length, 3);
  const byMeasured = Object.fromEntries(r.matches.map((m) => [m.measuredIndex, m]));
  assert.equal(byMeasured[0].planId, 'SHELF-04');
  assert.equal(byMeasured[0].orientation, 'rotated');
  assert.equal(byMeasured[0].planIndex, 0);
  assert.ok(Math.abs(byMeasured[0].discrepancyMm - 0.8) < 1e-9);
  assert.equal(byMeasured[1].planId, 'SHELF-04');
  assert.equal(byMeasured[1].orientation, 'same');
  assert.ok(Math.abs(byMeasured[1].discrepancyMm - 1.2) < 1e-9);
  assert.equal(byMeasured[2].planId, 'PLATE-A');
  assert.equal(byMeasured[2].planIndex, 1);
  assert.equal(byMeasured[2].orientation, 'same');
  assert.ok(Math.abs(byMeasured[2].discrepancyMm - 0.9) < 1e-9);
  assert.ok(Math.abs(byMeasured[2].dL - (-0.9)) < 1e-9 && Math.abs(byMeasured[2].dW - 0.5) < 1e-9);
  assert.equal(byMeasured[3], undefined);

  assert.deepEqual(r.missing, [{ planId: 'SQ', planIndex: 2, lengthMm: 100, widthMm: 100, qtyPlanned: 1, qtyFound: 0, qtyMissing: 1 }]);

  assert.equal(r.extra.length, 1);
  assert.equal(r.extra[0].measuredIndex, 3);
  assert.equal(r.extra[0].lengthMm, 150);
  assert.equal(r.extra[0].widthMm, 150);
  assert.equal(r.extra[0].nearest.planId, 'SQ');
  assert.ok(Math.abs(r.extra[0].nearest.discrepancyMm - 50) < 1e-9);

  // Candidates: per measured, top-5 ascending by discrepancy, one entry per plan part.
  assert.deepEqual(Object.keys(r.candidates).map(Number).sort(), [0, 1, 2, 3]);
  for (let i = 0; i < 4; i++) {
    const c = r.candidates[i];
    assert.equal(c.length, 3);
    for (let k = 1; k < c.length; k++) assert.ok(c[k - 1].discrepancyMm <= c[k].discrepancyMm);
  }
  assert.equal(r.candidates[0][0].planId, 'SHELF-04');
  assert.equal(r.candidates[0][0].orientation, 'rotated');
  assert.equal(r.candidates[3][0].planId, 'SQ');
  assert.deepEqual(r.ambiguous, []);
});

test('matchParts: ambiguous when two plan parts are within tolerance and closer than ambiguityMm', () => {
  const plan = [
    { id: 'A', lengthMm: 300, widthMm: 200, qty: 1 },
    { id: 'B', lengthMm: 302, widthMm: 200, qty: 1 },
  ];
  const r = matchParts([{ lengthMm: 301, widthMm: 200.2 }], plan, { toleranceMm: 3, ambiguityMm: 5 });
  assert.equal(r.matches.length, 1);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].measuredIndex, 0);
  assert.deepEqual([...r.ambiguous[0].planIds].sort(), ['A', 'B']);
  assert.equal(r.missing.length, 1);
  assert.equal(r.extra.length, 0);

  // Not ambiguous when the second candidate is outside tolerance.
  const plan2 = [
    { id: 'A', lengthMm: 300, widthMm: 200, qty: 1 },
    { id: 'C', lengthMm: 310, widthMm: 200, qty: 1 },
  ];
  const r2 = matchParts([{ lengthMm: 301, widthMm: 200.2 }], plan2);
  assert.deepEqual(r2.ambiguous, []);
  assert.equal(r2.matches[0].planId, 'A');

  // Not ambiguous when the difference between candidates is >= ambiguityMm (A: 0.5, B: 1.5).
  const r3 = matchParts([{ lengthMm: 300.5, widthMm: 200 }], plan, { toleranceMm: 3, ambiguityMm: 0.5 });
  assert.deepEqual(r3.ambiguous, []);
  const r3b = matchParts([{ lengthMm: 300.5, widthMm: 200 }], plan, { toleranceMm: 3, ambiguityMm: 1.5 });
  assert.equal(r3b.ambiguous.length, 1);

  // Two columns of the same plan part (qty 2) never make it ambiguous.
  const r4 = matchParts([{ lengthMm: 301, widthMm: 200.2 }], [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 2 }]);
  assert.deepEqual(r4.ambiguous, []);
});

test('matchParts: tolerance boundary — discrepancy of exactly 3.0 counts as a match', () => {
  const plan = [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 1 }];
  const ok = matchParts([{ lengthMm: 303, widthMm: 200 }], plan, { toleranceMm: 3 });
  assert.equal(ok.matches.length, 1);
  assert.equal(ok.matches[0].discrepancyMm, 3);
  assert.deepEqual(ok.missing, []);
  assert.deepEqual(ok.extra, []);

  const bad = matchParts([{ lengthMm: 303.01, widthMm: 200 }], plan, { toleranceMm: 3 });
  assert.equal(bad.matches.length, 0);
  assert.equal(bad.missing.length, 1);
  assert.equal(bad.missing[0].qtyMissing, 1);
  assert.equal(bad.extra.length, 1);
  assert.equal(bad.extra[0].nearest.planId, 'A');
  assert.ok(Math.abs(bad.extra[0].nearest.discrepancyMm - 3.01) < 1e-9);
});

test('matchParts: quantity accounting (qty expansion, missing counts, qty defaults to 1)', () => {
  const plan = [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 3 }];
  const measured = [
    { lengthMm: 300.5, widthMm: 200 },
    { lengthMm: 200, widthMm: 299 },
    { lengthMm: 300, widthMm: 200 },
    { lengthMm: 302, widthMm: 201 }, // fourth A (worst fit): only 3 planned -> extra with nearest A
  ];
  const r = matchParts(measured, plan);
  assert.equal(r.matches.length, 3);
  assert.ok(r.matches.every((m) => m.planId === 'A'));
  assert.deepEqual(r.missing, []);
  assert.equal(r.extra.length, 1);
  // Hungarian keeps the three best fits: the extra one is the worst of the four A candidates.
  assert.equal(r.extra[0].measuredIndex, 3);
  assert.equal(r.extra[0].nearest.planId, 'A');
  assert.equal(r.extra[0].nearest.discrepancyMm, 2);

  // A plan part without a qty field counts as 1 and shows up in missing when not found.
  const r2 = matchParts([{ lengthMm: 300, widthMm: 200 }], [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 1 }, { id: 'B', lengthMm: 50, widthMm: 40 }]);
  assert.equal(r2.matches.length, 1);
  assert.deepEqual(r2.missing, [{ planId: 'B', planIndex: 1, lengthMm: 50, widthMm: 40, qtyPlanned: 1, qtyFound: 0, qtyMissing: 1 }]);
  assert.deepEqual(r2.extra, []);

  // qty 2 with a single measured part: one found, one missing.
  const r3 = matchParts([{ lengthMm: 300, widthMm: 200 }], [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 2 }]);
  assert.deepEqual(r3.missing, [{ planId: 'A', planIndex: 0, lengthMm: 300, widthMm: 200, qtyPlanned: 2, qtyFound: 1, qtyMissing: 1 }]);
  // Fully found parts are not listed in missing.
  const r4 = matchParts([{ lengthMm: 300, widthMm: 200 }, { lengthMm: 200, widthMm: 300 }], [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 2 }]);
  assert.deepEqual(r4.missing, []);
  assert.equal(r4.matches.length, 2);
});

test('matchParts: assignment is globally optimal (not greedy)', () => {
  // Greedy by first measured would take A for measured 0 (disc 1), leaving measured 1 with nothing;
  // the optimum gives measured 0 -> B (disc 2), measured 1 -> A (disc 0.5).
  const plan = [{ id: 'A', lengthMm: 300, widthMm: 200, qty: 1 }, { id: 'B', lengthMm: 300, widthMm: 210, qty: 1 }];
  const measured = [{ lengthMm: 300, widthMm: 208 }, { lengthMm: 300, widthMm: 200.5 }];
  const r = matchParts(measured, plan, { toleranceMm: 3, ambiguityMm: 5 });
  assert.equal(r.matches.length, 2);
  const byMeasured = Object.fromEntries(r.matches.map((m) => [m.measuredIndex, m.planId]));
  assert.deepEqual(byMeasured, { 0: 'B', 1: 'A' });
});

test('matchParts: candidates are limited to top-5 and edge cases (no plan / no measured)', () => {
  const plan = Array.from({ length: 8 }, (_, k) => ({ id: `P${k}`, lengthMm: 100 + k * 10, widthMm: 50, qty: 1 }));
  const r = matchParts([{ lengthMm: 131, widthMm: 50 }], plan);
  assert.equal(r.candidates[0].length, 5);
  assert.equal(r.candidates[0][0].planId, 'P3');
  for (let k = 1; k < 5; k++) assert.ok(r.candidates[0][k - 1].discrepancyMm <= r.candidates[0][k].discrepancyMm);

  const noPlan = matchParts([{ lengthMm: 100, widthMm: 50 }], []);
  assert.deepEqual(noPlan.matches, []);
  assert.deepEqual(noPlan.missing, []);
  assert.equal(noPlan.extra.length, 1);
  assert.equal(noPlan.extra[0].nearest, null);
  assert.deepEqual(noPlan.candidates[0], []);
  assert.deepEqual(noPlan.ambiguous, []);

  const noMeasured = matchParts([], plan.slice(0, 2));
  assert.deepEqual(noMeasured.matches, []);
  assert.equal(noMeasured.missing.length, 2);
  assert.ok(noMeasured.missing.every((m) => m.qtyMissing === 1 && m.qtyFound === 0));
  assert.deepEqual(noMeasured.extra, []);
  assert.deepEqual(noMeasured.candidates, {});

  // Plan parts with polygonMm/rectangular flags are matched by dimensions only.
  const withPoly = [{ id: 'X', lengthMm: 100, widthMm: 50, qty: 1, polygonMm: [[0, 0], [100, 0], [100, 50], [0, 50]], rectangular: true, areaMm2: 5000 }];
  const r2 = matchParts([{ lengthMm: 50.2, widthMm: 99.9 }], withPoly);
  assert.equal(r2.matches.length, 1);
  assert.equal(r2.matches[0].orientation, 'rotated');
});

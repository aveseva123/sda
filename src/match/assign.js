// Assignment of measured parts to plan parts (SPEC 6.5). Pure JS, no DOM.
import { hungarian } from './hungarian.js';

const BIG_COST = 1e6;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

// Discrepancy between a measured part m and a plan part p in the best of the two orientations.
// 'same': measured length vs plan length; 'rotated': measured length vs plan width (the part lies
// turned by 90 deg relative to how the plan lists it). dL/dW are measured minus plan along the plan's
// length/width axes. Neither input needs to satisfy lengthMm >= widthMm: both orientations are tried.
export function partDiscrepancy(m, p) {
  const mL = num(m && m.lengthMm); const mW = num(m && m.widthMm);
  const pL = num(p && p.lengthMm); const pW = num(p && p.widthMm);
  const sameDL = mL - pL; const sameDW = mW - pW;
  const rotDL = mW - pL; const rotDW = mL - pW;
  const sameD = Math.max(Math.abs(sameDL), Math.abs(sameDW));
  const rotD = Math.max(Math.abs(rotDL), Math.abs(rotDW));
  const sameOk = Number.isFinite(sameD);
  const rotOk = Number.isFinite(rotD);
  if (!sameOk && !rotOk) return { discrepancyMm: Infinity, orientation: 'same', dL: NaN, dW: NaN };
  // Prefer 'same' on ties (square parts).
  if (sameOk && (!rotOk || sameD <= rotD)) return { discrepancyMm: sameD, orientation: 'same', dL: sameDL, dW: sameDW };
  return { discrepancyMm: rotD, orientation: 'rotated', dL: rotDL, dW: rotDW };
}

// Planned quantity: missing qty counts as 1; non-numeric as 1; negative/fractional are clamped.
function planQty(p) {
  if (!p || p.qty === undefined || p.qty === null) return 1;
  const q = Number(p.qty);
  if (!Number.isFinite(q)) return 1;
  return Math.max(0, Math.floor(q));
}

export function matchParts(measured, planParts, { toleranceMm = 3, ambiguityMm = 5 } = {}) {
  const meas = Array.isArray(measured) ? measured : [];
  const plan = Array.isArray(planParts) ? planParts : [];
  const tol = Number.isFinite(toleranceMm) ? toleranceMm : 3;
  const amb = Number.isFinite(ambiguityMm) ? ambiguityMm : 5;

  // Discrepancy of every measured part against every plan part (per plan part, not per qty column).
  const disc = meas.map((m) => plan.map((p) => partDiscrepancy(m, p)));

  // Expand plan parts by qty into columns.
  const columns = []; // planIndex per column
  plan.forEach((p, planIndex) => {
    const q = planQty(p);
    for (let k = 0; k < q; k++) columns.push(planIndex);
  });

  const cost = meas.map((_, i) => columns.map((planIndex) => {
    const d = disc[i][planIndex].discrepancyMm;
    if (!Number.isFinite(d)) return BIG_COST * 2;
    return d <= tol ? d : BIG_COST + d;
  }));

  const pairs = (meas.length && columns.length) ? hungarian(cost) : [];

  const matches = [];
  const matchedMeasured = new Set();
  const foundPerPlan = new Array(plan.length).fill(0);
  for (const [i, col] of pairs) {
    const planIndex = columns[col];
    const d = disc[i][planIndex];
    if (!(d.discrepancyMm <= tol)) continue;
    const p = plan[planIndex];
    matches.push({
      measuredIndex: i,
      planId: p.id,
      planIndex,
      discrepancyMm: d.discrepancyMm,
      orientation: d.orientation,
      dL: d.dL,
      dW: d.dW,
    });
    matchedMeasured.add(i);
    foundPerPlan[planIndex] += 1;
  }
  matches.sort((a, b) => a.measuredIndex - b.measuredIndex);

  const missing = [];
  plan.forEach((p, planIndex) => {
    const qtyPlanned = planQty(p);
    const qtyFound = foundPerPlan[planIndex];
    const qtyMissing = qtyPlanned - qtyFound;
    if (qtyMissing > 0) {
      missing.push({ planId: p.id, planIndex, lengthMm: p.lengthMm, widthMm: p.widthMm, qtyPlanned, qtyFound, qtyMissing });
    }
  });

  const candidates = {};
  const ambiguous = [];
  const extra = [];
  meas.forEach((m, i) => {
    const list = plan.map((p, planIndex) => ({
      planId: p.id,
      planIndex,
      discrepancyMm: disc[i][planIndex].discrepancyMm,
      orientation: disc[i][planIndex].orientation,
    }));
    list.sort((a, b) => (a.discrepancyMm - b.discrepancyMm) || (a.planIndex - b.planIndex));
    candidates[i] = list.slice(0, 5);

    // Ambiguity: the best candidate and at least one other plan id both within tolerance and
    // closer to each other than ambiguityMm.
    if (list.length >= 2 && list[0].discrepancyMm <= tol) {
      const best = list[0];
      const ids = [best.planId];
      for (let k = 1; k < list.length; k++) {
        const c = list[k];
        if (c.discrepancyMm > tol) break;
        if (c.planId === best.planId || ids.includes(c.planId)) continue;
        if (c.discrepancyMm - best.discrepancyMm < amb) ids.push(c.planId);
      }
      if (ids.length >= 2) ambiguous.push({ measuredIndex: i, planIds: ids });
    }

    if (!matchedMeasured.has(i)) {
      const best = list.length && Number.isFinite(list[0].discrepancyMm) ? list[0] : null;
      extra.push({
        measuredIndex: i,
        lengthMm: m ? m.lengthMm : undefined,
        widthMm: m ? m.widthMm : undefined,
        nearest: best ? { planId: best.planId, discrepancyMm: best.discrepancyMm } : null,
      });
    }
  });

  return { matches, missing, extra, candidates, ambiguous };
}

// Kuhn-Munkres (Hungarian) assignment for rectangular cost matrices, O(n^2 * m) with potentials
// (Jonker-Volgenant style shortest augmenting paths). Pure JS, no DOM.
//
// hungarian(cost) -> [[row, col], ...] with minimal total cost; exactly min(rows, cols) pairs,
// sorted by row. Non-finite entries (Infinity, NaN, missing cells of ragged rows) are treated as
// "forbidden": they are replaced by a finite BIG value larger than any possible finite assignment,
// so an assignment using them is chosen only when unavoidable.

function sanitize(cost, rows, cols) {
  // Flatten to Float64Array (row-major), replacing non-finite values by BIG.
  let maxAbs = 0;
  for (let i = 0; i < rows; i++) {
    const r = cost[i] || [];
    for (let j = 0; j < cols; j++) {
      const v = r[j];
      if (typeof v === 'number' && Number.isFinite(v)) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; }
    }
  }
  const n = Math.min(rows, cols);
  // Any assignment uses at most n entries, so its finite part lies in [-n*maxAbs, n*maxAbs].
  const BIG = 2 * n * Math.max(1, maxAbs) + 1;
  const A = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    const r = cost[i] || [];
    for (let j = 0; j < cols; j++) {
      const v = r[j];
      A[i * cols + j] = (typeof v === 'number' && Number.isFinite(v)) ? v : BIG;
    }
  }
  return A;
}

// Solve for n rows <= m cols, matrix A (row-major n x m). Returns Int32Array colOfRow (0-based).
function solveWide(A, n, m) {
  const INF = Infinity;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1); // p[j] = row (1-based) matched to column j, 0 = free
  const way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(INF);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      const rowBase = (i0 - 1) * m;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = A[rowBase + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      if (j1 === 0) {
        // Cannot happen with finite costs and n <= m (there is always a free column); guard anyway.
        break;
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    // Augment along the alternating path.
    while (j0) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    }
  }
  const colOfRow = new Int32Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) colOfRow[p[j] - 1] = j - 1;
  return colOfRow;
}

export function hungarian(cost) {
  if (!Array.isArray(cost) || cost.length === 0) return [];
  const rows = cost.length;
  let cols = 0;
  for (const r of cost) if (Array.isArray(r) && r.length > cols) cols = r.length;
  if (cols === 0) return [];

  const A = sanitize(cost, rows, cols);
  let pairs;
  if (rows <= cols) {
    const colOfRow = solveWide(A, rows, cols);
    pairs = [];
    for (let i = 0; i < rows; i++) if (colOfRow[i] >= 0) pairs.push([i, colOfRow[i]]);
  } else {
    // Transpose so that rows <= cols, solve, and swap back.
    const T = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) T[j * rows + i] = A[i * cols + j];
    const rowOfCol = solveWide(T, cols, rows);
    pairs = [];
    for (let j = 0; j < cols; j++) if (rowOfCol[j] >= 0) pairs.push([rowOfCol[j], j]);
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pairs;
}

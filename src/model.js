// Circuit data model shared by the editor, the OpenQASM importer/exporter and
// the quantikz exporter.
//
// A circuit is a grid: `cols` is a list of columns, each column a list of
// operations whose vertical extents do not overlap. Qubits and classical bits
// are addressed by flat indices across all registers.
//
// op = {
//   id, gate,            // gate key from GATES, or any other name (generic box)
//   targets: [q...],     // target qubits (order matters for multi-qubit gates)
//   controls: [{q, neg}],
//   params: ['pi/2', ...],
//   cbit,                // measure only: flat classical bit index (or null)
//   cond,                // optional classical condition text, e.g. "c==1"
//   inv, pow,            // generic gates only: OpenQASM 3 modifiers
// }

export const GATES = {
  id:   { label: 'I', tex: 'I' },
  h:    { label: 'H', tex: 'H' },
  x:    { label: 'X', tex: 'X' },
  y:    { label: 'Y', tex: 'Y' },
  z:    { label: 'Z', tex: 'Z' },
  s:    { label: 'S', tex: 'S' },
  sdg:  { label: 'S†', tex: 'S^\\dagger' },
  t:    { label: 'T', tex: 'T' },
  tdg:  { label: 'T†', tex: 'T^\\dagger' },
  sx:   { label: '√X', tex: '\\sqrt{X}' },
  sxdg: { label: '√X†', tex: '\\sqrt{X}^\\dagger' },
  rx:   { label: 'R', sub: 'x', tex: 'R_x', params: ['θ'] },
  ry:   { label: 'R', sub: 'y', tex: 'R_y', params: ['θ'] },
  rz:   { label: 'R', sub: 'z', tex: 'R_z', params: ['θ'] },
  p:    { label: 'P', tex: 'P', params: ['λ'] },
  u2:   { label: 'U', sub: '2', tex: 'U_2', params: ['φ', 'λ'] },
  u:    { label: 'U', tex: 'U', params: ['θ', 'φ', 'λ'] },
  swap: { label: 'SWAP', qubits: 2 },
  rxx:  { label: 'R', sub: 'XX', tex: 'R_{XX}', params: ['θ'], qubits: 2 },
  ryy:  { label: 'R', sub: 'YY', tex: 'R_{YY}', params: ['θ'], qubits: 2 },
  rzz:  { label: 'R', sub: 'ZZ', tex: 'R_{ZZ}', params: ['θ'], qubits: 2 },
  measure: { label: 'Measure', noCtrl: true },
  reset:   { label: 'Reset', noCtrl: true },
  barrier: { label: 'Barrier', noCtrl: true },
};

let nextId = 1;
export const newId = () => 'op' + (nextId++);

export function makeOp(gate, targets, extra = {}) {
  const def = GATES[gate];
  return {
    id: newId(),
    gate,
    targets: [...targets],
    controls: [],
    params: def && def.params ? def.params.map(() => 'pi/2') : [],
    ...extra,
  };
}

export function emptyCircuit(nq = 3) {
  return { qregs: [{ name: 'q', size: nq }], cregs: [], cols: [], defs: [] };
}

export const numQubits = (c) => c.qregs.reduce((a, r) => a + r.size, 0);
export const numCbits = (c) => c.cregs.reduce((a, r) => a + r.size, 0);

// Map a flat index to {reg, idx}.
export function locate(regs, flat) {
  let off = 0;
  for (const r of regs) {
    if (flat < off + r.size) return { reg: r, idx: flat - off };
    off += r.size;
  }
  return null;
}

export function regOffset(regs, name) {
  let off = 0;
  for (const r of regs) {
    if (r.name === name) return off;
    off += r.size;
  }
  return -1;
}

export const opQubits = (op) => [...op.targets, ...op.controls.map((c) => c.q)];

export function opSpan(op) {
  const qs = opQubits(op);
  return [Math.min(...qs), Math.max(...qs)];
}

// Is `op` a gate drawn as a single box over several wires?
export const isBox = (op) => op.gate !== 'swap' && op.gate !== 'barrier' && op.targets.length > 1;

export function allOps(c) {
  const ops = [];
  for (const col of c.cols) for (const op of sortCol(col)) ops.push(op);
  return ops;
}

export const sortCol = (col) => [...col].sort((a, b) => opSpan(a)[0] - opSpan(b)[0]);

export function findOp(c, id) {
  for (let ci = 0; ci < c.cols.length; ci++) {
    const oi = c.cols[ci].findIndex((o) => o.id === id);
    if (oi >= 0) return { col: ci, op: c.cols[ci][oi] };
  }
  return null;
}

const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

export function fits(c, colIdx, op, ignoreId = op.id) {
  const col = c.cols[colIdx];
  if (!col) return true;
  const span = opSpan(op);
  return col.every((o) => o.id === ignoreId || !overlaps(opSpan(o), span));
}

// Place `op` in column `colIdx`; if it collides with something there, a new
// column is inserted at that position instead.
export function placeOp(c, op, colIdx) {
  while (c.cols.length < colIdx) c.cols.push([]);
  if (colIdx >= c.cols.length) c.cols.push([]);
  if (!fits(c, colIdx, op)) c.cols.splice(colIdx, 0, []);
  c.cols[colIdx].push(op);
}

export function removeOp(c, id) {
  const f = findOp(c, id);
  if (f) c.cols[f.col] = c.cols[f.col].filter((o) => o.id !== id);
  trimCols(c);
  return f;
}

// Replace operation `id` by `op`, keeping its column (a new column is inserted
// there if the changed operation no longer fits).
export function replaceOp(c, id, op) {
  const f = findOp(c, id);
  if (!f) return;
  c.cols[f.col] = c.cols[f.col].filter((o) => o.id !== id);
  placeOp(c, op, f.col);
  trimCols(c);
}

export function trimCols(c) {
  while (c.cols.length && c.cols[c.cols.length - 1].length === 0) c.cols.pop();
}

// Re-layout all operations as early as possible, keeping their order.
export function compact(c) {
  const ops = allOps(c);
  c.cols = [];
  layoutInto(c, ops);
}

// Classical bits written (measure) or read (condition) also order operations,
// so that e.g. two measurements into the same bit keep their order.
export function layoutInto(c, ops) {
  const front = new Array(numQubits(c)).fill(0);
  const cfront = new Array(numCbits(c)).fill(0);
  for (const op of ops) {
    const [lo, hi] = opSpan(op);
    const bits = op.cond ? cfront.map((_, i) => i) : op.cbit != null ? [op.cbit] : [];
    let col = 0;
    for (let q = lo; q <= hi; q++) col = Math.max(col, front[q]);
    for (const b of bits) col = Math.max(col, cfront[b]);
    while (c.cols.length <= col) c.cols.push([]);
    c.cols[col].push(op);
    for (let q = lo; q <= hi; q++) front[q] = col + 1;
    for (const b of bits) cfront[b] = col + 1;
  }
}

export function addQubit(c) {
  if (!c.qregs.length) c.qregs.push({ name: 'q', size: 0 });
  c.qregs[c.qregs.length - 1].size++;
}

// Remove qubit `q`; operations acting on it are removed (barriers shrink).
export function removeQubit(c, q) {
  const loc = locate(c.qregs, q);
  if (!loc) return;
  loc.reg.size--;
  if (loc.reg.size === 0 && c.qregs.length > 1) c.qregs = c.qregs.filter((r) => r !== loc.reg);
  const shift = (x) => (x > q ? x - 1 : x);
  if (c.hidden) {
    c.hidden = c.hidden.filter((x) => x !== q).map(shift);
    // never leave nothing to see
    if (!c.hidden.length || c.hidden.length >= numQubits(c)) delete c.hidden;
  }
  c.cols = c.cols.map((col) =>
    col.flatMap((op) => {
      if (op.gate === 'barrier') {
        const t = op.targets.filter((x) => x !== q);
        return t.length ? [{ ...op, targets: t.map(shift) }] : [];
      }
      if (opQubits(op).includes(q)) return [];
      return [{ ...op, targets: op.targets.map(shift), controls: op.controls.map((k) => ({ ...k, q: shift(k.q) })) }];
    }),
  );
  trimCols(c);
}

// ---------------------------------------------------------------- hidden qubits
//
// A qubit can be hidden from the drawing (never from the program): each run of
// consecutive hidden qubits is drawn as a single row of vertical dots, in the
// editor and in quantikz alike. `c.hidden` lists them, sorted; it is optional.

export const isHidden = (c, q) => !!c.hidden && c.hidden.includes(q);

// The rows of the drawing: { rows: [{ q } | { dots: [q, ...] }], rowOf: qubit -> row }.
export function displayRows(c) {
  const rows = [];
  const rowOf = [];
  for (let q = 0; q < numQubits(c); q++) {
    const last = rows[rows.length - 1];
    if (!isHidden(c, q)) rows.push({ q });
    else if (last && last.dots) last.dots.push(q);
    else rows.push({ dots: [q] });
    rowOf.push(rows.length - 1);
  }
  return { rows, rowOf };
}

// Hide or show the qubits `qs`. Returns an error message, or null.
export function setHidden(c, qs, hide) {
  const n = numQubits(c);
  const set = new Set(c.hidden || []);
  for (const q of qs) hide ? set.add(q) : set.delete(q);
  if (set.size >= n) return 'at least one qubit has to stay visible';
  c.hidden = [...set].filter((q) => q < n).sort((a, b) => a - b);
  if (!c.hidden.length) delete c.hidden;
  return null;
}

// Is any part of `op` drawn?
export const opVisible = (c, op) => opQubits(op).some((q) => !isHidden(c, q));

// Make sure classical bit `b` exists (grows the last register / creates `c`).
export function ensureCbit(c, b) {
  if (!c.cregs.length) c.cregs.push({ name: 'c', size: 0 });
  const missing = b + 1 - numCbits(c);
  if (missing > 0) c.cregs[c.cregs.length - 1].size += missing;
}

export const clone = (x) => JSON.parse(JSON.stringify(x));

// Re-assign fresh ids (e.g. after loading a saved circuit).
export function reId(c) {
  for (const col of c.cols) for (const op of col) op.id = newId();
  return c;
}

export function validate(c) {
  const n = numQubits(c);
  for (const col of c.cols)
    for (const op of col) {
      const qs = opQubits(op);
      if (qs.some((q) => !(q >= 0 && q < n))) throw new Error(`operation ${op.gate} uses a qubit out of range`);
      if (new Set(qs).size !== qs.length) throw new Error(`operation ${op.gate} uses a qubit twice`);
    }
}

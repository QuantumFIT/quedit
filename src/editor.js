// The WYSIWYG circuit canvas: SVG rendering and pointer/keyboard interaction.
//
// The editor never mutates the circuit it is shown directly. Every change goes
// through `host.commit(fn)`, which snapshots the circuit for undo, applies `fn`
// to it and re-renders; while dragging, the same edit is applied to a clone to
// show a live preview.

import {
  GATES, makeOp, numQubits, locate, opQubits, opSpan, isBox, findOp, fits,
  placeOp, replaceOp, removeOp, removeQubit, trimCols, ensureCbit, clone,
} from './model.js';

const ROW = 52;          // distance between wires
const TOP = 40;          // y of the first wire
const LEFT = 76;         // x where the first column starts
const MINW = 52;         // minimal column width
const BOX = 34;          // gate box height
const EXTRA_COLS = 3;    // empty columns drawn after the circuit

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const prettyExpr = (e) => e.replace(/\bpi\b/g, 'π').replace(/\btheta\b/g, 'θ').replace(/\bphi\b/g, 'φ')
  .replace(/\blambda\b/g, 'λ').replace(/\bgamma\b/g, 'γ').replace(/\s*\*\s*/g, '·');

// Text pieces of a gate label: [main, subscript, rest].
export function labelParts(op) {
  const def = Object.hasOwn(GATES, op.gate) && GATES[op.gate];
  let main = def ? def.label : op.gate;
  const sub = def && def.sub ? def.sub : '';
  let rest = '';
  if (op.inv) rest += '†';
  if (op.pow != null) rest += `^${prettyExpr(String(op.pow))}`;
  if (op.params.length) rest += `(${op.params.map(prettyExpr).join(', ')})`;
  return [main, sub, rest];
}

const textWidth = (s, px) => [...s].length * px;

function opWidth(op) {
  if (op.gate === 'barrier') return 16;
  if (op.gate === 'swap') return 24;
  if (op.gate === 'measure' || op.gate === 'reset') return BOX + 4;
  if (op.controls.length && (op.gate === 'x' || op.gate === 'z') && op.targets.length === 1) return 26;
  const [m, s, r] = labelParts(op);
  return Math.max(BOX, textWidth(m, 10.5) + textWidth(s, 7.5) + textWidth(r, 8.2) + 16);
}

// ---------------------------------------------------------------- editing

// What a palette tool creates when dropped on qubit q. Returns an op, or a
// string explaining why it cannot be placed.
export function opFromTool(tool, q, c) {
  const n = numQubits(c);
  const pair = () => (q + 1 < n ? [q, q + 1] : [q - 1, q]);
  switch (tool.kind) {
    case 'gate': {
      const def = GATES[tool.gate];
      const nq = (def && def.qubits) || 1;
      if (nq === 2 && n < 2) return 'this gate needs two qubits';
      return makeOp(tool.gate, nq === 2 ? pair() : [q]);
    }
    case 'cnot':
    case 'cz': {
      if (n < 2) return 'a controlled gate needs two qubits';
      const [a, b] = pair();
      const [ctl, tgt] = a === q ? [a, b] : [b, a];
      return makeOp(tool.kind === 'cnot' ? 'x' : 'z', [tgt], { controls: [{ q: ctl, neg: false }] });
    }
    case 'measure': {
      return makeOp('measure', [q], { cbit: q });
    }
    case 'barrier':
      return makeOp('barrier', Array.from({ length: n }, (_, i) => i));
    case 'custom': {
      const nq = Math.max(1, Math.min(tool.qubits || 1, n));
      const start = Math.min(q, n - nq);
      return makeOp(tool.gate, Array.from({ length: nq }, (_, i) => start + i), { params: [...(tool.params || [])] });
    }
    default:
      return 'unknown tool';
  }
}

// Apply a drop of `drag` at `cell` to circuit `c` (mutated). Returns null on
// success or an error message.
export function applyDrop(c, drag, cell) {
  const n = numQubits(c);
  const off = !cell || cell.q < 0 || cell.q >= n;
  if (drag.kind === 'new') {
    if (off) return 'drop the gate onto a wire';
    if (drag.tool.kind === 'ctrl') return attachControl(c, cell, drag.tool.neg);
    const op = opFromTool(drag.tool, cell.q, c);
    if (typeof op === 'string') return op;
    if (op.gate === 'measure') ensureCbit(c, op.cbit);
    placeOp(c, op, cell.col);
    drag.createdId = op.id;
    return null;
  }
  const found = findOp(c, drag.id);
  if (!found) return 'operation vanished';
  const op = found.op;
  const part = drag.part;
  if (part.startsWith('c') || (part.startsWith('t') && op.gate === 'swap')) {
    // move a single control dot / swap end, vertically
    const isCtrl = part.startsWith('c');
    const i = +part.slice(1);
    const moved = clone(op);
    if (off) {
      if (!isCtrl) { removeOp(c, op.id); return null; }
      moved.controls.splice(i, 1);
    } else {
      const others = opQubits(op).filter((x) => x !== (isCtrl ? op.controls[i].q : op.targets[i]));
      if (others.includes(cell.q)) return 'that qubit is already used by this gate';
      if (isCtrl) moved.controls[i].q = cell.q;
      else moved.targets[i] = cell.q;
    }
    replaceOp(c, op.id, moved);
    return null;
  }
  // move the whole operation
  if (off) { removeOp(c, op.id); return null; }
  const dq = cell.q - drag.grabQ;
  const moved = clone(op);
  if (op.gate === 'barrier' && dq !== 0) return 'edit the barrier qubits in the side panel';
  moved.targets = op.targets.map((x) => x + dq);
  moved.controls = op.controls.map((k) => ({ ...k, q: k.q + dq }));
  if (opQubits(moved).some((x) => x < 0 || x >= n)) return 'the gate would leave the circuit';
  c.cols[found.col] = c.cols[found.col].filter((o) => o.id !== op.id);
  placeOp(c, moved, cell.col);
  trimCols(c);
  return null;
}

function attachControl(c, cell, neg) {
  const col = c.cols[cell.col] || [];
  const candidates = col.filter((o) => !(GATES[o.gate] && GATES[o.gate].noCtrl) && !opQubits(o).includes(cell.q));
  if (!candidates.length) return 'drop a control onto a column that contains a gate';
  const dist = (o) => { const [lo, hi] = opSpan(o); return cell.q < lo ? lo - cell.q : cell.q - hi; };
  candidates.sort((a, b) => dist(a) - dist(b));
  const op = candidates[0];
  const moved = clone(op);
  moved.controls.push({ q: cell.q, neg: !!neg });
  replaceOp(c, op.id, moved);
  return null;
}

// ---------------------------------------------------------------- editor

export class Editor {
  // host: { circuit(), commit(fn) -> error|null, select(id), selected(), toast(msg) }
  constructor(svg, host) {
    this.svg = svg;
    this.host = host;
    this.drag = null;
    this.tool = null;
    this.hover = null;
    this.geom = null;
    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => { if (!this.drag) this.onHover(e); });
    svg.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.render(); } });
    svg.addEventListener('contextmenu', (e) => this.onContext(e));
    svg.addEventListener('dblclick', (e) => {
      const hit = this.hitPart(e.target);
      if (hit) this.host.focusProps?.();
    });
    this.onMove = (e) => this.dragMove(e);
    this.onUp = (e) => this.dragEnd(e);
  }

  // ---- geometry

  layout(c) {
    const n = numQubits(c);
    const ncols = Math.max(c.cols.length + EXTRA_COLS, 8);
    const widths = [];
    for (let i = 0; i < ncols; i++) {
      const col = c.cols[i] || [];
      widths.push(Math.max(MINW, ...col.map((o) => opWidth(o) + 18)));
    }
    const lefts = [];
    let x = LEFT;
    for (const w of widths) { lefts.push(x); x += w; }
    const hasCond = c.cols.some((col) => col.some((o) => o.cond));
    const top = TOP + (hasCond ? 12 : 0);
    return {
      n, ncols, widths, lefts, top,
      cx: (i) => lefts[i] + widths[i] / 2,
      y: (q) => top + q * ROW,
      width: x + 24,
      height: top + Math.max(0, n - 1) * ROW + 44,
    };
  }

  cellAt(clientX, clientY) {
    const g = this.geom;
    const r = this.svg.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    let col = g.ncols - 1;
    for (let i = 0; i < g.ncols; i++) if (x < g.lefts[i] + g.widths[i]) { col = i; break; }
    if (x < LEFT - 10) return null;
    const qf = (y - g.top) / ROW;
    const q = Math.round(qf);
    if (qf < -0.75 || qf > g.n - 0.25) return null;
    return { col, q: Math.max(0, Math.min(g.n - 1, q)) };
  }

  hitPart(el) {
    const p = el.closest && el.closest('[data-part]');
    if (!p) return null;
    const g = p.closest('[data-id]');
    return g ? { id: g.dataset.id, part: p.dataset.part, q: +p.dataset.q } : null;
  }

  // ---- rendering

  render(preview) {
    const c = preview ? preview.circuit : this.host.circuit();
    const g = (this.geom = this.layout(c));
    const sel = this.host.selected();
    const ghost = preview && preview.id;
    const parts = [];
    const n = g.n;
    // column guides
    for (let i = 0; i < g.ncols; i++) {
      if (i % 2 === 0) parts.push(`<rect class="colband" x="${g.lefts[i]}" y="${g.top - ROW / 2}" width="${g.widths[i]}" height="${Math.max(n, 1) * ROW}"/>`);
    }
    if (this.hover && !this.drag && this.tool && this.hover.q < n) {
      const h = this.hover;
      parts.push(`<rect class="hovercell" x="${g.lefts[h.col] + 2}" y="${g.y(h.q) - ROW / 2 + 3}" width="${g.widths[h.col] - 4}" height="${ROW - 6}" rx="6"/>`);
    }
    if (preview && preview.cell && preview.cell.q < n) {
      const h = preview.cell;
      parts.push(`<rect class="dropcell${preview.error ? ' bad' : ''}" x="${g.lefts[h.col] + 2}" y="${g.y(h.q) - ROW / 2 + 3}" width="${g.widths[h.col] - 4}" height="${ROW - 6}" rx="6"/>`);
    }
    // wires and labels
    for (let q = 0; q < n; q++) {
      const l = locate(c.qregs, q);
      const y = g.y(q);
      parts.push(`<line class="wire" x1="${LEFT - 8}" y1="${y}" x2="${g.width - 10}" y2="${y}"/>`);
      parts.push(`<g class="qlabel" data-q="${q}"><text x="${LEFT - 16}" y="${y + 5}" text-anchor="end">${esc(l.reg.name)}<tspan class="idx" dy="4">${l.idx}</tspan></text>` +
        `<g class="qdel" data-delq="${q}" transform="translate(12 ${y})"><title>remove this qubit</title><circle r="8"/><path d="M-3.5-3.5L3.5 3.5M3.5-3.5L-3.5 3.5"/></g></g>`);
    }
    // operations
    c.cols.forEach((col, ci) => {
      for (const op of col) parts.push(this.renderOp(op, ci, g, op.id === sel, op.id === ghost ? (preview.error ? 'ghost bad' : 'ghost') : ''));
    });
    this.svg.setAttribute('width', g.width);
    this.svg.setAttribute('height', g.height);
    this.svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    this.svg.classList.toggle('armed', !!this.tool);
    this.svg.innerHTML = parts.join('');
  }

  renderOp(op, ci, g, selected, extra) {
    const x = g.cx(ci);
    const y = g.y;
    const out = [];
    const [lo, hi] = opSpan(op);
    const w = opWidth(op);
    let bbox = [x - w / 2, y(lo) - BOX / 2, w, y(hi) - y(lo) + BOX];

    if (op.gate === 'barrier') {
      const y0 = y(lo) - ROW / 2 + 6, y1 = y(hi) + ROW / 2 - 6;
      out.push(`<rect class="hit" data-part="b" data-q="${lo}" x="${x - 8}" y="${y0}" width="16" height="${y1 - y0}"/>`);
      out.push(`<line class="barrier" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`);
      bbox = [x - 8, y0, 16, y1 - y0];
    } else {
      if (hi > lo) out.push(`<line class="link" x1="${x}" y1="${y(lo)}" x2="${x}" y2="${y(hi)}"/>`);
      // body hit area spanning the whole operation
      out.push(`<rect class="hit" data-part="b" data-q="${op.targets[0]}" x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}"/>`);
      if (op.gate === 'swap') {
        op.targets.forEach((t, i) => {
          out.push(`<g data-part="t${i}" data-q="${t}" class="part"><rect class="hit" x="${x - 11}" y="${y(t) - 11}" width="22" height="22"/>` +
            `<path class="swapx" d="M${x - 7} ${y(t) - 7}L${x + 7} ${y(t) + 7}M${x + 7} ${y(t) - 7}L${x - 7} ${y(t) + 7}"/></g>`);
        });
      } else if (op.controls.length && op.gate === 'x' && op.targets.length === 1) {
        const t = op.targets[0];
        out.push(`<g data-part="b" data-q="${t}" class="part"><circle class="oplus" cx="${x}" cy="${y(t)}" r="11"/>` +
          `<path class="oplusx" d="M${x - 11} ${y(t)}H${x + 11}M${x} ${y(t) - 11}V${y(t) + 11}"/></g>`);
      } else if (op.controls.length && op.gate === 'z' && op.targets.length === 1) {
        const t = op.targets[0];
        out.push(`<g data-part="b" data-q="${t}" class="part"><circle class="ctrl" cx="${x}" cy="${y(t)}" r="5.5"/></g>`);
      } else if (op.gate === 'measure') {
        const t = op.targets[0];
        const yy = y(t);
        out.push(`<g data-part="b" data-q="${t}" class="part"><rect class="box" x="${x - BOX / 2}" y="${yy - BOX / 2}" width="${BOX}" height="${BOX}"/>` +
          `<path class="meter" d="M${x - 11} ${yy + 7}A12 12 0 0 1 ${x + 11} ${yy + 7}M${x} ${yy + 7}L${x + 7} ${yy - 9}"/></g>`);
        if (op.cbit != null) {
          const cl = locate(this.host.circuit().cregs, op.cbit);
          if (cl) out.push(`<text class="cbit" x="${x + BOX / 2 + 2}" y="${yy + BOX / 2 + 9}">${esc(cl.reg.name)}[${cl.idx}]</text>`);
        }
      } else if (op.gate === 'reset') {
        const t = op.targets[0];
        out.push(`<g data-part="b" data-q="${t}" class="part"><rect class="box" x="${x - w / 2}" y="${y(t) - BOX / 2}" width="${w}" height="${BOX}"/>` +
          `<text class="glabel" x="${x}" y="${y(t) + 6}" text-anchor="middle">|0⟩</text></g>`);
      } else {
        const tlo = Math.min(...op.targets), thi = Math.max(...op.targets);
        const [m, s, r] = labelParts(op);
        const yc = (y(tlo) + y(thi)) / 2;
        out.push(`<g data-part="b" data-q="${op.targets[0]}" class="part"><rect class="box" x="${x - w / 2}" y="${y(tlo) - BOX / 2}" width="${w}" height="${y(thi) - y(tlo) + BOX}"/>` +
          `<text class="glabel" x="${x}" y="${yc + 6}" text-anchor="middle">${esc(m)}${s ? `<tspan class="sub" dy="4">${esc(s)}</tspan>` : ''}${r ? `<tspan class="rest"${s ? ' dy="-4"' : ''}>${esc(r)}</tspan>` : ''}</text></g>`);
        if (isBox(op)) {
          const contiguous = thi - tlo + 1 === op.targets.length;
          const ordered = op.targets.every((t, i) => i === 0 || t > op.targets[i - 1]);
          if (!contiguous || !ordered) {
            op.targets.forEach((t, i) => out.push(`<text class="tidx" x="${x - w / 2 + 3}" y="${y(t) + 4}">${i}</text>`));
          }
        }
      }
      op.controls.forEach((k, i) => {
        out.push(`<g data-part="c${i}" data-q="${k.q}" class="part"><rect class="hit" x="${x - 10}" y="${y(k.q) - 10}" width="20" height="20"/>` +
          `<circle class="${k.neg ? 'nctrl' : 'ctrl'}" cx="${x}" cy="${y(k.q)}" r="5.5"/></g>`);
      });
    }
    if (op.cond) out.push(`<text class="cond" x="${x}" y="${y(lo) - BOX / 2 - 5}" text-anchor="middle">if ${esc(op.cond)}</text>`);
    if (selected) out.unshift(`<rect class="selbox" x="${bbox[0] - 5}" y="${bbox[1] - 5}" width="${bbox[2] + 10}" height="${bbox[3] + 10}" rx="7"/>`);
    return `<g class="op ${extra}" data-id="${op.id}">${out.join('')}</g>`;
  }

  // ---- tools

  setTool(tool) {
    this.tool = tool;
    this.render();
  }

  onHover(e) {
    const cell = this.tool ? this.cellAt(e.clientX, e.clientY) : null;
    const same = (a, b) => (a && b ? a.col === b.col && a.q === b.q : a === b);
    if (!same(cell, this.hover)) { this.hover = cell; this.render(); }
  }

  // ---- dragging

  // Start dragging a palette tool (called by the UI on pointerdown in the palette).
  beginNew(tool, e, label) {
    this.startDrag({ kind: 'new', tool, x0: e.clientX, y0: e.clientY, label }, e);
  }

  startDrag(drag, e) {
    this.drag = { ...drag, moved: false, cell: null };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    e.preventDefault();
  }

  onDown(e) {
    if (e.button !== 0) return;
    const del = e.target.closest && e.target.closest('[data-delq]');
    if (del) {
      const q = +del.dataset.delq;
      const err = this.host.commit((c) => {
        if (numQubits(c) <= 1) return 'a circuit needs at least one qubit';
        removeQubit(c, q);
        return null;
      });
      if (err) this.host.toast(err);
      return;
    }
    const hit = this.hitPart(e.target);
    if (hit) {
      this.startDrag({ kind: 'op', id: hit.id, part: hit.part, grabQ: hit.q, x0: e.clientX, y0: e.clientY }, e);
      return;
    }
    if (this.tool) {
      const cell = this.cellAt(e.clientX, e.clientY);
      if (cell) {
        const drag = { kind: 'new', tool: this.tool };
        const err = this.host.commit((c) => applyDrop(c, drag, cell));
        if (err) this.host.toast(err);
        else if (drag.createdId && !e.shiftKey) this.host.select(drag.createdId);
        if (!e.shiftKey && this.tool.kind !== 'ctrl') this.host.setTool(null);
      }
      return;
    }
    this.host.select(null);
  }

  dragMove(e) {
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    this.host.showGhost?.(d.kind === 'new' ? d.label : null, e);
    const cell = this.cellAt(e.clientX, e.clientY);
    const same = d.cell && cell && d.cell.col === cell.col && d.cell.q === cell.q;
    if (d.started && (same || (!d.cell && !cell))) return;
    d.started = true;
    d.cell = cell;
    if (d.kind === 'new' && !cell) { this.render(); return; }
    const c = clone(this.host.circuit());
    const probe = { ...d };
    const error = applyDrop(c, probe, cell);
    const id = d.kind === 'new' ? probe.createdId : d.id;
    if (error) this.render({ circuit: this.host.circuit(), id: d.id, cell, error });
    else this.render({ circuit: c, id, cell });
  }

  dragEnd(e) {
    const d = this.drag;
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.host.showGhost?.(null);
    if (e.type === 'pointercancel') { this.render(); return; }
    if (!d.moved) {
      if (d.kind === 'new') this.host.setTool(this.tool && this.tool.key === d.tool.key ? null : d.tool);
      else this.host.select(d.id);
      this.render();
      return;
    }
    const cell = this.cellAt(e.clientX, e.clientY);
    if (d.kind === 'new' && !cell) { this.render(); return; }
    const err = this.host.commit((c) => applyDrop(c, d, cell));
    if (err) this.host.toast(err);
    else this.host.select(d.kind === 'new' ? d.createdId : (findOp(this.host.circuit(), d.id) ? d.id : null));
    this.render();
  }

  onContext(e) {
    const hit = this.hitPart(e.target);
    if (!hit) return;
    e.preventDefault();
    this.host.commit((c) => {
      const f = findOp(c, hit.id);
      if (!f) return null;
      if (hit.part.startsWith('c')) {
        const moved = clone(f.op);
        moved.controls.splice(+hit.part.slice(1), 1);
        replaceOp(c, f.op.id, moved);
      } else removeOp(c, hit.id);
      return null;
    });
  }

  // Keyboard moves of the selected operation.
  nudge(id, dcol, dq) {
    return this.host.commit((c) => {
      const f = findOp(c, id);
      if (!f) return null;
      const n = numQubits(c);
      const moved = clone(f.op);
      moved.targets = moved.targets.map((x) => x + dq);
      moved.controls = moved.controls.map((k) => ({ ...k, q: k.q + dq }));
      if (opQubits(moved).some((x) => x < 0 || x >= n)) return 'the gate would leave the circuit';
      let col = f.col + dcol;
      if (col < 0) return null;
      c.cols[f.col] = c.cols[f.col].filter((o) => o.id !== id);
      // hop over columns where it does not fit, rather than inserting new ones
      while (dcol && col < c.cols.length && !fits(c, col, moved)) col += dcol;
      if (col < 0) col = 0;
      placeOp(c, moved, col);
      trimCols(c);
      return null;
    });
  }
}

// Export to LaTeX quantikz.

import { GATES, numQubits, numCbits, locate, sortCol, opSpan, isBox, isHidden, displayRows, opVisible } from './model.js';

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'phi', 'pi', 'psi', 'omega', 'sigma', 'tau', 'mu', 'nu'];
const UNI = { 'π': '\\pi', 'θ': '\\theta', 'φ': '\\phi', 'λ': '\\lambda', 'γ': '\\gamma', 'α': '\\alpha', 'β': '\\beta', 'τ': '\\tau' };

export function exprToTex(e) {
  let s = e.replace(/[πθφλγαβτ]/g, (m) => UNI[m] + ' ');
  s = s.replace(/(?<!\\)\b([A-Za-z]+)\b/g, (m) => (GREEK.includes(m) ? '\\' + m : m));
  s = s.replace(/\*/g, ' ');
  return s.replace(/\s+/g, ' ').replace(/\s*([()/+,-])\s*/g, '$1').replace(/\\(\w+) (?=[^A-Za-z])/g, '\\$1').trim();
}

export const texEscape = (s) => s.replace(/([_#%&$])/g, '\\$1');

export function gateTex(op) {
  const def = Object.hasOwn(GATES, op.gate) && GATES[op.gate];
  let base = def ? def.tex : `\\mathrm{${texEscape(op.gate)}}`;
  if (op.inv) base += '^\\dagger';
  if (op.pow != null) base = `(${base})^{${exprToTex(String(op.pow))}}`;
  if (op.params.length) base += `(${op.params.map(exprToTex).join(', ')})`;
  return base;
}

export const DEFAULT_OPTIONS = {
  labels: 'name',        // 'name' | 'ket0' | 'none'
  classical: 'none',     // 'none' | 'after' (wire turns classical) | 'register' (\vcw to a register wire)
  standalone: false,
};

export function toQuantikz(c, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const n = numQubits(c);
  const ncols = c.cols.length;
  // rows of the drawing: one per visible qubit, one of dots per run of hidden ones
  const { rows: shown, rowOf } = displayRows(c);
  const hasMeasure = c.cols.some((col) => col.some((o) => o.gate === 'measure' && opVisible(c, o)));
  const regRow = opt.classical === 'register' && hasMeasure ? shown.length : -1;
  const rows = regRow >= 0 ? shown.length + 1 : shown.length;
  const grid = Array.from({ length: rows }, () => new Array(ncols).fill(null));
  const notes = [];

  // `classicalFrom[r]`: column after which row r's wire is classical
  const classicalFrom = new Array(rows).fill(Infinity);
  if (opt.classical === 'after') {
    for (let q = 0; q < n; q++) {
      if (isHidden(c, q)) continue;
      for (let ci = ncols - 1; ci >= 0; ci--) {
        const op = c.cols[ci].find((o) => opSpan(o)[0] <= q && q <= opSpan(o)[1]);
        if (!op) continue;
        if (op.gate === 'measure' && op.targets[0] === q) classicalFrom[rowOf[q]] = ci;
        break;
      }
    }
  }

  c.cols.forEach((col, ci) => {
    for (const op of sortCol(col)) {
      if (!opVisible(c, op)) continue;
      // Everything below is in rows. A part on a hidden qubit is not drawn, but the
      // lines of the operation still reach into its row of dots.
      const row = (q) => rowOf[q];
      const hid = (q) => isHidden(c, q);
      const cell = (r, s) => { grid[r][ci] = grid[r][ci] ? grid[r][ci] + ' ' + s : s; };
      const set = (q, s) => { if (!hid(q)) cell(row(q), s); };
      if (op.cond) notes.push(`condition "${op.cond}" on ${op.gate} (column ${ci + 1}) not drawn`);
      const t0 = op.targets[0];
      if (op.gate === 'measure') {
        set(t0, '\\meter{}');
        if (regRow >= 0) set(t0, `\\vcw{${regRow - row(t0)}}`);
        continue;
      }
      if (op.gate === 'reset') { set(t0, '\\gate{\\ket{0}}'); continue; }
      if (op.gate === 'barrier') {
        cell(row(Math.min(...op.targets.filter((q) => !hid(q)))), '\\slice[style={black!60,dashed}]{}');
        continue;
      }
      // `anchors`: the rows of the target, which controls point at
      let anchors;
      const targetsShown = op.targets.filter((q) => !hid(q));
      if (!targetsShown.length) {
        anchors = [...new Set(op.targets.map(row))];
      } else if (op.gate === 'swap') {
        const [a, b] = [...op.targets].sort((x, y) => x - y);
        if (hid(b)) { set(a, '\\targX{}'); cell(row(a), `\\vqw{${row(b) - row(a)}}`); }
        else if (hid(a)) { set(b, '\\targX{}'); cell(row(b), `\\vqw{${row(a) - row(b)}}`); }
        else { set(a, `\\swap{${row(b) - row(a)}}`); set(b, '\\targX{}'); }
        anchors = [row(a), row(b)];
      } else if (isBox(op)) {
        const [lo, hi] = [row(Math.min(...op.targets)), row(Math.max(...op.targets))];
        cell(lo, `\\gate[wires=${hi - lo + 1}]{${gateTex(op)}}`);
        for (let r = lo + 1; r <= hi; r++) if (shown[r].q != null) cell(r, '\\qw');
        anchors = [lo, hi];
      } else if (op.controls.length && op.gate === 'x') {
        set(t0, '\\targ{}'); anchors = [row(t0)];
      } else if (op.controls.length && op.gate === 'z') {
        set(t0, '\\control{}'); anchors = [row(t0)];
      } else {
        set(t0, `\\gate{${gateTex(op)}}`); anchors = [row(t0)];
      }
      const nearest = (r) => anchors.reduce((best, a) => (Math.abs(a - r) < Math.abs(best - r) ? a : best));
      for (const k of op.controls) {
        if (!hid(k.q)) { set(k.q, `\\${k.neg ? 'octrl' : 'ctrl'}{${nearest(row(k.q)) - row(k.q)}}`); continue; }
        // a hidden control: a line from the target into its row of dots
        const a = nearest(row(k.q));
        if (a !== row(k.q) && shown[a].q != null) cell(a, `\\vqw{${row(k.q) - a}}`);
      }
    }
  });

  const cbits = numCbits(c);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let label = '';
    if (r < shown.length && shown[r].dots) {
      lines.push(['\\lstick{\\vdots} \\setwiretype{n}', ...grid[r].map((s) => s || ''), '']);
      continue;
    }
    const q = r < shown.length ? shown[r].q : -1;
    if (r === regRow) {
      label = c.cregs.length === 1 ? `\\lstick{$${texEscape(c.cregs[0].name)}$}` : '\\lstick{$c$}';
    } else if (opt.labels === 'name') {
      const l = locate(c.qregs, q);
      label = `\\lstick{$${texEscape(l.reg.name)}_{${l.idx}}$}`;
    } else if (opt.labels === 'ket0') label = '\\lstick{\\ket{0}}';
    const cells = [label];
    for (let ci = 0; ci <= ncols; ci++) {
      const classical = r === regRow || ci > classicalFrom[r];
      let cell = ci < ncols ? grid[r][ci] : null;
      if (!cell) cell = classical ? '\\cw' : '\\qw';
      if (r === regRow && ci === 0 && cbits > 1) cell += ` \\qwbundle[alternate]{}`;
      cells.push(cell);
    }
    lines.push(cells);
  }
  // align columns
  const widths = [];
  for (const row of lines) row.forEach((s, i) => (widths[i] = Math.max(widths[i] || 0, s.length)));
  const body = lines
    .map((row, ri) => row.map((s, i) => (i < row.length - 1 ? s.padEnd(widths[i]) : s)).join(' & ') + (ri < lines.length - 1 ? ' \\\\' : ''))
    .map((l) => l.trimEnd());

  let out = ['\\begin{quantikz}', ...body, '\\end{quantikz}'];
  if (notes.length) out = [...notes.map((s) => '% ' + s), ...out];
  if (opt.standalone) {
    out = ['\\documentclass[border=4pt]{standalone}', '\\usepackage{quantikz}', '\\begin{document}', ...out, '\\end{document}'];
  }
  return out.join('\n') + '\n';
}

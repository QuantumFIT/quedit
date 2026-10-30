// Export to LaTeX quantikz.

import { GATES, numQubits, numCbits, locate, sortCol, opSpan, isBox } from './model.js';

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
  const hasMeasure = c.cols.some((col) => col.some((o) => o.gate === 'measure'));
  const regRow = opt.classical === 'register' && hasMeasure ? n : -1;
  const rows = regRow >= 0 ? n + 1 : n;
  const grid = Array.from({ length: rows }, () => new Array(ncols).fill(null));
  const notes = [];

  // `classicalFrom[q]`: column after which qubit q's wire is classical
  const classicalFrom = new Array(n).fill(Infinity);
  if (opt.classical === 'after') {
    for (let q = 0; q < n; q++) {
      for (let ci = ncols - 1; ci >= 0; ci--) {
        const op = c.cols[ci].find((o) => opSpan(o)[0] <= q && q <= opSpan(o)[1]);
        if (!op) continue;
        if (op.gate === 'measure' && op.targets[0] === q) classicalFrom[q] = ci;
        break;
      }
    }
  }

  c.cols.forEach((col, ci) => {
    for (const op of sortCol(col)) {
      const set = (r, s) => { grid[r][ci] = grid[r][ci] ? grid[r][ci] + ' ' + s : s; };
      if (op.cond) notes.push(`condition "${op.cond}" on ${op.gate} (column ${ci + 1}) not drawn`);
      const t0 = op.targets[0];
      if (op.gate === 'measure') {
        set(t0, '\\meter{}');
        if (regRow >= 0) set(t0, `\\vcw{${regRow - t0}}`);
        continue;
      }
      if (op.gate === 'reset') { set(t0, '\\gate{\\ket{0}}'); continue; }
      if (op.gate === 'barrier') {
        set(Math.min(...op.targets), '\\slice[style={black!60,dashed}]{}');
        continue;
      }
      // target rows that controls connect to
      let anchors;
      if (op.gate === 'swap') {
        const [a, b] = [...op.targets].sort((x, y) => x - y);
        set(a, `\\swap{${b - a}}`);
        set(b, '\\targX{}');
        anchors = [a, b];
      } else if (isBox(op)) {
        const [lo, hi] = [Math.min(...op.targets), Math.max(...op.targets)];
        set(lo, `\\gate[wires=${hi - lo + 1}]{${gateTex(op)}}`);
        for (let r = lo + 1; r <= hi; r++) set(r, '\\qw');
        anchors = [lo, hi];
      } else if (op.controls.length && op.gate === 'x') {
        set(t0, '\\targ{}'); anchors = [t0];
      } else if (op.controls.length && op.gate === 'z') {
        set(t0, '\\control{}'); anchors = [t0];
      } else {
        set(t0, `\\gate{${gateTex(op)}}`); anchors = [t0];
      }
      for (const k of op.controls) {
        const a = anchors.reduce((best, r) => (Math.abs(r - k.q) < Math.abs(best - k.q) ? r : best));
        set(k.q, `\\${k.neg ? 'octrl' : 'ctrl'}{${a - k.q}}`);
      }
    }
  });

  const cbits = numCbits(c);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let label = '';
    if (r === regRow) {
      label = c.cregs.length === 1 ? `\\lstick{$${texEscape(c.cregs[0].name)}$}` : '\\lstick{$c$}';
    } else if (opt.labels === 'name') {
      const l = locate(c.qregs, r);
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

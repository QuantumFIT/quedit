import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQasm } from '../src/qasm.js';
import { toQuantikz, exprToTex } from '../src/quantikz.js';
import { EXAMPLES } from '../src/examples.js';
import { setHidden, numQubits } from '../src/model.js';
import { fragmentToCircuit, encodeText } from '../src/links.js';

const BELL = 'OPENQASM 2.0; qreg q[2]; creg c[2]; h q[0]; cx q[0], q[1]; measure q -> c;';

test('parameters are written as LaTeX', () => {
  assert.equal(exprToTex('pi/2'), '\\pi/2');
  assert.equal(exprToTex('-pi/4'), '-\\pi/4');
  assert.equal(exprToTex('2*pi'), '2 \\pi');
  assert.equal(exprToTex('theta'), '\\theta');
  assert.equal(exprToTex('π/2'), '\\pi/2');
});

test('a Bell circuit', () => {
  assert.equal(toQuantikz(parseQasm(BELL).circuit), `\\begin{quantikz}
\\lstick{$q_{0}$} & \\gate{H} & \\ctrl{1} & \\meter{} & \\qw \\\\
\\lstick{$q_{1}$} & \\qw      & \\targ{}  & \\meter{} & \\qw
\\end{quantikz}
`);
});

test('controls point at the nearest end of what they control', () => {
  const c = parseQasm('OPENQASM 3.0; qubit[5] q; ctrl(2) @ rxx(1) q[0], q[4], q[2], q[3];').circuit;
  const rows = toQuantikz(c).split('\n').slice(1, 6);
  assert.match(rows[0], /\\ctrl\{2\}/);
  assert.match(rows[2], /\\gate\[wires=2\]\{R_\{XX\}\(1\)\}/);
  assert.match(rows[4], /\\ctrl\{-1\}/);
});

test('measurement styles', () => {
  const c = parseQasm(BELL).circuit;
  const after = toQuantikz(c, { classical: 'after' });
  assert.match(after, /\\meter\{\} & \\cw$/m);
  const reg = toQuantikz(c, { classical: 'register' });
  assert.match(reg, /\\meter\{\} \\vcw\{2\}/);
  assert.match(reg, /^\\lstick\{\$c\$\} +& \\cw \\qwbundle\[alternate\]\{\}/m);
});

// Compile every example in every style, when there is a LaTeX to compile with.
let pdflatex = true;
try { execFileSync('kpsewhich', ['quantikz.sty'], { stdio: 'pipe' }); } catch { pdflatex = false; }

test('the output compiles with pdflatex', { skip: !pdflatex && 'no pdflatex with quantikz' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'quedit-tex-'));
  try {
    const extra = 'OPENQASM 3.0; include "stdgates.inc"; qubit[4] q; bit[2] c; sxdg q[0]; u(1,2,3) q[1]; ' +
      'ctrl @ negctrl @ swap q[0], q[3], q[1], q[2]; rzz(theta) q[1], q[3]; reset q[2]; barrier q[0], q[1]; ' +
      'my_gate q[0], q[1], q[2]; inv @ my_gate q[1]; c[1] = measure q[3]; cz q[0], q[1]; c[0] = measure q[0];';
    const sources = [...EXAMPLES.map((e) => e.qasm), extra];
    let i = 0;
    // hidden qubits: the first, one in the middle, and all but the first
    const hidings = (n) => [[], [0], [1], [...Array(n).keys()].slice(1)].filter((h) => h.length < n);
    for (const src of sources) {
      const n = numQubits(parseQasm(src).circuit);
      for (const [h, hidden] of hidings(n).entries()) for (const labels of h ? ['name'] : ['name', 'ket0', 'none']) {
        for (const classical of ['none', 'after', 'register']) {
          const circuit = parseQasm(src).circuit;
          setHidden(circuit, hidden, true);
          const tex = toQuantikz(circuit, { labels, classical, standalone: true });
          const file = join(dir, `t${i++}.tex`);
          writeFileSync(file, tex);
          try {
            execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', file], { cwd: dir, stdio: 'pipe' });
          } catch (e) {
            const log = String(e.stdout).split('\n').filter((l) => l.startsWith('!')).join('\n');
            assert.fail(`${labels}/${classical}/hidden ${hidden} failed:\n${log}\n${tex}`);
          }
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hidden qubits: one row of dots, stubs toward it, and no empty columns', () => {
  // two swaps in one column, each with an end under the dots: they must not join up
  // into what looks like one swap, and the column of a wholly hidden swap goes
  const src = 'OPENQASM 3.0; include "stdgates.inc"; qubit[5] q; h q[0]; h q[1]; x q[2]; x q[3]; x q[4]; ' +
    'swap q[2], q[3]; swap q[0], q[1]; swap q[3], q[4];';
  const { circuit } = fragmentToCircuit(`c=${encodeText(src)}&k=0.0.0.0.0.2.1.2`);
  setHidden(circuit, [1, 2, 3], true);
  const rows = toQuantikz(circuit).split('\n').filter((l) => l.includes('&'))
    .map((l) => l.replace(/\\\\$/, '').split('&').map((s) => s.trim()));
  assert.equal(rows.length, 3, 'q0, the dots, q4');
  assert.match(rows[1][0], /\\lstick\{\\vdots\} \\setwiretype\{n\}/);
  assert.ok(rows[1].slice(1).every((s) => s === ''), 'nothing is drawn on the dots');
  assert.equal(rows[0].length, 4, 'label, the gates, the swaps, the end: the hidden swap left no column');
  assert.deepEqual(rows.map((r) => r[2]), [
    '\\targX{} \\wire[d][1][dash pattern=on 3.5mm off 50cm]{q}', '',
    '\\targX{} \\wire[u][1][dash pattern=on 3.5mm off 50cm]{q}']);
  // a control into the dots from a box stubs from the box, longer, to clear it
  const b = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; cx q[2], q[0];').circuit;
  setHidden(b, [2], true);
  // two rows away: the line crosses q1 in full, and the stub starts from q1's wire
  const bt = toQuantikz(b);
  assert.match(bt, /\\targ\{\} \\wire\[d\]\[1\]\{q\}/);
  assert.match(bt, /q_\{1\}\$\}\s*& \\wire\[d\]\[1\]\[dash pattern=on 3\.5mm/);
  const g = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; ch q[2], q[0];').circuit;
  setHidden(g, [1, 2], true);
  assert.match(toQuantikz(g), /\\gate\{H\} \\wire\[d\]\[1\]\[dash pattern=on 5\.5mm/);
});

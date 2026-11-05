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

test('hidden qubits are one row of dots, which lines still reach into', () => {
  const { circuit } = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[5] q; h q[0]; cx q[0], q[2]; ' +
    'cx q[1], q[4]; h q[2]; cz q[3], q[4]; swap q[0], q[3];');
  setHidden(circuit, [1, 2, 3], true);
  const rows = toQuantikz(circuit).split('\n').filter((l) => l.includes('&')).map((l) => l.replace(/\\\\$/, '').split('&').map((s) => s.trim()));
  assert.equal(rows.length, 3, 'q0, the dots, q4');
  assert.match(rows[1][0], /\\lstick\{\\vdots\} \\setwiretype\{n\}/);
  assert.ok(rows[1].slice(1).every((s) => s === ''), 'nothing is drawn on the dots');
  const col = (ci) => rows.map((r) => r[ci + 1]);
  assert.deepEqual(col(0), ['\\gate{H}', '', '\\qw'], 'h q[0]');
  assert.deepEqual(col(1), ['\\ctrl{1}', '', '\\qw'], 'a cx into the dots');
  assert.deepEqual(col(2), ['\\qw', '', '\\targ{} \\vqw{-1}'], 'a cx out of them');
  assert.deepEqual(col(4), ['\\targX{} \\vqw{1}', '', '\\qw'], 'a swap with a hidden end');
});

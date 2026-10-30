import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQasm, toQasm } from '../src/qasm.js';
import { allOps } from '../src/model.js';
import { EXAMPLES } from '../src/examples.js';

const strip = (c) => allOps(c).map(({ id, ...o }) => o);

const BELL2 = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0], q[1];
measure q -> c;
`;

test('OpenQASM 2: registers, gates and broadcast measurement', () => {
  const { circuit: c } = parseQasm(BELL2);
  assert.equal(c.qregs[0].size, 2);
  assert.equal(c.cols.length, 3);
  const ops = strip(c);
  assert.deepEqual(ops[1], { gate: 'x', targets: [1], controls: [{ q: 0, neg: false }], params: [] });
  assert.deepEqual(ops.slice(2).map((o) => o.cbit), [0, 1]);
});

test('OpenQASM 2 survives a round trip', () => {
  const { circuit: c } = parseQasm(BELL2);
  const out = toQasm(c, 2).text;
  assert.equal(out, BELL2.replace('measure q -> c;', 'measure q[0] -> c[0];\nmeasure q[1] -> c[1];'));
  assert.deepEqual(strip(parseQasm(out).circuit), strip(c));
});

test('OpenQASM 3: modifiers, measurement assignment, conditions, barrier', () => {
  const src = `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
bit[3] c;
// comment
/* block
   comment */
ctrl @ negctrl @ rx(pi/4) q[0], q[1], q[2];
inv @ s q[0];
inv @ rz(theta) q[1];
c[0] = measure q[0];
c = measure q;
cp(pi/8) q[0], q[2];
U(1, 2, 3) q[1];
if (c == 1) x q[2];
barrier q;
`;
  const { circuit: c, warnings } = parseQasm(src);
  assert.deepEqual(warnings, []);
  const ops = strip(c);
  assert.deepEqual(ops[0].controls, [{ q: 0, neg: false }, { q: 1, neg: true }]);
  assert.equal(ops[0].gate, 'rx');
  assert.equal(ops.find((o) => o.gate === 'sdg').targets[0], 0);
  assert.deepEqual(ops.find((o) => o.gate === 'rz').params, ['-theta']);
  const out3 = toQasm(c, 3).text;
  assert.match(out3, /^ctrl @ negctrl @ rx\(pi\/4\) q\[0\], q\[1\], q\[2\];$/m);
  assert.match(out3, /^if \(c==1\) x q\[2\];$/m);
  assert.deepEqual(strip(parseQasm(out3).circuit), ops);
});

test('measurements into the same bit keep their order', () => {
  const { circuit: c } = parseQasm('OPENQASM 3.0; qubit[2] q; bit[1] c; c[0] = measure q[1]; c[0] = measure q[0];');
  assert.deepEqual(strip(c).map((o) => o.targets[0]), [1, 0]);
});

test('OpenQASM 2 has no negative controls: they become X conjugation', () => {
  const { circuit: c } = parseQasm('OPENQASM 3.0; qubit[2] q; negctrl @ x q[0], q[1];');
  assert.equal(toQasm(c, 2).text.split('\n').slice(3).join('\n'), 'x q[0];\ncx q[0], q[1];\nx q[0];\n');
});

test('what OpenQASM 2 cannot say is reported, not silently dropped', () => {
  const { circuit: c } = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; ctrl(2) @ rx(0.1) q[0], q[1], q[2];');
  const { text, warnings } = toQasm(c, 2);
  assert.equal(warnings.length, 1);
  assert.match(text, /\/\/ unsupported in OpenQASM 2\.0: rx with 2 control\(s\)/);
  assert.match(toQasm(c, 3).text, /ctrl\(2\) @ rx\(0\.1\) q\[0\], q\[1\], q\[2\];/);
});

test('user gate definitions are kept and re-emitted', () => {
  const src = `OPENQASM 2.0;
include "qelib1.inc";
gate foo(a) x, y { rx(a) x; cx x, y; }
qreg q[3];
foo(0.5) q[0], q[2];
rzz(pi) q[1], q[2];
`;
  const { circuit: c, warnings } = parseQasm(src);
  assert.deepEqual(warnings, []);
  const out = toQasm(c, 2).text;
  assert.match(out, /gate foo\(a\) x, y \{ rx\(a\) x; cx x, y; \}/);
  assert.match(out, /foo\(0\.5\) q\[0\], q\[2\];/);
  const out3 = toQasm(c, 3).text;
  assert.match(out3, /gate rzz\(theta\)/, 'rzz is not in stdgates.inc, so it is defined');
  assert.deepEqual(strip(parseQasm(out3).circuit), strip(c));
});

test('unknown gates become boxes, with a warning, and an opaque declaration in OpenQASM 2', () => {
  const { circuit: c, warnings } = parseQasm('OPENQASM 2.0; qreg q[2]; oracle(1) q[0], q[1];');
  assert.equal(warnings.length, 1);
  assert.deepEqual(strip(c)[0].targets, [0, 1]);
  assert.match(toQasm(c, 2).text, /opaque oracle\(p0\) q0, q1;/);
});

test('errors carry line numbers', () => {
  assert.throws(() => parseQasm('OPENQASM 2.0;\nqreg q[1];\nh q[3];'), /line 3/);
  assert.throws(() => parseQasm('qreg q[2];\ncx q[0];'), /line 2: gate 'cx' expects 2/);
  assert.throws(() => parseQasm('qreg q[2];\nfor i in [0:1] { }'), /line 2/);
  assert.throws(() => parseQasm('qreg q[2];\ncx q[0], q[0];'), /line 2: .*same qubit/);
});

test('names on Object.prototype are not mistaken for gates', () => {
  const { circuit: c } = parseQasm('OPENQASM 2.0; qreg q[1]; constructor q[0];');
  assert.equal(strip(c)[0].gate, 'constructor');
});

test('every example round-trips through both dialects', () => {
  for (const ex of EXAMPLES) {
    const { circuit: c, warnings } = parseQasm(ex.qasm);
    assert.deepEqual(warnings, [], ex.name);
    for (const v of [2, 3]) {
      const { text } = toQasm(c, v);
      assert.deepEqual(strip(parseQasm(text).circuit), strip(c), `${ex.name}, OpenQASM ${v}`);
    }
  }
});

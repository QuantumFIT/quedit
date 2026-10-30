// The editing operations behind drag and drop, run headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrop } from '../src/editor.js';
import { parseQasm } from '../src/qasm.js';
import { compact, allOps, numCbits } from '../src/model.js';

const load = (src) => parseQasm(`OPENQASM 3.0; include "stdgates.inc"; ${src}`).circuit;
const shape = (c) => c.cols.map((col) => col.map((o) => `${o.gate}${o.controls.map((k) => (k.neg ? '~' : '') + k.q).join('')}>${o.targets}`).sort().join(' '));

test('dropping a gate on a free cell places it there', () => {
  const c = load('qubit[2] q; h q[0];');
  assert.equal(applyDrop(c, { kind: 'new', tool: { kind: 'gate', gate: 'x' } }, { col: 0, q: 1 }), null);
  assert.deepEqual(shape(c), ['h>0 x>1']);
});

test('dropping on an occupied cell inserts a column', () => {
  const c = load('qubit[2] q; h q[0]; x q[0];');
  applyDrop(c, { kind: 'new', tool: { kind: 'gate', gate: 'z' } }, { col: 1, q: 0 });
  assert.deepEqual(shape(c), ['h>0', 'z>0', 'x>0']);
});

test('far away drops pad with empty columns, and compact removes them', () => {
  const c = load('qubit[1] q; h q[0];');
  applyDrop(c, { kind: 'new', tool: { kind: 'gate', gate: 't' } }, { col: 4, q: 0 });
  assert.equal(c.cols.length, 5);
  compact(c);
  assert.deepEqual(shape(c), ['h>0', 't>0']);
});

test('a control dropped into a column joins the nearest gate there', () => {
  const c = load('qubit[4] q; h q[0]; x q[3];');
  assert.equal(applyDrop(c, { kind: 'new', tool: { kind: 'ctrl', neg: true } }, { col: 0, q: 2 }), null);
  assert.deepEqual(shape(c), ['h>0 x~2>3']);
  const err = applyDrop(c, { kind: 'new', tool: { kind: 'ctrl' } }, { col: 3, q: 0 });
  assert.match(err, /column that contains a gate/);
});

test('a control that would cross another gate pushes its gate into a new column', () => {
  const c = load('qubit[3] q; h q[1]; x q[2];');
  applyDrop(c, { kind: 'new', tool: { kind: 'ctrl' } }, { col: 0, q: 0 });
  // h on q1 stays nearest; x would have to cross it
  assert.deepEqual(shape(c), ['h0>1 x>2']);
});

test('dragging a control retargets it; dragging it off removes it', () => {
  const c = load('qubit[3] q; cx q[0], q[1];');
  const id = allOps(c)[0].id;
  applyDrop(c, { kind: 'op', id, part: 'c0', grabQ: 0 }, { col: 0, q: 2 });
  assert.deepEqual(shape(c), ['x2>1']);
  applyDrop(c, { kind: 'op', id, part: 'c0', grabQ: 2 }, null);
  assert.deepEqual(shape(c), ['x>1']);
});

test('dragging a gate moves all its qubits, and refuses to leave the circuit', () => {
  const c = load('qubit[3] q; cx q[0], q[1]; h q[2];');
  const id = allOps(c)[0].id;
  assert.equal(applyDrop(c, { kind: 'op', id, part: 'b', grabQ: 1 }, { col: 2, q: 2 }), null);
  assert.deepEqual(shape(c), ['h>2', '', 'x1>2']);
  assert.match(applyDrop(c, { kind: 'op', id, part: 'b', grabQ: 1 }, { col: 2, q: 2 }) || '', /leave the circuit/);
});

test('a measurement creates the classical bit it writes', () => {
  const c = load('qubit[3] q;');
  applyDrop(c, { kind: 'new', tool: { kind: 'measure' } }, { col: 0, q: 2 });
  assert.equal(numCbits(c), 3);
  assert.equal(allOps(c)[0].cbit, 2);
});

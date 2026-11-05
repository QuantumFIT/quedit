import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCircuit, setHidden, displayRows, removeQubit } from '../src/model.js';

test('hidden qubits: runs become one row, and indices follow removals', () => {
  const c = emptyCircuit(6);
  assert.equal(setHidden(c, [1, 2, 4], true), null);
  assert.deepEqual(displayRows(c).rows, [{ q: 0 }, { dots: [1, 2] }, { q: 3 }, { dots: [4] }, { q: 5 }]);
  assert.deepEqual(displayRows(c).rowOf, [0, 1, 1, 2, 3, 4]);
  removeQubit(c, 0);
  assert.deepEqual(c.hidden, [0, 1, 3]);
  assert.match(setHidden(c, [2, 4], true), /at least one/);
  assert.deepEqual(c.hidden, [0, 1, 3], 'a refused change changes nothing');
  setHidden(c, [0, 1, 3], false);
  assert.equal(c.hidden, undefined);
  // deleting the last visible qubit shows the rest rather than nothing
  const d = emptyCircuit(2);
  setHidden(d, [1], true);
  removeQubit(d, 0);
  assert.equal(d.hidden, undefined);
});

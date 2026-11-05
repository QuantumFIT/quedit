import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveUrl, liveUrl, circuitToFragment, fragmentToCircuit, qvisFragment, decodeText } from '../src/links.js';
import { parseQasm } from '../src/qasm.js';
import { allOps } from '../src/model.js';
import { buildHtml } from '../tools/build.mjs';

const SITE = 'https://quantum.fit.vut.cz/quedit/';
const strip = (c) => c.cols.map((col) => col.map(({ id, ...o }) => o));

test('a link carries the circuit, its layout and the export options', () => {
  const c = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; c = measure q;').circuit;
  c.cols.splice(1, 0, []);            // a deliberate gap
  const frag = circuitToFragment(c, { labels: 'ket0', classical: 'after', standalone: true });
  const back = fragmentToCircuit('#' + frag);
  assert.deepEqual(strip(back.circuit), strip(c));
  assert.deepEqual(back.options, { labels: 'ket0', classical: 'after', standalone: true });
});

test('a link to a compact circuit with default options stays short', () => {
  const c = parseQasm('OPENQASM 3.0; qubit[1] q; h q[0];').circuit;
  assert.deepEqual([...new URLSearchParams(circuitToFragment(c)).keys()], ['c']);
});

test('a layout that does not fit is ignored rather than trusted', () => {
  const c = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; x q[0];').circuit;
  const p = new URLSearchParams(circuitToFragment(c));
  p.set('k', '0.0');                 // both gates in one column on one wire
  assert.equal(allOps(fragmentToCircuit(p.toString()).circuit).length, 2);
  assert.equal(fragmentToCircuit(p.toString()).circuit.cols.length, 2);
});

test('a copied link points at the frozen copy of the build that made it', () => {
  assert.equal(archiveUrl(SITE, 'v3'), `${SITE}v/v3/`);
  assert.equal(archiveUrl(`${SITE}index.html#c=abc`, 'v3'), `${SITE}v/v3/`);
  assert.equal(archiveUrl(SITE, 'dev'), null, 'an unreleased build has no frozen copy');
  assert.equal(archiveUrl('file:///home/someone/quedit.html', 'v3'), null);
  assert.equal(archiveUrl(`${SITE}v/v3/`, 'v3'), null, 'already there');
});

test('archived pages and the preview offer the way back, and only they do', () => {
  assert.equal(liveUrl(`${SITE}v/v3/#c=abc`, 'v3'), SITE);
  assert.equal(liveUrl(SITE, 'v3'), null);
  assert.equal(liveUrl(`${SITE}preview/`, 'preview'), SITE);
  assert.equal(archiveUrl(`${SITE}preview/`, 'preview'), null, 'a preview link stays on the preview');
  assert.equal(liveUrl(SITE, 'dev'), null);
});

test('the build stamps the version it was told, and refuses nonsense', () => {
  const stamp = (v) => buildHtml(v).html.match(/name="quedit-version" content="([^"]*)"/)[1];
  assert.equal(stamp('v3'), 'v3');
  assert.equal(stamp('preview'), 'preview');
  assert.equal(stamp(), 'dev');
  for (const bad of ['1.2.3', 'v3; rm -rf /', 'prev', 'v', 'V3']) {
    assert.throws(() => buildHtml(bad), /must be 'dev', 'preview' or a release tag/, bad);
  }
});

test('the built page is self-contained', () => {
  const { html } = buildHtml();
  assert.doesNotMatch(html, /src="src\/|href="src\//);
  assert.match(html, /__m\['ui\.js'\]\.boot\(\)/);
});

test('a circuit goes to q-vis as unitary OpenQASM 2 from |0…0⟩', () => {
  const { circuit } = parseQasm(`OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
h q[0];
ryy(pi/2) q[0], q[1];
c[0] = measure q[0];
if (c[0]) x q[1];
reset q[0];
`);
  const { fragment, dropped } = qvisFragment(circuit);
  assert.equal(dropped, 3);
  const p = new URLSearchParams(fragment);
  const qasm = decodeText(p.get('c'));
  assert.match(qasm, /^OPENQASM 2\.0;/);
  assert.match(qasm, /ryy\(pi\/2\) q\[0\], ?q\[1\];/);
  assert.doesNotMatch(qasm, /measure|reset|if|creg/);
  assert.equal(decodeText(p.get('s')), '|00> : 1');
  // and what q-vis sends back — its OpenQASM 2, as `c` alone — loads here
  const back = fragmentToCircuit(`c=${p.get('c')}`).circuit;
  assert.equal(allOps(back).length, 2);
});

test('hidden qubits survive a link', () => {
  const { circuit } = parseQasm('OPENQASM 3.0; include "stdgates.inc"; qubit[4] q; h q[0]; cx q[0], q[3];');
  circuit.hidden = [1, 2];
  const frag = circuitToFragment(circuit);
  assert.match(frag, /(^|&)h=1\.2(&|$)/);
  assert.deepEqual(fragmentToCircuit(frag).circuit.hidden, [1, 2]);
  // out of range, or hiding everything, is ignored rather than fatal
  assert.equal(fragmentToCircuit(frag.replace('h=1.2', 'h=1.9')).circuit.hidden, undefined);
  assert.equal(fragmentToCircuit(frag.replace('h=1.2', 'h=0.1.2.3')).circuit.hidden, undefined);
});

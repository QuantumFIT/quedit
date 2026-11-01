// Permalinks and versioned URLs. Pure functions, no DOM: tested headless.
//
// A link carries the circuit as OpenQASM 3 plus, when it differs from the
// automatic layout, the column of every operation:
//
//   #c=<base64url(OpenQASM 3)>&k=<col,col,...>&l=<labels>&m=<classical>&s=1
//
// What such a link *means* is decided by the build that reads it, so a copied
// link points at the frozen copy of the build that made it, /v/<tag>/ (see
// docs/VERSIONS.md).

import { allOps, clone, sortCol, fits, compact, numQubits } from './model.js';
import { parseQasm, toQasm } from './qasm.js';
import { DEFAULT_OPTIONS } from './quantikz.js';

export function encodeText(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeText(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

const LABELS = { name: '', ket0: 'k', none: 'x' };
const CLASSICAL = { none: '', after: 'a', register: 'r' };
const inverse = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

// Column of each operation, in the order the OpenQASM export lists them.
function columnsOf(c) {
  const where = new Map();
  c.cols.forEach((col, i) => col.forEach((o) => where.set(o.id, i)));
  return allOps(c).map((o) => where.get(o.id));
}

export function circuitToFragment(c, options = {}) {
  const p = new URLSearchParams();
  p.set('c', encodeText(toQasm(c, 3).text));
  const auto = clone(c);
  compact(auto);
  const cols = columnsOf(c);
  if (cols.join() !== columnsOf(auto).join()) p.set('k', cols.join('.'));
  const opt = { ...DEFAULT_OPTIONS, ...options };
  if (LABELS[opt.labels]) p.set('l', LABELS[opt.labels]);
  if (CLASSICAL[opt.classical]) p.set('m', CLASSICAL[opt.classical]);
  if (opt.standalone) p.set('s', '1');
  return p.toString();
}

// Returns { circuit, options } or throws.
export function fragmentToCircuit(fragment) {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  if (!p.has('c')) throw new Error('the link carries no circuit');
  const { circuit } = parseQasm(decodeText(p.get('c')));
  const k = p.get('k');
  if (k) {
    const cols = k.split('.').map(Number);
    const ops = allOps(circuit);
    if (cols.length === ops.length && cols.every((x) => Number.isInteger(x) && x >= 0 && x < 10000)) {
      const placed = { ...circuit, cols: [] };
      let ok = true;
      ops.forEach((op, i) => {
        while (placed.cols.length <= cols[i]) placed.cols.push([]);
        if (!fits(placed, cols[i], op)) ok = false;
        else placed.cols[cols[i]].push(op);
      });
      if (ok) circuit.cols = placed.cols.map(sortCol);
    }
  }
  const options = {
    labels: inverse(LABELS)[p.get('l') || ''] || 'name',
    classical: inverse(CLASSICAL)[p.get('m') || ''] || 'none',
    standalone: p.get('s') === '1',
  };
  return { circuit, options };
}

// ---------------------------------------------------------------- q-vis
//
// q-vis (QuantumFIT/q-vis) animates how a decision diagram evolves under a
// unitary circuit. Its links are #c=<base64url(OpenQASM 2)>&s=<base64url(state)>,
// and it reads only unitary programs, so measurements, resets and conditioned
// gates are left out. Its own links come back here as `c` alone: the importer
// reads OpenQASM 2 as well as 3.

export const QVIS_URL = 'https://quantum.fit.vut.cz/q-vis/';

// Returns { fragment, dropped: number of operations left out, warnings }.
export function qvisFragment(c) {
  const u = clone(c);
  let dropped = 0;
  u.cols = u.cols.map((col) => col.filter((o) => {
    const keep = o.gate !== 'measure' && o.gate !== 'reset' && !o.cond;
    if (!keep) dropped++;
    return keep;
  }));
  u.cregs = [];
  const { text, warnings } = toQasm(u, 2);
  const p = new URLSearchParams();
  p.set('c', encodeText(text));
  p.set('s', encodeText(`|${'0'.repeat(numQubits(u))}> : 1`));
  return { fragment: p.toString(), dropped, warnings };
}

/** A released version is archived under /v/<version>/ and never changes again. */
const RELEASE = /^v\d+$/;

/** Where a build that is not the current one lives, relative to the site root. */
const elsewhere = (version) => (version === 'preview' ? 'preview/' : `v/${version}/`);

/**
 * Where a copied link should point: the frozen copy of this build. Null when
 * there is nothing frozen to point at — an unreleased build, a page opened from
 * a file, or a page that is already the archived copy.
 */
export function archiveUrl(href, version) {
  if (!RELEASE.test(version)) return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.pathname.includes(`/v/${version}/`)) return null;
  return new URL(`v/${version}/`, url).href;
}

/**
 * The way back to whatever is current, from an archived release or the preview.
 * Null when this page is the current one.
 */
export function liveUrl(href, version) {
  if (!RELEASE.test(version) && version !== 'preview') return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  const at = elsewhere(version);
  if (!url.pathname.includes(`/${at}`)) return null;
  return new URL('../'.repeat(at.split('/').length - 1), url).href;
}

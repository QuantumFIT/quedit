// The page: palette, toolbar, side panel, output pane, permalinks. The only
// module besides editor.js that touches the DOM.

import {
  GATES, emptyCircuit, numQubits, numCbits, findOp, replaceOp, removeOp, addQubit, removeQubit,
  compact, clone, validate, opQubits,
} from './model.js';
import { Editor, labelParts } from './editor.js';
import { parseQasm, toQasm } from './qasm.js';
import { toQuantikz } from './quantikz.js';
import { circuitToFragment, fragmentToCircuit, archiveUrl, liveUrl } from './links.js';
import { EXAMPLES } from './examples.js';

const $ = (id) => document.getElementById(id);
const STORE = 'quedit:circuit';

const state = {
  circuit: emptyCircuit(3),
  selected: null,
  tool: null,
  options: { labels: 'name', classical: 'none', standalone: false },
  tab: 'quantikz',
  undo: [],
  redo: [],
  dirtyCode: false,
};

let editor;

// ---------------------------------------------------------------- palette

const icon = {
  cnot: '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M11 5V25" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="5" r="3.2" fill="currentColor"/><circle cx="11" cy="21" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 21H18M11 14V28" stroke="currentColor" stroke-width="1.3"/></svg>',
  cz: '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M11 5V25" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="5" r="3.2" fill="currentColor"/><circle cx="11" cy="25" r="3.2" fill="currentColor"/></svg>',
  swap: '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M11 5V25M6 0L16 10M16 0L6 10M6 20L16 30M16 20L6 30" stroke="currentColor" stroke-width="1.3" transform="translate(0 0)"/></svg>',
  ctrl: '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 9V18" stroke="currentColor" stroke-width="1.3"/><circle cx="9" cy="9" r="4" fill="currentColor"/></svg>',
  nctrl: '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 13V18" stroke="currentColor" stroke-width="1.3"/><circle cx="9" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  measure: '<svg width="24" height="20" viewBox="0 0 24 20"><path d="M2 15A10 10 0 0 1 22 15M12 16L19 4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  barrier: '<svg width="10" height="28" viewBox="0 0 10 28"><path d="M5 0V28" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 3"/></svg>',
};

const gateTile = (g) => {
  const [m, s] = labelParts({ gate: g, params: [] });
  return `<span>${m}${s ? `<sub>${s}</sub>` : ''}</span>`;
};

const PALETTE = [
  ['Single qubit', ['h', 'x', 'y', 'z', 's', 'sdg', 't', 'tdg', 'sx', 'sxdg', 'id'].map((g) => ({ key: g, kind: 'gate', gate: g, html: gateTile(g), title: g }))],
  ['Rotations', ['rx', 'ry', 'rz', 'p', 'u', 'u2'].map((g) => ({ key: g, kind: 'gate', gate: g, html: gateTile(g), title: g }))],
  ['Multi qubit', [
    { key: 'cnot', kind: 'cnot', html: icon.cnot, title: 'CNOT' },
    { key: 'cz', kind: 'cz', html: icon.cz, title: 'controlled Z' },
    { key: 'swap', kind: 'gate', gate: 'swap', html: icon.swap, title: 'SWAP' },
    ...['rxx', 'ryy', 'rzz'].map((g) => ({ key: g, kind: 'gate', gate: g, html: gateTile(g), title: g })),
    { key: 'custom', kind: 'custom', html: 'custom…', wide: true, title: 'a named box on one or more wires' },
  ]],
  ['Controls', [
    { key: 'ctrl', kind: 'ctrl', neg: false, html: icon.ctrl, title: 'control: drop onto a column with a gate' },
    { key: 'nctrl', kind: 'ctrl', neg: true, html: icon.nctrl, title: 'negative control: drop onto a column with a gate' },
  ]],
  ['Other', [
    { key: 'measure', kind: 'measure', html: icon.measure, title: 'measurement' },
    { key: 'reset', kind: 'gate', gate: 'reset', html: '|0⟩', title: 'reset' },
    { key: 'barrier', kind: 'barrier', html: icon.barrier, title: 'barrier' },
  ]],
];

const TOOLS = new Map(PALETTE.flatMap(([, ts]) => ts.map((t) => [t.key, t])));

const KEY_TOOLS = { h: 'h', x: 'x', y: 'y', z: 'z', s: 's', t: 't', m: 'measure', c: 'ctrl', b: 'barrier', w: 'swap' };

function buildPalette() {
  const pal = $('palette');
  for (const [title, tools] of PALETTE) {
    const h = document.createElement('h3');
    h.textContent = title;
    const box = document.createElement('div');
    box.className = 'tiles';
    for (const t of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile' + (t.wide ? ' wide' : '');
      b.innerHTML = t.html;
      b.title = t.title;
      b.dataset.key = t.key;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const tool = resolveTool(t);
        if (!tool) return;
        editor.beginNew(tool, e, b.textContent.trim() || t.title);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTool(state.tool && state.tool.key === t.key ? null : resolveTool(t)); }
      });
      box.append(b);
    }
    pal.append(h, box);
  }
}

// A custom box asks for its name when it is picked.
function resolveTool(t) {
  if (t.kind !== 'custom') return t;
  const answer = prompt('Gate name, optionally followed by the number of qubits and parameters, e.g. "U 2" or "Oracle 3 theta"', state.lastCustom || 'U 2');
  if (!answer) return null;
  const [name, nq, ...params] = answer.trim().split(/\s+/);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { toast('a gate name is a letter followed by letters, digits or _'); return null; }
  state.lastCustom = answer;
  return { ...t, key: 'custom:' + answer, gate: name, qubits: Math.max(1, parseInt(nq, 10) || 1), params };
}

function setTool(tool) {
  state.tool = tool;
  for (const b of document.querySelectorAll('.tile')) {
    b.classList.toggle('armed', !!tool && (tool.key === b.dataset.key || tool.key.startsWith(b.dataset.key + ':')));
  }
  editor.setTool(tool);
}

// ---------------------------------------------------------------- state changes

// Apply `fn` to a copy of the circuit; on success it becomes the circuit and
// the old one goes on the undo stack. Returns an error message or null.
function commit(fn) {
  const next = clone(state.circuit);
  const err = fn(next);
  if (err) return err;
  try { validate(next); } catch (e) { return e.message; }
  if (JSON.stringify(next) === JSON.stringify(state.circuit)) return null;
  state.undo.push(state.circuit);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.circuit = next;
  changed();
  return null;
}

function setCircuit(c, keepHistory = true) {
  if (keepHistory) { state.undo.push(state.circuit); state.redo = []; }
  state.circuit = c;
  state.selected = null;
  changed();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(state.circuit);
  state.circuit = state.undo.pop();
  changed();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(state.circuit);
  state.circuit = state.redo.pop();
  changed();
}

function changed() {
  if (state.selected && !findOp(state.circuit, state.selected)) state.selected = null;
  editor.render();
  $('qcount').value = numQubits(state.circuit);
  $('ccount').value = numCbits(state.circuit);
  $('undo').disabled = !state.undo.length;
  $('redo').disabled = !state.redo.length;
  renderProps();
  renderOutput();
  try { localStorage.setItem(STORE, circuitToFragment(state.circuit, state.options)); } catch { /* private mode */ }
}

function select(id) {
  state.selected = id;
  editor.render();
  renderProps();
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function showGhost(label, e) {
  const g = $('ghost');
  if (!label || !e) { g.hidden = true; return; }
  const overCanvas = e.target && e.target.closest && e.target.closest('#canvas');
  g.hidden = !!overCanvas;
  g.textContent = label;
  g.style.left = e.clientX + 'px';
  g.style.top = e.clientY + 'px';
}

// ---------------------------------------------------------------- side panel

const parseQubitList = (s, n) => {
  const out = s.split(/[\s,]+/).filter(Boolean).map((x) => {
    const neg = x.startsWith('~');
    const q = Number(neg ? x.slice(1) : x);
    if (!Number.isInteger(q) || q < 0 || q >= n) throw new Error(`'${x}' is not a qubit (0–${n - 1})`);
    return { q, neg };
  });
  return out;
};

function renderProps() {
  const form = $('propsForm');
  const f = state.selected && findOp(state.circuit, state.selected);
  $('propsEmpty').hidden = !!f;
  form.hidden = !f;
  if (!f) { form.innerHTML = ''; return; }
  const op = f.op;
  const def = Object.hasOwn(GATES, op.gate) && GATES[op.gate];
  const r = labelParts(op)[2];
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const parts = [`<h2>${esc(def ? def.label + (def.sub ? def.sub : '') : op.gate)}${op.gate === 'measure' || op.gate === 'barrier' || op.gate === 'reset' ? '' : esc(r ? ' ' + r : '')}</h2>`];
  const special = ['measure', 'reset', 'barrier'].includes(op.gate);
  if (!special) {
    parts.push(`<label class="field">gate<input type="text" name="gate" value="${esc(op.gate)}" list="gateNames"></label>`);
    const names = def && def.params ? def.params : null;
    if (names) {
      names.forEach((nm, i) => parts.push(`<label class="field">${esc(nm)}<input type="text" name="p${i}" value="${esc(op.params[i] || '')}"></label>`));
    } else {
      parts.push(`<label class="field">parameters<input type="text" name="params" value="${esc(op.params.join(', '))}"><span class="help">comma-separated, e.g. pi/2, theta</span></label>`);
    }
  }
  parts.push(`<label class="field">${op.gate === 'barrier' ? 'qubits' : op.targets.length > 1 ? 'target qubits' : 'target qubit'}<input type="text" name="targets" value="${op.targets.join(', ')}"></label>`);
  if (!special) {
    parts.push(`<label class="field">controls<input type="text" name="controls" value="${op.controls.map((k) => (k.neg ? '~' : '') + k.q).join(', ')}"><span class="help">qubit numbers; ~2 is a negative control on qubit 2</span></label>`);
  }
  if (op.gate === 'measure') {
    parts.push(`<label class="field">classical bit<input type="number" min="0" name="cbit" value="${op.cbit ?? ''}"><span class="help">flat index over all bit registers</span></label>`);
  }
  if (op.gate !== 'barrier') {
    parts.push(`<label class="field">condition<input type="text" name="cond" value="${esc(op.cond || '')}" placeholder="e.g. c[0] or c==1"><span class="help">classical condition, exported as if (…)</span></label>`);
  }
  parts.push('<div class="actions"><button type="button" class="danger" data-act="delete">delete</button></div>');
  parts.push(`<datalist id="gateNames">${Object.keys(GATES).filter((g) => !['measure', 'reset', 'barrier'].includes(g)).map((g) => `<option value="${g}">`).join('')}</datalist>`);
  form.innerHTML = parts.join('');
}

function applyProps(input) {
  const f = findOp(state.circuit, state.selected);
  if (!f) return;
  const op = clone(f.op);
  const n = numQubits(state.circuit);
  const v = input.value.trim();
  try {
    const name = input.name;
    if (name === 'gate') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error('not a gate name');
      const def = Object.hasOwn(GATES, v) && GATES[v];
      if (def && def.noCtrl) throw new Error(`use the palette for ${v}`);
      op.gate = v;
      if (def) {
        const want = def.params ? def.params.length : 0;
        op.params = Array.from({ length: want }, (_, i) => op.params[i] || 'pi/2');
        const nq = def.qubits || 1;
        if (op.targets.length !== nq) {
          if (op.targets.length > nq) op.targets = op.targets.slice(0, nq);
          else {
            const free = [...Array(n).keys()].filter((q) => !opQubits(op).includes(q));
            while (op.targets.length < nq && free.length) {
              const last = op.targets[op.targets.length - 1];
              free.sort((a, b) => Math.abs(a - last) - Math.abs(b - last));
              op.targets.push(free.shift());
            }
            if (op.targets.length < nq) throw new Error(`${v} needs ${nq} qubits`);
          }
        }
      }
      delete op.inv; delete op.pow;
    } else if (/^p\d+$/.test(name)) {
      if (!v) throw new Error('a parameter cannot be empty');
      op.params[+name.slice(1)] = v;
    } else if (name === 'params') {
      op.params = v ? splitTop(v) : [];
    } else if (name === 'targets') {
      const ts = parseQubitList(v, n);
      if (!ts.length) throw new Error('at least one qubit is needed');
      if (ts.some((t) => t.neg)) throw new Error('~ is for controls only');
      const def = Object.hasOwn(GATES, op.gate) && GATES[op.gate];
      if (def && op.gate !== 'barrier' && ts.length !== (def.qubits || 1)) throw new Error(`${op.gate} acts on ${def.qubits || 1} qubit(s)`);
      op.targets = ts.map((t) => t.q);
      if (op.gate === 'barrier') op.targets.sort((a, b) => a - b);
    } else if (name === 'controls') {
      op.controls = parseQubitList(v, n);
    } else if (name === 'cbit') {
      if (v === '') op.cbit = null;
      else {
        const b = Number(v);
        if (!Number.isInteger(b) || b < 0) throw new Error('not a bit index');
        op.cbit = b;
      }
    } else if (name === 'cond') {
      if (v) op.cond = v; else delete op.cond;
    }
  } catch (e) {
    input.classList.add('bad');
    toast(e.message);
    return;
  }
  const err = commit((c) => {
    if (op.gate === 'measure' && op.cbit != null && op.cbit >= numCbits(c)) {
      const missing = op.cbit + 1 - numCbits(c);
      if (!c.cregs.length) c.cregs.push({ name: 'c', size: 0 });
      c.cregs[c.cregs.length - 1].size += missing;
    }
    replaceOp(c, op.id, op);
    return null;
  });
  if (err) { input.classList.add('bad'); toast(err); }
}

// Split on commas that are not inside parentheses.
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

// ---------------------------------------------------------------- output

function renderOutput() {
  const code = $('code');
  const status = $('status');
  const isQasm = state.tab !== 'quantikz';
  $('tikzOpts').hidden = isQasm;
  $('load').hidden = !isQasm;
  $('openFile').hidden = !isQasm;
  code.readOnly = !isQasm;
  let text, warnings = [];
  if (state.tab === 'quantikz') text = toQuantikz(state.circuit, state.options);
  else ({ text, warnings } = toQasm(state.circuit, state.tab === 'qasm2' ? 2 : 3));
  code.value = text;
  state.dirtyCode = false;
  status.className = 'status' + (warnings.length ? ' warn' : '');
  status.textContent = warnings.length ? `⚠ ${warnings.join('; ')}`
    : isQasm ? 'Edit the code and press “load into editor” (Ctrl+Enter) to bring changes back.' : '';
}

function loadCode() {
  const status = $('status');
  try {
    const { circuit, warnings } = parseQasm($('code').value);
    if (!numQubits(circuit)) throw new Error('the program declares no qubits');
    setCircuit(circuit);
    if (warnings.length) { status.className = 'status warn'; status.textContent = `⚠ ${warnings.join('; ')}`; }
    else toast('Loaded.');
  } catch (e) {
    status.className = 'status bad';
    status.textContent = `✗ ${e.message}`;
    if (e.line) selectLine($('code'), e.line);
  }
}

function selectLine(ta, line) {
  const lines = ta.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(start, start + (lines[line - 1] || '').length);
}

function setTab(tab) {
  if (state.dirtyCode && !confirm('Discard your edits to the code?')) return;
  state.tab = tab;
  for (const b of document.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  renderOutput();
}

function download() {
  const ext = state.tab === 'quantikz' ? 'tex' : 'qasm';
  const blob = new Blob([$('code').value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `circuit.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}.`);
  } catch {
    prompt(`Copy ${what}:`, text);
  }
}

// ---------------------------------------------------------------- versions & links

let versionSeen = '';
function version() {
  if (!versionSeen) versionSeen = document.querySelector('meta[name="quedit-version"]')?.content || 'dev';
  return versionSeen;
}

function permalink() {
  const here = location.href.split('#')[0];
  const base = archiveUrl(location.href, version()) || here;
  return `${base}#${circuitToFragment(state.circuit, state.options)}`;
}

function showVersion() {
  const back = liveUrl(location.href, version());
  if (!back) return;
  const chip = $('version');
  chip.textContent = `${version()} · open the current version`;
  chip.href = back;
  // carry the circuit being edited over to the current version
  chip.addEventListener('click', () => { chip.href = `${back}#${circuitToFragment(state.circuit, state.options)}`; });
  chip.title = version() === 'preview'
    ? 'this is a preview: it changes without warning and is not what the site serves'
    : 'this is a frozen copy, kept so that older links keep working';
}

function syncOptions() {
  $('optLabels').value = state.options.labels;
  $('optClassical').value = state.options.classical;
  $('optStandalone').checked = state.options.standalone;
}

function loadFragment(fragment) {
  const { circuit, options } = fragmentToCircuit(fragment);
  state.options = options;
  syncOptions();
  return circuit;
}

// ---------------------------------------------------------------- boot

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function boot() {
  showVersion();
  editor = new Editor($('canvas'), {
    circuit: () => state.circuit,
    commit,
    select,
    selected: () => state.selected,
    toast,
    setTool,
    showGhost,
    focusProps: () => $('propsForm').querySelector('input')?.focus(),
  });
  buildPalette();
  // handy from the browser console, and what the browser tests drive
  window.quedit = { editor, state, permalink };

  // initial circuit: link, then the last session, then an example
  let initial = null;
  if (location.hash.length > 1) {
    try { initial = loadFragment(location.hash); } catch (e) { toast(`The link could not be read: ${e.message}`); }
  }
  if (!initial) {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) initial = loadFragment(saved);
    } catch { /* ignore a broken save */ }
  }
  if (!initial) initial = parseQasm(EXAMPLES[0].qasm).circuit;
  state.circuit = initial;

  // toolbar
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('qplus').addEventListener('click', () => commit((c) => { addQubit(c); return null; }));
  $('qminus').addEventListener('click', () => {
    const n = numQubits(state.circuit);
    const err = commit((c) => (n <= 1 ? 'a circuit needs at least one qubit' : (removeQubit(c, n - 1), null)));
    if (err) toast(err);
  });
  $('cplus').addEventListener('click', () => commit((c) => {
    if (!c.cregs.length) c.cregs.push({ name: 'c', size: 0 });
    c.cregs[c.cregs.length - 1].size++;
    return null;
  }));
  $('cminus').addEventListener('click', () => {
    const err = commit((c) => {
      const nb = numCbits(c);
      if (!nb) return null;
      const used = c.cols.some((col) => col.some((o) => o.cbit === nb - 1));
      if (used) return `bit ${nb - 1} is measured into; change those measurements first`;
      const r = c.cregs[c.cregs.length - 1];
      r.size--;
      if (!r.size) c.cregs.pop();
      return null;
    });
    if (err) toast(err);
  });
  $('compact').addEventListener('click', () => commit((c) => { compact(c); return null; }));
  $('clear').addEventListener('click', () => commit((c) => { c.cols = []; return null; }));
  const ex = $('example');
  EXAMPLES.forEach((e, i) => ex.append(new Option(e.name, String(i))));
  ex.addEventListener('change', () => {
    if (ex.value === '') return;
    setCircuit(parseQasm(EXAMPLES[+ex.value].qasm).circuit);
    ex.value = '';
  });
  $('copyLink').addEventListener('click', () => {
    const link = permalink();
    history.replaceState(null, '', location.href.split('#')[0] + link.slice(link.indexOf('#')));
    copyText(link, 'a link to this circuit');
  });
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = dark ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('quedit:theme', t); } catch { /* ignore */ }
  });
  try { applyTheme(localStorage.getItem('quedit:theme')); } catch { /* ignore */ }

  // side panel
  const form = $('propsForm');
  form.addEventListener('change', (e) => { if (e.target.name) applyProps(e.target); });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => e.target.classList.remove('bad'));
  form.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'delete') commit((c) => { removeOp(c, state.selected); return null; });
  });

  // output
  for (const b of document.querySelectorAll('[role="tab"]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('optLabels').addEventListener('change', (e) => { state.options.labels = e.target.value; changed(); });
  $('optClassical').addEventListener('change', (e) => { state.options.classical = e.target.value; changed(); });
  $('optStandalone').addEventListener('change', (e) => { state.options.standalone = e.target.checked; changed(); });
  $('code').addEventListener('input', () => { state.dirtyCode = true; });
  $('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state.tab !== 'quantikz') { e.preventDefault(); loadCode(); }
  });
  $('load').addEventListener('click', loadCode);
  $('file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('code').value = await file.text();
    e.target.value = '';
    loadCode();
  });
  $('copy').addEventListener('click', () => copyText($('code').value, state.tab === 'quantikz' ? 'the quantikz code' : 'the OpenQASM code'));
  $('download').addEventListener('click', download);

  // keyboard
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') { setTool(null); select(null); return; }
    if (state.selected) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit((c) => { removeOp(c, state.selected); return null; });
        return;
      }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        const err = editor.nudge(state.selected, ...d);
        if (err) toast(err);
        return;
      }
    }
    const key = KEY_TOOLS[e.key.toLowerCase()];
    if (key && !e.target.closest('button')) {
      const tool = TOOLS.get(key);
      setTool(state.tool && state.tool.key === key ? null : tool);
    }
  });

  window.addEventListener('beforeunload', (e) => { if (state.dirtyCode) e.preventDefault(); });
  syncOptions();
  changed();
}

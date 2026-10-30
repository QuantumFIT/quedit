// OpenQASM 2.0 / 3.0 import and export.

import { GATES, emptyCircuit, makeOp, layoutInto, allOps, numQubits, locate, regOffset } from './model.js';

// ---------------------------------------------------------------- tokenizer

const PUNCT = ['->', '==', '!=', '<=', '>=', '&&', '||', '**', '<<', '>>', '++',
  '(', ')', '[', ']', '{', '}', ';', ',', '=', '+', '-', '*', '/', '^', '%', ':', '<', '>', '!', '~', '@', '&', '|'];

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    const start = i;
    let m;
    if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?(im)?/.exec(src.slice(i, i + 64)))) {
      toks.push({ t: 'num', v: m[0], line, start }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_$\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(src.slice(i, i + 256)))) {
      toks.push({ t: 'id', v: m[0], line, start }); i += m[0].length; continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw qerr('unterminated string', line);
      toks.push({ t: 'str', v: src.slice(i + 1, end), line, start }); i = end + 1; continue;
    }
    const p = PUNCT.find((p) => src.startsWith(p, i));
    if (!p) throw qerr(`unexpected character '${ch}'`, line);
    toks.push({ t: 'p', v: p, line, start }); i += p.length;
  }
  toks.push({ t: 'eof', v: '<end of file>', line, start: src.length });
  return toks;
}

function qerr(msg, line) {
  const e = new Error(line ? `line ${line}: ${msg}` : msg);
  e.line = line;
  return e;
}

// ------------------------------------------------------------------- import

// Standard gate names -> [canonical gate, number of controls, param mapper].
const IMPORT = {
  id: ['id', 0], i: ['id', 0], u0: ['id', 0, () => []],
  x: ['x', 0], y: ['y', 0], z: ['z', 0], h: ['h', 0],
  s: ['s', 0], sdg: ['sdg', 0], t: ['t', 0], tdg: ['tdg', 0], sx: ['sx', 0], sxdg: ['sxdg', 0],
  rx: ['rx', 0], ry: ['ry', 0], rz: ['rz', 0],
  p: ['p', 0], u1: ['p', 0], phase: ['p', 0],
  u2: ['u2', 0], u: ['u', 0], u3: ['u', 0], U: ['u', 0],
  swap: ['swap', 0], rxx: ['rxx', 0], ryy: ['ryy', 0], rzz: ['rzz', 0],
  cx: ['x', 1], CX: ['x', 1], cy: ['y', 1], cz: ['z', 1], ch: ['h', 1], csx: ['sx', 1],
  crx: ['rx', 1], cry: ['ry', 1], crz: ['rz', 1],
  cp: ['p', 1], cu1: ['p', 1], cphase: ['p', 1], cu3: ['u', 1],
  ccx: ['x', 2], c3x: ['x', 3], c4x: ['x', 4], c3sqrtx: ['sx', 3], cswap: ['swap', 1],
};

const SELF_INVERSE = new Set(['id', 'x', 'y', 'z', 'h', 'swap']);
const INVERSE = { s: 'sdg', sdg: 's', t: 'tdg', tdg: 't', sx: 'sxdg', sxdg: 'sx' };
const NEGATE_PARAMS = new Set(['rx', 'ry', 'rz', 'p', 'rxx', 'ryy', 'rzz']);

export function negateExpr(e) {
  e = e.trim();
  if (/^-[\w.π]+$/.test(e)) return e.slice(1);
  if (/^[\w.π]+$/.test(e)) return '-' + e;
  return `-(${e})`;
}

class Parser {
  constructor(src) {
    this.src = src;
    this.toks = tokenize(src);
    this.pos = 0;
    this.c = emptyCircuit(0);
    this.c.qregs = [];
    this.ops = [];
    this.warnings = [];
    this.custom = {};
    this.version = null;
  }
  peek(k = 0) { return this.toks[this.pos + k]; }
  next() { return this.toks[this.pos++]; }
  is(v, k = 0) { const t = this.peek(k); return t.t !== 'str' && t.v === v; }
  accept(v) { if (this.is(v)) { this.pos++; return true; } return false; }
  expect(v) {
    const t = this.next();
    if (t.v !== v || t.t === 'str') throw qerr(`expected '${v}' but found '${t.v}'`, t.line);
    return t;
  }
  ident() {
    const t = this.next();
    if (t.t !== 'id') throw qerr(`expected identifier but found '${t.v}'`, t.line);
    return t.v;
  }
  int() {
    const t = this.next();
    if (t.t !== 'num' || !/^\d+$/.test(t.v)) throw qerr(`expected integer but found '${t.v}'`, t.line);
    return parseInt(t.v, 10);
  }
  warn(msg, line) { this.warnings.push(line ? `line ${line}: ${msg}` : msg); }

  // Collect tokens of an expression up to (not including) one of `stops` at depth 0.
  exprText(stops) {
    let depth = 0, out = '';
    const startTok = this.peek();
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') throw qerr('unexpected end of file in expression', startTok.line);
      if (depth === 0 && t.t === 'p' && stops.includes(t.v)) break;
      if (['(', '[', '{'].includes(t.v)) depth++;
      if ([')', ']', '}'].includes(t.v)) depth--;
      this.pos++;
      const prev = out[out.length - 1];
      if (out && t.t !== 'p' && prev && /[\w.]/.test(prev)) out += ' ';
      out += t.v;
    }
    if (!out) throw qerr('expected expression', startTok.line);
    return out;
  }

  paramList() {
    const ps = [];
    if (this.accept('(')) {
      if (!this.accept(')')) {
        for (;;) {
          ps.push(this.exprText([',', ')']));
          if (this.accept(')')) break;
          this.expect(',');
        }
      }
    }
    return ps;
  }

  // A qubit/bit argument: returns list of flat indices.
  arg(regs, kind) {
    const t = this.peek();
    const name = this.ident();
    const reg = regs.find((r) => r.name === name);
    if (!reg) throw qerr(`unknown ${kind} register '${name}'`, t.line);
    const off = regOffset(regs, name);
    if (this.accept('[')) {
      const i = this.int();
      if (this.accept(':')) {
        const j = this.int();
        this.expect(']');
        const out = [];
        for (let k = i; k <= j; k++) out.push(off + k);
        return out;
      }
      this.expect(']');
      if (i >= reg.size) throw qerr(`index ${i} out of range for '${name}[${reg.size}]'`, t.line);
      return [off + i];
    }
    return Array.from({ length: reg.size }, (_, k) => off + k);
  }

  argList(regs, kind, stop = ';') {
    const args = [];
    if (this.is(stop)) return args;
    for (;;) {
      args.push(this.arg(regs, kind));
      if (!this.accept(',')) break;
    }
    return args;
  }

  parse() {
    while (this.peek().t !== 'eof') this.statement(this.ops, null);
    layoutInto(this.c, this.ops);
    for (const r of this.c.qregs) if (!r.name) r.name = 'q';
    return { circuit: this.c, warnings: this.warnings, version: this.version };
  }

  statement(out, cond) {
    const t = this.peek();
    const kw = t.t === 'id' ? t.v : null;
    if (kw === 'OPENQASM') {
      this.next();
      this.version = this.next().v;
      this.expect(';');
      return;
    }
    if (kw === 'include') {
      this.next(); this.next(); this.expect(';');
      return;
    }
    if (kw === 'qreg' || kw === 'creg') {
      this.next();
      const name = this.ident();
      this.expect('['); const n = this.int(); this.expect(']'); this.expect(';');
      this.declare(kw === 'qreg' ? 'q' : 'c', name, n, t.line);
      return;
    }
    if (kw === 'qubit' || kw === 'bit') {
      this.next();
      let n = 1;
      if (this.accept('[')) { n = this.int(); this.expect(']'); }
      const name = this.ident();
      this.expect(';');
      this.declare(kw === 'qubit' ? 'q' : 'c', name, n, t.line);
      return;
    }
    if (kw === 'gate' || kw === 'opaque') return this.gateDef(kw);
    if (kw === 'if') {
      this.next(); this.expect('(');
      const c = this.exprText([')']);
      this.expect(')');
      if (this.accept('{')) {
        while (!this.accept('}')) this.statement(out, c);
      } else this.statement(out, c);
      return;
    }
    if (kw === 'barrier') {
      this.next();
      const args = this.argList(this.c.qregs, 'qubit');
      this.expect(';');
      let qs = args.flat();
      if (!qs.length) qs = Array.from({ length: numQubits(this.c) }, (_, i) => i);
      if (qs.length) out.push(makeOp('barrier', [...new Set(qs)].sort((a, b) => a - b)));
      return;
    }
    if (kw === 'reset') {
      this.next();
      const args = this.argList(this.c.qregs, 'qubit');
      this.expect(';');
      for (const q of args.flat()) out.push(withCond(makeOp('reset', [q]), cond));
      return;
    }
    if (kw === 'measure') {
      this.next();
      const qs = this.arg(this.c.qregs, 'qubit');
      let cs = null;
      if (this.accept('->')) cs = this.arg(this.c.cregs, 'bit');
      this.expect(';');
      this.measure(out, qs, cs, cond, t.line);
      return;
    }
    // `c = measure q;` / `c[0] = measure q[0];`
    if (t.t === 'id' && (this.is('=', 1) || (this.is('[', 1) && this.is('=', 4)))) {
      const cs = this.arg(this.c.cregs, 'bit');
      this.expect('=');
      if (!this.is('measure')) throw qerr('only measurement assignments are supported', t.line);
      this.next();
      const qs = this.arg(this.c.qregs, 'qubit');
      this.expect(';');
      this.measure(out, qs, cs, cond, t.line);
      return;
    }
    if (kw === 'gphase') {
      this.next(); this.paramList(); this.argList(this.c.qregs, 'qubit'); this.expect(';');
      this.warn('global phase (gphase) ignored', t.line);
      return;
    }
    if (t.t === 'id') return this.gateCall(out, cond);
    throw qerr(`unexpected '${t.v}'`, t.line);
  }

  declare(kind, name, n, line) {
    const regs = kind === 'q' ? this.c.qregs : this.c.cregs;
    if (this.c.qregs.some((r) => r.name === name) || this.c.cregs.some((r) => r.name === name))
      throw qerr(`register '${name}' declared twice`, line);
    if (kind === 'q' && this.ops.length)
      this.warn('qubit register declared after operations', line);
    regs.push({ name, size: n });
  }

  measure(out, qs, cs, cond, line) {
    if (cs && cs.length !== qs.length) throw qerr('measure: register sizes differ', line);
    qs.forEach((q, i) => out.push(withCond(makeOp('measure', [q], { cbit: cs ? cs[i] : null }), cond)));
  }

  gateDef(kw) {
    const startTok = this.next();
    const name = this.ident();
    const params = [];
    if (this.accept('(')) {
      if (!this.accept(')')) {
        for (;;) { params.push(this.ident()); if (this.accept(')')) break; this.expect(','); }
      }
    }
    const qargs = [];
    for (;;) { qargs.push(this.ident()); if (!this.accept(',')) break; }
    let end;
    if (kw === 'opaque') {
      end = this.expect(';');
    } else {
      this.expect('{');
      let depth = 1;
      while (depth) {
        const t = this.next();
        if (t.t === 'eof') throw qerr(`unterminated gate definition '${name}'`, startTok.line);
        if (t.v === '{') depth++;
        if (t.v === '}') depth--;
        end = t;
      }
    }
    this.custom[name] = { params: params.length, qubits: qargs.length };
    this.c.defs.push({ name, text: this.src.slice(startTok.start, end.start + 1) });
  }

  gateCall(out, cond) {
    const startTok = this.peek();
    const mods = [];
    for (;;) {
      const t = this.peek();
      if (t.t === 'id' && ['ctrl', 'negctrl', 'inv', 'pow'].includes(t.v) && (this.is('@', 1) || this.is('(', 1))) {
        this.next();
        let n = 1;
        if (this.accept('(')) {
          const e = this.exprText([')']);
          this.expect(')');
          n = t.v === 'pow' ? e : parseInt(e, 10);
        }
        this.expect('@');
        mods.push({ kind: t.v, n });
      } else break;
    }
    const name = this.ident();
    const params = this.paramList();
    const args = this.argList(this.c.qregs, 'qubit');
    this.expect(';');

    // broadcasting
    const len = Math.max(...args.map((a) => a.length));
    if (args.some((a) => a.length !== 1 && a.length !== len))
      throw qerr('mismatched register sizes in gate arguments', startTok.line);
    for (let i = 0; i < len; i++) {
      const qs = args.map((a) => (a.length === 1 ? a[0] : a[i]));
      if (new Set(qs).size !== qs.length) throw qerr(`gate '${name}' applied to the same qubit twice`, startTok.line);
      out.push(withCond(this.buildOp(name, params, qs, mods, startTok.line), cond));
    }
  }

  buildOp(name, params, qs, mods, line) {
    const controls = [];
    let inv = false, pow = null, k = 0;
    for (const m of mods) {
      if (m.kind === 'ctrl' || m.kind === 'negctrl') {
        for (let j = 0; j < m.n; j++) controls.push({ q: qs[k++], neg: m.kind === 'negctrl' });
      } else if (m.kind === 'inv') inv = !inv;
      else if (m.kind === 'pow') pow = m.n;
    }
    let rest = qs.slice(k);
    let gate = name;
    const std = !this.custom[name] && Object.hasOwn(IMPORT, name) && IMPORT[name];
    if (std) {
      gate = std[0];
      if (std[2]) params = std[2](params);
      for (let j = 0; j < std[1]; j++) controls.push({ q: rest[j], neg: false });
      rest = rest.slice(std[1]);
    } else if (name === 'cu' && !this.custom.cu && params.length === 4 && /^0*\.?0*$/.test(params[3])) {
      gate = 'u';
      params = params.slice(0, 3);
      controls.push({ q: rest[0], neg: false });
      rest = rest.slice(1);
    } else if (!this.custom[name]) {
      this.warn(`unknown gate '${name}' (kept as a box)`, line);
    }
    const def = Object.hasOwn(GATES, gate) && GATES[gate];
    if (def) {
      const nq = def.qubits || 1;
      const np = def.params ? def.params.length : 0;
      if (rest.length !== nq) throw qerr(`gate '${name}' expects ${nq + controls.length} qubit(s)`, line);
      if (params.length !== np) throw qerr(`gate '${name}' expects ${np} parameter(s)`, line);
    }
    const op = makeOp(gate, rest, { params, controls });
    if (inv) {
      if (SELF_INVERSE.has(gate)) { /* nothing */ }
      else if (INVERSE[gate]) op.gate = INVERSE[gate];
      else if (NEGATE_PARAMS.has(gate)) op.params = op.params.map(negateExpr);
      else if (gate === 'u') op.params = [negateExpr(params[0]), negateExpr(params[2]), negateExpr(params[1])];
      else if (gate === 'u2') { op.gate = 'u'; op.params = ['-pi/2', negateExpr(params[1]), negateExpr(params[0])]; }
      else op.inv = true;
    }
    if (pow !== null) {
      if (def) {
        // keep as generic box so that the modifier survives a round trip
        this.warn(`pow modifier on '${name}' kept as a generic gate`, line);
      }
      op.pow = pow;
    }
    return op;
  }
}

function withCond(op, cond) {
  if (cond) op.cond = cond;
  return op;
}

export function parseQasm(src) {
  return new Parser(src).parse();
}

// ------------------------------------------------------------------- export

// Gate definitions not provided by the standard include files.
const EXTRA_DEFS = {
  2: {
    ryy: 'gate ryy(theta) a, b { rx(pi/2) a; rx(pi/2) b; cx a, b; rz(theta) b; cx a, b; rx(-pi/2) a; rx(-pi/2) b; }',
  },
  3: {
    sxdg: 'gate sxdg a { s a; h a; s a; }',
    rxx: 'gate rxx(theta) a, b { h a; h b; cx a, b; rz(theta) b; cx a, b; h a; h b; }',
    ryy: 'gate ryy(theta) a, b { rx(pi/2) a; rx(pi/2) b; cx a, b; rz(theta) b; cx a, b; rx(-pi/2) a; rx(-pi/2) b; }',
    rzz: 'gate rzz(theta) a, b { cx a, b; rz(theta) b; cx a, b; }',
  },
};

// Names of controlled variants: [gate][#controls] (index 0 = uncontrolled).
const NAMES = {
  2: {
    id: ['id'], x: ['x', 'cx', 'ccx', 'c3x', 'c4x'], y: ['y', 'cy'], z: ['z', 'cz'], h: ['h', 'ch'],
    s: ['s'], sdg: ['sdg'], t: ['t'], tdg: ['tdg'], sx: ['sx', 'csx', null, 'c3sqrtx'], sxdg: ['sxdg'],
    rx: ['rx', 'crx'], ry: ['ry', 'cry'], rz: ['rz', 'crz'], p: ['u1', 'cu1'], u2: ['u2'], u: ['u3', 'cu3'],
    swap: ['swap', 'cswap'], rxx: ['rxx'], ryy: ['ryy'], rzz: ['rzz'],
  },
  3: {
    id: ['id'], x: ['x', 'cx', 'ccx'], y: ['y', 'cy'], z: ['z', 'cz'], h: ['h', 'ch'],
    s: ['s'], sdg: ['sdg'], t: ['t'], tdg: ['tdg'], sx: ['sx'], sxdg: ['sxdg'],
    rx: ['rx', 'crx'], ry: ['ry', 'cry'], rz: ['rz', 'crz'], p: ['p', 'cp'], u2: ['u2'], u: ['U', 'cu'],
    swap: ['swap', 'cswap'], rxx: ['rxx'], ryy: ['ryy'], rzz: ['rzz'],
  },
};

const STD_NAMES = new Set(Object.keys(IMPORT).concat(['cu']));

function qname(c, q) {
  const l = locate(c.qregs, q);
  return `${l.reg.name}[${l.idx}]`;
}

function cname(c, b) {
  const l = locate(c.cregs, b);
  return l ? `${l.reg.name}[${l.idx}]` : null;
}

export function toQasm(c, version = 3) {
  const v = version === 2 ? 2 : 3;
  const warnings = [];
  const body = [];
  const needDefs = new Set();
  const userDefs = new Set(c.defs.map((d) => d.name));
  const opaque = new Map();

  for (const op of allOps(c)) {
    let lines;
    try {
      lines = opLines(c, op, v, needDefs, opaque, userDefs);
    } catch (e) {
      warnings.push(e.message);
      lines = [`// unsupported in OpenQASM ${v}.0: ${e.message}`];
    }
    if (op.cond) {
      if (lines.length === 1 && !lines[0].startsWith('//')) lines = [`if (${op.cond}) ${lines[0]}`];
      else if (v === 3) lines = [`if (${op.cond}) {`, ...lines.map((l) => '  ' + l), '}'];
      else {
        warnings.push(`condition '${op.cond}' on a multi-instruction sequence dropped`);
      }
    }
    body.push(...lines);
  }

  const out = [];
  out.push(v === 2 ? 'OPENQASM 2.0;' : 'OPENQASM 3.0;');
  out.push(v === 2 ? 'include "qelib1.inc";' : 'include "stdgates.inc";');
  for (const name of needDefs) if (!userDefs.has(name)) out.push(EXTRA_DEFS[v][name]);
  for (const d of c.defs) out.push(d.text);
  for (const [name, sig] of opaque) {
    if (v === 2) out.push(`opaque ${name}${sig.params ? '(' + Array.from({ length: sig.params }, (_, i) => 'p' + i).join(', ') + ')' : ''} ${Array.from({ length: sig.qubits }, (_, i) => 'q' + i).join(', ')};`);
    else warnings.push(`gate '${name}' has no definition`);
  }
  for (const r of c.qregs) out.push(v === 2 ? `qreg ${r.name}[${r.size}];` : `qubit[${r.size}] ${r.name};`);
  for (const r of c.cregs) out.push(v === 2 ? `creg ${r.name}[${r.size}];` : `bit[${r.size}] ${r.name};`);
  out.push(...body);
  return { text: out.join('\n') + '\n', warnings };
}

function opLines(c, op, v, needDefs, opaque, userDefs) {
  const q = (x) => qname(c, x);
  const ps = op.params.length ? `(${op.params.join(', ')})` : '';
  if (op.gate === 'measure') {
    const b = op.cbit == null ? null : cname(c, op.cbit);
    if (!b) {
      if (v === 3) return [`measure ${q(op.targets[0])};`];
      throw new Error(`measurement of ${q(op.targets[0])} has no classical bit`);
    }
    return [v === 2 ? `measure ${q(op.targets[0])} -> ${b};` : `${b} = measure ${q(op.targets[0])};`];
  }
  if (op.gate === 'reset') return [`reset ${q(op.targets[0])};`];
  if (op.gate === 'barrier') return [`barrier ${op.targets.map(q).join(', ')};`];

  const names = Object.hasOwn(NAMES[v], op.gate) && NAMES[v][op.gate];
  const nc = op.controls.length;
  const negs = op.controls.filter((k) => k.neg);
  const args = [...op.controls.map((k) => k.q), ...op.targets].map(q).join(', ');

  if (!names) {
    // generic / user-defined gate
    if (!userDefs.has(op.gate) && !STD_NAMES.has(op.gate)) {
      opaque.set(op.gate, { params: op.params.length, qubits: op.targets.length });
    }
    let mods = '';
    if (op.inv) mods += 'inv @ ';
    if (op.pow != null) mods += `pow(${op.pow}) @ `;
    if (v === 2 && (mods || nc)) throw new Error(`modifiers/controls on '${op.gate}' need OpenQASM 3`);
    return [`${mods}${ctrlMods(op.controls)}${op.gate}${ps} ${args};`];
  }
  if (Object.hasOwn(EXTRA_DEFS[v], op.gate)) needDefs.add(op.gate);

  if (v === 2) {
    let name = names[nc];
    if (op.gate === 'u' && nc === 0) name = 'u3';
    if (!name) throw new Error(`${op.gate} with ${nc} control(s)`);
    const flips = negs.map((k) => `x ${q(k.q)};`);
    return [...flips, `${name}${ps} ${args};`, ...flips];
  }
  // OpenQASM 3
  if (!negs.length && names[nc]) {
    if (op.gate === 'u' && nc === 1) return [`cu(${op.params.join(', ')}, 0) ${args};`];
    return [`${names[nc]}${ps} ${args};`];
  }
  return [`${ctrlMods(op.controls)}${names[0]}${ps} ${args};`];
}

// Group consecutive controls of the same polarity into ctrl(n)/negctrl(n) modifiers.
function ctrlMods(controls) {
  let s = '';
  for (let i = 0; i < controls.length;) {
    let j = i;
    while (j < controls.length && controls[j].neg === controls[i].neg) j++;
    const n = j - i;
    s += `${controls[i].neg ? 'negctrl' : 'ctrl'}${n > 1 ? `(${n})` : ''} @ `;
    i = j;
  }
  return s;
}


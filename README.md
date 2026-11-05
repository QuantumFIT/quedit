# quedit

A WYSIWYG editor for quantum circuits that runs in the browser and writes
**[quantikz](https://ctan.org/pkg/quantikz)** LaTeX and **OpenQASM 2.0 / 3.0**, and reads
OpenQASM back in.

**→ <https://quantum.fit.vut.cz/quedit/>**

No installation, no server, no dependencies: the whole tool is one HTML file that also
works offline from `file://`.

## Using it

- **Place gates** by dragging them from the palette onto a wire, or click a gate to pick
  it and click on the circuit to place it (Shift-click to place several). Keyboard: `h x y
  z s t` pick the gate, `m` a measurement, `c` a control, `w` a swap, `b` a barrier.
- **Controls**: drop a ● (or ○ for a negative control) into a column that has a gate —
  it joins the nearest gate there. CNOT and CZ in the palette come with their control
  already attached. Any gate can have any number of controls.
- **Move** a gate by dragging it; drag a control dot or a swap end to move just that end.
  Drag anything off the circuit (or right-click it) to delete it.
- **Hide** qubits under ⋮: hover a qubit's label and click the ⋮ button. Neighbouring
  hidden qubits share one row of dots; click the dots to show them again. Only the drawing
  changes (editor, PNG and quantikz, where the row is `\lstick{\vdots} \setwiretype{n}`),
  never the program: gates entirely on hidden qubits are not drawn, and a gate partly on
  them keeps its line into the dots.
- **Edit** the selected gate in the side panel: parameters (`pi/4`, `theta`, `-2*pi/3`),
  target qubits, controls (`~2` is a negative control on qubit 2), the classical bit of a
  measurement, a classical condition. Arrow keys move the selected gate, `Del` deletes it.
- **Output**: the bottom pane shows quantikz, OpenQASM 3 and OpenQASM 2, live.
  The OpenQASM tabs are editable: change the code, or open a `.qasm` file, and press
  *load into editor* (Ctrl+Enter). Parse errors point at their line.
- **PDF** (quantikz tab) compiles the quantikz as a standalone document on
  [texlive.net](https://texlive.net/) and opens the PDF in a new tab — the browser cannot
  run LaTeX itself, so the code is sent there.
- **copy PNG** puts the drawing on the clipboard as an image (3× resolution, white
  background); where the browser does not allow images on the clipboard, e.g. from
  `file://`, it saves `circuit.png` instead.
- **open in q-vis** shows the circuit in [q-vis](https://quantum.fit.vut.cz/q-vis/), which
  animates its decision diagram gate by gate. q-vis simulates unitary circuits only, so
  measurements, resets and conditioned gates are left out, and it takes only angles that
  are π times a dyadic fraction (π/4 yes, π/3 no). Its *quedit ↗* button brings a circuit
  back.
- **copy link** gives a permalink with the circuit, its layout and the export options in
  it. See below for why links point at a versioned copy.

### quantikz options

- *wire labels*: `q_{0}` style register names, `\ket{0}`, or none.
- *measurement*: just `\meter{}`; the wire turning classical after the final measurement;
  or a classical register wire at the bottom with `\vcw` from each meter.
- *full document*: wrap the circuit in a `standalone` document that compiles on its own.

The output uses only commands present in quantikz 1.0 (TeX Live 2023) and compiles with
newer versions too.

### What is supported

| | |
| --- | --- |
| gates | `id h x y z s sdg t tdg sx sxdg rx ry rz p u u2 swap rxx ryy rzz`, plus any named box over any number of qubits |
| modifiers | any number of positive/negative controls on any gate; `inv @` (folded into the gate where possible); `pow(k) @` is kept |
| other | `measure`, `reset`, `barrier`, `if (…)` conditions |
| OpenQASM import | 2.0 (`qreg`, `creg`, `qelib1.inc` gates incl. Qiskit's additions) and the matching subset of 3.0 (`qubit[n]`, `bit[n]`, `c = measure q`, `ctrl(n)/negctrl/inv/pow @`, `stdgates.inc`); register broadcasting; `gate`/`opaque` definitions are kept and re-emitted |
| not supported | classical control flow (`for`, `while`, `def`), classical expressions beyond conditions, pulse-level code |

Known limitations: a barrier on a subset of qubits becomes a full-height `\slice` in
quantikz; a multi-qubit box over non-adjacent wires is drawn over the wires between them
(the editor numbers the box's wires in that case); classically conditioned gates are drawn
without their condition in quantikz (a comment in the output says so). Things OpenQASM 2
cannot express (e.g. `rx` with two controls) are reported and left as comments.

Import from quantikz is not supported yet.

## Developing

```
python3 -m http.server 8000      # then open http://localhost:8000/dev.html
node --test tests/*.test.js      # zero dependencies; compiles the LaTeX if pdflatex is around
node tools/build.mjs             # the single-file quedit.html
```

`dev.html` loads the ES modules in `src/` directly; there is no build step in the dev
loop. Only `src/editor.js` and `src/ui.js` touch the DOM — the circuit model, the
OpenQASM parser and the exporters run headless in Node, which is what the tests use.

| module | role |
| --- | --- |
| `src/model.js` | the circuit: registers and a grid of columns of operations |
| `src/qasm.js` | OpenQASM 2/3 parser and writer |
| `src/quantikz.js` | quantikz writer |
| `src/links.js` | permalinks and versioned URLs |
| `src/editor.js` | the SVG canvas and drag and drop |
| `src/ui.js` | the rest of the page |

## Versions, previews and links

Done the same way as in [q-vis](https://github.com/QuantumFIT/q-vis):

- the site root is `master`, and `master` only moves on a release tagged `v1`, `v2`, …;
- every release is kept, frozen, at `/v/<tag>/` (listed at `/v/`), and **copy link** in a
  released build points there, so a shared link keeps opening the editor that made it;
- the `preview` branch is published at `/preview/` for review before a release:
  `git push -f origin HEAD:preview`.

Details in [`docs/VERSIONS.md`](docs/VERSIONS.md).

## License

MIT.

# quedit — project conventions

WYSIWYG quantum circuit editor (static web page) that exports quantikz and OpenQASM 2/3
and imports OpenQASM. Sibling of q-vis (`~/q-vis`, github.com/QuantumFIT/q-vis), whose
conventions it follows.

## Hard constraints

- **No runtime dependencies. No CDN. No build step in the dev loop.**
  Source is native ES modules in `src/`, loaded by `dev.html`. `tools/build.mjs` inlines
  everything into a single self-contained `quedit.html` that works offline from `file://`.
  The bundler is line-based: imports are `import { … } from './x.js';` (may span lines),
  exports are `export function|const|class` — no default exports, no re-export lists.
- `node --test tests/*.test.js` must pass with **zero `node_modules`**.
- **Only `editor.js` and `ui.js` may touch the DOM** (and `editor.js` only inside the
  `Editor` class, so its editing functions stay testable headless).
- The quantikz output must compile with quantikz 1.0 (TeX Live 2023): `tests/quantikz.test.js`
  compiles every example in every option combination when pdflatex is available.

## Model

A circuit is a grid (`c.cols`, each a list of ops with disjoint vertical spans) over flat
qubit/bit indices across registers. The grid *is* the layout the user sees and the
quantikz columns; OpenQASM import lays ops out as-soon-as-possible, respecting both qubit
and classical-bit order.

## Previewing and releasing

Same as q-vis — see `docs/VERSIONS.md`.

- Work in progress goes to `preview`: `git push -f origin HEAD:preview`, published at
  <https://quantum.fit.vut.cz/quedit/preview/>. Give that link last, once the deploy has
  landed.
- **Nothing lands on master until Ondra has reviewed the preview and says to deploy**, and
  the release is tagged in the same push:
  ```
  git tag -a vN -m "One line saying what this release added"
  git push origin master --atomic --follow-tags
  ```
- Changing what a permalink means (`src/links.js`) is fine — old links are pinned to
  `/v/<tag>/` — but keep the fragment table in `docs/VERSIONS.md` current.

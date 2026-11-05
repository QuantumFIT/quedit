<!-- The scheme is the same as in q-vis (github.com/QuantumFIT/q-vis). -->
# Versions, and why old links keep working

A permalink carries the whole circuit (as OpenQASM 3), the column of every gate and the
quantikz export options in its fragment. That makes it self-contained, but not stable:
what `#c=…&k=…&m=a` *means* is decided by the build that reads it, and the meaning drifts.
The OpenQASM dialect the importer understands grows, the automatic layout may change, an
option letter could be reused — so a circuit that loads today may load differently later.

The fragment format, for reference (all but `c` are omitted when they are the default):

| key | meaning |
| --- | --- |
| `c` | the circuit as OpenQASM 3, UTF-8, base64url |
| `k` | the column of each operation, in program order, `.`-separated; only when the layout is not the automatic one |
| `h` | the qubits hidden under ⋮, `.`-separated (since v3) |
| `l` | wire labels: `k` = \|0⟩, `x` = none (default: register names) |
| `m` | measurements: `a` = classical wire after the meter, `r` = wire to a register (default: meter only) |
| `s` | `1` = emit a complete standalone document |

So a released build does not ask a future build to interpret its links. **"copy link"
points at the frozen copy of the build that made it**, under `/v/<version>/`, and that
page never changes again.

```
https://quantum.fit.vut.cz/quedit/v/v9/#c=…&k=…
                                   ^^^^ the build that wrote this link
```

The archived page says which version it is and offers the way back to the current one, so
nobody is stranded on an old build without noticing.

## What is archived

Every release tag — `v1`, `v2`, … — and nothing else. `tools/release.mjs` builds them all
on every deploy, each from its own source with its own `tools/build.mjs`, which is what
makes a copy faithful rather than merely old. The archive is therefore a function of the
repository alone: nothing is carried over from the previous publish, and a lost or
mangled deploy is repaired by running the workflow again.

`/v/` lists them. The site root is always the tip of `master`.

## Releasing

**Tag every deploy you want to be linkable.** An untagged build stamps itself `dev` and
copies plain links to the site root, which are as stable as the parameter format and no
more — fine for a work in progress, not for anything shared.

```
git tag -a v12 -m "One line saying what this release added"
git push origin master --atomic --follow-tags
```

The tag message is the description shown on `/v/`. Push the tag *with* the commit it
names: only `master` may deploy, so a tag push of its own is refused by the environment,
and the branch push is what rebuilds the archive. To tag a commit master has already moved
past, add the tag and then run the workflow by hand (Actions → CI → Run workflow).

Tag the commit you are deploying, not one behind it. The root build stamps itself with the
tag it is exactly at, and calls itself `dev` otherwise — an honest answer, since a build
one commit past `v11` is not `v11` — but a `dev` root copies plain links to the site root
instead of pinning them. Since every push to master is a release, this does not come up
unless a release is pushed without its tag.

## Previewing

`/preview/` is the build of the `preview` branch, published so that a change can be
clicked through before it is public.

```
git push -f origin HEAD:preview       # from a feature branch or worktree
→ /preview/                           # refreshes within a minute
```

**The root does not move.** The deploy job checks out `master` whatever ref started it, so
a push to `preview` rebuilds and republishes the whole site with the public page unchanged.
That is a property of the workflow, not a habit to keep — `/preview/` is the only path a
preview push can affect.

It lives outside `/v/`, because everything in `/v/` is frozen forever and a preview is the
opposite: it changes without warning, and it disappears from the site on the next deploy
after the branch is deleted. Its pages carry `robots: noindex`, and `copy link` on a
preview points at the preview rather than at the root — a link to a draft should show the
draft. The masthead says `preview · open the current version`.

It is a public URL, not a private staging area. Anyone with the link can open it.

**Master only ever moves on a release.** Nothing lands there until the
preview has been reviewed and is approved for deploy, and it is tagged in the same push. So master is always
exactly at a tag, which is what keeps the root stamped with a version and its links
pinned; a root that is merely *near* a tag would call itself `dev` and stop pinning.

Promoting a preview is then the ordinary release: merge, tag, push, then delete the
branch.

```
git switch master && git merge <branch>
git tag -a v13 -m "One line saying what this release added"
git push origin master --atomic --follow-tags
git push origin --delete preview
```

A preview branch that does not build is survivable: the release script skips `/preview/`
and says so, and the site and the archive go out regardless.

## How a build knows its own version

`tools/build.mjs` stamps `QUEDIT_VERSION` into the `quedit-version` meta tag, defaulting
to `dev`; `tools/release.mjs` sets it from `git describe --tags --exact-match`, or to
`preview` for the preview branch. `ui.js` reads the tag at run time and decides where a
copied link should point — `archiveUrl` and `liveUrl` in `src/links.js`, both pure
functions of the current URL and the version, and both tested in `tests/links.test.js`.

A build outside the release workflow, or a page opened from `file://`, has no archive to
point at, so it copies links to itself exactly as it always did.

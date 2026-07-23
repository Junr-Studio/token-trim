# Contributing to token-trim

Thanks for your interest in improving **token-trim**! This guide covers local
setup, how the tests are organized, and the conventions we expect in a PR.

token-trim is a zero-dependency, pure-ESM library (Node >= 24) that generates
PATH-wrapper scripts to condense the stdout of the shell commands an AI agent
runs. The generated scripts differ per operating system, so changes must keep
working on Linux, macOS, **and Windows**.

## Prerequisites

- **Node.js >= 24** with `node` on your PATH.
- **npm** (the repo is pinned with a `package-lock.json`).

## Setup

Install exactly the locked dependencies:

```sh
npm ci
```

## Everyday commands

| Task | Command |
| --- | --- |
| Run the full test suite | `npm test` |
| Watch tests while developing | `npm run test:watch` |
| Type-check the library source | `npm run typecheck` |
| Type-check source **and** tests | `npx tsc -p tsconfig.test.json --noEmit` |
| Build `dist/` (what gets published) | `npm run build` |

`tsconfig.json` covers `src/`; `tsconfig.test.json` extends it to include
`test/` as well. Please make sure both type-check cleanly before opening a PR.

## The one rule: a condenser may delete, it may not invent

Everything in this repository follows from a single property. The output of a
condenser is read by a machine that will act on it, and that machine cannot tell
a summary from a fabrication. So:

> **A condenser may DELETE information. It may never INVENT it.**

This is not a style preference. Both times it has been violated the result
shipped, silently, and was wrong in the worst possible direction: `git diff
--stat` answered `diff: 0 file(s)  +0 -0` for a real diff, and `rg -l` answered
`0 matches in 0 file(s)` for a hundred hits. An agent reads "nothing changed"
and stops.

Three consequences, each enforced by a test that runs against **every case in
the suite** (see [`test/support/invariants.ts`](test/support/invariants.ts),
wired into `describeCompression`):

1. **No fabricated words.** Every word in the output either appeared in the
   input or is listed in `CONDENSER_VOCABULARY`. That list is deliberately small
   and deliberately boring - a label, a unit, a marker. If your change needs a
   new word in it, that is the moment to ask whether you are summarising or
   inventing.
2. **No fabricated zero.** An output whose every count is zero, for an input
   that was not empty, is rejected. Relaying a zero the command itself printed
   is fine; deriving one from input you failed to parse is not.
3. **Data lists stay data.** When the input is one datum per line - a path list,
   an id list, raw `jq -r` values - every output line must be a line the command
   really printed. No header, no indent, no grouping, no in-band marker.
   `git ls-files | xargs prettier --write` is the reason those commands are run,
   and a `... 37 paths elided ...` line inside the stream is 6 filenames that do
   not exist.

**When you cannot recognise the input, return it unchanged.** Passthrough is the
contract, not a fallback. Every condenser in `src/handlers/` does this, and a new
one that emits a confident summary for a shape it did not parse will be rejected
in review even if its tests are green.

### Disclosing a truncation

A summary can say `... +12 more` inline: it is prose either way. A **data list**
cannot. Use `ttCapDataList(lines, head, tail, noun)` or `ttNotice(message)` from
[`src/handlers/args.ts`](src/handlers/args.ts): the frame drains notices to
**stderr** after `compress()`, so stdout stays exactly what the command printed,
minus what was elided.

The frame's last-resort size cap does this for you: it calls `ttIsDataList()`
and, for a list, elides out of band instead of splicing its marker in. You still
have to reach for `ttCapDataList` in your own condenser - the backstop only
fires past ~8 KB.

### Two things the frame guarantees, so you do not have to

Both live in `compress()` in [`src/frame.ts`](src/frame.ts). Know they are there,
because working around them by hand is how they get broken.

- **Your condenser cannot grow its input.** If what you return is longer than
  what you were given, the original is handed back and any notice you queued is
  dropped with it. This is not hypothetical: it is what a rollup line does on a
  run with nothing to report, and every condenser that emits a header is one
  clean run away from it.
- **Leading indentation is not trimmed.** Use `ttTrimBlankEdges()` rather than
  `.trim()` anywhere you clean up a join. `.trim()` cannot tell a leading blank
  line from the first line's indentation, and in a column format that first
  column is the payload - ` M file` and `M  file` are opposite `git status`
  answers.

## Every proxied command is measured

Adding a command to `PROXIED_COMMANDS` installs a PATH wrapper that costs the
agent ~40 ms of node startup on *every* invocation. That trade has to be worth
taking, so it is checked:
[`test/coverage-matrix.test.ts`](test/coverage-matrix.test.ts) requires one
realistic invocation per command with the reduction it actually achieves, and
fails if a command is wrapped with no entry.

A command that cannot reduce does not get a lower threshold - it gets a
`passthroughReason` saying the wrapper exists to protect the output (a machine
format, a pipe hazard, a stream) rather than to shrink it. Either way the claim
is explicit and tested. Set `minReduction` from a value you **measured**, with a
few points of headroom.

## Test philosophy

The suite is **characterization-first**: because a condenser's job is to rewrite
real command output, most tests pin the exact, byte-for-byte result so that any
change to the output is deliberate and reviewable.

Command condensers are exercised through the shared harness in
[`test/support/harness.ts`](test/support/harness.ts). The harness slices the
`compress()` dispatcher out of the same `PROXY_FRAME` string that ships and
links it against the real handler sources, so tests exercise the shipped logic
1:1 - deterministically and cross-platform, with no subprocess spawning.

Each condenser has a table-driven case file at
`test/handlers/<name>.cases.test.ts`. A case is pure data - a realistic raw
command output plus optional behavioral assertions - passed to
`describeCompression(handler, cases)`. For every case the harness:

1. runs the real `compress()`,
2. asserts the output is no larger than the input (unless `allowGrowth` is set),
3. runs any case-specific `assert(out, input)` expectations, then
4. locks the exact output with a snapshot.

See [`test/handlers/git.cases.test.ts`](test/handlers/git.cases.test.ts) for a
reference example.

### Adding or changing a condenser

- **New command condenser** → add a `test/handlers/<name>.cases.test.ts` file
  with realistic cases, register the handler in **all three** registries
  (`PROXIED_COMMANDS` and `PROXY_SCRIPT_SOURCE` in `src/write-proxy.ts`, and
  `ALL_HANDLER_SOURCES` in `test/support/harness.ts`), add a matrix entry, and
  cover the common subcommands you care about.
- **Handler sources are template-literal strings of plain ES2022 JS**, so two
  authoring rules bite:
  - **only function declarations at top level.** Handlers are concatenated
    *after* the frame, and the frame calls into them from top-level code, so a
    top-level `const` is still in its temporal dead zone and throws
    `ReferenceError` in the generated proxy - invisible to the `compress()`
    harness, which evaluates everything before calling anything. Put lookup
    tables behind a function. [`test/handler-contract.test.ts`](test/handler-contract.test.ts)
    enforces this.
  - **escape every backtick.** An unescaped one in a comment terminates the
    literal and turns the rest of the handler into TypeScript.
- **Changing existing output** → update the affected snapshots intentionally
  (`npx vitest -u`) and make sure the diff is one you can explain in the PR.
  Never update snapshots blindly to make a red test pass.

## Coding conventions

- **ESM only.** The package is `"type": "module"`; use `import`/`export`, not
  `require`.
- **Explicit `.js` import specifiers.** We compile with `NodeNext` module
  resolution, so relative imports must end in `.js` even though the source is
  `.ts` (e.g. `import { GIT_HANDLER } from '../../src/handlers/git.js'`).
- **Strict TypeScript.** `strict` is on, together with
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`.
  Keep the source free of `any` and unchecked index access.
- **Zero runtime dependencies.** The library must rely only on Node built-ins.
  Do not add runtime `dependencies` to `package.json`.
- **Cross-platform.** Anything that touches the generated scripts, paths, or the
  environment must behave correctly on Windows as well as POSIX shells.
- **Match `.editorconfig`** - 2-space indent, LF line endings, UTF-8, a final
  newline, and no trailing whitespace.

## Pull request expectations

Before you open a PR, please make sure:

- [ ] `npm test` passes.
- [ ] `npm run typecheck` **and** `npx tsc -p tsconfig.test.json --noEmit` pass.
- [ ] New or changed behavior is covered by cases/snapshots, and any snapshot
      updates are intentional.
- [ ] Changes work cross-platform (CI runs on Windows too).
- [ ] The PR description explains the *why*, and any output changes are called
      out explicitly.

Keep PRs focused and reasonably small - one logical change per PR is much easier
to review than a mixed bag. Thank you for contributing!

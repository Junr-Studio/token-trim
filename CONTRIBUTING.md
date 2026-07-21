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
  with realistic cases, register the handler in the harness's handler list, and
  cover the common subcommands you care about.
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

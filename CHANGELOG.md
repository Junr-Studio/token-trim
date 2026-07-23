# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-23

### Fixed

- **Several condensers returned a confident summary for output they had not
  parsed.** `git diff --stat`, `--name-only`, `--name-status`, `--numstat` and
  `git show --stat` all collapsed to the literal string `diff: 0 file(s) +0 -0`;
  `rg -l`, `rg --files` and `grep -rl` returned `0 matches in 0 file(s)` for any
  result of ten paths or more. In both cases an agent reads "nothing found" and
  acts on it.
- **Redirected stdout was compressed.** `cat src/frame.ts > copy.ts` wrote 24% of
  the file. The proxy now detects a regular file on fd 1 and passes the bytes
  through untouched, skipping arg rewriting as well.
- **A follow invocation made the agent blind.** `tail -f`, `kubectl logs -f`,
  `journalctl -f` and watch-mode runners were captured with `spawnSync`, so no
  output appeared until the process exited - which for a follow is never. They
  exec straight through now.
- **A capture failure was reported as success.** A `maxBuffer` overflow left
  `result.status` null and the proxy exited 0 with truncated output - a failed
  build read as a passing one.
- **The last-resort size cap could delete an entire payload.** A document on one
  long line (compacted JSON, a minified bundle) fitted in neither the head nor
  the tail budget, so a 22 KB API response came back as 73 characters of elision
  marker. Valid JSON is now left whole, and anything else falls back to a
  character-level cut that keeps both ends.
- `condenseLs` reported directories that did not exist (any name starting with
  `d` in a non-long listing) and under-counted the ones that did; `condenseEslint`
  reported `in 0 file(s)` on every Windows run; `condenseNext`, `condenseDf` and
  the BuildKit path of `docker build` never fired at all; `condensePrettier`
  counted its own summary line as an offending file; `condensePlaywright`
  reported a flaky test as failed.
- **`cat data.json | jq` produced a parse error.** Reading a JSON file through
  `cat`/`head`/`tail` returned a prose header (`[12 items  schema: {…}]`) over a
  five-item preview - not JSON, and the items past the preview were gone. It is
  re-serialised compactly now: lossless, still parses, and the indentation it
  drops was most of the file.
- Machine-readable output is no longer reshaped: `--json`, `-o json|yaml`,
  `--porcelain`, `gh`'s tab-separated lists, `docker ps -q`, and the artifact
  commands whose stdout *is* the deliverable (`helm template`, `kustomize build`).
- No condenser can return more characters than it received. `npm ls` and
  `gh pr checks` both could, by buying a summary line with extra output.
- **Reading a file no longer shifts its line numbers.** `cat`/`head`/`tail`
  deleted comment and body lines, so `cat app.py | wc -l` reported a count that
  was not the file's, `sed -n '42p'` printed the wrong line, and an agent that
  read the output and then edited "line 87" edited the wrong one. A removed line
  is blanked in place now. Measured cost across the whole matrix corpus: 0.05%.
- **`--full` was not full.** The bypass path applied `.trim()` to the captured
  stream, so the one route documented to be exact was the least faithful one in
  the proxy: `cat three.txt --full | wc -l` answered 2 for a three-line file, and
  a file with leading blank lines came back with its functions at different line
  numbers than the compressed read had just shown - which is what every "re-run
  with `--full`" hint sends the agent to do. `--full` now returns the raw bytes
  as the command wrote them, with arg rewriting and injected row caps skipped
  alongside.
- **The trailing newline is data, and it was being dropped.** Condensers trim as
  they build, so the final newline disappeared for every command: `find … |
  wc -l` reported 26 for 27 files, and `cmd | while read x` silently discarded
  the last record. It is restored if and only if the command printed one - never
  invented for one that did not.
- **A file over the size backstop is now cut from the END, not the middle.**
  Reading a >8 KB file whose language has no comment grammar (`.md`, `.sql`,
  `.java`, `.c`, `.txt`, …) fell through to the generic head+tail backstop, which
  dropped lines out of the middle and spliced an English elision marker into the
  file's own text - so `cat big.py | wc -l` returned 81 for a 400-line file,
  `sed -n '300p'` returned nothing, and every line after the cut was renumbered:
  exactly the shift the blank-in-place strip exists to prevent. File reads now
  stop on a whole-line boundary and keep the prefix, so every line shown still
  carries its own number, and what was dropped is disclosed on stderr instead of
  inside the stream.

- **`git status --short` inverted what it reported.** Compression ended in
  `.trim()`, which cannot tell a leading blank line from the first line's
  indentation - and in a column format that first column is the payload. git
  prints ` M src/a.ts` for a file modified in the worktree and `M  src/a.ts` for
  one already staged, so eating one space told the agent the opposite fact.
  `git branch` lost its marker column (making the first branch look like the
  current one), `ps`, `psql` and `df` lost the alignment between their header
  and their rows. Blank lines are still dropped from both ends; the indentation
  of the first line that has content is not.
- **A capped path list stopped being a path list past 8 KB.** Every condenser
  that caps a list already discloses it on stderr, but the last-resort size cap
  underneath them still spliced `... 64 lines elided ...` into the stream - so
  `rg -l pat | xargs sed`, `git ls-files | xargs prettier` and
  `terraform state list | xargs -n1 terraform state show` were handed eight
  words that name no file. It only happened to LARGE lists, which is to say the
  ones that actually reach the cap.
- **`kubectl get pods -o wide` was treated as a machine format**, so it skipped
  the condenser and the size cap alike: a 2000-pod listing arrived whole, 246 KB
  of it. Nothing parses `-o wide` - it is the human table with IP and NODE added.
  It is capped like any other large output now, and the pod rollup steps aside
  for it so the columns it was asked for survive.
- **`"""` is not a comment.** Python has no block comment, and treating the
  delimiter as one could not work when the opener and the closer are the same
  token: the line that opened a run also closed it. `SQL = """ … """` came back
  without its closing delimiter - unterminated, unparseable - and a module
  docstring came back with both delimiters blanked and its prose emitted at
  statement position. Only the module docstring is stripped now, only its
  interior, with both delimiters left in place.
- **No condenser can grow its input, structurally.** This was policed per
  condenser, which each new one had to re-earn, and the suite only caught the
  cases it happened to contain - none of which was a run with nothing to report.
  That is exactly where growth lives: `ruff format --check` on an already-clean
  tree turned 26 characters into 47. The proxy can no longer cost an agent more
  context than running the command without it.
- The coverage matrix rounded its measurements, so a floor was not a floor:
  `git diff --stat` declared 45% and removed 44.601%, and passed. One entry of
  70 was sitting below its own threshold; the comment beside it claimed 56%.
- **`docker pull` had never been compressed.** The layer-noise filter was
  anchored at the start of the line, and docker puts the layer ID there first -
  `17a39c0ba978: Pull complete`, not `Pull complete`. So the filter matched
  nothing docker prints, and the fixture that kept the case green had been
  written to the regex rather than to the tool. Checked against docker 29.4.1:
  a real `docker pull` now goes from 346 to 190 characters, where it went from
  346 to 346.
- **`docker compose -f docker-compose.prod.yml build` compressed by 0%.** The
  subcommand resolver knows docker's own value-taking flags, not compose's, so
  the flag was skipped without its value and `docker-compose.prod.yml` came back
  as the verb. Every flagged spelling missed the build condenser -
  `--progress plain` included, which is the flag that produces the transcript
  being condensed.
- **`cargo test` piped through `tail` reported `0 passed, 0 failed`** above the
  FAIL block it had just printed. A `test result:` line inside a captured-stdout
  block belongs to a child run and is skipped - but a stream cut mid-block never
  closes, so the binary's own line was inside it and the only tally in the text
  was dropped.
- `git status -z` and its spellings (`-sz`, `--null`, and the prefixes git's own
  parser accepts) are recognised as the NUL stream they are: no `--branch`
  injection, no reshaping, no elision marker spliced between two NULs.

### Added

- **Enforced invariants.** Every case in the suite is now checked for fabricated
  words, fabricated zero counts, and foreign lines injected into a data list.
  Everything a condenser may say that the command did not is declared in one
  reviewed list. See `test/support/invariants.ts` and CONTRIBUTING.
- **A coverage matrix.** Each of the 50 proxied commands carries a realistic
  invocation and the reduction it actually achieves, or an explicit
  `passthroughReason`. Measured across that corpus: ~58%.
- Out-of-band truncation notices, so a capped path/id list stays valid `xargs`
  input and the elision is disclosed on stderr instead of inside the stream.
- Disclosure when an injected limit (`git log -20`) actually truncated.
- New commands: `helm`, `tree`, `ps`, `du`, `df`, `systemctl`, `journalctl`.
  New subcommand coverage across `git`, `gh`, `docker`, `kubectl`, `npm`,
  `terraform`, `cargo` and the JS test runners.

### Changed

- **README's "Line numbers stay true" guarantee now states its two real limits.**
  It was written unqualified, and two things the code does contradicted it: a
  file past the size backstop is truncated (at the tail, disclosed on stderr), and
  `.json`/`.yaml`/`.toml`/`.csv`/`.xml` read through `cat`/`head`/`tail` are
  condensed *structurally* - compacted, previewed, or given a top-keys header - so
  their line positions move. A guarantee in the section that tells an integrator
  what may be relied on has to be true of the shipped code; both carve-outs are
  now written out beside it.
- The **data lists stay data** invariant recognises the shapes it used to read as
  prose: bracketed and quoted resource addresses (`module.vpc.aws_subnet.private[0]`,
  `aws_route53_record.this["api-1.acme.example"]` - i.e. all of `terraform state
  list`), paths containing a space, and `key=value` lines. Its character class
  excluded `[`, `]`, `"`, `=` and the space, so the stream the library names as
  the archetype of a must-stay-pipeable list was the one stream the invariant
  never ran on.

## [0.1.4] - 2026-07-21

### Changed

- `publint` and `@arethetypeswrong/cli` are now dev dependencies (hash-pinned via
  the lockfile) invoked through npm scripts, instead of unpinned `npx` calls, so
  the OpenSSF Scorecard Pinned-Dependencies check no longer flags them.

## [0.1.3] - 2026-07-21

### Changed

- Hardened the CI/CD supply-chain posture (OpenSSF Scorecard): every workflow now
  declares a minimal top-level `permissions: contents: read` and escalates only
  where needed (Token-Permissions), and all GitHub Actions are pinned by commit
  SHA (Pinned-Dependencies), kept current by Dependabot.
- README license badge is now a static Apache-2.0 badge instead of the npm badge,
  which failed to resolve the scoped package name.

## [0.1.2] - 2026-07-21

### Fixed

- Scorecard workflow now pins `ossf/scorecard-action@v2.4.3` (the action has no
  moving `v2` major tag, so `@v2` failed to resolve). Added a `workflow_dispatch`
  trigger so the analysis can be run on demand.

## [0.1.1] - 2026-07-21

### Changed

- Raised the minimum supported Node.js to **24**. Node 18 and 20 are end-of-life,
  and the test tooling (vitest 4) requires Node 20+.

### Fixed

- CI test matrix now runs on Node 24 only, fixing failures caused by vitest 4
  importing a `node:util` export unavailable on Node 18.
- The Scorecard workflow no longer runs on `push` (schedule and branch-protection
  triggers only), removing spurious first-run failures.
- Dependabot now targets the `dev` branch so dependency updates flow through the
  dev -> canary -> main pipeline instead of landing directly on `main`.

## [0.1.0] - 2026-07-20

Initial public release of **token-trim** - a zero-dependency, pure-ESM library
that generates PATH-wrapper scripts to compress the stdout of the shell commands
an AI agent runs, cutting the tokens they cost in its context window.

### Added

- Command-output compressor exposed via `createCommandProxy` and
  `writeProxyScripts`, which generate per-command PATH-wrapper scripts that
  intercept a command's stdout and emit a condensed version.
- Cross-platform script generation: the emitted wrappers differ per-OS, with
  support for Windows in addition to POSIX shells.
- `PROXIED_COMMANDS` covering ~60 commands, backed by ~30 command-aware
  condensers that understand and summarize specific command outputs.
- `--full` escape hatch to bypass compression and pass through a command's
  original, unmodified output on demand.
- Optional stats reporting via the `SavingsFrame` protocol: `parseSavingsFrame`
  and `createStatsReceiver` for collecting per-invocation savings data.
- Optional savings accounting helpers: `bytesToTokens`, `formatTokens`, and
  `createSavingsAccumulator` for estimating and totaling tokens saved.
- Zero runtime dependencies, ESM-only distribution, Node.js >= 18.

[Unreleased]: https://github.com/Junr-Studio/token-trim/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Junr-Studio/token-trim/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/Junr-Studio/token-trim/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Junr-Studio/token-trim/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Junr-Studio/token-trim/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Junr-Studio/token-trim/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Junr-Studio/token-trim/releases/tag/v0.1.0

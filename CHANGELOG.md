# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Junr-Studio/token-trim/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Junr-Studio/token-trim/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Junr-Studio/token-trim/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Junr-Studio/token-trim/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Junr-Studio/token-trim/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Junr-Studio/token-trim/releases/tag/v0.1.0

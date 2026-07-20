# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Junr-Studio/token-trim/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Junr-Studio/token-trim/releases/tag/v0.1.0

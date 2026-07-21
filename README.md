# token-trim

[![npm version](https://img.shields.io/npm/v/@junr_studio/token-trim.svg)](https://www.npmjs.com/package/@junr_studio/token-trim)
[![CI](https://github.com/Junr-Studio/token-trim/actions/workflows/ci.yml/badge.svg)](https://github.com/Junr-Studio/token-trim/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Junr-Studio/token-trim/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Junr-Studio/token-trim)
[![node](https://img.shields.io/node/v/@junr_studio/token-trim.svg)](https://www.npmjs.com/package/@junr_studio/token-trim)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/Junr-Studio/token-trim/blob/main/package.json)
[![license](https://img.shields.io/npm/l/@junr_studio/token-trim.svg)](./LICENSE)

**Compress the output of shell commands your AI agent runs, to cut the tokens they cost in its context window.**

When an autonomous coding agent runs `git log`, `npm install`, `tsc`, `docker ps`, `grep -r`, `kubectl get pods`… the raw output is verbose and mostly noise - yet every line costs tokens in the model's context window. `token-trim` installs transparent PATH‑wrappers around ~60 common commands so their output is condensed - *command‑aware*, not blindly truncated - **before the agent ever sees it**, with a `--full` escape hatch to get the raw output back.

```
$ git log                                    $ git log
commit a1b2c3d4e5f6...                        a1b2c3d fix: handle null config (2h ago) <you>
Author: You <you@example.com>       ─►        e4f5g6h feat: configurable port (5h ago) <you>
Date:   Mon Jul 14 ...                        9c8b7a6 chore: bump deps (1d ago) <you>
                                              … 17 more
    fix: handle null config                   55 684 bytes  ─►  1 599 bytes   (‑97%)
... (55 KB more)
```

- **Zero runtime dependencies** - only Node built‑ins.
- **Command‑aware** - ~30 specialized condensers (git, tsc, grep, docker, kubectl, pytest, cargo, jq, aws, psql, eslint, terraform…), not a blind text truncator.
- **Non‑invasive** - the library only generates scripts + an env; *you* stay in control of how you spawn your process.
- **Lossless on demand** - append `--full` to any command to get the untouched output.
- **Measured** - optional byte‑savings reporting and token accounting you can surface however you like.
- **Cross‑platform** - Linux, macOS, and Windows (Git Bash / MSYS2).

## Install

```sh
pnpm add @junr_studio/token-trim           # stable (latest)
pnpm add @junr_studio/token-trim@canary    # early-access pre-releases
```

Requires **Node ≥ 24**. The environment where the agent runs commands needs `node` on its `PATH` (the wrappers are `node proxy.mjs …`) and a POSIX `sh` (present everywhere; on Windows it ships with Git).

## Quick start

```ts
import { createCommandProxy } from '@junr_studio/token-trim'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// 1. Write the wrappers + (optionally) start collecting savings.
const proxy = await createCommandProxy({
  dir: path.join(os.tmpdir(), 'my-app/token-trim'),
  onSavings: (f) => console.log(`${f.cmd}: -${f.savedBytes} bytes`), // optional
})

// 2. Inject the proxy env when you spawn your agent / subprocess.
const child = spawn('claude', ['--dangerously-skip-permissions'], {
  env: proxy.env(process.env), // prepends PATH, sets BASH_ENV + the env contract
  stdio: 'inherit',
})

// 3. Clean up when done.
child.on('exit', () => proxy.close())
```

That's it - every proxied command the child runs now returns condensed output. No agent, just wrapping a shell you drive? `spawn('bash', ['-c', 'kubectl get pods && docker ps'], { env: proxy.env(process.env) })` works the same way.

## How it works

`createCommandProxy` / `writeProxyScripts` write three things into your `dir`:

- **`proxy.mjs`** - a self‑contained Node script: it runs the real command, condenses its **stdout** (stderr passes through untouched), prints the result, propagates the exit code, and best‑effort reports `{ cmd, savedBytes, originalBytes }` to the stats socket.
- **`bin/<cmd>` wrappers** - one per proxied command (`.cmd` + POSIX `sh` on Windows), each just `node proxy.mjs <cmd> "$@"`.
- **`setup.sh`** - prepends `bin/` to `PATH`; wired via `BASH_ENV` so it wins even in non‑interactive shells.

`proxy.env(base)` returns a copy of `base` with `PATH` prepended, `BASH_ENV` set, and the two env vars the proxy reads. Commands not in the list are never touched.

## Getting the full output - the `--full` escape hatch

When a command is compressed by more than `hintMinSavedBytes` (default 500), the proxy prints a one‑line **directive** to **stderr** (never stdout):

```
[token-trim] instruction (not output): compressed to save tokens; re-run with --full for the full output, do not switch commands.
```

This is deliberately phrased as an *instruction to the assistant* rather than a passive log line, because agents otherwise tend to treat it as part of the command output and ignore it - or work around it by reaching for a different command. To read the untouched output, the agent re‑runs the same command with `--full` appended:

```sh
git log --full
```

The notice is short by design (it lives in the model's context too); raise `hintMinSavedBytes` if you only want it on large savings, or rename the flag/label to fit your product (see options below).

## API

### `createCommandProxy(options): Promise<CommandProxy>`

One‑call setup. `options` extends [`ProxyWriterOptions`](#proxywriteroptions) plus:

| option | default | meaning |
| --- | --- | --- |
| `dir` | *(required)* | where to write `proxy.mjs`, `bin/`, `setup.sh` |
| `onSavings?` | - | callback per savings frame; providing it starts a stats socket |
| `socketPath?` | temp path | explicit stats socket / named pipe |

Returns `CommandProxy`:

| member | type | meaning |
| --- | --- | --- |
| `binDir` | `string` | wrapper dir (prepended to PATH by `env`) |
| `setupScript` | `string` | `setup.sh` path (wired into `BASH_ENV` by `env`) |
| `socketPath` | `string \| null` | stats socket, or `null` if `onSavings` was omitted |
| `env(base?)` | `(env?) => env` | merge the proxy contract into a base env for `spawn` |
| `close()` | `() => Promise<void>` | stop the stats receiver (wrapper files are left on disk) |

### `writeProxyScripts(dir, options?): Promise<ProxyScriptPaths>`

Low‑level generator, if you wire the env into your process yourself. Returns `{ binDir, setupScript, proxyPath, binDirEnvVar, statsSocketEnvVar }`.

#### ProxyWriterOptions

| option | default | meaning |
| --- | --- | --- |
| `commands?` | `PROXIED_COMMANDS` | which commands to wrap |
| `binDirEnvVar?` | `TOKEN_TRIM_BIN_DIR` | env var the proxy reads for its bin dir (anti‑recursion) |
| `statsSocketEnvVar?` | `TOKEN_TRIM_STATS_SOCKET` | env var the proxy reads for the stats socket |
| `fullFlag?` | `--full` | flag that bypasses compression |
| `hintLabel?` | `token-trim` | label in the stderr hint |
| `hintMinSavedBytes?` | `500` | min bytes saved before the hint is emitted |

### `PROXIED_COMMANDS: string[]`

The default ~60‑command allow‑list, grouped by category: file readers (`cat`, `head`, `tail`), VCS (`git`, `gh`), type‑checkers/linters/formatters (`tsc`, `eslint`, `prettier`, `mypy`, `ruff`, `golangci-lint`, `rubocop`), package managers (`npm`, `pnpm`, `yarn`, `pip`, `bun`), search (`grep`, `rg`), filesystem (`ls`, `find`), data (`jq`), build/test (`cargo`, `pytest`, `go`, `rspec`, `rake`, `vitest`, `jest`, `playwright`, `make`, `mvn`, `gradle`, `dotnet`, `terraform`, `tofu`), infra/cloud (`docker`, `kubectl`, `curl`, `wget`, `aws`, `psql`), and framework CLIs (`next`).

### `@junr_studio/token-trim/stats`

The savings wire contract and DB‑free accounting - import from the `@junr_studio/token-trim/stats` subpath:

```ts
import {
  parseSavingsFrame,      // (line: string) => SavingsFrame | null
  createStatsReceiver,    // ({ socketPath?, onFrame }) => Promise<StatsReceiver>
  defaultStatsSocketPath, // () => string
  bytesToTokens,          // (bytes: number) => number   (~4 bytes/token)
  formatTokens,           // (tokens: number) => string  ("1.2k", "3.4M")
  createSavingsAccumulator, // () => SavingsAccumulator (totals + per-command)
} from '@junr_studio/token-trim/stats'
```

`SavingsFrame` is `{ cmd: string; savedBytes: number; originalBytes: number }`. Build your own collector with `createStatsReceiver`, or roll running totals with `createSavingsAccumulator()` (`.add(frame)`, `.totals()`, `.byCommand()`, `.reset()`).

## Custom env contract

Defaults are host‑agnostic, but every name is configurable so the proxy fits into an existing runtime without collisions:

```ts
await writeProxyScripts(dir, {
  binDirEnvVar: 'MYAPP_BIN',
  statsSocketEnvVar: 'MYAPP_SOCK',
  fullFlag: '--raw',
  hintLabel: 'myapp',
  hintMinSavedBytes: 2000,
})
```

## Versioning

Semantic versioning. **While `0.x`, minor releases may contain breaking changes** - pin a version if that matters to you. The `SavingsFrame` shape and `PROXIED_COMMANDS` are treated as public surface. Two release channels: `latest` (stable) and `canary` (early-access pre-releases). See the [CHANGELOG](./CHANGELOG.md) and the [release process](./PUBLISHING.md).

## Contributing

Issues and PRs welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE) © Junr Studio. If you redistribute token-trim or a derivative, you must retain the attribution in [NOTICE](./NOTICE) (License §4(d)).

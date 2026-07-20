import fs from 'node:fs/promises'
import path from 'node:path'
import { PROXY_FRAME }         from './frame.js'
import { GIT_HANDLER }         from './handlers/git.js'
import { TSC_HANDLER }         from './handlers/tsc.js'
import { PKGMGR_HANDLER }      from './handlers/pkgmgr.js'
import { GREP_HANDLER }        from './handlers/grep.js'
import { CARGO_HANDLER }       from './handlers/cargo.js'
import { PYTHON_HANDLER }      from './handlers/python.js'
import { DOCKER_HANDLER }      from './handlers/docker.js'
import { HTTP_HANDLER }        from './handlers/http.js'
import { GH_HANDLER }          from './handlers/gh.js'
import { MAKE_HANDLER }        from './handlers/make.js'
import { SOURCE_HANDLER }      from './handlers/source.js'
import { SYSTEM_HANDLER }      from './handlers/system.js'
import { RUBY_HANDLER }        from './handlers/ruby.js'
import { JS_TOOLS_HANDLER }    from './handlers/js-tools.js'
import { CLOUD_EXTRA_HANDLER } from './handlers/cloud-extra.js'
import { GOLANGCI_HANDLER }    from './handlers/golangci.js'
import { JQ_HANDLER }          from './handlers/jq.js'
import { BUILD_TOOLS_HANDLER } from './handlers/build-tools.js'

// ─── Proxied commands ─────────────────────────────────────────────────────────
// Adding a command here installs a wrapper script in the agent's PATH at spawn.

export const PROXIED_COMMANDS = [
  // file readers
  'cat', 'head', 'tail',
  // version control
  'git', 'gh',
  // type-checkers / linters / formatters
  'tsc', 'eslint', 'prettier',
  'mypy', 'ruff',
  'golangci-lint', 'rubocop',
  // package managers
  'npm', 'pnpm', 'yarn', 'pip', 'bun',
  // search
  'grep', 'rg',
  // filesystem
  'ls', 'find',
  // data processing
  'jq',
  // build / test
  'cargo',
  'pytest', 'go',
  'rspec', 'rake',
  'vitest', 'jest', 'playwright',
  'make',
  'mvn', 'gradle', 'dotnet',
  'terraform', 'tofu',
  // infra / cloud
  'docker', 'kubectl',
  'curl', 'wget',
  'aws', 'psql',
  // framework CLIs
  'next',
]

// ─── Assemble proxy.mjs ───────────────────────────────────────────────────────

const PROXY_SCRIPT_SOURCE = [
  PROXY_FRAME,
  GIT_HANDLER,
  TSC_HANDLER,
  PKGMGR_HANDLER,
  GREP_HANDLER,
  CARGO_HANDLER,
  PYTHON_HANDLER,
  DOCKER_HANDLER,
  HTTP_HANDLER,
  GH_HANDLER,
  MAKE_HANDLER,
  SOURCE_HANDLER,
  SYSTEM_HANDLER,
  RUBY_HANDLER,
  JS_TOOLS_HANDLER,
  CLOUD_EXTRA_HANDLER,
  GOLANGCI_HANDLER,
  JQ_HANDLER,
  BUILD_TOOLS_HANDLER,
].join('\n')

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ProxyWriterOptions {
  /**
   * Commands to install PATH-wrappers for. Defaults to {@link PROXIED_COMMANDS}.
   * Every listed command runs through the proxy; unlisted commands are untouched.
   */
  commands?: string[]
  /**
   * Name of the env var the generated proxy reads to locate its own bin dir
   * (so it can strip it from PATH and avoid proxy→proxy recursion).
   * The caller must set this env var to `binDir` when spawning the child.
   * Default: `TOKEN_TRIM_BIN_DIR`.
   */
  binDirEnvVar?: string
  /**
   * Name of the env var the generated proxy reads to find the stats socket it
   * reports byte-savings to. Leave the env var unset to disable reporting.
   * Default: `TOKEN_TRIM_STATS_SOCKET`.
   */
  statsSocketEnvVar?: string
  /**
   * Flag that, when passed to a proxied command, bypasses compression and
   * returns raw output. Default: `--full`.
   */
  fullFlag?: string
  /**
   * Label shown in the `[<label>] instruction (not output): …` stderr hint.
   * Default: `token-trim`.
   */
  hintLabel?: string
  /**
   * Minimum bytes saved before the "re-run with --full" hint is emitted on
   * stderr. Keep it comfortably above the hint's own size so the notice never
   * eats a meaningful share of the saving. Default: `500`.
   */
  hintMinSavedBytes?: number
}

// ─── Writer ───────────────────────────────────────────────────────────────────

export interface ProxyScriptPaths {
  /** Directory containing the per-command wrapper scripts; prepend to PATH. */
  binDir: string
  /** setup.sh path; wire into BASH_ENV so non-interactive bash re-prepends binDir. */
  setupScript: string
  /** Absolute path of the generated proxy.mjs. */
  proxyPath: string
  /** Resolved env-var name the proxy reads for its bin dir (set it to `binDir`). */
  binDirEnvVar: string
  /** Resolved env-var name the proxy reads for the stats socket path. */
  statsSocketEnvVar: string
}

const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Convert a Windows path like C:\foo\bar to /c/foo/bar for POSIX shells. */
function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)
}

/**
 * Generate `proxy.mjs`, per-command PATH wrapper scripts and `setup.sh` into
 * `compressDir`. Returns the paths and resolved env-var names needed to wire the
 * proxy into a child process (see {@link createCommandProxy} for the easy path).
 *
 * Degrades gracefully: callers should wrap this in a try/catch so that a failure
 * simply disables compression rather than crashing startup.
 */
export async function writeProxyScripts(
  compressDir: string,
  options: ProxyWriterOptions = {},
): Promise<ProxyScriptPaths> {
  const commands = options.commands ?? PROXIED_COMMANDS
  const binDirEnvVar = options.binDirEnvVar ?? 'TOKEN_TRIM_BIN_DIR'
  const statsSocketEnvVar = options.statsSocketEnvVar ?? 'TOKEN_TRIM_STATS_SOCKET'
  const fullFlag = options.fullFlag ?? '--full'
  const hintLabel = options.hintLabel ?? 'token-trim'
  const hintMinSavedBytes = options.hintMinSavedBytes ?? 500

  if (!ENV_VAR_RE.test(binDirEnvVar)) throw new Error(`Invalid binDirEnvVar: ${binDirEnvVar}`)
  if (!ENV_VAR_RE.test(statsSocketEnvVar)) throw new Error(`Invalid statsSocketEnvVar: ${statsSocketEnvVar}`)
  if (!Number.isInteger(hintMinSavedBytes) || hintMinSavedBytes < 0) {
    throw new Error(`Invalid hintMinSavedBytes: ${hintMinSavedBytes}`)
  }

  const proxySource = PROXY_SCRIPT_SOURCE
    .replaceAll('__TT_BIN_DIR_ENV__', binDirEnvVar)
    .replaceAll('__TT_STATS_SOCKET_ENV__', statsSocketEnvVar)
    .replaceAll('__TT_FULL_FLAG__', fullFlag)
    .replaceAll('__TT_HINT_LABEL__', hintLabel)
    .replaceAll('__TT_HINT_MIN__', String(hintMinSavedBytes))

  await fs.mkdir(compressDir, { recursive: true })
  const binDir = path.join(compressDir, 'bin')
  await fs.mkdir(binDir, { recursive: true })

  const proxyPath = path.join(compressDir, 'proxy.mjs')
  await fs.writeFile(proxyPath, proxySource, 'utf8')

  if (process.platform !== 'win32') {
    await fs.chmod(proxyPath, 0o755)
  }

  // On Windows, forward slashes work in node paths from bash/sh
  const proxyPathForSh = proxyPath.replace(/\\/g, '/')

  for (const cmd of commands) {
    if (process.platform === 'win32') {
      // .cmd wrapper for cmd.exe / PowerShell
      const cmdContent = `@echo off\nnode "${proxyPath}" ${cmd} %*\n`
      await fs.writeFile(path.join(binDir, `${cmd}.cmd`), cmdContent, 'utf8')
      // Extensionless sh wrapper for Git Bash / MSYS2 (bash ignores .cmd files)
      const shContent = `#!/bin/sh\nexec node "${proxyPathForSh}" ${cmd} "$@"\n`
      const shPath = path.join(binDir, cmd)
      await fs.writeFile(shPath, shContent, 'utf8')
      // chmod 0o755 is ignored on Windows NTFS but sets the POSIX exec bit
      // that Git Bash / MSYS2 reads from the file's ACL metadata
      await fs.chmod(shPath, 0o755)
    } else {
      const content = `#!/bin/sh\nexec node "${proxyPath}" ${cmd} "$@"\n`
      const wrapperPath = path.join(binDir, cmd)
      await fs.writeFile(wrapperPath, content, 'utf8')
      await fs.chmod(wrapperPath, 0o755)
    }
  }

  // Write setup.sh - sourced via BASH_ENV for every non-interactive bash invocation.
  // This ensures our proxy bin dir is first in PATH even when bash init scripts run.
  const posixBinDir = process.platform === 'win32' ? toPosixPath(binDir) : binDir
  const setupScript = path.join(compressDir, 'setup.sh')
  await fs.writeFile(
    setupScript,
    `#!/bin/sh\nexport PATH="${posixBinDir}:$PATH"\n`,
    'utf8',
  )
  if (process.platform !== 'win32') {
    await fs.chmod(setupScript, 0o755)
  }

  return { binDir, setupScript, proxyPath, binDirEnvVar, statsSocketEnvVar }
}

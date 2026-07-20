import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeProxyScripts, PROXIED_COMMANDS } from '../src/write-proxy.js'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tt-wp-'))
}

describe('writeProxyScripts - structure', () => {
  let dir: string
  let proxySrc: string

  beforeAll(async () => {
    dir = await tmpDir()
    const paths = await writeProxyScripts(dir)
    proxySrc = await fs.readFile(paths.proxyPath, 'utf8')
  })

  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('writes proxy.mjs and setup.sh', async () => {
    await expect(fs.stat(path.join(dir, 'proxy.mjs'))).resolves.toBeDefined()
    const setup = await fs.readFile(path.join(dir, 'setup.sh'), 'utf8')
    expect(setup).toContain('export PATH=')
  })

  it('writes a wrapper for every proxied command', async () => {
    for (const cmd of PROXIED_COMMANDS) {
      await expect(fs.stat(path.join(dir, 'bin', cmd))).resolves.toBeDefined()
      if (process.platform === 'win32') {
        await expect(fs.stat(path.join(dir, 'bin', `${cmd}.cmd`))).resolves.toBeDefined()
      }
    }
  })

  it('leaves no unresolved __TT_ placeholders in the generated proxy', () => {
    expect(proxySrc).not.toContain('__TT_')
  })

  it('uses the generic defaults', () => {
    expect(proxySrc).toContain('process.env.TOKEN_TRIM_BIN_DIR')
    expect(proxySrc).toContain('process.env.TOKEN_TRIM_STATS_SOCKET')
    expect(proxySrc).toContain("const FULL_FLAG = '--full'")
    expect(proxySrc).toContain('[token-trim] instruction (not output):')
    expect(proxySrc).toContain('savedBytes > 500')
  })

  // The proxy is assembled by concatenating handler source STRINGS that are
  // linked via JS function-declaration hoisting. If a dispatched condenser has
  // no matching `function` declaration, the agent hits a ReferenceError at
  // runtime. This guards that invariant statically.
  it('every dispatched condenser/helper is declared (hoisting + jq→source dep)', () => {
    const declared = new Set(
      [...proxySrc.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)]
        .map((m) => m[1])
        .filter((s): s is string => s !== undefined),
    )
    const helperAllowlist = new Set([
      'aggressiveStrip', 'stripPkgNoise', 'groupGrep', 'rewriteGitArgs',
      'detectLang', 'jsonSchema', 'stripComments',
    ])
    const called = new Set(
      [...proxySrc.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((m) => m[1])
        .filter((s): s is string => s !== undefined),
    )
    const mustBeDeclared = [...called].filter(
      (n) => n.startsWith('condense') || helperAllowlist.has(n),
    )
    const missing = mustBeDeclared.filter((n) => !declared.has(n))
    expect(missing).toEqual([])
    // explicit: jsonSchema lives in the source handler but is called by the jq handler
    expect(declared.has('jsonSchema')).toBe(true)
  })
})

describe('writeProxyScripts - custom options + subsetting', () => {
  let dir: string
  let proxySrc: string

  // Use arbitrary host-agnostic values (NOT any specific consumer's names) so
  // this proves the parameterization works generally, not just for one host.
  beforeAll(async () => {
    dir = await tmpDir()
    const paths = await writeProxyScripts(dir, {
      commands: ['git', 'grep'],
      binDirEnvVar: 'MYHOST_BIN_DIR',
      statsSocketEnvVar: 'MYHOST_STATS_SOCK',
      fullFlag: '--raw',
      hintLabel: 'myhost',
      hintMinSavedBytes: 2000,
    })
    proxySrc = await fs.readFile(paths.proxyPath, 'utf8')
  })

  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  it('substitutes arbitrary custom env-var names, flag and hint label', () => {
    expect(proxySrc).toContain('process.env.MYHOST_BIN_DIR')
    expect(proxySrc).toContain('process.env.MYHOST_STATS_SOCK')
    expect(proxySrc).toContain("const FULL_FLAG = '--raw'")
    expect(proxySrc).toContain('[myhost] instruction (not output):')
    expect(proxySrc).toContain('savedBytes > 2000')
    expect(proxySrc).not.toContain('TOKEN_TRIM_BIN_DIR')
    expect(proxySrc).not.toContain('__TT_')
  })

  it('only writes wrappers for the requested commands', async () => {
    await expect(fs.stat(path.join(dir, 'bin', 'git'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(dir, 'bin', 'grep'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(dir, 'bin', 'docker'))).rejects.toThrow()
  })

  it('rejects invalid env-var names', async () => {
    const d = await tmpDir()
    await expect(writeProxyScripts(d, { binDirEnvVar: 'bad name!' })).rejects.toThrow()
    await fs.rm(d, { recursive: true, force: true })
  })
})

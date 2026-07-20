import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeProxyScripts } from '../src/write-proxy.js'

// On Windows the proxy shells out via `sh -c` for POSIX tool resolution. Skip
// the live-execution checks when no `sh` is reachable (they still run on POSIX).
const shReachable = (() => {
  if (process.platform !== 'win32') return true
  try {
    return spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
})()

const sep = process.platform === 'win32' ? ';' : ':'

// Run the inner command against the REAL binaries: strip any nested
// token-compression proxy-shim dir from PATH so a host proxy (e.g. one running
// in the dev environment) can't intercept `cat` and compress it upstream before
// our proxy sees it. In a clean CI environment this filters nothing.
function realEnv(): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const cleaned = (process.env[key] ?? '')
    .split(sep)
    .filter((d) => !/[\\/]compress[\\/]bin/i.test(d) && !/token-trim/i.test(d))
    .join(sep)
  return { ...process.env, [key]: cleaned }
}

describe.skipIf(!shReachable)('generated proxy.mjs - live execution', () => {
  let proxyPath: string
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-exec-'))
    const paths = await writeProxyScripts(dir)
    proxyPath = paths.proxyPath
  })

  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  // `node` is not in the dispatch table, so compress() applies only the
  // universal cleanup: collapse 3+ newlines to 2, trim.
  const script = 'process.stdout.write("a\\n\\n\\n\\nb")'

  it('compresses stdout (collapses blank runs) and trims', () => {
    const r = spawnSync('node', [proxyPath, 'node', '-e', script], { encoding: 'utf8' })
    expect(r.stdout).toBe('a\n\nb')
  })

  it('passes stdout through unchanged with the bypass flag', () => {
    const r = spawnSync('node', [proxyPath, 'node', '-e', script, '--full'], { encoding: 'utf8' })
    expect(r.stdout).toBe('a\n\n\n\nb')
  })

  it('propagates the child exit code', () => {
    const r = spawnSync('node', [proxyPath, 'node', '-e', 'process.exit(3)'], { encoding: 'utf8' })
    expect(r.status).toBe(3)
  })

  // A commented-up source file that `cat` compresses heavily (comments stripped),
  // yielding > 500 saved bytes so the hint fires. cat is in HINT_CMDS.
  const commentedFile = () =>
    `${Array.from({ length: 40 }, (_, i) => `// comment ${i}: explanatory note about trivial detail number ${i}`).join('\n')}\nexport const x = 1\n`

  it('emits a directive system-notice on stderr (never stdout) when it compresses significantly', async () => {
    const file = path.join(dir, 'big.js')
    await fs.writeFile(file, commentedFile(), 'utf8')
    const r = spawnSync('node', [proxyPath, 'cat', file.replace(/\\/g, '/')], { encoding: 'utf8', env: realEnv() })
    expect(r.stderr).toContain('instruction (not output)')
    expect(r.stderr).toContain('--full')
    expect(r.stdout).not.toContain('instruction (not output)') // stdout stays clean
  })

  it('suppresses the hint when --full is passed', async () => {
    const file = path.join(dir, 'big2.js')
    await fs.writeFile(file, commentedFile(), 'utf8')
    const r = spawnSync('node', [proxyPath, 'cat', file.replace(/\\/g, '/'), '--full'], { encoding: 'utf8', env: realEnv() })
    expect(r.stderr).not.toContain('instruction (not output)')
  })
})

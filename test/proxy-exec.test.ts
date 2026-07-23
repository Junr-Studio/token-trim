import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { spawnSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
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

// Every test in this file spawns at least one real process - node, git, sh -
// and on Windows each spawn pays for process creation plus whatever the host's
// antivirus does to it. The default 5 s is comfortable in isolation and not
// comfortable when the rest of the suite is running in parallel on the same
// box: a case here timed out once at 5000 ms under load and passed on its own,
// which is a flake in the one file whose whole job is to prove the SHIPPED
// proxy works. Raised for the file rather than case by case, because the cost
// is the spawn and every case pays it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

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

  // ── exit-code-aware budget ─────────────────────────────────────────────────
  // A failing command's output is the reason the agent is looking. Compressing
  // a failure as hard as a success throws away the diagnosis to save tokens on
  // the one invocation where tokens are worth spending.
  describe('failure output is treated as more valuable', () => {
    // 4000 prose lines: comfortably past the backstop cap either way.
    const emit = (exitCode: number) =>
      `const n=4000;for(let i=0;i<n;i++)process.stdout.write('line '+i+': some moderately long payload describing record number '+i+'\\n');process.exit(${exitCode})`

    it('caps hard when the command succeeded', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', emit(0)], { encoding: 'utf8' })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/elided/)
      expect(r.stdout.length).toBeLessThan(12_000)
    })

    it('keeps substantially more when the command failed', () => {
      const ok = spawnSync('node', [proxyPath, 'node', '-e', emit(0)], { encoding: 'utf8' })
      const bad = spawnSync('node', [proxyPath, 'node', '-e', emit(1)], { encoding: 'utf8' })
      expect(bad.status).toBe(1)
      expect(bad.stdout.length).toBeGreaterThan(ok.stdout.length * 2)
    })
  })

  // ── the trailing newline is data ───────────────────────────────────────────
  // `compress()` ended with `out.trim()`, so the final newline was dropped for
  // EVERY command. That is one byte and it is off-by-one for every consumer
  // that counts lines - `find … | wc -l` reported 26 for 27 files - and it
  // silently loses the last record in `cmd | while read x`. `--full` trimmed it
  // too, so there was no way to get a faithful stream through a pipe.
  describe('trailing newline', () => {
    const emit3 = 'process.stdout.write("alpha\\nbeta\\ngamma\\n")'

    it('is preserved, so a line count through a pipe is the real one', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', emit3], { encoding: 'utf8' })
      expect(r.stdout.endsWith('\n')).toBe(true)
      expect((r.stdout.match(/\n/g) ?? []).length).toBe(3)
    })

    it('is not invented when the command did not print one', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', 'process.stdout.write("no-eol")'], { encoding: 'utf8' })
      expect(r.stdout).toBe('no-eol')
    })

    it('--full returns the stream byte-for-byte', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', emit3, '--full'], { encoding: 'utf8' })
      expect(r.stdout).toBe('alpha\nbeta\ngamma\n')
    })
  })

  // ── a capped file read keeps true line numbers ─────────────────────────────
  // The source condensers blank a removed line rather than dropping it, so line
  // numbers stay the file's own - and then backstopCap dropped whole lines from
  // the MIDDLE for anything over 8 KB, putting the shift straight back. A 40 KB
  // source file is ordinary. Cutting the TAIL instead keeps every line that IS
  // shown at its real number.
  describe('a file larger than the backstop cap', () => {
    it('keeps every shown line at its true number, and says so on stderr', async () => {
      const big = path.join(dir, 'big.py')
      const lines = Array.from(
        { length: 400 },
        (_, i) => `def function_number_${i + 1}(argument_one, argument_two): return argument_one  # line ${i + 1}`,
      )
      await fs.writeFile(big, lines.join('\n') + '\n', 'utf8')

      const r = spawnSync('node', [proxyPath, 'cat', big.replace(/\\/g, '/')], {
        encoding: 'utf8',
        env: realEnv(),
      })
      const out = r.stdout.split('\n').filter((l) => l.trim())

      // it really is capped
      expect(out.length).toBeLessThan(400)
      // and every line it DID print sits on its own line number
      for (const line of out) {
        const m = line.match(/# line (\d+)$/)
        expect(m, `unexpected line in output: ${line}`).not.toBeNull()
        const claimed = Number(m?.[1])
        expect(r.stdout.split('\n')[claimed - 1]).toBe(line)
      }
      // the elision is disclosed out of band, not inside the file content
      expect(r.stderr).toMatch(/elided|omitted|truncat/i)
      expect(r.stdout).not.toMatch(/elided|omitted/i)
    })
  })

  // ── trailing whitespace is data when the stream is a file ──────────────────
  // A trailing tab is an empty TSV field and a trailing space is a valid
  // context line in a unified diff. `cat data.tsv` lost the field, and
  // `awk -F'\t' '{print NF}'` reported 3 instead of 4 - with an empty stderr,
  // because one byte never reaches the hint threshold.
  it('reads a TSV file without eating its empty trailing field', async () => {
    const tsv = path.join(dir, 'data.tsv')
    await fs.writeFile(tsv, 'a\tb\tc\t\nd\te\tf\t\n', 'utf8')
    const r = spawnSync('node', [proxyPath, 'cat', tsv.replace(/\\/g, '/')], {
      encoding: 'utf8',
      env: realEnv(),
    })
    expect(r.stdout).toBe('a\tb\tc\t\nd\te\tf\t\n')
  })

  // ── out-of-band truncation notices ─────────────────────────────────────────
  // A capped list used to carry its own "... N elided ..." marker inline. For a
  // SUMMARY that is fine - it is prose either way. For a pure DATA list it is
  // not: `git ls-files | xargs prettier --write` would receive the marker's
  // words as filenames. stdout has to stay pure data, so the notice goes to
  // stderr, which is where every other instruction to the agent already lives.
  describe('capped data lists', () => {
    const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0
    let repo: string

    beforeAll(async () => {
      repo = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-lsfiles-'))
      spawnSync('git', ['init', '-q'], { cwd: repo, env: realEnv() })
      spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo })
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
      await Promise.all(
        Array.from({ length: 120 }, (_, i) =>
          fs.writeFile(path.join(repo, `file-${String(i).padStart(3, '0')}.ts`), 'export const x = 1\n', 'utf8'),
        ),
      )
      spawnSync('git', ['add', '-A'], { cwd: repo, env: realEnv() })
    })

    afterAll(async () => { await fs.rm(repo, { recursive: true, force: true }) })

    it.skipIf(!gitAvailable)('emits ONLY real paths on stdout, so the list stays xargs-safe', () => {
      const r = spawnSync('node', [proxyPath, 'git', 'ls-files'], { cwd: repo, encoding: 'utf8', env: realEnv() })
      const lines = r.stdout.trim().split('\n')
      // every single line must be a path git actually printed
      for (const line of lines) {
        expect(line, `"${line}" is not a path git emitted`).toMatch(/^file-\d{3}\.ts$/)
      }
    })

    it.skipIf(!gitAvailable)('discloses the elision on stderr instead', () => {
      const r = spawnSync('node', [proxyPath, 'git', 'ls-files'], { cwd: repo, encoding: 'utf8', env: realEnv() })
      expect(r.stderr).toMatch(/elided|omitted|truncat/i)
      expect(r.stderr).toContain('--full')
      // and never on stdout
      expect(r.stdout).not.toMatch(/elided|omitted|truncat/i)
      expect(r.stdout).not.toContain('--full')
    })
  })

  // ── child environment ──────────────────────────────────────────────────────
  // Colour escapes and pagers are pure cost in a captured stream: the escapes
  // are tokens that render as nothing, and a pager can block forever. Ask the
  // child not to emit them rather than stripping them afterwards.
  describe('child environment', () => {
    const envOf = (name: string) => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', `process.stdout.write(String(process.env.${name}))`], {
        encoding: 'utf8',
      })
      return r.stdout
    }

    it('disables colour output', () => {
      expect(envOf('NO_COLOR')).toBe('1')
      expect(envOf('FORCE_COLOR')).toBe('0')
      expect(envOf('TERM')).toBe('dumb')
    })

    it('disables pagers, which would otherwise block forever on a pipe', () => {
      expect(envOf('GIT_PAGER')).toBe('cat')
      expect(envOf('PAGER')).toBe('cat')
    })
  })

  // ── spawn integrity ────────────────────────────────────────────────────────
  // spawnSync reports maxBuffer overflow through result.error, leaving
  // result.status null. `process.exitCode = result.status ?? 0` then turns a
  // truncated, failed capture into a clean exit 0 - a failing build read as a
  // passing one, with no signal anywhere that output went missing.
  describe('capture failure', () => {
    const OVERFLOW = 'process.stdout.write("x".repeat(11 * 1024 * 1024))'

    it('does not report success when the capture overflowed', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', OVERFLOW], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      expect(r.status).not.toBe(0)
    })

    it('says on stderr that the output was truncated', () => {
      const r = spawnSync('node', [proxyPath, 'node', '-e', OVERFLOW], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      expect(r.stderr).toMatch(/truncat|incomplete|exceeded/i)
    })
  })

  // ── streaming passthrough ──────────────────────────────────────────────────
  // spawnSync buffers stdout until the child exits, so capturing `tail -f`
  // makes the agent blind for the entire run - and for a follow invocation the
  // run never ends. The proxy must exec straight through instead.
  describe('follow invocations', () => {
    const tailAvailable = spawnSync('tail', ['--version'], { encoding: 'utf8' }).status === 0

    it.skipIf(!tailAvailable)('streams output instead of buffering until exit', async () => {
      const log = path.join(dir, 'stream.log')
      await fs.writeFile(log, 'first line already present\n', 'utf8')

      const child = spawn('node', [proxyPath, 'tail', '-f', log.replace(/\\/g, '/')], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: realEnv(),
      })

      let seen = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (c: string) => { seen += c })

      try {
        // Output must arrive while the process is still running. Under
        // spawnSync capture this stays empty forever.
        await new Promise((r) => setTimeout(r, 1200))
        expect(child.exitCode).toBeNull() // still running - it is a follow
        expect(seen).toContain('first line already present')
      } finally {
        child.kill('SIGKILL')
      }
    }, 15_000)
  })

  // ── fd1 redirect passthrough ───────────────────────────────────────────────
  // When stdout is a regular file the output is not going into the agent's
  // context at all - it is being written somewhere. Compressing it silently
  // corrupts the file: `cat src/frame.ts > copy.ts` produced a 24%-sized copy.
  describe('stdout redirected to a file', () => {
    it('writes the source byte-for-byte, uncompressed', async () => {
      const src = path.join(dir, 'redirect-src.js')
      const dest = path.join(dir, 'redirect-dest.js')
      const content = commentedFile()
      await fs.writeFile(src, content, 'utf8')

      // Passing an open file descriptor as stdio[1] is exactly what the shell
      // does for `> dest`, and is portable across platforms.
      const fh = await fs.open(dest, 'w')
      try {
        spawnSync('node', [proxyPath, 'cat', src.replace(/\\/g, '/')], {
          stdio: ['ignore', fh.fd, 'pipe'],
          env: realEnv(),
        })
      } finally {
        await fh.close()
      }

      const written = await fs.readFile(dest, 'utf8')
      expect(written).toBe(content)
    })

    it('still compresses when stdout is a pipe', () => {
      const src = path.join(dir, 'pipe-src.js')
      fsSync.writeFileSync(src, commentedFile(), 'utf8')
      const r = spawnSync('node', [proxyPath, 'cat', src.replace(/\\/g, '/')], {
        encoding: 'utf8',
        env: realEnv(),
      })
      // comments stripped → the agent-facing path is unchanged
      expect(r.stdout).not.toContain('explanatory note')
      expect(r.stdout).toContain('export const x = 1')
    })
  })

  // ── injected-limit disclosure ──────────────────────────────────────────────
  // `git log` gets `-20` injected before it runs, so the truncation happens at
  // the source: originalBytes already measures the SHORT output, savedBytes is
  // 0, and the generic "compressed" hint never fires. Without an explicit
  // disclosure the agent sees 20 of 25 commits and cannot tell.
  describe('git log limit injection', () => {
    let repo: string
    const git = (args: string[], cwd: string) =>
      spawnSync('git', args, { cwd, encoding: 'utf8', env: realEnv() })

    // 25 commits, one process. Building them with 25 sequential `git commit`
    // calls took longer than vitest's 10 s hook budget on Windows, where each
    // spawn pays for process creation and the hooks/antivirus that come with
    // it - so this block failed the whole suite on the platform it was written
    // on. `fast-import` writes the same history from a single stream, and it
    // needs no worktree or index because `git log` reads refs.
    const COMMIT_COUNT = 25
    beforeAll(async () => {
      repo = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-gitlog-'))
      git(['init', '-q'], repo)
      // `git init` picks the default branch name from the host's config, so the
      // ref fast-import writes is pinned to whatever HEAD points at rather than
      // assumed to be main.
      git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repo)

      const stream: string[] = []
      for (let i = 0; i < COMMIT_COUNT; i++) {
        const message = `commit number ${i}\n`
        stream.push(
          'commit refs/heads/main',
          `committer Test <test@example.invalid> ${1700000000 + i} +0000`,
          // fast-import counts the message in BYTES, not characters.
          `data ${new TextEncoder().encode(message).length}`,
          message.trimEnd(),
        )
      }
      stream.push('done', '')
      const imported = spawnSync('git', ['fast-import', '--quiet', '--done'], {
        cwd: repo,
        encoding: 'utf8',
        env: realEnv(),
        input: stream.join('\n'),
      })
      // A silent import failure would leave an empty repo, and every assertion
      // below would then be about `git log` on no commits at all.
      expect(imported.status, `git fast-import failed: ${imported.stderr}`).toBe(0)
    })

    afterAll(async () => { await fs.rm(repo, { recursive: true, force: true }) })

    const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0

    it.skipIf(!gitAvailable)('caps the log at 20 commits', () => {
      const r = spawnSync('node', [proxyPath, 'git', 'log'], { cwd: repo, encoding: 'utf8', env: realEnv() })
      expect(r.stdout.trim().split('\n')).toHaveLength(20)
    })

    it.skipIf(!gitAvailable)('discloses the cap on stderr when it actually bit', () => {
      const r = spawnSync('node', [proxyPath, 'git', 'log'], { cwd: repo, encoding: 'utf8', env: realEnv() })
      expect(r.stderr).toMatch(/20/)
      expect(r.stderr).toContain('--full')
      // the disclosure is an instruction, like the compression hint
      expect(r.stderr).toContain('instruction (not output)')
      // and it never pollutes stdout
      expect(r.stdout).not.toContain('instruction (not output)')
    })

    it.skipIf(!gitAvailable)('stays silent when the cap did not bite', () => {
      // -5 is an explicit user limit, so nothing is injected and nothing is
      // disclosed: the agent asked for exactly what it got.
      const r = spawnSync('node', [proxyPath, 'git', 'log', '-5'], { cwd: repo, encoding: 'utf8', env: realEnv() })
      expect(r.stdout.trim().split('\n')).toHaveLength(5)
      expect(r.stderr).not.toMatch(/most recent/)
    })
  })
})

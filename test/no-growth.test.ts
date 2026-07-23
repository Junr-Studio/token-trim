import { describe, it, expect } from 'vitest'
import { compress, linkHandlerFunction } from './support/harness.js'
import { ARGS_HANDLER } from '../src/handlers/args.js'

// The proxy may never cost more context than not using it.
//
// `describeCompression` already asserts that each case shrinks, but only for
// the cases the suite happens to contain - and growth does not live where the
// cases do. Every case is a realistic run with something to report, because
// that is what a condenser is written against. Growth lives at the other end:
// the run with NOTHING to report, where a rollup line costs more than the one
// line it replaces. `ruff format --check` on an already-clean tree turned
// "3 files already formatted" (26 characters) into "ruff format: 0 reformatted,
// 3 already formatted" (47), and no case covered it because nobody writes a
// fixture for a clean run.
//
// So the rule is enforced structurally in compress() instead: if the transform
// did not pay for itself, the pre-condenser text is handed back. This file is
// the evidence, and the empty-run corpus below is the shape that needs it.

const takeNotices = linkHandlerFunction<() => string[]>('ttTakeNotices', ARGS_HANDLER)

/**
 * A realistic "ran fine, nothing to say" stdout for each command that has a
 * condenser producing a summary line. These are the outputs an agent sees on
 * the happy path, which is most of the time.
 */
const CLEAN_RUNS: Array<{ cmd: string; args: string[]; input: string }> = [
  { cmd: 'ruff', args: ['format', '--check', '.'], input: '3 files already formatted\n' },
  { cmd: 'ruff', args: ['check', '.'], input: 'All checks passed!\n' },
  { cmd: 'mypy', args: ['.'], input: 'Success: no issues found in 12 source files\n' },
  {
    cmd: 'prettier',
    args: ['--check', '.'],
    input: 'Checking formatting...\nAll matched files use Prettier code style!\n',
  },
  { cmd: 'pytest', args: [], input: '===== 3 passed in 0.12s =====\n' },
  { cmd: 'go', args: ['test', './...'], input: 'ok  \tacme/pkg\t0.012s\n' },
  {
    cmd: 'cargo',
    args: ['test'],
    input:
      'test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n',
  },
  { cmd: 'git', args: ['status'], input: 'On branch main\nnothing to commit, working tree clean\n' },
  { cmd: 'npm', args: ['audit'], input: 'found 0 vulnerabilities\n' },
  {
    cmd: 'docker',
    args: ['ps'],
    input: 'CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES\n',
  },
  { cmd: 'kubectl', args: ['get', 'pods'], input: 'No resources found in default namespace.\n' },
  {
    cmd: 'terraform',
    args: ['plan'],
    input: 'No changes. Your infrastructure matches the configuration.\n',
  },
  {
    cmd: 'df',
    args: ['-h'],
    input: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   40G   60G  40% /\n',
  },
  { cmd: 'ls', args: ['-l'], input: 'total 0\n' },
  { cmd: 'tree', args: [], input: '.\n\n0 directories, 0 files\n' },
  {
    cmd: 'ps',
    args: ['aux'],
    input:
      'USER  PID %CPU %MEM    VSZ   RSS TTY STAT START   TIME COMMAND\n' +
      'root    1  0.0  0.1 168000 11000 ?   Ss   09:00   0:01 /sbin/init\n',
  },
  {
    cmd: 'systemctl',
    args: ['status', 'nginx'],
    input:
      '● nginx.service - A high performance web server\n' +
      '     Active: active (running) since Mon 2026-07-20 09:00:00 UTC; 3 days ago\n',
  },
  {
    cmd: 'helm',
    args: ['list'],
    input: 'NAME\tNAMESPACE\tREVISION\tUPDATED\tSTATUS\tCHART\tAPP VERSION\n',
  },
  { cmd: 'rubocop', args: [], input: '3 files inspected, no offenses detected\n' },
  { cmd: 'make', args: [], input: "make: Nothing to be done for 'all'.\n" },
  {
    cmd: 'gradle',
    args: ['build'],
    input: 'BUILD SUCCESSFUL in 2s\n1 actionable task: 1 up-to-date\n',
  },
  { cmd: 'mvn', args: ['test'], input: '[INFO] BUILD SUCCESS\n' },
  { cmd: 'dotnet', args: ['build'], input: 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n' },
  { cmd: 'jq', args: ['.'], input: '{"a":1}\n' },
  { cmd: 'du', args: ['-sh', '.'], input: '4.0K\t.\n' },
  {
    cmd: 'journalctl',
    args: ['-u', 'nginx', '-n', '2'],
    input: 'Jul 23 09:00:00 host nginx[1]: started\nJul 23 09:00:01 host nginx[1]: ready\n',
  },
  { cmd: 'find', args: ['.', '-name', '*.ts'], input: './a.ts\n./b.ts\n' },
  { cmd: 'grep', args: ['-rn', 'foo', '.'], input: './a.ts:1:foo\n' },
  { cmd: 'eslint', args: ['.'], input: '' },
  { cmd: 'golangci-lint', args: ['run'], input: '' },
]

describe('no condenser may grow its input', () => {
  for (const c of CLEAN_RUNS) {
    it(`${c.cmd} ${c.args.join(' ')} - nothing to report`, () => {
      const out = compress(c.input, c.cmd, c.args)
      expect(
        out.length,
        `compressing a clean run of \`${c.cmd} ${c.args.join(' ')}\` produced MORE ` +
          'characters than the command printed - the proxy cost the agent context ' +
          'instead of saving it',
      ).toBeLessThanOrEqual(c.input.length)
    })
  }

  it('hands back the exact pre-condenser text, not an approximation of it', () => {
    // The regression this guard was written for. Falling back has to return
    // what ruff actually printed - if it returned a reconstruction, the guard
    // would be one more place that can lose a byte.
    const input = '3 files already formatted\n'
    const out = compress(input, 'ruff', ['format', '--check', '.'])
    expect(out).toBe(input.trim())
  })

  it('drops any truncation notice queued by the output it discarded', () => {
    // A notice announces an elision. When the guard falls back, the text going
    // to the agent is the one that was never elided, so a surviving notice
    // would describe something that did not happen - on stderr, where the agent
    // reads it as fact.
    //
    // No condenser today both elides and grows, so this asserts a contract
    // rather than reproducing a live bug: it is what stops the next condenser
    // that queues a notice from leaking one through the fallback.
    takeNotices()
    compress('3 files already formatted\n', 'ruff', ['format', '--check', '.'])
    expect(takeNotices()).toEqual([])
  })
})

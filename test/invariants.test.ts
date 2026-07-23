import { describe, it, expect } from 'vitest'
import {
  CONDENSER_VOCABULARY,
  assertNoFabricatedWords,
  findsFabricatedZero,
  isPureDataList,
  findsForeignListLines,
} from './support/invariants.js'
import { compress, linkHandlerFunction } from './support/harness.js'
import { ARGS_HANDLER } from '../src/handlers/args.js'

// The invariants are the library's central guarantee: they run against every
// case in the suite and are the reason "a condenser only compresses" is a
// checked property rather than a claim. So they need their own tests - a
// checker that silently always passes would make the whole guarantee vacuous
// while every suite stayed green.
//
// Each block below pins BOTH directions: the violation is caught, and the
// legitimate transform next to it is not. The second half matters as much as
// the first, because an invariant that cries wolf gets disabled.

describe('assertNoFabricatedWords', () => {
  it('catches a word the condenser invented', () => {
    expect(assertNoFabricatedWords('3 pods running on gke-node-2', '3 pods running'))
      .toContain('gke')
  })

  it('catches the real historical bug: a filename that was never in the input', () => {
    const input = 'src/app.ts\nsrc/util.ts\n'
    expect(assertNoFabricatedWords('src/app.ts\nsrc/util.ts\nsrc/phantom.ts', input))
      .toContain('phantom')
  })

  it('passes a pure deletion', () => {
    expect(assertNoFabricatedWords('kept line', 'kept line\ndropped line')).toEqual([])
  })

  it('passes a declared vocabulary word', () => {
    expect(CONDENSER_VOCABULARY).toContain('elided')
    expect(assertNoFabricatedWords('a\n... 4 lines elided ...\nb', 'a\nx\ny\nz\nw\nb')).toEqual([])
  })

  it('passes an identifier the condenser shortened', () => {
    // 4788fef0d695… -> 4788fef is a prefix, not an invention.
    expect(assertNoFabricatedWords('4788fef fix: thing', 'commit 4788fef0d695715cffb69504\n    fix: thing'))
      .toEqual([])
  })

  it('passes a word cut in half by a width truncation', () => {
    expect(assertNoFabricatedWords('the experime', 'the experimental flag is set')).toEqual([])
  })

  it('passes a label composed with a number the input supplied', () => {
    // "rev12" tokenises to "rev" (vocabulary) - the 12 came from the input.
    expect(assertNoFabricatedWords('myapp deployed rev12', 'myapp\t12\tdeployed')).toEqual([])
  })

  it('compares against the input as the condenser sees it, ANSI already stripped', () => {
    // Raw input holds "\x1b[32mDONE"; the condenser is handed "DONE".
    expect(assertNoFabricatedWords('DONE installed', '\x1b[32mDONE\x1b[0m installed')).toEqual([])
  })
})

describe('findsFabricatedZero', () => {
  it('catches the git diff --stat bug', () => {
    const input = ' src/app.ts | 12 ++--\n src/util.ts | 3 +\n 2 files changed, 15 insertions(+)\n'
    expect(findsFabricatedZero('diff: 0 file(s)  +0 -0', input)).toBe('0 file(s)')
  })

  it('catches the rg -l bug', () => {
    const input = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`).join('\n')
    expect(findsFabricatedZero('0 matches in 0 file(s)', input)).toBeTruthy()
  })

  it('allows a zero the command itself printed', () => {
    const input = 'audited 1282 packages in 2s\n\nfound 0 vulnerabilities\n'
    expect(findsFabricatedZero('found 0 vulnerabilities', input)).toBeNull()
  })

  it('allows a zero derived from a header-only table', () => {
    expect(findsFabricatedZero('[docker] 0 containers running', 'CONTAINER ID   IMAGE   STATUS\n')).toBeNull()
  })

  it('allows a zero derived from an empty-result sentinel', () => {
    expect(findsFabricatedZero('0 pods: 0 running', 'No resources found in default namespace.\n')).toBeNull()
  })

  it('allows one empty dimension beside a non-empty one', () => {
    // "3 files, 0 dirs" is not a claim that nothing is there.
    expect(findsFabricatedZero('3 files, 0 dirs  .ts(3)', 'a.ts\nb.ts\nc.ts\n')).toBeNull()
  })
})

describe('isPureDataList / findsForeignListLines', () => {
  it('recognises a path list', () => {
    expect(isPureDataList(Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`).join('\n'))).toBe(true)
  })

  // The classifier decides WHETHER I3 runs, so a shape it fails to recognise is
  // a stream the invariant silently never guards. These are the shapes it used
  // to miss.
  it('recognises a terraform state list, brackets and quotes included', () => {
    // `terraform state list` is named in src/handlers/args.ts as one of the
    // streams that must stay pipeable (`| xargs -n1 terraform state show`).
    // `count` prints `…private[0]` and `for_each` prints `…this["key"]`, so a
    // character class without `[`, `]` and `"` classified the single most
    // pipe-sensitive list in the corpus as prose and I3 never ran on it.
    const addrs: string[] = []
    for (let i = 0; i < 6; i++) {
      addrs.push(`module.vpc.aws_subnet.private[${i}]`)
      addrs.push(`aws_route53_record.this["api-${i}.acme.example"]`)
    }
    expect(isPureDataList(addrs.join('\n'))).toBe(true)
  })

  it('recognises a path list whose paths contain spaces', () => {
    // `find`/`rg -l`/`git ls-files` on a real machine. A single space inside a
    // datum is not column padding, and excluding it blinded I3 to every list
    // touching `Program Files`, `My Documents`, or a spaced filename.
    const paths = Array.from({ length: 10 }, (_, i) => `docs/Design Notes/chapter ${i}.md`)
    expect(isPureDataList(paths.join('\n'))).toBe(true)
  })

  it('recognises a key=value list', () => {
    // `git config --list`, `docker ps --filter`, a label selector: one setting
    // per line, `=` and nothing else structural.
    const conf = Array.from({ length: 10 }, (_, i) => `remote.origin-${i}.url=git@github.com:acme/repo-${i}.git`)
    expect(isPureDataList(conf.join('\n'))).toBe(true)
  })

  it('does not mistake prose or a table for a data list', () => {
    expect(isPureDataList('12 files changed, 3 insertions\nsrc/app.ts | 4 ++--\n')).toBe(false)
    expect(isPureDataList('NAME   STATUS   AGE\napi-0  Running  5d\n')).toBe(false)
  })

  // The two lines above are below the 8-line floor, so they would be rejected
  // by line count alone and prove nothing about the shape test. These are long
  // enough to reach it - the widened character class has to earn each `false`.
  it('still rejects a column-aligned table, however long', () => {
    const table = ['NAME                 READY   STATUS    RESTARTS   AGE']
      .concat(Array.from({ length: 11 }, (_, i) => `api-${i}               1/1     Running   0          5d`))
    expect(isPureDataList(table.join('\n'))).toBe(false)
  })

  it('still rejects prose, including the frame\'s own elision marker', () => {
    const prose = Array.from({ length: 10 }, (_, i) => `warning ${i}: this value is never read and can be removed`)
    expect(isPureDataList(prose.join('\n'))).toBe(false)
    expect(isPureDataList(Array.from({ length: 10 }, () =>
      '... 64 lines elided (10 KB total) - re-run with --full for all of it ...').join('\n'))).toBe(false)
  })

  it('still rejects an indented block, which is a grouping and not a list', () => {
    const grouped = Array.from({ length: 10 }, (_, i) => `  p${i}.tsx`)
    expect(isPureDataList(grouped.join('\n'))).toBe(false)
  })

  it('needs enough lines to be sure', () => {
    expect(isPureDataList('a.ts\nb.ts\n')).toBe(false)
  })

  it('catches an elision marker smuggled into a path list', () => {
    const input = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`).join('\n')
    const out = 'src/f0.ts\nsrc/f1.ts\n... 10 paths elided (--full) ...'
    expect(findsForeignListLines(out, input)).toEqual(['... 10 paths elided (--full) ...'])
  })

  it('catches a grouping header, which is what condenseFind used to emit', () => {
    const input = Array.from({ length: 12 }, (_, i) => `./src/pages/p${i}.tsx`).join('\n')
    const out = '12 results in 1 dir(s)\n./src/pages/  (12)\n  p0.tsx'
    expect(findsForeignListLines(out, input).length).toBeGreaterThan(0)
  })

  it('passes a list that was only capped', () => {
    const input = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`).join('\n')
    expect(findsForeignListLines('src/f0.ts\nsrc/f1.ts\nsrc/f11.ts', input)).toEqual([])
  })

  // The two lists below are the ones the frame's ~8 KB backstop actually bites:
  // long enough that a condenser's own 60-entry cap still leaves >8000 chars, so
  // the generic head/tail elision runs and splices its marker into the stream.
  // I3 has to recognise BOTH shapes, because the marker it must catch is the
  // frame's real wording - the words in it (`lines`, `elided`, `total`, `run`,
  // `full`) are all declared vocabulary, so I1 will never flag it and I3 is the
  // only invariant standing between an agent and `xargs` being handed an English
  // sentence as a list of filenames.
  const BACKSTOP_MARKER = '... 5 lines elided (8 KB total) - re-run with --full for all of it ...'

  it('runs on a monorepo path list long enough to reach the backstop', () => {
    const paths = Array.from({ length: 60 }, (_, i) =>
      'packages/@acme/design-system/src/components/DataGrid/internals/virtualization/' +
      `__tests__/RowVirtualizerScrollAnchoring${i}.integration.test.tsx`)
    const input = paths.join('\n') + '\n'
    expect(input.length).toBeGreaterThan(8000) // the cap really is in play
    expect(isPureDataList(input)).toBe(true)
    const out = paths.slice(0, 40).concat(BACKSTOP_MARKER, paths.slice(55)).join('\n')
    expect(findsForeignListLines(out, input)).toEqual([BACKSTOP_MARKER])
  })

  it('runs on a terraform state list long enough to reach the backstop', () => {
    const addrs: string[] = []
    for (let i = 0; i < 130; i++) {
      addrs.push(`module.vpc.aws_subnet.private[${i}]`)
      addrs.push(`aws_route53_record.this["api-${i}.acme.example"]`)
    }
    const input = addrs.join('\n') + '\n'
    expect(input.length).toBeGreaterThan(8000)
    expect(isPureDataList(input)).toBe(true)
    const out = addrs.slice(0, 100).concat(BACKSTOP_MARKER, addrs.slice(180)).join('\n')
    expect(findsForeignListLines(out, input)).toEqual([BACKSTOP_MARKER])
  })
})

describe('CONDENSER_VOCABULARY', () => {
  it('is the review surface, so it stays small enough to read', () => {
    // Not a hard cap on functionality - a nudge. Every entry is a word the
    // library may put in front of an agent that the command never said.
    expect(CONDENSER_VOCABULARY.length).toBeLessThan(200)
  })

  it('holds no duplicates, which would hide a word being added twice', () => {
    const lower = CONDENSER_VOCABULARY.map((w) => w.toLowerCase())
    expect(lower.length - new Set(lower).size).toBe(0)
  })
})
// ── I3, run against the real compress() ───────────────────────────────────────
// The block above pins the CHECKER: it builds `out` by hand and asserts that
// findsForeignListLines spots a marker in it. That is worth having, and it is
// not the same thing as checking the frame - a classifier can be perfect while
// the code it was written to police still splices prose into a pipe.
//
// These run the shipped compress() on lists big enough to reach the 8 KB
// backstop, which is the only place a data list could still pick up a marker
// once every condenser routes its own caps through ttCapDataList. Both shapes
// below are named in src/handlers/args.ts as streams that must stay pipeable.
describe('I3 against the shipped compress()', () => {
  const takeNotices = linkHandlerFunction<() => string[]>('ttTakeNotices', ARGS_HANDLER)

  function pipeable(cmd: string, args: string[], input: string) {
    takeNotices() // drop anything an earlier case left queued
    const out = compress(input, cmd, args)
    return { out, foreign: findsForeignListLines(out, input), notices: takeNotices() }
  }

  // Long enough that 60 of them - the cap `rg -l` applies itself - still exceed
  // the 8 KB backstop, so the SECOND cap is the one under test here.
  const LONG_PATHS = Array.from(
    { length: 200 },
    (_, i) =>
      `packages/service-${i}/src/main/domain/entities/aggregates/user-account/` +
      `user-account-aggregate-root-with-a-considerably-longer-generated-name-${i}.ts`,
  )

  const TF_ADDRESSES: string[] = []
  for (let i = 0; i < 130; i++) {
    TF_ADDRESSES.push(`module.vpc.aws_subnet.private[${i}]`)
    TF_ADDRESSES.push(`aws_route53_record.this["api-${i}.acme.example"]`)
  }

  it.each([
    ['rg -l', 'rg', ['-l', 'getUserById'], LONG_PATHS],
    ['grep -rl', 'grep', ['-rl', 'getUserById', '.'], LONG_PATHS],
    ['git ls-files', 'git', ['ls-files'], LONG_PATHS],
    ['find', 'find', ['.', '-name', '*.ts'], LONG_PATHS],
    ['terraform state list', 'terraform', ['state', 'list'], TF_ADDRESSES],
    ['tofu state list', 'tofu', ['state', 'list'], TF_ADDRESSES],
  ])('%s stays valid xargs input past the backstop', (_label, cmd, args, lines) => {
    const input = (lines as string[]).join('\n') + '\n'
    // If the input stopped reaching the cap, this test would pass for the wrong
    // reason - it would be measuring a list that was never truncated at all.
    expect(input.length).toBeGreaterThan(8000)
    expect(isPureDataList(input)).toBe(true)

    const { out, foreign, notices } = pipeable(cmd as string, args as string[], input)

    expect(out.length).toBeLessThan(input.length) // the cap really did bite
    expect(
      foreign,
      'a line the command never printed reached stdout - `| xargs` would be ' +
        'handed the elision marker as a filename',
    ).toEqual([])
    expect(
      notices.length,
      'output was truncated, so the agent has to be told - on stderr, where it ' +
        'cannot corrupt the stream',
    ).toBeGreaterThan(0)
  })
})
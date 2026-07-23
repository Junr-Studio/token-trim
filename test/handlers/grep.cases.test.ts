import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// grep / rg - groupGrep() characterization.
//
// The condenser parses each non-blank line as `file:line:content` (or the
// fallback `file:content`), groups matches by file, and - unless the output is
// tiny (<=1 file AND <10 lines, which passes through untouched) - emits a
// `N matches in M file(s)` summary header followed by, per file, a
// `path  (count)` line plus up to 20 indented matches truncated to 120 chars,
// with a `... +K more` marker when a file has more than 20 matches.

// ── (a) grouping condenser: many matches, several files ──────────────────────

// One file with 25 matches → exercises the 20/file cap + '... +5 more'.
const ROUTER = 'src/server/router.ts'
const routerMatches = Array.from(
  { length: 25 },
  (_, i) => `${ROUTER}:${100 + i}:    router.register('/route${i}', handler${i}) // TODO consolidate registration`,
)

// A second file whose first match's `line:content` exceeds 120 chars →
// exercises the per-match truncation (TRUNCATEDMARKER sits past column 120).
const LOADER = 'src/legacy/config-loader.ts'
const loaderMatches = [
  `${LOADER}:250:    const legacyConfig = deepMerge(defaults, overrides, environmentVariables, runtimeFlags, featureToggles, experimentalOptions, tenantSettings) // TRUNCATEDMARKER`,
  `${LOADER}:12:  import { deepMerge } from './merge' // TODO drop legacy loader`,
  `${LOADER}:88:  export function loadLegacy() { // TODO remove after v3`,
  `${LOADER}:140:    return normalize(raw) // TODO validate shape`,
]

const API = 'src/api/handlers.ts'
const apiMatches = [
  `${API}:20:  export const getUser = () => ({}) // TODO auth`,
  `${API}:44:  export const putUser = () => ({}) // TODO validate body`,
  `${API}:70:  export const delUser = () => ({}) // TODO cascade delete`,
  `${API}:96:  export const listUsers = () => ([]) // TODO paginate`,
]

// 25 + 4 + 4 = 33 matches across 3 files.
const GREP_MANY = [...routerMatches, ...loaderMatches, ...apiMatches].join('\n') + '\n'

// rg alias, several files, none over the cap and no over-long lines →
// pure grouping with no truncation / '... +K more'.
const CHECKOUT = 'src/features/checkout/CheckoutForm.tsx'
const CART = 'src/features/cart/CartSummary.tsx'
const PROFILE = 'src/features/profile/ProfilePanel.tsx'
const mkHits = (file: string, base: number): string[] =>
  Array.from(
    { length: 4 },
    (_, i) => `${file}:${base + i * 12}:  const [value${i}, setValue${i}] = useState(initial${i})`,
  )
// 4 + 4 + 4 = 12 matches across 3 files.
const RG_MANY = [...mkHits(CHECKOUT, 10), ...mkHits(CART, 25), ...mkHits(PROFILE, 40)].join('\n') + '\n'

// grep -r WITHOUT -n → `file:content` lines (the fallback regex branch).
const FORMAT = 'src/utils/format.ts'
const DATE = 'src/utils/date.ts'
const STRINGS = 'src/utils/strings.ts'
const GREP_NOLINE =
  [
    `${FORMAT}:export function formatCurrency(amount: number): string {`,
    `${FORMAT}:export function formatPercent(ratio: number): string {`,
    `${FORMAT}:export function formatBytes(bytes: number): string {`,
    `${DATE}:export function formatDate(value: Date): string {`,
    `${DATE}:export function parseDate(raw: string): Date {`,
    `${STRINGS}:export function truncate(input: string, max: number): string {`,
    `${STRINGS}:export function slugify(input: string): string {`,
  ].join('\n') + '\n'

// ── (b) passthrough: tiny output (<=1 file AND <10 lines) ────────────────────
const GREP_TINY = `src/config/defaults.ts:12:  export const PORT = process.env.PORT ?? 3000 // TODO validate range
src/config/defaults.ts:34:  export const HOST = process.env.HOST ?? '0.0.0.0' // TODO make configurable
src/config/defaults.ts:56:  export const TIMEOUT_MS = 30_000
`

// ── (c) path-list mode: -l / --files-with-matches / rg --files ───────────────
// These emit BARE PATHS, not `file:line:content`. The match-grouping parser
// finds zero matches in them, so an unguarded condenser reports "0 matches in
// 0 file(s)" and deletes the entire result. They are also the canonical input
// to `| xargs`, so they must degrade (head-N + marker), never break.
const PATH_LIST = Array.from(
  { length: 12 },
  (_, i) => `src/features/widget-${i}/Widget${i}.tsx`,
).join('\n') + '\n'

// ── (d) Windows absolute paths ───────────────────────────────────────────────
// `^([^:]+):` splits at the drive letter, so every hit collapses under a
// fabricated file literally named "C".
const WIN_HITS = Array.from(
  { length: 12 },
  (_, i) => `C:/repo/src/handlers/file${i}.ts:${10 + i}:export const value${i} = ${i}`,
).join('\n') + '\n'

// ── (e) -c / --count mode: `file:N` rows ─────────────────────────────────────
const COUNT_ROWS = [
  'src/server/router.ts:25',
  'src/legacy/config-loader.ts:4',
  'src/api/handlers.ts:4',
  'src/utils/format.ts:3',
  'src/utils/date.ts:2',
  'src/utils/strings.ts:2',
  'src/config/defaults.ts:1',
  'src/index.ts:1',
  'src/frame.ts:1',
  'src/stats.ts:1',
  'src/write-proxy.ts:1',
].join('\n') + '\n'

// ── (f) unparseable input ────────────────────────────────────────────────────
// 12 lines that match neither `file:line:content` nor `file:content`. The
// condenser must fall back to the input, never invent a zero summary.
const UNPARSEABLE = Array.from(
  { length: 12 },
  (_, i) => `binary file matched at offset ${i * 4096}`,
).join('\n') + '\n'

// ── (g) context mode: -C / -A / -B ───────────────────────────────────────────
// grep separates a CONTEXT row from a MATCH row by using `-` instead of `:`
// (`file-9-content`) and puts `--` between non-adjacent groups. Neither shape
// parses as `file:line:content`, so the grouping branch dropped every context
// line and every separator - silently, and from both the body and the count.
// `-C` exists for no other purpose than to show those lines, so the output came
// back indistinguishable from a plain `grep -n` run.
const CTX_FILES = ['src/config/a.ts', 'src/config/b.ts']
const GREP_CONTEXT =
  CTX_FILES.flatMap((f) =>
    [10, 24, 38, 52, 66, 80].flatMap((n) => [
      `${f}-${n - 1}-  // resolve the layered configuration`,
      `${f}:${n}:  const cfg = readConfig(process.env.NODE_ENV)`,
      `${f}-${n + 1}-  return applyDefaults(cfg)`,
      '--',
    ]),
  ).join('\n') + '\n'

// ── (h) rg --heading: the filename is its own line, rows are `line:content` ──
// `rg --heading` (and `-p`/`--pretty`, which implies it, and any
// RIPGREP_CONFIG_PATH that enables it) puts the filename on a line of its own.
// The heading has no colon, so it matched neither PATH regex and was DELETED;
// the surviving `10:content` rows then keyed the group map by LINE NUMBER, so
// the line numbers became the file headings and "M file(s)" became the count of
// distinct line numbers. Every real filename was lost and the count fabricated.
const RG_HEADING =
  Array.from({ length: 8 }, (_, i) =>
    [
      `src/features/mod${i}.ts`,
      '10:  const cfg = readConfig()',
      '11:  const merged = applyDefaults(cfg)',
      '12:  return readConfig(merged)',
      '',
    ].join('\n'),
  ).join('\n')

describeCompression('grep', [
  {
    name: '-l / --files-with-matches - bare path list survives (was annihilated to "0 matches in 0 file(s)")',
    cmd: 'rg',
    args: ['-l', 'useState', 'src/'],
    input: PATH_LIST,
    assert: (out) => {
      expect(out).not.toContain('0 matches in 0 file(s)')
      // every path still present, one per line, order preserved
      for (let i = 0; i < 12; i++) expect(out).toContain(`src/features/widget-${i}/Widget${i}.tsx`)
      // one path per line: a partially-truncated list must still be xargs-safe
      const paths = out.split('\n').filter((l) => l.includes('Widget'))
      expect(paths).toHaveLength(12)
      for (const p of paths) expect(p).toBe(p.trim())
    },
  },
  {
    name: 'grep -rl - bare path list survives on the grep alias too',
    cmd: 'grep',
    args: ['-rl', 'useState', 'src/'],
    input: PATH_LIST,
    assert: (out) => {
      expect(out).not.toContain('0 matches in 0 file(s)')
      expect(out).toContain('src/features/widget-0/Widget0.tsx')
      expect(out).toContain('src/features/widget-11/Widget11.tsx')
    },
  },
  {
    name: 'rg --files - the bare file listing is not a match list',
    cmd: 'rg',
    args: ['--files'],
    input: PATH_LIST,
    assert: (out) => {
      expect(out).not.toContain('0 matches in 0 file(s)')
      expect(out).toContain('src/features/widget-7/Widget7.tsx')
    },
  },
  {
    name: 'Windows drive letters - hits group under their real file, not a fabricated "C"',
    cmd: 'rg',
    args: ['-n', 'export', 'C:/repo/src'],
    input: WIN_HITS,
    assert: (out) => {
      // the drive letter must never become a file heading
      expect(out).not.toMatch(/^C\s+\(\d+\)$/m)
      // nor may the path be split at it, leaving a headless "/repo/..." remainder
      expect(out).not.toMatch(/^\s+\/repo\//m)
      // the real paths survive intact
      expect(out).toContain('C:/repo/src/handlers/file0.ts')
      expect(out).toContain('C:/repo/src/handlers/file11.ts')
    },
  },
  {
    name: '-c / --count - file:N rows are counts, not matches to be re-grouped',
    cmd: 'rg',
    args: ['-c', 'export', 'src/'],
    input: COUNT_ROWS,
    assert: (out) => {
      expect(out).not.toContain('0 matches in 0 file(s)')
      expect(out).toContain('src/server/router.ts')
      expect(out).toContain('25')
      // the biggest count should be findable, ordering is the condenser's call
      expect(out).toContain('src/legacy/config-loader.ts')
    },
  },
  {
    name: 'unrecognised shape - falls back to the input instead of fabricating a zero summary',
    cmd: 'rg',
    args: ['-n', 'x', 'src/'],
    input: UNPARSEABLE,
    assert: (out) => {
      expect(out).not.toMatch(/0 matches in 0 file\(s\)/)
      expect(out).toContain('binary file matched at offset 0')
      expect(out).toContain('binary file matched at offset 45056')
    },
  },
  {
    name: '--json - machine output must not be reshaped',
    cmd: 'rg',
    args: ['--json', 'export', 'src/'],
    input: Array.from(
      { length: 12 },
      (_, i) => JSON.stringify({ type: 'match', data: { path: { text: `src/f${i}.ts` }, line_number: i } }),
    ).join('\n') + '\n',
    assert: (out) => {
      // every line must still be independently JSON-parseable
      for (const line of out.split('\n').filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    },
  },
  {
    name: 'grep -rn - many matches over several files: grouped under a summary header, 20/file cap, 120-char truncation',
    cmd: 'grep',
    args: ['-rn', 'TODO', 'src/'],
    input: GREP_MANY,
    assert: (out, input) => {
      // Summary header counts ALL matches (including the capped ones) and files.
      expect(out).toMatch(/^33 matches in 3 file\(s\)$/m)
      // The 25-match file is capped at 20 shown with a remainder marker.
      expect(out).toContain('src/server/router.ts  (25)')
      expect(out).toContain('... +5 more')
      // Repeated `file:line:` prefixes are stripped - matches sit under their file.
      expect(out).not.toContain('src/server/router.ts:')
      // The over-long match line was truncated before its end marker.
      expect(out).not.toContain('TRUNCATEDMARKER')
      // No match/content line survives past the 2-space indent + 120-char cap.
      for (const line of out.split('\n')) {
        if (line.startsWith('  ')) expect(line.length).toBeLessThanOrEqual(122)
      }
      // It genuinely compresses.
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'rg - alias dispatches identically; several files each under the cap group cleanly (no truncation, no "+more")',
    cmd: 'rg',
    args: ['-n', 'useState', 'src/features'],
    input: RG_MANY,
    assert: (out, input) => {
      expect(out).toMatch(/^12 matches in 3 file\(s\)$/m)
      expect(out).toContain('src/features/checkout/CheckoutForm.tsx  (4)')
      // Nothing exceeded the cap, so no remainder markers.
      expect(out).not.toContain('... +')
      // Grouped, so the repeated path prefix is gone.
      expect(out).not.toContain('CheckoutForm.tsx:')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'grep -r (no line numbers) - file:content fallback branch still groups by file',
    cmd: 'grep',
    args: ['-r', 'export function', 'src/utils'],
    input: GREP_NOLINE,
    assert: (out, input) => {
      expect(out).toMatch(/^7 matches in 3 file\(s\)$/m)
      expect(out).toContain('src/utils/format.ts  (3)')
      // Content is preserved under the file heading; the `path:` prefix is dropped.
      expect(out).toContain('export function formatCurrency')
      expect(out).not.toContain('src/utils/format.ts:export')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'grep -rn - tiny result (single file, <10 lines) passes through unchanged, no header',
    cmd: 'grep',
    args: ['-rn', 'TODO', 'src/config/defaults.ts'],
    input: GREP_TINY,
    assert: (out) => {
      // Below the grouping threshold → original lines, no summary header.
      expect(out).not.toMatch(/matches in \d+ file/)
      expect(out).toContain('src/config/defaults.ts:12:')
      expect(out).toContain('export const PORT')
      expect(out).toContain('export const TIMEOUT_MS = 30_000')
    },
  },
  {
    name: '-C1 context - the lines the flag was passed to show are not deleted from the output',
    cmd: 'grep',
    args: ['-rn', '-C1', 'readConfig', 'src'],
    input: GREP_CONTEXT,
    assert: (out, input) => {
      // The context rows are the entire reason `-C` was typed.
      expect(out).toContain('// resolve the layered configuration')
      expect(out).toContain('return applyDefaults(cfg)')
      // grep's own group separator marks where the file jumps; keep it.
      expect(out).toContain('--')
      // Nothing may be silently dropped: every line grep printed comes back.
      const source = input.split('\n').filter((l) => l.trim())
      for (const line of source) expect(out).toContain(line)
      // And no header may claim a match/file count derived from a grammar the
      // condenser never parsed.
      expect(out).not.toMatch(/matches in \d+ file\(s\)/)
    },
  },
  {
    name: 'rg --heading - filenames on their own line are never deleted, and line numbers never become files',
    cmd: 'rg',
    args: ['--heading', '-n', 'readConfig'],
    input: RG_HEADING,
    assert: (out) => {
      // Every real filename must survive - they are the answer to the search.
      for (let i = 0; i < 8; i++) expect(out).toContain(`src/features/mod${i}.ts`)
      // A line number may never be presented as a file heading.
      expect(out).not.toMatch(/^1[012] {2}\(\d+\)$/m)
      // …nor may a file count be invented from the number of distinct line
      // numbers: 24 hits over 8 files were reported as "in 3 file(s)".
      expect(out).not.toContain('3 file(s)')
    },
  },
  {
    name: 'empty output - no matches found returns empty (grep prints nothing on zero hits)',
    cmd: 'grep',
    args: ['-rn', 'nonexistent-token', 'src/'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

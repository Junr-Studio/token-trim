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

describeCompression('grep', [
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
    name: 'empty output - no matches found returns empty (grep prints nothing on zero hits)',
    cmd: 'grep',
    args: ['-rn', 'nonexistent-token', 'src/'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

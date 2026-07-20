import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `js-tools` handler.
// Covers all six condensers dispatched by cmd name:
//   vitest → condenseVitest      jest    → condenseJest
//   playwright → condensePlaywright  prettier → condensePrettier
//   eslint → condenseEslint      next    → condenseNext
// Each case feeds realistic raw tool output; the harness runs the real
// shipped compress(), asserts it shrinks, runs the behavioral asserts, then
// snapshots the byte-for-byte output.
//
// NOTE: none of these fixtures may contain an uppercase `TS<4 digits>:`
// token - the dispatcher reroutes any such text to the tsc condenser
// (`/TS\d{4}:/.test(out)`) regardless of cmd. All `.ts:NN` paths below are
// lowercase and safe.

// ── vitest ──────────────────────────────────────────────────────────────────
const VITEST_FAIL = ` RUN  v1.6.0 /home/dev/project

 ✓ src/math.test.ts (5) 12ms
 ✓ src/utils.test.ts (8) 20ms
 ❯ src/api.test.ts (4)
   × api > fetchUser returns user data 8ms
   × api > fetchUser handles 404 response 5ms
 ✓ src/format.test.ts (3) 4ms

⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/api.test.ts > api > fetchUser returns user data
AssertionError: expected 200 to deeply equal 404

- Expected
+ Received

- 404
+ 200

 ❯ src/api.test.ts:12:34

 FAIL  src/api.test.ts > api > fetchUser handles 404 response
AssertionError: expected undefined to be defined

 ❯ src/api.test.ts:20:18

 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 18 passed (20)
   Start at  14:32:01
   Duration  892ms (transform 45ms, setup 0ms, collect 120ms, tests 78ms)
`

const VITEST_PASS = ` RUN  v1.6.0 /home/dev/project

 ✓ src/math.test.ts (5) 12ms
 ✓ src/utils.test.ts (8) 20ms
 ✓ src/format.test.ts (3) 4ms

 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  14:35:10
   Duration  445ms (transform 40ms, setup 0ms, collect 90ms, tests 55ms)
`

const VITEST_NO_TESTS = ` RUN  v1.6.0 /home/dev/project

No test files found, exiting with code 1
filter:  nonexistent-pattern
include: **/*.{test,spec}.{js,mjs,ts}
exclude: **/node_modules/**
`

// ── jest ────────────────────────────────────────────────────────────────────
const JEST_FAIL = ` FAIL  src/api.test.js
  ● API › fetchUser › returns user data

    expect(received).toBe(expected)

    Expected: 200
    Received: 404

      at Object.<anonymous> (src/api.test.js:12:20)

  ● API › fetchUser › handles error response

    TypeError: Cannot read properties of undefined

 PASS  src/math.test.js
 PASS  src/utils.test.js

Test Suites: 1 failed, 2 passed, 3 total
Tests:       2 failed, 18 passed, 20 total
Snapshots:   0 total
Time:        2.145 s
Ran all test suites.
`

const JEST_PASS = ` PASS  src/math.test.js
 PASS  src/utils.test.js
 PASS  src/api.test.js

Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   2 passed, 2 total
Time:        1.832 s
Ran all test suites.
`

// ── playwright ──────────────────────────────────────────────────────────────
const PW_FAIL = `Running 30 tests using 4 workers

  ✓  1 [chromium] › login.spec.ts:5:1 › user can log in (1.2s)
  ✓  2 [chromium] › home.spec.ts:8:1 › renders homepage (0.8s)
  ✘  3 [chromium] › checkout.spec.ts:12:1 › completes purchase (3.1s)
  ✘  4 [firefox] › checkout.spec.ts:12:1 › completes purchase (3.4s)
  ✓  5 [webkit] › search.spec.ts:4:1 › search returns results (1.1s)

  1) checkout.spec.ts:12:1 › completes purchase ──────────────────────────

    Error: expect(locator).toBeVisible()

    Call log:
      - expect.toBeVisible with timeout 5000ms
      - waiting for locator('.confirmation')

      at checkout.spec.ts:18:42

  25 passed (58.3s)
  2 failed
  1 flaky
  2 skipped
`

const PW_PASS = `Running 18 tests using 4 workers

  ✓  1 [chromium] › login.spec.ts:5:1 › user can log in (1.2s)
  ✓  2 [chromium] › home.spec.ts:8:1 › renders homepage (0.8s)
  ✓  3 [firefox] › login.spec.ts:5:1 › user can log in (1.4s)

  18 passed (32.1s)
`

// ── prettier ────────────────────────────────────────────────────────────────
const PRETTIER_DIRTY = `Checking formatting...
[warn] src/app.ts
[warn] src/components/Button.tsx
[warn] src/components/Modal.tsx
[warn] src/components/Header.tsx
[warn] src/hooks/useAuth.ts
[warn] src/hooks/useFetch.ts
[warn] src/lib/api.ts
[warn] src/lib/format.ts
[warn] src/pages/index.tsx
[warn] src/pages/about.tsx
[warn] src/utils/date.ts
[warn] src/utils/string.ts
[warn] Code style issues found in 12 files. Run Prettier with --write to fix.
`

const PRETTIER_CLEAN = `Checking formatting...
All matched files use Prettier code style!
`

// ── eslint ──────────────────────────────────────────────────────────────────
const ESLINT_PROBLEMS = `/home/dev/project/src/app.ts
   5:1   error    'foo' is assigned a value but never used   no-unused-vars
  12:7   warning  Unexpected console statement                no-console
  18:3   error    Missing semicolon                           semi
  23:10  error    'bar' is not defined                        no-undef

/home/dev/project/src/api.ts
   3:5   warning  Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
   9:1   error    Missing semicolon                           semi
  14:20  warning  Unexpected console statement                no-console
  20:15  error    Strings must use singlequote                quotes

✖ 8 problems (5 errors, 3 warnings)
`

const ESLINT_CONFIG_MSG = `Oops! Something went wrong! :(

ESLint: 8.56.0

No files matching the pattern "src/**/*.vue" were found.
Please check for typing mistakes in the pattern.
`

// ── next build ──────────────────────────────────────────────────────────────
const NEXT_BUILD = `   ▲ Next.js 14.1.0

   Creating an optimized production build ...
 ✓ Compiled successfully
 ✓ Linting and checking validity of types
 ✓ Collecting page data
 ✓ Generating static pages (8/8)
 ✓ Finalizing page optimization

Route (app)                              Size     First Load JS
  ○ /                                    5.2 kB          89 kB
  ○ /about                               1.1 kB          85 kB
  ● /blog/[slug]                         2.3 kB          87 kB
  λ /api/users                           0 B             0 B
  ○ /dashboard                           8.7 kB          95 kB
  ○ /settings                            3.1 kB          88 kB

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML
λ  (Server)   server-side renders at runtime
`

const NEXT_FAIL = `   ▲ Next.js 14.1.0

   Creating an optimized production build ...
Failed to compile.

./src/app/page.tsx
Type error: Property 'foo' does not exist on type 'Props'.

  10 |   return <div>{props.foo}</div>
     |                      ^
`

describeCompression('js-tools', [
  // ── vitest ────────────────────────────────────────────────────────────────
  {
    name: 'vitest - summarizes pass/fail counts and lists failing tests, drops assertion noise',
    cmd: 'vitest',
    args: ['run'],
    input: VITEST_FAIL,
    assert: (out) => {
      expect(out).toMatch(/^Vitest: /)
      expect(out).toContain('18 passed')
      expect(out).toContain('2 failed')
      // failing test names are surfaced as FAIL lines
      expect(out).toContain('FAIL:')
      expect(out).toContain('fetchUser returns user data')
      expect(out).toContain('fetchUser handles 404 response')
      // verbose diff / stack / timing noise is stripped
      expect(out).not.toContain('AssertionError')
      expect(out).not.toContain('Duration')
      expect(out).not.toContain('transform 45ms')
    },
  },
  {
    name: 'vitest - clean run collapses to a one-line passing summary (no FAIL lines)',
    cmd: 'vitest',
    args: ['run'],
    input: VITEST_PASS,
    assert: (out) => {
      expect(out).toBe('Vitest: 16 passed')
      expect(out).not.toContain('FAIL')
    },
  },
  {
    name: 'vitest - no pass/fail counts passes through untouched (no false summary)',
    cmd: 'vitest',
    args: ['run'],
    input: VITEST_NO_TESTS,
    assert: (out) => {
      expect(out).not.toMatch(/^Vitest: /)
      expect(out).toContain('No test files found')
    },
  },
  // ── jest ──────────────────────────────────────────────────────────────────
  {
    name: 'jest - summarizes tests + failing suite count and lists failures, drops stack traces',
    cmd: 'jest',
    args: ['--ci'],
    input: JEST_FAIL,
    assert: (out) => {
      expect(out).toMatch(/^Jest: /)
      expect(out).toContain('18 passed')
      expect(out).toContain('2 failed')
      expect(out).toContain('1 suite(s)')
      expect(out).toContain('FAIL: API › fetchUser › returns user data')
      expect(out).toContain('FAIL: API › fetchUser › handles error response')
      // noise removed
      expect(out).not.toContain('Expected: 200')
      expect(out).not.toContain('at Object.<anonymous>')
      expect(out).not.toContain('Time:')
    },
  },
  {
    name: 'jest - all green collapses to a single passing summary line',
    cmd: 'jest',
    args: ['--ci'],
    input: JEST_PASS,
    assert: (out) => {
      expect(out).toBe('Jest: 25 passed')
      expect(out).not.toContain('FAIL')
      expect(out).not.toContain('suite(s)')
    },
  },
  // ── playwright ────────────────────────────────────────────────────────────
  {
    name: 'playwright - summarizes passed/failed/flaky/skipped with duration, lists failing specs',
    cmd: 'playwright',
    args: ['test'],
    input: PW_FAIL,
    assert: (out) => {
      expect(out).toMatch(/^Playwright: /)
      expect(out).toContain('25 passed')
      expect(out).toContain('2 failed')
      expect(out).toContain('1 flaky')
      expect(out).toContain('2 skipped')
      expect(out).toContain('(58.3s)')
      // failing specs surfaced with their browser project
      expect(out).toContain('FAIL:')
      expect(out).toContain('[chromium] › checkout.spec.ts')
      expect(out).toContain('[firefox] › checkout.spec.ts')
      // failure detail noise stripped
      expect(out).not.toContain('Call log:')
      expect(out).not.toContain('toBeVisible')
    },
  },
  {
    name: 'playwright - all passing keeps only the summary + duration',
    cmd: 'playwright',
    args: ['test'],
    input: PW_PASS,
    assert: (out) => {
      expect(out).toBe('Playwright: 18 passed (32.1s)')
      expect(out).not.toContain('FAIL')
    },
  },
  // ── prettier ──────────────────────────────────────────────────────────────
  {
    name: 'prettier - lists files needing formatting with a count header, truncates past 10',
    cmd: 'prettier',
    args: ['--check', '.'],
    input: PRETTIER_DIRTY,
    assert: (out) => {
      expect(out).toMatch(/^Prettier: \d+ file\(s\) need formatting/)
      expect(out).toContain('src/app.ts')
      expect(out).toContain('src/pages/about.tsx')
      // truncation marker present (>10 offending entries)
      expect(out).toMatch(/\.\.\. \+\d+ more/)
      // the "Checking formatting..." preamble is dropped
      expect(out).not.toContain('Checking formatting')
    },
  },
  {
    name: 'prettier - all formatted collapses to a single confirmation line',
    cmd: 'prettier',
    args: ['--check', '.'],
    input: PRETTIER_CLEAN,
    assert: (out) => {
      expect(out).toBe('Prettier: all files formatted')
      expect(out).not.toContain('Checking formatting')
    },
  },
  // ── eslint ────────────────────────────────────────────────────────────────
  {
    name: 'eslint - groups problems by rule with error/warning counts, file count, and top rules',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_PROBLEMS,
    assert: (out) => {
      expect(out).toMatch(/^ESLint: /)
      expect(out).toContain('5 errors')
      expect(out).toContain('3 warnings')
      expect(out).toContain('in 2 file(s)')
      // rules are aggregated with per-rule counts, most frequent first
      expect(out).toContain('Top rules:')
      expect(out).toContain('no-console(2)')
      expect(out).toContain('semi(2)')
      expect(out).toContain('@typescript-eslint/no-explicit-any(1)')
      // per-line messages are dropped
      expect(out).not.toContain('is assigned a value but never used')
      expect(out).not.toContain('Unexpected console statement')
    },
  },
  {
    name: 'eslint - non-lint output (config error) passes through, no false summary',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_CONFIG_MSG,
    assert: (out) => {
      expect(out).not.toMatch(/^ESLint: \d+ error/)
      expect(out).not.toContain('Top rules:')
      // original diagnostic preserved verbatim
      expect(out).toContain('Oops! Something went wrong')
      expect(out).toContain('No files matching the pattern')
    },
  },
  // ── next build ────────────────────────────────────────────────────────────
  {
    name: 'next - successful build collapses to a route list with a count header',
    cmd: 'next',
    args: ['build'],
    input: NEXT_BUILD,
    assert: (out) => {
      expect(out).toMatch(/^Next\.js build: 6 routes/)
      expect(out).toContain('/about')
      expect(out).toContain('/blog/[slug]')
      expect(out).toContain('/api/users')
      // build-log chatter is stripped
      expect(out).not.toContain('Compiled successfully')
      expect(out).not.toContain('First Load JS')
      expect(out).not.toContain('Generating static pages')
    },
  },
  {
    name: 'next - failed build passes through untouched so the error stays visible',
    cmd: 'next',
    args: ['build'],
    input: NEXT_FAIL,
    assert: (out) => {
      expect(out).not.toMatch(/^Next\.js build:/)
      expect(out).toContain('Failed to compile')
      expect(out).toContain('Type error')
    },
  },
  // ── edge: empty output ──────────────────────────────────────────────────────
  {
    name: 'empty output - returns empty string without crashing',
    cmd: 'vitest',
    args: ['run'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

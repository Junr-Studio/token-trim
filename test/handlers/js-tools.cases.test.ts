import { describe, it, expect } from 'vitest'
import { describeCompression, linkHandlerFunction } from '../support/harness.js'
import { JS_TOOLS_HANDLER } from '../../src/handlers/js-tools.js'

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

// A run with retries on. The list reporter prints the FIRST attempt of a flaky
// test with ✘ and its successful retry as a separate "(retry #1)" row, then
// names it under "1 flaky" in the tally. Two tests are broken here; the third ✘
// is not.
// "Running N tests" counts DISTINCT tests, not printed rows - the retry row
// below is the same test as the one above it, so five tests produce six rows.
// And playwright's tally classifies each test exactly once: a test that failed
// then passed on retry is counted under `flaky` and NOT under `passed`.
// An earlier version of this fixture said "Running 6 tests" / "3 passed", a
// tally playwright cannot print, which meant the case pinned a summary line
// that does not exist rather than the one the condenser will really meet.
const PW_FLAKY = `Running 5 tests using 3 workers

  ✓  1 [chromium] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (1.9s)
  ✘  2 [chromium] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code (30.4s)
  ✘  3 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (5.1s)
  ✓  4 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (retry #1) (2.9s)
  ✓  5 [firefox] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (2.4s)
  ✘  6 [firefox] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code (30.6s)

  2 failed
    [chromium] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code
    [firefox] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code
  1 flaky
    [chromium] › tests/search.spec.ts:18:5 › search › paginates results
  2 passed (48.2s)
`

// Nothing failed: one test wobbled and its retry passed. Playwright prints no
// "failed" line at all in this run.
// Three distinct tests over four rows, and the flaky one is counted under
// `flaky` only - so the tally is "2 passed", never "3 passed".
const PW_FLAKY_GREEN = `Running 3 tests using 2 workers

  ✓  1 [chromium] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (1.2s)
  ✘  2 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (5.1s)
  ✓  3 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (retry #1) (2.4s)
  ✓  4 [chromium] › tests/cart.spec.ts:8:5 › cart › adds an item (1.1s)

  1 flaky
    [chromium] › tests/search.spec.ts:18:5 › search › paginates results
  2 passed (5.0s)
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

// `prettier --write` prints one row per file it PROCESSED - a duration for the
// ones it rewrote, and a "(unchanged)" suffix for the ones it left alone. Every
// row here says a file HAS been formatted, which is the opposite of "needs
// formatting"; and the unchanged rows are part of the tally, not noise to drop.
const PRETTIER_WRITE = `src/a.ts 21ms
src/b.ts 14ms (unchanged)
src/c.ts 9ms
src/d.ts 7ms (unchanged)
`

// `prettier -l` / `--list-different` prints a bare newline-separated path list.
// Its documented purpose is CI and `| xargs prettier --write`, so a header line
// and a two-space indent break the consumer - and on a list this short they make
// the output LARGER than the input.
const PRETTIER_LIST = `src/app.ts
src/components/Button.tsx
src/components/Modal.tsx
src/hooks/useAuth.ts
src/lib/api.ts
src/lib/format.ts
src/pages/index.tsx
src/utils/date.ts
`

// prettier 3.x closes --check with its own tally sentence. It is a statement
// ABOUT the list, not a member of it.
const PRETTIER_THREE = `Checking formatting...
[warn] src/lib/date.ts
[warn] src/lib/money.ts
[warn] src/routes/cart.ts
[warn] Code style issues found in 3 files. Run Prettier with --write to fix.
`

// A `--write` run with a diagnostic line in the same stream. Every timed row is
// a file prettier HAS just reformatted; the `[error]` line is a fact about one
// file it could not parse. The write branch was gated on "EVERY line is a timed
// row", so this one diagnostic took the run out of write mode entirely and the
// thirteen files that had just been rewritten came back labelled
// "need formatting" - with their `21ms` suffix still attached.
// Sized so the inversion is visible at the compress() seam: below ~14 rows the
// bogus rollup is longer than the input and the frame's no-growth guard hands
// the raw output back, hiding it.
const PRETTIER_WRITE_WITH_DIAGNOSTIC = `src/components/Button.tsx 21ms
src/components/Modal.tsx 17ms
src/components/Header.tsx 12ms (unchanged)
src/components/Sidebar.tsx 19ms
src/hooks/useAuth.ts 8ms
src/hooks/useFetch.ts 6ms (unchanged)
src/lib/api.ts 11ms
src/lib/format.ts 9ms
src/pages/index.tsx 24ms
src/pages/about.tsx 13ms
src/pages/contact.tsx 10ms
src/utils/date.ts 7ms
src/utils/string.ts 5ms (unchanged)
[error] src/generated/schema.ts: SyntaxError: Unexpected token (3:1)
`

// prettier 2.x worded the same sentence without a count.
const PRETTIER_V2 = `Checking formatting...
[warn] src/lib/date.ts
[warn] src/routes/cart.ts
[warn] Code style issues found in the above file(s). Forgot to run Prettier?
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

// The SAME stylish report, with the file headers written the way eslint writes
// them on win32: a drive letter and backslashes. `String.raw` because in a plain
// template literal `\U` and `\a` are swallowed as escape sequences, so the
// fixture would silently stop being a Windows path at all.
const ESLINT_PROBLEMS_WIN = String.raw`C:\Users\dev\shop\src\app.ts
   5:1   error    'foo' is assigned a value but never used   no-unused-vars
  12:7   warning  Unexpected console statement                no-console
  18:3   error    Missing semicolon                           semi
  23:10  error    'bar' is not defined                        no-undef

C:\Users\dev\shop\src\api.ts
   3:5   warning  Unexpected any. Specify a different type    @typescript-eslint/no-explicit-any
   9:1   error    Missing semicolon                           semi
  14:20  warning  Unexpected console statement                no-console
  20:15  error    Strings must use singlequote                quotes

✖ 8 problems (5 errors, 3 warnings)
`

// The same stylish report over a Vue project. eslint-plugin-vue,
// svelte-eslint-parser and typescript-eslint on `.mts`/`.cts` are mainstream, and
// the formatter prints exactly the same shape for them - only the extension in
// the header differs. An extension allowlist in the header pattern therefore
// matched nothing here, so `fileSet` stayed empty and the rollup asserted
// "in 0 file(s)" beside a live error count.
const ESLINT_VUE = `/repo/src/components/Header.vue
  12:5  error    Unexpected console statement  no-console
  20:1  warning  Missing return type           @typescript-eslint/explicit-function-return-type

/repo/src/components/Footer.mts
  3:9  error  'x' is assigned a value but never used  no-unused-vars

✖ 3 problems (2 errors, 1 warning)
`

// The characters a real project path is allowed to hold. A Windows profile
// directory contains a space, its 8.3 alias a `~`, a monorepo workspace an
// `@scope` - none of which are in `\w`. `String.raw` so the backslashes survive.
const ESLINT_ODD_PATHS = String.raw`C:\Users\Boris Bembinoff\repo\src\app.ts
   5:1   error    'foo' is assigned a value but never used   no-unused-vars
  12:7   warning  Unexpected console statement                no-console

C:\Users\BORISB~1\repo\@shop\api.ts
   9:1   error    Missing semicolon                           semi

✖ 3 problems (2 errors, 1 warning)
`

// One `.ts` file and one `.vue` file. This is the shape that reads as truthful
// and is not: an allowlist that accepts only the `.ts` header undercounts to
// "in 1 file(s)" rather than zeroing, so nothing looks wrong.
const ESLINT_MIXED_EXT = `/repo/src/app.ts
  5:1  error  Missing semicolon  semi

/repo/src/components/Card.vue
  9:3  error  Unexpected console statement  no-console

✖ 2 problems (2 errors, 0 warnings)
`

// A lint target with NO extension. `bin/cli`, `scripts/deploy` - a shebang
// script with no suffix, matched by a flat-config `files: ['bin/*']` glob or by
// `--ext`. The header pattern demanded a trailing `.ext`, so none of these was
// ever recognised: `fileSet` stayed empty and the rollup asserted "in 0 file(s)"
// beside a live error count, the same fabricated zero every extension sweep
// before it had closed one shape at a time.
const ESLINT_EXTENSIONLESS = `/repo/bin/release-notes
   3:1   error    Unexpected console statement                no-console
  11:14  error    'args' is not defined                       no-undef
  27:9   warning  Missing return type on function             @typescript-eslint/explicit-function-return-type

/repo/scripts/deploy
   8:5   error    Unexpected console statement                no-console
  19:3   error    Strings must use singlequote                quotes

✖ 5 problems (4 errors, 1 warning)
`

// The quiet half of the same defect, on win32: one header carries an extension
// and one does not, so the count is merely WRONG rather than zero - which reads
// as truthful. `String.raw` so the backslashes survive.
const ESLINT_EXTENSIONLESS_MIXED = String.raw`C:\repo\src\app.ts
  5:1  error  Missing semicolon  semi

C:\repo\bin\cli
  3:1  error  Unexpected console statement  no-console

✖ 2 problems (2 errors, 0 warnings)
`

// eslint prints `<text>` as the file path when it lints stdin without a
// `--stdin-filename`. That is not a path in any shape this function can read -
// no extension, no separator - and it is the case that proves the point: the
// answer to "I cannot tell which file this was" is the report itself, never a
// count of zero files.
const ESLINT_STDIN = `<text>
  1:5   error    Unexpected console statement    no-console
  4:12  warning  Unexpected any                  @typescript-eslint/no-explicit-any
  9:3   error    Strings must use singlequote    quotes

✖ 3 problems (2 errors, 1 warning)
`

// A parse error is a diagnostic with no rule id, because eslint never got as far
// as running a rule. It is also the whole payload: there is nothing else in the
// report to act on.
const ESLINT_PARSE_ERROR = `/repo/src/broken.ts
  1:1  error  Parsing error: Unexpected token }

✖ 1 problem (1 error, 0 warnings)
`

const ESLINT_CONFIG_MSG = `Oops! Something went wrong! :(

ESLint: 8.56.0

No files matching the pattern "src/**/*.vue" were found.
Please check for typing mistakes in the pattern.
`

// ── next build ──────────────────────────────────────────────────────────────
// FIXTURE CORRECTED: this used to indent each route row with two spaces
// ("  ○ /"), a shape no released Next.js prints. Next has drawn the route table
// with box-drawing connectors at column 0 (┌ ├ └) since ~9.3, which is why the
// condenser's route regex - it required leading whitespace - never matched a
// real build and the case passed only against the invented shape. The rest of
// the sample (the ✓ progress lines, the shared-chunk rows under
// "+ First Load JS shared by all", the legend) is what 14.1.0 really prints.
const NEXT_BUILD = `   ▲ Next.js 14.1.0

   Creating an optimized production build ...
 ✓ Compiled successfully
 ✓ Linting and checking validity of types
 ✓ Collecting page data
 ✓ Generating static pages (8/8)
 ✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    5.2 kB          89 kB
├ ○ /about                               1.1 kB          85 kB
├ ● /blog/[slug]                         2.3 kB          87 kB
├ λ /api/users                           0 B                0 B
├ ○ /dashboard                           8.7 kB          95 kB
└ ○ /settings                            3.1 kB          88 kB
+ First Load JS shared by all            84.3 kB
  ├ chunks/23-b5b2c0d1.js                29.1 kB
  ├ chunks/main-app-9c8d7e6f.js          53.1 kB
  └ other shared chunks (total)           2.1 kB

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML
λ  (Server)   server-side renders at runtime
`

// Next 15: same connectors, but dynamic routes are marked `ƒ` (the marker
// changed from λ in 14.2) and prerendered params are listed as marker-less
// child rows under their ● parent.
const NEXT15_BUILD = `   ▲ Next.js 15.0.3

   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...
   Collecting page data ...
   Generating static pages (11/11)
   Finalizing page optimization ...

Route (app)                                 Size  First Load JS
┌ ○ /                                    5.21 kB         112 kB
├ ○ /_not-found                            142 B        87.3 kB
├ ƒ /api/checkout                            0 B           0 B
├ ƒ /api/webhooks/stripe                     0 B           0 B
├ ● /blog/[slug]                          2.31 kB         104 kB
├   ├ /blog/hello-world
├   ├ /blog/shipping-faster
├   └ /blog/why-we-moved
├ ○ /cart                                 3.94 kB         108 kB
├ ƒ /checkout                             6.12 kB         119 kB
├ ○ /products                             4.03 kB         109 kB
├ ● /products/[id]                        3.11 kB         107 kB
├   ├ /products/aeron-chair
├   └ /products/standing-desk
├ ○ /search                               2.88 kB         102 kB
└ ○ /settings                             3.10 kB         103 kB
+ First Load JS shared by all             87.2 kB
  ├ chunks/23-9f2b1c4d.js                 31.5 kB
  ├ chunks/main-app-7a3e8b2c.js           53.6 kB
  └ other shared chunks (total)            2.1 kB

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
`

// A route table in a shape the condenser has never seen. The point is what it
// must NOT do: claim a count.
const NEXT_UNKNOWN_TABLE = `   ▲ Next.js 99.1.0

   Creating an optimized production build ...
 ✓ Compiled successfully

Route (app)                              Size     First Load JS
▸ static   /                             5.2 kB          89 kB
▸ static   /about                        1.1 kB          85 kB
▸ dynamic  /api/users                    0 B                0 B

Build completed in 21.4s
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
    // CHANGED DELIBERATELY: the assertion used to be dropped along with the
    // timing and transform noise. Naming the failing test without saying how it
    // failed forces a `--full` re-run to learn anything, which costs the entire
    // raw output on top of the wasted call - far more than the four lines kept
    // here. The echoed source and caret art are still dropped: the agent can
    // open the file.
    name: 'vitest - rolls up the counts and keeps the assertion, not just the test name',
    cmd: 'vitest',
    args: ['run'],
    input: VITEST_FAIL,
    assert: (out, input) => {
      expect(out).toMatch(/^Vitest: /)
      expect(out).toContain('18 passed')
      expect(out).toContain('2 failed')
      expect(out).toContain('FAIL:')
      expect(out).toContain('fetchUser returns user data')
      expect(out).toContain('fetchUser handles 404 response')
      // the diagnosis survives
      expect(out).toContain('AssertionError')
      // ...but the run chrome does not
      expect(out).not.toContain('Duration')
      expect(out).not.toContain('transform 45ms')
      // each failure is listed once, not once per vitest reporter section
      expect((out.match(/FAIL:/g) ?? [])).toHaveLength(2)
      expect(out.length).toBeLessThan(input.length / 2)
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
    // CHANGED DELIBERATELY, same reasoning as the vitest case above.
    name: 'jest - rolls up the counts and keeps the expected/received pair',
    cmd: 'jest',
    args: ['--ci'],
    input: JEST_FAIL,
    assert: (out, input) => {
      expect(out).toMatch(/^Jest: /)
      expect(out).toContain('18 passed')
      expect(out).toContain('2 failed')
      expect(out).toContain('1 suite(s)')
      expect(out).toContain('FAIL: API › fetchUser › returns user data')
      expect(out).toContain('FAIL: API › fetchUser › handles error response')
      // the diagnosis survives
      expect(out).toContain('Expected: 200')
      expect(out).toContain('Received: 404')
      expect(out).toContain('TypeError: Cannot read properties of undefined')
      // the run chrome does not. This fixture is almost entirely diagnosis, so
      // the win here is modest by construction - the ratio shows up on real
      // runs, where the failure block is a handful of lines inside tens of KB
      // of passing-suite output.
      expect(out).not.toContain('Time:')
      expect(out).not.toContain('Ran all test suites')
      expect(out).not.toContain('Snapshots:')
      expect(out.length).toBeLessThan(input.length)
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
    // A test that fails its first attempt and passes on a retry is FLAKY, not
    // failed - playwright says so itself, twice: with the "(retry #1)" pass row
    // and with the "1 flaky" section of the tally. Listing its first attempt as
    // a FAIL made the rollup contradict its own header ("2 failed" over three
    // FAIL lines) and sent the agent to debug a test that is passing.
    name: 'playwright - a test that passed on retry is flaky, not a third failure',
    cmd: 'playwright',
    args: ['test'],
    input: PW_FLAKY,
    assert: (out) => {
      // The tally is relayed verbatim, so these are playwright's own numbers:
      // five distinct tests, the flaky one counted under `flaky` and not under
      // `passed`.
      expect(out).toContain('2 passed')
      expect(out).toContain('2 failed')
      expect(out).toContain('1 flaky')
      // the header and the body agree: exactly as many FAIL lines as failures
      expect(out.match(/FAIL:/g) ?? []).toHaveLength(2)
      expect(out).toContain('[chromium] › tests/checkout.spec.ts')
      expect(out).toContain('[firefox] › tests/checkout.spec.ts')
      // the flaky one is not among them
      expect(out).not.toContain('paginates results')
    },
  },
  {
    name: 'playwright - a green run with one flaky test reports no failure at all',
    cmd: 'playwright',
    args: ['test'],
    input: PW_FLAKY_GREEN,
    assert: (out) => {
      expect(out).toBe('Playwright: 2 passed, 1 flaky (5.0s)')
      expect(out).not.toContain('FAIL')
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
      // TIGHTENED: `\d+` accepted the fabricated 13 this fixture used to
      // produce (12 files + prettier's own closing sentence).
      expect(out).toMatch(/^Prettier: 12 file\(s\) need formatting/)
      expect(out).toContain('src/app.ts')
      expect(out).toContain('src/pages/about.tsx')
      // truncation marker present (>10 offending entries)
      expect(out).toMatch(/\.\.\. \+\d+ more/)
      // the "Checking formatting..." preamble is dropped
      expect(out).not.toContain('Checking formatting')
    },
  },
  {
    // The count in the header is a claim about the input, so it has to be the
    // real one. prettier's closing sentence was being counted as a file and
    // printed where a path belongs, so a 3-file check reported 4.
    name: "prettier - its own summary sentence is not one of the files it names",
    cmd: 'prettier',
    args: ['--check', '.'],
    input: PRETTIER_THREE,
    assert: (out) => {
      expect(out).toMatch(/^Prettier: 3 file\(s\) need formatting/)
      expect(out).toContain('src/lib/date.ts')
      expect(out).toContain('src/lib/money.ts')
      expect(out).toContain('src/routes/cart.ts')
      expect(out).not.toContain('Code style issues found')
      expect(out).not.toContain('--write')
    },
  },
  {
    name: "prettier - the 2.x wording of that sentence is not a file either",
    cmd: 'prettier',
    args: ['--check', '.'],
    input: PRETTIER_V2,
    assert: (out) => {
      expect(out).toMatch(/^Prettier: 2 file\(s\) need formatting/)
      expect(out).not.toContain('Code style issues found')
      expect(out).not.toContain('Forgot to run Prettier')
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
  {
    // `--write` rows report work already DONE. Relabelling them "need
    // formatting" told the agent the opposite of what had just happened, and
    // silently dropping the "(unchanged)" rows meant four processed files were
    // reported as two - a tally that does not add up against the input.
    name: 'prettier --write - reports files it formatted, not files that "need formatting"',
    cmd: 'prettier',
    args: ['--write', 'src'],
    input: PRETTIER_WRITE,
    assert: (out) => {
      expect(out).not.toContain('need formatting')
      expect(out).toMatch(/^Prettier: 2 file\(s\) formatted, 2 unchanged/)
      // the files it rewrote are named
      expect(out).toContain('src/a.ts')
      expect(out).toContain('src/c.ts')
    },
  },
  {
    // One `[error]` line in the stream flipped the whole invocation out of write
    // mode, and thirteen files prettier had just rewritten came back as, byte
    // for byte:
    //   Prettier: 11 file(s) need formatting
    //     src/components/Button.tsx 21ms
    //     ...
    // - the exact opposite of what the command did, with the duration suffix
    // still hanging off each path, the "(unchanged)" rows silently dropped, the
    // diagnostic counted as a twelfth "file", and the diagnostic itself then
    // truncated away by the ten-line cap.
    name: 'prettier --write - a diagnostic line does not flip the mode to "need formatting"',
    cmd: 'prettier',
    args: ['--write', 'src'],
    input: PRETTIER_WRITE_WITH_DIAGNOSTIC,
    assert: (out) => {
      expect(out).not.toContain('need formatting')
      expect(out).toMatch(/^Prettier: 10 file\(s\) formatted, 3 unchanged/)
      // the paths are named without the timing column they were printed with
      expect(out).toContain('src/components/Button.tsx')
      expect(out).not.toMatch(/\d+ms/)
      // and the one line in the run worth reading survives
      expect(out).toContain('[error] src/generated/schema.ts')
    },
  },
  {
    // A bare path list is the shape that gets piped into xargs. There is nothing
    // to condense in it, and anything added to it breaks the pipe, so the only
    // correct answer is the input.
    name: 'prettier -l - a bare path list is handed back untouched (the xargs pipe survives)',
    cmd: 'prettier',
    args: ['-l', 'src'],
    input: PRETTIER_LIST,
    assert: (out, input) => {
      // Compared without the final newline: the frame trims the whole stream
      // before writing it, which is a separate defect of its own and not this
      // condenser's to answer for. Everything this condenser controls - the
      // lines, their order, their exact text - must be the input's.
      expect(out.trimEnd()).toBe(input.trimEnd())
      expect(out).not.toContain('Prettier:')
      expect(out).not.toMatch(/^ {2}\S/m)
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
  {
    // The same report, run on Windows. condenseEslint decides "is this line a
    // file header?" with /^\/?([\w./-]+\.(js|ts|jsx|tsx|mjs|cjs))$/ - a class
    // that has no backslash and no drive colon in it - so on win32 every header
    // fails to match, curFile stays empty, fileSet stays empty and the rollup
    // asserts "in 0 file(s)" for a report that plainly names two files. That is
    // a fabricated zero, and the I2 invariant cannot see it: findsFabricatedZero
    // bails as soon as any other count is non-zero, and the error and warning
    // counts here are 5 and 3. The POSIX fixture above is the one path shape the
    // regex accepts, so the group's headline number was measured on it alone.
    name: 'eslint - counts Windows file headers instead of reporting 0 file(s)',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_PROBLEMS_WIN,
    assert: (out) => {
      expect(out).toMatch(/^ESLint: /)
      expect(out).toContain('5 errors')
      expect(out).toContain('3 warnings')
      // the point of the case: two files offended, so no zero may be claimed
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 2 file(s)')
    },
  },
  {
    // The Windows fix widened the path characters but left the extension
    // allowlist alone, so the same fabricated zero survived for every extension
    // eslint's plugins lint: .vue, .svelte, .astro, .mts, .cts. A file header is
    // a SHAPE - an unindented path line - not a list of extensions.
    name: 'eslint - .vue/.mts headers are counted, not reported as 0 file(s)',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_VUE,
    assert: (out) => {
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 2 file(s)')
      expect(out).toContain('2 errors')
      expect(out).toContain('1 warnings')
    },
  },
  {
    // `\w` has no space, no `~`, no `@` and nothing non-ASCII in it, so a
    // project living under "C:\Users\First Last", an 8.3 alias or an @scope
    // workspace directory produced the same "in 0 file(s)".
    name: 'eslint - paths with spaces, ~ and @scope segments still count as files',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_ODD_PATHS,
    assert: (out) => {
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 2 file(s)')
      expect(out).toContain('2 errors')
    },
  },
  {
    // The quiet variant of the same defect: with one accepted extension and one
    // rejected one the count is merely WRONG, which reads as truthful.
    name: 'eslint - a mixed .ts/.vue run counts both files, not just the .ts one',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_MIXED_EXT,
    assert: (out) => {
      expect(out).toContain('in 2 file(s)')
      expect(out).toContain('2 errors')
    },
  },
  {
    // The last shape the extension allowlist could not see. An eslint run over a
    // `bin/` directory of shebang scripts produced, byte for byte:
    //   ESLint: 1 errors in 0 file(s)
    //     Top rules: no-console(1)
    // - a claim that nothing was linted, over a count of things that were.
    name: 'eslint - an extensionless lint target is counted, not reported as 0 file(s)',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_EXTENSIONLESS,
    assert: (out) => {
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 2 file(s)')
      expect(out).toContain('4 errors')
      expect(out).toContain('1 warnings')
      expect(out).toContain('no-console(2)')
    },
  },
  {
    // The quiet variant, and the one that reads as truthful: with one accepted
    // header and one rejected the rollup said "in 1 file(s)" for two files.
    name: 'eslint - a mixed .ts/extensionless run counts both files, not just the .ts one',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_EXTENSIONLESS_MIXED,
    assert: (out) => {
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 2 file(s)')
      expect(out).toContain('2 errors')
    },
  },
  {
    // Every widening buys one more shape of header and none of them can promise
    // the next one, so the failure mode has to be structural: when not one
    // header was recognised, the count is unknown - and "0" is not a smaller
    // answer than "I could not read it", it is a different and false one.
    name: 'eslint - an unrecognisable file header yields the report, never "0 file(s)"',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_STDIN,
    assert: (out, input) => {
      expect(out).not.toMatch(/\b0 file\(s\)/)
      expect(out).not.toMatch(/^ESLint: /)
      // the report is handed back whole, so nothing actionable is lost
      expect(out.trimEnd()).toBe(input.trimEnd())
      expect(out).toContain('<text>')
      expect(out).toContain('Unexpected console statement')
    },
  },
  {
    // A parse error carries no rule id, so a pattern that REQUIRED a trailing
    // rule token matched nothing: the error was never counted, the file was
    // never counted ("in 0 file(s)"), and the message - the only actionable
    // thing in the report - was deleted. The variant without the trailing "}"
    // was worse: the last word of the message was captured AS a rule id, so the
    // rollup invented "Top rules: token(1)".
    name: 'eslint - a rule-less parse error is counted and its message survives',
    cmd: 'eslint',
    args: ['.'],
    input: ESLINT_PARSE_ERROR,
    assert: (out) => {
      expect(out).not.toMatch(/in 0 file\(s\)/)
      expect(out).toContain('in 1 file(s)')
      expect(out).toContain('1 errors')
      // the payload is the message, so it must not be dropped
      expect(out).toContain('Parsing error: Unexpected token')
      // and no rule id may be invented out of the message's last word
      expect(out).not.toContain('Top rules:')
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
    name: 'next - Next 15 table (box connectors, ƒ dynamic marker) yields the real route count',
    cmd: 'next',
    args: ['build'],
    input: NEXT15_BUILD,
    assert: (out) => {
      expect(out).toMatch(/^Next\.js build: 11 routes/)
      expect(out).toContain('/api/checkout')
      expect(out).toContain('/api/webhooks/stripe')
      expect(out).toContain('/blog/[slug]')
      expect(out).toContain('/products/[id]')
      expect(out).toContain('/settings')
      // the shared-chunk rows carry a connector but no route marker, and the
      // legend carries a marker but no route - neither is a route
      expect(out).not.toContain('chunks/')
      expect(out).not.toContain('(Dynamic)')
      expect(out).not.toContain('First Load JS')
    },
  },
  {
    // The failure this file exists to prevent: a build with routes in it
    // reported as a build with none. When the table cannot be read, the answer
    // is the output itself, not a count of zero.
    name: 'next - an unreadable route table is returned verbatim, never "0 routes"',
    cmd: 'next',
    args: ['build'],
    input: NEXT_UNKNOWN_TABLE,
    assert: (out) => {
      expect(out).not.toMatch(/Next\.js build:/)
      expect(out).not.toMatch(/\broutes\b/)
      expect(out).toContain('/api/users')
      expect(out).toContain('/about')
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

  // ── a failing run: the assertion is the answer, not the test name ─────────
  // Rolling a failure up to "FAIL: <test name>" tells the agent WHICH test
  // broke and nothing about HOW, so it has to re-run with --full to learn
  // anything - paying the raw cost on top of the wasted call.
  {
    name: 'vitest failure - the expected/received values survive the rollup',
    cmd: 'vitest',
    args: ['run'],
    input: ` ❯ test/auth.test.ts (3 tests | 1 failed)
   × rejects an expired token

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.test.ts > auth > rejects an expired token
AssertionError: expected 200 to be 401 // Object.is equality

- Expected
+ Received

- 401
+ 200

 ❯ test/auth.test.ts:42:23
     40|     const res = await request(app).get('/me')
     41|
     42|     expect(res.status).toBe(401)
       |                        ^

 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 27 passed (28)
`,
    assert: (out, input) => {
      expect(out).toContain('rejects an expired token')
      // the diagnosis, which is the reason the agent is reading this
      expect(out).toMatch(/expected 200 to be 401/)
      // and where to look
      expect(out).toContain('test/auth.test.ts:42')
      // still a real compression
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'vitest green run - stays a single summary line, no failure detail to carry',
    cmd: 'vitest',
    args: ['run'],
    input: ' Test Files  5 passed (5)\n      Tests  28 passed (28)\n   Duration  1.42s\n',
    assert: (out) => {
      expect(out).toBe('Vitest: 28 passed')
    },
  },
  {
    name: 'jest failure - the assertion block survives the rollup too',
    cmd: 'jest',
    args: [],
    input: `FAIL  src/cart.test.js
  ● cart › applies the discount

    expect(received).toBe(expected) // Object.is equality

    Expected: 90
    Received: 100

      12 |     const total = applyDiscount(100, 0.1)
    > 13 |     expect(total).toBe(90)
         |                   ^

      at Object.<anonymous> (src/cart.test.js:13:19)

Test Suites: 1 failed, 4 passed, 5 total
Tests:       1 failed, 27 passed, 28 total
`,
    assert: (out, input) => {
      expect(out).toContain('applies the discount')
      expect(out).toMatch(/Expected: 90/)
      expect(out).toMatch(/Received: 100/)
      expect(out.length).toBeLessThan(input.length)
    },
  },
])

// ── the mode is argv's to decide, never the output's ────────────────────────
// A prettier invocation's MODE - rewrite in place, check, list - is fixed on the
// command line before a byte of output exists. Deriving it from stdout instead
// is what let one `[error]` line invert a `--write` run into a `--check` one.
//
// The dispatcher in src/frame.ts calls `condensePrettier(out)` with no argv
// today, so the case above exercises the shape fallback; these link the
// condenser directly - the same mechanism test/arg-rewrite.test.ts uses for the
// pre-spawn predicates - to pin the contract that fallback stands in for. They
// also see the raw condenser output, which at these sizes the frame's no-growth
// guard would otherwise replace with the input and hide.
describe('condensePrettier - argv decides the mode', () => {
  const condensePrettier = linkHandlerFunction<(text: string, args?: string[]) => string>(
    'condensePrettier',
    JS_TOOLS_HANDLER,
  )

  const WRITE_WITH_WARN = `src/a.ts 21ms
[warn] Ignored unknown option --fooo.
src/b.ts 14ms (unchanged)
src/c.ts 9ms
`

  it('a [warn] line does not turn files it just rewrote into files that "need formatting"', () => {
    const out = condensePrettier(WRITE_WITH_WARN, ['--write', 'src'])
    // was: "Prettier: 3 file(s) need formatting\n  src/a.ts 21ms\n
    //       [warn] Ignored unknown option --fooo.\n  src/c.ts 9ms"
    expect(out).not.toContain('need formatting')
    expect(out).toMatch(/^Prettier: 2 file\(s\) formatted, 1 unchanged/)
    expect(out).toContain('src/a.ts')
    expect(out).toContain('src/c.ts')
    // the timing column is chrome and goes; the diagnostic is the payload and stays
    expect(out).not.toMatch(/\d+ms/)
    expect(out).toContain('[warn] Ignored unknown option')
  })

  const WRITE_WITH_ERROR = `src/a.ts 21ms
[error] src/broken.ts: SyntaxError: Unexpected token (3:1)
src/c.ts 9ms
src/d.ts 7ms (unchanged)
`

  it('an [error] line does not either', () => {
    const out = condensePrettier(WRITE_WITH_ERROR, ['--write', 'src'])
    expect(out).not.toContain('need formatting')
    expect(out).toMatch(/^Prettier: 2 file\(s\) formatted, 1 unchanged/)
    expect(out).toContain('[error] src/broken.ts: SyntaxError')
  })

  it('--write output that is nothing but diagnostics is handed back, not relabelled', () => {
    // Nothing was rewritten, so there is no tally to print - and reading these
    // lines as a --check report would relabel them "need formatting", the same
    // inversion through another door.
    const only = '[error] src/broken.ts: SyntaxError: Unexpected token (3:1)\n'
    expect(condensePrettier(only, ['--write', 'src'])).toBe(only)
  })

  it('--check is still read as a check when argv is the only thing that says so', () => {
    const out = condensePrettier('[warn] src/a.ts\n[warn] src/b.ts\n', ['--check', '.'])
    expect(out).toMatch(/^Prettier: 2 file\(s\) need formatting/)
  })

  it('-l keeps its bare path list intact, argv or not', () => {
    const list = 'src/a.ts\nsrc/b.ts\nsrc/c.ts\n'
    expect(condensePrettier(list, ['-l', 'src'])).toBe(list)
    expect(condensePrettier(list)).toBe(list)
  })

  it('the timed-row fallback still stands in when no argv is passed', () => {
    const out = condensePrettier(WRITE_WITH_ERROR)
    expect(out).not.toContain('need formatting')
    expect(out).toMatch(/^Prettier: 2 file\(s\) formatted, 1 unchanged/)
  })
})

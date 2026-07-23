import type { MatrixEntry } from '../support/matrix.js'

/**
 * Coverage matrix - JavaScript / TypeScript toolchain.
 *
 * tsc, eslint, prettier, npm (×2), pnpm, yarn, bun, vitest, jest, playwright,
 * next (×2).
 *
 * Every fixture below is the shape the real tool prints into a pipe (no colour,
 * no TTY progress art - the proxy sets NO_COLOR/TERM=dumb before spawning), and
 * every `minReduction` is a measured figure with a few points of headroom, never
 * an aspiration. Most of the test-runner entries use FAILING runs on purpose: a
 * green run collapses to one line trivially, while the failing run is the shape
 * an agent actually reads.
 *
 * What survives that rollup is NOT uniform across the runners, and the entries
 * say which is which rather than claiming a single virtue for all of them:
 *   - vitest and jest keep the assertion, the expected/received pair and the
 *     source location under each failure - the answer, not just the question;
 *   - bun and eslint keep only the identity of what broke. The bun entry's 92%
 *     and the eslint entry's 90% - the two largest numbers here - are bought by
 *     discarding the diagnosis, so an agent that needs it pays for a second run.
 *     Nothing is invented in either case, but neither is the saving free, and
 *     the per-entry comments record the trade.
 *
 * NOTE: no fixture here other than the tsc one may contain an uppercase
 * `TS<4 digits>:` token - compress() content-sniffs for it and reroutes the text
 * to the TypeScript condenser regardless of which command produced it.
 */

// ── tsc ───────────────────────────────────────────────────────────────────────
// `tsc --noEmit` in a monorepo: the same long path is re-printed on every
// diagnostic, which is exactly what the group-by-file rollup removes. The
// messages themselves are all kept - they are the answer.
const TSC_ERRORS = `packages/web/src/features/checkout/CheckoutSummary.tsx(41,18): error TS2339: Property 'rowCount' does not exist on type 'SummaryProps'.
packages/web/src/features/checkout/CheckoutSummary.tsx(77,5): error TS2739: Type '{ id: string; }' is missing the following properties from type 'LineItem': label, unitPrice
packages/web/src/features/checkout/CheckoutSummary.tsx(103,9): error TS18048: 'order.discount' is possibly 'undefined'.
packages/web/src/features/checkout/CheckoutSummary.tsx(151,24): error TS2769: No overload matches this call.
  Overload 1 of 2, '(props: PriceProps): Element', gave the following error.
    Argument of type 'string' is not assignable to parameter of type 'Cents'.
packages/web/src/features/checkout/useCheckout.ts(19,11): error TS2322: Type 'null' is not assignable to type 'CheckoutState'.
packages/web/src/features/checkout/useCheckout.ts(46,26): error TS2532: Object is possibly 'undefined'.
packages/web/src/features/checkout/useCheckout.ts(88,15): error TS2551: Property 'totalCents' does not exist on type 'CheckoutState'. Did you mean 'totalcents'?
packages/api/src/routes/orders.ts(24,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
packages/api/src/routes/orders.ts(58,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'RequestInit'.
packages/api/src/routes/orders.ts(91,3): error TS7006: Parameter 'ctx' implicitly has an 'any' type.
packages/api/src/routes/orders.ts(117,20): error TS2554: Expected 2 arguments, but got 1.
packages/shared/src/money.ts(12,10): error TS2554: Expected 2 arguments, but got 1.
packages/shared/src/money.ts(33,3): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.

Found 13 errors in 4 files.
`

// ── eslint ────────────────────────────────────────────────────────────────────
// Stylish formatter, four files. The per-problem message text is uniform across
// occurrences of the same rule, so the rule histogram carries it at a fraction
// of the size - which is why this is the biggest win in the group.
const ESLINT_PROBLEMS = `/home/dev/shop/src/routes/cart.ts
   7:8   error    'formatMoney' is defined but never used                     @typescript-eslint/no-unused-vars
  31:5   warning  Unexpected console statement                                no-console
  44:11  error    Unsafe assignment of an \`any\` value                         @typescript-eslint/no-unsafe-assignment
  58:3   error    Missing return type on function                             @typescript-eslint/explicit-function-return-type
  72:19  error    Strings must use singlequote                                quotes

/home/dev/shop/src/routes/checkout.ts
  12:1   error    Missing return type on function                             @typescript-eslint/explicit-function-return-type
  26:14  warning  Unexpected console statement                                no-console
  39:9   error    Unsafe assignment of an \`any\` value                         @typescript-eslint/no-unsafe-assignment
  55:7   error    'req' is defined but never used                             @typescript-eslint/no-unused-vars
  61:22  error    Strings must use singlequote                                quotes
  88:2   error    Missing semicolon                                           semi

/home/dev/shop/src/components/PriceTag.tsx
   3:10  error    'useMemo' is defined but never used                         @typescript-eslint/no-unused-vars
  18:26  warning  Unexpected any. Specify a different type                    @typescript-eslint/no-explicit-any
  22:5   error    Missing return type on function                             @typescript-eslint/explicit-function-return-type

/home/dev/shop/src/lib/analytics.ts
   9:1   warning  Unexpected console statement                                no-console
  14:33  warning  Unexpected any. Specify a different type                    @typescript-eslint/no-explicit-any
  27:12  error    Missing semicolon                                           semi
  41:5   error    Promises must be awaited                                    @typescript-eslint/no-floating-promises

✖ 18 problems (13 errors, 5 warnings)
  6 errors and 0 warnings potentially fixable with the \`--fix\` option.
`

// ── prettier ──────────────────────────────────────────────────────────────────
// `--check` on a repo that has drifted. The offending paths are the answer and
// are kept verbatim; the saving comes from the preamble and from capping the
// list at ten with a count.
const PRETTIER_CHECK = `Checking formatting...
[warn] src/lib/analytics.ts
[warn] src/lib/currency.ts
[warn] src/routes/cart.ts
[warn] src/routes/checkout.ts
[warn] src/routes/search.ts
[warn] src/components/PriceTag.tsx
[warn] src/components/DataTable.tsx
[warn] src/components/CartDrawer.tsx
[warn] src/hooks/useCart.ts
[warn] src/hooks/useCheckout.ts
[warn] src/store/checkout.ts
[warn] src/store/session.ts
[warn] test/cart.test.ts
[warn] test/checkout.test.ts
[warn] Code style issues found in 14 files. Run Prettier with --write to fix.
`

// ── npm install ───────────────────────────────────────────────────────────────
// The deprecation and EBADENGINE warnings are the same every install and are
// never what the agent ran the command to learn; the counts, the funding note
// and the audit summary are.
const NPM_INSTALL = `npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Use lru-cache instead.
npm warn deprecated @humanwhocodes/object-schema@2.0.3: Use @eslint/object-schema instead
npm warn deprecated @humanwhocodes/config-array@0.13.0: Use @eslint/config-array instead
npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
npm warn deprecated eslint@8.57.1: This version is no longer supported. Please see https://eslint.org/version-support for other options.
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'sharp@0.33.5',
npm warn EBADENGINE   required: { node: '^18.17.0 || ^20.3.0 || >=21.0.0' },
npm warn EBADENGINE   current: { node: 'v18.16.0', npm: '9.5.1' }
npm warn EBADENGINE }

added 1187 packages, and audited 1188 packages in 47s

263 packages are looking for funding
  run \`npm fund\` for details

9 vulnerabilities (2 low, 4 moderate, 3 high)

To address issues that do not require attention to breaking changes, run:
  npm audit fix

Some issues need review, and may require choosing
a different dependency.

Run \`npm audit\` for details.
`

// ── npm ls --all ──────────────────────────────────────────────────────────────
// The transitive tree is derivable; the direct dependencies and anything npm
// flagged are not. Both flagged rows here (an `invalid` peer and an
// `UNMET DEPENDENCY`) are hoisted out of the folded depth rather than dropped.
const NPM_LS_ALL = `shop@1.4.0 /home/dev/shop
├─┬ @tanstack/react-query@5.59.16
│ └── @tanstack/query-core@5.59.16
├─┬ eslint@9.14.0
│ ├── @eslint-community/eslint-utils@4.4.1
│ ├── @eslint/js@9.14.0
│ ├─┬ espree@10.3.0
│ │ ├── acorn-jsx@5.3.2
│ │ └── acorn@8.14.0
│ ├── levn@0.4.1
│ └─┬ optionator@0.9.4
│   ├── deep-is@0.1.4
│   └── word-wrap@1.2.5
├─┬ next@15.0.3
│ ├── @next/env@15.0.3
│ ├── @swc/helpers@0.5.13
│ ├── postcss@8.4.31
│ ├── react@18.3.1 invalid: "^19.0.0" from node_modules/next
│ └─┬ styled-jsx@5.1.6
│   └── client-only@0.0.1
├── react@18.3.1
├─┬ react-dom@18.3.1
│ └── scheduler@0.23.2
├─┬ typescript-eslint@8.13.0
│ └── UNMET DEPENDENCY tslib@^2.0.0
├── typescript@5.6.3
├─┬ vitest@2.1.4
│ ├── @vitest/expect@2.1.4
│ ├── @vitest/runner@2.1.4
│ ├── tinypool@1.0.1
│ └── tinyrainbow@1.2.0
└── zod@3.23.8
`

// ── pnpm install ──────────────────────────────────────────────────────────────
// pnpm's resolution counter is rewritten in place on a TTY and printed as
// repeated whole lines into a pipe; the postinstall-script chatter is the same
// on every run. The dependency deltas at the end are what changed.
const PNPM_INSTALL = `Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +904
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 904, reused 898, downloaded 6, added 0, done
node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild: Running postinstall script, done in 412ms
node_modules/.pnpm/sharp@0.33.5/node_modules/sharp: Running install script, done in 1.4s

dependencies:
+ @tanstack/react-query 5.59.16
+ next 15.0.3
+ react 18.3.1
+ react-dom 18.3.1
+ zod 3.23.8

devDependencies:
+ eslint 9.14.0
+ prettier 3.3.3
+ typescript 5.6.3
+ vitest 2.1.4

Done in 6.4s
`

// ── yarn outdated ─────────────────────────────────────────────────────────────
// yarn v1's table: a colour legend nobody can see through a pipe, plus a URL
// column that is a lookup of the package name in the first column.
const YARN_OUTDATED = `yarn outdated v1.22.22
info Color legend :
 "<red>"    : Major Update backward-incompatible updates
 "<yellow>" : Minor Update backward-compatible features
 "<green>"  : Patch Update backward-compatible bug fixes
Package                    Current Wanted Latest Package Type    URL
@tanstack/react-query      5.51.1  5.59.16 5.59.16 dependencies    https://tanstack.com/query
@types/node                20.14.9 20.19.9 22.9.0  devDependencies https://github.com/DefinitelyTyped/DefinitelyTyped#readme
eslint                     8.57.1  8.57.1  9.14.0  devDependencies https://eslint.org
next                       14.2.5  14.2.18 15.0.3  dependencies    https://nextjs.org
prettier                   3.2.5   3.3.3   3.3.3   devDependencies https://prettier.io
react                      18.2.0  18.3.1  18.3.1  dependencies    https://react.dev
react-dom                  18.2.0  18.3.1  18.3.1  dependencies    https://react.dev
typescript                 5.4.5   5.6.3   5.6.3   devDependencies https://www.typescriptlang.org/
vitest                     1.6.0   1.6.1   2.1.4   devDependencies https://github.com/vitest-dev/vitest#readme
zod                        3.22.4  3.23.8  3.23.8  dependencies    https://zod.dev
Done in 2.31s.
`

// ── bun test ──────────────────────────────────────────────────────────────────
// A failing run: one ✗ inside a wall of ✓, plus the echoed source and caret art
// bun prints around the assertion.
const BUN_TEST_FAIL = `bun test v1.1.34 (5e5e7c60)

src/cart.test.ts:
✓ cart > adds an item [1.42ms]
✓ cart > removes an item [0.31ms]
✗ cart > applies a percentage coupon [2.10ms]

  22 |   test("applies a percentage coupon", () => {
  23 |     const cart = makeCart([{ price: 50 }]);
  24 |     expect(cart.total()).toBe(45);
                               ^
error: expect(received).toBe(expected)

Expected: 45
Received: 50

      at applies a percentage coupon (src/cart.test.ts:24:29)
✓ cart > totals with tax [0.22ms]

src/format.test.ts:
✓ format > formats currency [0.18ms]
✓ format > formats a percentage [0.11ms]
✓ format > pads a short code [0.09ms]

src/session.test.ts:
✓ session > creates a token [0.44ms]
✓ session > rejects an expired token [0.27ms]
✓ session > refreshes near expiry [0.35ms]
✓ session > clears on logout [0.14ms]
✓ session > survives a reload [0.19ms]
✓ session > ignores a foreign token [0.21ms]

 12 pass
 1 fail
 14 expect() calls
Ran 13 tests across 3 files. [312.00ms]
`

// ── vitest run ────────────────────────────────────────────────────────────────
// A FAILING run, which is the shape an agent reads. vitest names the failure
// twice (per-file list and detail header) and wraps it in run chrome; the
// assertion, the expected/received pair and the source location survive.
const VITEST_FAIL = ` RUN  v2.1.4 /home/dev/shop

 ✓ src/lib/currency.test.ts (7 tests) 14ms
 ✓ src/store/session.test.ts (11 tests) 22ms
 ❯ src/api/client.test.ts (5 tests | 1 failed) 61ms
   ✓ client > builds a request url 3ms
   ✓ client > sends the auth header 2ms
   × client > retries a 503 twice 24ms
   ✓ client > gives up after the retry budget 6ms
   ✓ client > decodes a json body 4ms
 ✓ src/components/PriceTag.test.tsx (4 tests) 31ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/api/client.test.ts > client > retries a 503 twice
AssertionError: expected 3 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 3

 ❯ src/api/client.test.ts:38:24
     36|     const res = await client.get('/flaky')
     37|
     38|     expect(attempts).toBe(2)
       |                      ^
     39|     expect(res.status).toBe(200)
     40|   })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 26 passed (27)
   Start at  09:14:22
   Duration  1.24s (transform 210ms, setup 0ms, collect 640ms, tests 128ms)
`

// ── jest ──────────────────────────────────────────────────────────────────────
// Also a FAILING run. The PASS banners, the echoed source, the caret art and
// the timing footer go; the expected/received pair stays.
const JEST_FAIL = ` PASS  src/lib/format.test.js
 PASS  src/lib/tax.test.js
 FAIL  src/lib/cart.test.js
  ● cart › applies a percentage coupon

    expect(received).toBe(expected) // Object.is equality

    Expected: 45
    Received: 50

      23 |     const cart = makeCart([{ price: 50 }])
      24 |     cart.applyCoupon('SAVE10')
    > 25 |     expect(cart.total()).toBe(45)
         |                          ^
      26 |   })
      27 | })

      at Object.<anonymous> (src/lib/cart.test.js:25:26)

 PASS  src/lib/session.test.js
 PASS  src/routes/checkout.test.js

Test Suites: 1 failed, 4 passed, 5 total
Tests:       1 failed, 38 passed, 39 total
Snapshots:   0 total
Time:        4.812 s
Ran all test suites.
`

// ── playwright ────────────────────────────────────────────────────────────────
// The list reporter prints one line per test per project, then a full failure
// report per failure, then the tally. The failing spec names plus the tally are
// what an agent acts on.
// 14 ROWS but 13 distinct tests - row 8 is the retry of row 7 - and playwright
// counts each test once: the flaky one lands under `flaky`, never also under
// `passed`. So the tally is 10 passed / 2 failed / 1 flaky, and "Running 13".
const PLAYWRIGHT_FAIL = `Running 13 tests using 4 workers

  ✓  1 [chromium] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (1.9s)
  ✓  2 [chromium] › tests/auth.spec.ts:21:5 › auth › rejects a bad password (1.1s)
  ✓  3 [chromium] › tests/cart.spec.ts:8:5 › cart › adds an item (1.4s)
  ✓  4 [chromium] › tests/cart.spec.ts:19:5 › cart › removes an item (1.2s)
  ✘  5 [chromium] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code (30.4s)
  ✓  6 [chromium] › tests/search.spec.ts:7:5 › search › returns matching products (2.3s)
  ✘  7 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (5.1s)
  ✓  8 [chromium] › tests/search.spec.ts:18:5 › search › paginates results (retry #1) (2.9s)
  ✓  9 [firefox] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (2.4s)
  ✓ 10 [firefox] › tests/cart.spec.ts:8:5 › cart › adds an item (1.8s)
  ✘ 11 [firefox] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code (30.6s)
  ✓ 12 [firefox] › tests/search.spec.ts:7:5 › search › returns matching products (2.7s)
  ✓ 13 [webkit] › tests/auth.spec.ts:9:5 › auth › logs in with valid credentials (2.1s)
  ✓ 14 [webkit] › tests/cart.spec.ts:8:5 › cart › adds an item (1.6s)


  1) [chromium] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code ──────────

    Error: Timed out 5000ms waiting for expect(locator).toHaveText(expected)

    Locator: getByTestId('order-total')
    Expected string: "$45.00"
    Received string: "$50.00"
    Call log:
      - expect.toHaveText with timeout 5000ms
      - waiting for getByTestId('order-total')
      -   locator resolved to <span data-testid="order-total">$50.00</span>
      -   unexpected value "$50.00"

      36 |     await page.getByRole('button', { name: 'Apply' }).click()
    > 37 |     await expect(page.getByTestId('order-total')).toHaveText('$45.00')
         |                                                  ^
      38 |   })

        at tests/checkout.spec.ts:37:50

  2) [firefox] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code ───────────

    Error: Timed out 5000ms waiting for expect(locator).toHaveText(expected)

    Locator: getByTestId('order-total')
    Expected string: "$45.00"
    Received string: "$50.00"

        at tests/checkout.spec.ts:37:50

  2 failed
    [chromium] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code
    [firefox] › tests/checkout.spec.ts:31:5 › checkout › applies a promo code
  1 flaky
    [chromium] › tests/search.spec.ts:18:5 › search › paginates results
  10 passed (1.4m)
`

// ── next build ────────────────────────────────────────────────────────────────
// A successful production build. The route table is the only part an agent
// reads - the progress lines, the per-route byte columns, the shared-chunk
// breakdown and the marker legend are the same on every build. Next prints the
// table with box-drawing connectors at column 0 (┌ ├ └) and marks dynamic
// routes ƒ since 14.2; the marker-less "├   ├ /blog/hello-world" rows are the
// params ● routes were prerendered for, not routes of their own.
const NEXT_BUILD_OK = `   ▲ Next.js 15.0.3

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
├   ├ /products/standing-desk
├   └ /products/wall-shelf
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

// A build that failed type-checking. condenseNext bails out the moment it sees
// "Failed to compile", so the diagnostic and its code frame reach the agent
// byte-for-byte - which is the whole point of reading a broken build.
const NEXT_BUILD_FAIL = `   ▲ Next.js 15.0.3

   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...
Failed to compile.

./src/app/cart/page.tsx:31:24
Type error: Property 'totalCents' does not exist on type 'CheckoutState'. Did you mean 'totalcents'?

  29 |   const state = useCheckout()
  30 |
> 31 |   const total = state.totalCents
     |                        ^
  32 |
  33 |   return <PriceTag cents={total} />
  34 | }

Next.js build worker exited with code: 1 and signal: null
`

export const JS_MATRIX: MatrixEntry[] = [
  {
    cmd: 'tsc',
    args: ['--noEmit', '-p', 'tsconfig.json'],
    what: 'monorepo type-check with 13 diagnostics across 4 files',
    input: TSC_ERRORS,
    // measured 20%
    minReduction: 14,
  },
  {
    cmd: 'eslint',
    args: ['.', '--ext', '.ts,.tsx'],
    what: 'stylish report, 18 problems across 4 files',
    input: ESLINT_PROBLEMS,
    // measured 90%, and the same trade as the bun entry: condenseEslint keeps
    // the counts, the file total and a rule histogram, and drops every
    // file:line:col and every message. It answers "how bad and which rules",
    // not "where" - fixing anything means re-running without the wrapper.
    minReduction: 82,
  },
  {
    cmd: 'prettier',
    args: ['--check', '.'],
    what: 'formatting check with 14 files that need rewriting',
    input: PRETTIER_CHECK,
    // measured 27% - modest by construction: the offending paths are the
    // answer, so nearly everything kept is a path printed verbatim. The header
    // now says 14, the number prettier itself reported; it used to say 15,
    // having counted prettier's closing "Code style issues found in 14 files."
    // sentence as a fifteenth path and printed it among them.
    minReduction: 20,
  },
  {
    cmd: 'npm',
    args: ['install'],
    what: 'fresh install: deprecation + EBADENGINE warnings around the real summary',
    input: NPM_INSTALL,
    // measured 70%
    minReduction: 62,
  },
  {
    cmd: 'npm',
    args: ['ls', '--all'],
    what: 'full dependency tree - direct deps kept, nested folded, flagged rows hoisted',
    input: NPM_LS_ALL,
    // measured 54%
    minReduction: 46,
  },
  {
    cmd: 'pnpm',
    args: ['install'],
    what: 'install with resolution progress and postinstall-script chatter',
    input: PNPM_INSTALL,
    // measured 47%
    minReduction: 40,
  },
  {
    cmd: 'yarn',
    args: ['outdated'],
    what: 'yarn v1 outdated table, 10 packages behind',
    input: YARN_OUTDATED,
    // measured 73%
    minReduction: 65,
  },
  {
    cmd: 'bun',
    args: ['test'],
    what: 'failing run: 13 tests across 3 files, one assertion failure',
    input: BUN_TEST_FAIL,
    // measured 92% - the largest number in this group and the one with the
    // biggest caveat. condenseBunTest keeps the ✗ test names and nothing else,
    // so the diagnosis bun printed under the failure ("error:
    // expect(received).toBe(expected)", "Expected: 45", "Received: 50", "at
    // applies a percentage coupon (src/cart.test.ts:24:29)") is dropped: this
    // output answers WHICH test broke, not HOW. Deletion, not invention - but
    // an agent that needs the assertion re-runs and pays the raw cost, which is
    // the opposite trade from the vitest and jest entries below.
    minReduction: 85,
  },
  {
    cmd: 'vitest',
    args: ['run'],
    what: 'failing run: 27 tests, one failure with its assertion and location',
    input: VITEST_FAIL,
    // measured 78%
    minReduction: 70,
  },
  {
    cmd: 'jest',
    args: ['--ci'],
    what: 'failing run: 39 tests across 5 suites, one expected/received mismatch',
    input: JEST_FAIL,
    // measured 84%
    minReduction: 76,
  },
  {
    cmd: 'playwright',
    args: ['test'],
    what: 'failing run: 13 tests across 3 browsers, 2 failed and 1 flaky (14 rows - one is a retry)',
    input: PLAYWRIGHT_FAIL,
    // measured 91% (2552 -> 233). Two FAIL lines under a "2 failed" header:
    // the ✘ row for test #7 is the first attempt of the test playwright then
    // reports as flaky, and it used to be listed as a third failure - a rollup
    // that contradicted its own count and sent the agent after a passing test.
    minReduction: 80,
  },
  {
    cmd: 'next',
    args: ['build'],
    what: 'successful production build, 11 app routes plus prerendered params',
    input: NEXT_BUILD_OK,
    // measured 89% (1527 -> 167). What is kept is the 11 route paths and their
    // count; what goes is the byte columns, the shared-chunk breakdown, the
    // progress lines and the legend. This entry exists because the condenser
    // was shipped dead - its route regex required leading whitespace before the
    // marker, which no released Next prints - and nothing in the matrix
    // exercised it, so it answered "0 routes" for every real build.
    minReduction: 80,
  },
  {
    cmd: 'next',
    args: ['build'],
    what: 'production build that failed type-checking - passed through untouched',
    input: NEXT_BUILD_FAIL,
    minReduction: 0,
    passthroughReason:
      'a build that failed is deliberately returned verbatim: the type error, ' +
      'the file:line:col and the code frame under it are the entire reason the ' +
      'agent is reading the build log, and reshaping them would cost it the fix. ' +
      'Measured 1% (trailing-whitespace normalisation only). This is a choice, ' +
      'not a condenser that cannot read its input - the entry above measures ' +
      'the same condenser doing the work on a build that succeeded.',
  },
]

import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `cargo` handler.
//
// Two condensers live behind the `cargo` dispatch:
//   - condenseCargo      - build / check / clippy: strips compilation-noise
//                          status lines (Compiling/Downloading/Updating/…),
//                          keeps errors + warnings verbatim.
//   - condenseCargoTest  - `cargo test`: parses the `test result:` line and
//                          renders a one-line summary + up to 5 failures,
//                          each with up to 6 truncated (≤120 char) detail
//                          lines; extra failures collapse to "... +N more".
//
// Each case is pure data: realistic raw cargo output + behavioral assertions.
// The harness runs the real compress(), checks it shrinks, runs the asserts,
// then snapshots the exact byte-for-byte output.

// ── condenseCargo (build / check / clippy) ────────────────────────────────────

// A failed `cargo build`: several Compiling/Updating status lines precede the
// real error. The noise lines must vanish; the diagnostic must survive intact.
const BUILD_ERR = `    Updating crates.io index
   Compiling libc v0.2.147
   Compiling proc-macro2 v1.0.66
   Compiling quote v1.0.33
   Compiling myapp v0.1.0 (/home/user/myapp)
error[E0308]: mismatched types
  --> src/main.rs:4:18
   |
4  |     let x: u32 = "hello";
   |            ---   ^^^^^^^ expected \`u32\`, found \`&str\`
   |            |
   |            expected due to this
   |
error: aborting due to 1 previous error

For more information about this error, try \`rustc --explain E0308\`.
`

// `cargo check` that only produces a warning. Blocking + Compiling are noise;
// the warning body and the (non-noise) Finished line stay.
const CHECK_WARN = `    Blocking waiting for file lock on package cache
   Compiling myapp v0.1.0 (/home/user/myapp)
warning: unused variable: \`y\`
 --> src/main.rs:3:9
  |
3 |     let y = 42;
  |         ^ help: if this is intentional, prefix it with an underscore: \`_y\`
  |
  = note: \`#[warn(unused_variables)]\` on by default

warning: \`myapp\` (bin "myapp") generated 1 warning
    Finished dev [unoptimized + debuginfo] target(s) in 0.52s
`

// `cargo clippy`: Updating/Compiling get stripped, but note that "Checking"
// is deliberately NOT in the noise set - locking that boundary.
const CLIPPY_WARN = `    Updating crates.io index
   Compiling libc v0.2.147
   Compiling serde v1.0.183
    Checking myapp v0.1.0 (/home/user/myapp)
warning: this expression creates a reference which is immediately dereferenced by the compiler
 --> src/main.rs:7:18
  |
7 |     do_something(&*value);
  |                  ^^^^^^^ help: change this to: \`value\`
  |
  = note: \`#[warn(clippy::needless_borrow)]\` on by default
  = help: for further information visit https://rust-lang.github.io/rust-clippy/master/index.html#needless_borrow

warning: \`myapp\` (bin "myapp") generated 1 warning
    Finished dev [unoptimized + debuginfo] target(s) in 0.30s
`

// A clean, successful build: pure Compiling noise + the Finished line. The
// two Compiling lines evaporate, leaving only the (kept) Finished summary.
const BUILD_OK = `   Compiling libc v0.2.147
   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished dev [unoptimized + debuginfo] target(s) in 2.14s
`

// ── condenseCargoTest (cargo test) ────────────────────────────────────────────

// One failing test with a long panic + backtrace. Exercises the 6-detail-line
// cap: the note/backtrace tail past line 6 is dropped, and the trailing
// second "failures:" name list is sliced away.
const TEST_FAIL = `   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished test [unoptimized + debuginfo] target(s) in 0.94s
     Running unittests src/lib.rs (target/debug/deps/myapp-1a2b3c4d5e6f)

running 3 tests
test tests::test_addition ... ok
test tests::test_parser ... FAILED
test tests::test_format ... ok

failures:

---- tests::test_parser stdout ----
thread 'tests::test_parser' panicked at src/parser.rs:128:13:
assertion \`left == right\` failed
  left: Token { kind: Ident, value: "foo", span: 12..15 }
 right: Token { kind: Keyword, value: "fn", span: 12..14 }
stack backtrace:
   0: rust_begin_unwind
   1: core::panicking::panic_fmt
   2: myapp::parser::tests::test_parser
note: Some details are omitted, run with \`RUST_BACKTRACE=full\` for a verbose backtrace

failures:
    tests::test_parser

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`

// Seven failing tests. Only the first 5 render; the rest collapse to
// "... +2 more". Each failure keeps its short two-line panic.
const TEST_MANY = `   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished test [unoptimized + debuginfo] target(s) in 2.31s
     Running unittests src/lib.rs (target/debug/deps/myapp-abcdef123456)

running 7 tests
test suite::case_01 ... FAILED
test suite::case_02 ... FAILED
test suite::case_03 ... FAILED
test suite::case_04 ... FAILED
test suite::case_05 ... FAILED
test suite::case_06 ... FAILED
test suite::case_07 ... FAILED

failures:

---- suite::case_01 stdout ----
thread 'suite::case_01' panicked at src/lib.rs:10:5:
assertion failed: result.is_ok()

---- suite::case_02 stdout ----
thread 'suite::case_02' panicked at src/lib.rs:20:5:
assertion failed: result.is_ok()

---- suite::case_03 stdout ----
thread 'suite::case_03' panicked at src/lib.rs:30:5:
assertion failed: result.is_ok()

---- suite::case_04 stdout ----
thread 'suite::case_04' panicked at src/lib.rs:40:5:
assertion failed: result.is_ok()

---- suite::case_05 stdout ----
thread 'suite::case_05' panicked at src/lib.rs:50:5:
assertion failed: result.is_ok()

---- suite::case_06 stdout ----
thread 'suite::case_06' panicked at src/lib.rs:60:5:
assertion failed: result.is_ok()

---- suite::case_07 stdout ----
thread 'suite::case_07' panicked at src/lib.rs:70:5:
assertion failed: result.is_ok()

failures:
    suite::case_01
    suite::case_02
    suite::case_03
    suite::case_04
    suite::case_05
    suite::case_06
    suite::case_07

test result: FAILED. 0 passed; 7 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
`

// The clean / zero-failure path: a big all-passing run collapses to a single
// summary line.
const TEST_PASS = `   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished test [unoptimized + debuginfo] target(s) in 1.02s
     Running unittests src/lib.rs (target/debug/deps/myapp-5f4e3d2c1b0a)

running 12 tests
test tests::test_a ... ok
test tests::test_b ... ok
test tests::test_c ... ok
test tests::test_d ... ok
test tests::test_e ... ok
test tests::test_f ... ok
test tests::test_g ... ok
test tests::test_h ... ok
test tests::test_i ... ok
test tests::test_j ... ok
test tests::test_k ... ok
test tests::test_l ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`

// A `cargo test` invocation that never reaches the test runner (the crate
// fails to compile): no `test result:` line and no failure blocks, so the
// condenser's guard returns the text untouched - a true passthrough.
const TEST_COMPILE_ERR = `   Compiling myapp v0.1.0 (/home/user/myapp)
error[E0432]: unresolved import \`crate::missing\`
 --> src/lib.rs:1:5
  |
1 | use crate::missing;
  |     ^^^^^^^^^^^^^^^ no \`missing\` in the root

error: could not compile \`myapp\` (lib test) due to 1 previous error
`

// ── audit #48: one `test result:` line PER TEST BINARY ───────────────────────
// A crate with a tests/ directory runs the lib unit binary and each integration
// binary separately, and every one of them prints its own `test result:` line.
// The condenser assigned (rather than accumulated) the counts, so the last
// binary's tally silently replaced every earlier one.
const TEST_TWO_BINARIES = `   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished test [unoptimized + debuginfo] target(s) in 0.94s
     Running unittests src/lib.rs (target/debug/deps/myapp-1a2b3c4d5e6f)

running 12 tests

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/integration.rs (target/debug/deps/integration-9f8e7d6c5b4a)

running 3 tests

failures:

---- api::test_create stdout ----
thread 'api::test_create' panicked at tests/integration.rs:14:5:
assertion \`left == right\` failed
  left: 500
 right: 201

failures:
    api::test_create

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`

// `--no-fail-fast` keeps going after a binary fails, so the FAILING binary can
// come first and a green one last. Assigning the counts then produced a header
// claiming "0 failed" printed directly above a FAIL block, and the second
// binary's chrome leaked into the first binary's failure detail because the
// block was never closed at the binary boundary.
const TEST_NO_FAIL_FAST = `    Finished test [unoptimized + debuginfo] target(s) in 1.10s
     Running unittests src/lib.rs (target/debug/deps/myapp-1a2b3c4d5e6f)

running 2 tests

failures:

---- tests::bad stdout ----
thread 'tests::bad' panicked at src/lib.rs:9:5:
assertion failed: false

failures:
    tests::bad

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/integration.rs (target/debug/deps/integration-9f8e7d6c5b4a)

running 4 tests

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`

// ── audit #5: a `test result:` line inside a CAPTURED-STDOUT block ───────────
// cargo echoes a failing test's own stdout under `---- <name> stdout ----`. A
// test that shells out to `cargo test`, or that asserts on cargo's output,
// therefore prints a `test result:` line INSIDE that block - and that line is
// the CHILD's tally, not this binary's. Accumulating it unconditionally added
// tests that never ran here: the run below has 2 tests and was reported as
// "10 passed".
//
// libtest prints exactly one result line per binary and always LAST, after the
// terminating `failures:` name list. So a result line still inside a captured
// block belongs to whatever the test printed, and must not be counted.
const TEST_NESTED_RESULT = `   Compiling myapp v0.1.0 (/home/user/myapp)
    Finished test [unoptimized + debuginfo] target(s) in 0.94s
     Running unittests src/lib.rs (target/debug/deps/myapp-1a2b3c4d5e6f)

running 2 tests
test harness::runs_cargo ... FAILED
test harness::parses ... ok

failures:

---- harness::runs_cargo stdout ----
thread 'harness::runs_cargo' panicked at tests/harness.rs:31:5:
child cargo reported the wrong tally, stdout was:
running 9 tests
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s

failures:
    harness::runs_cargo

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`

// The same fabrication with two REAL binaries around it, so the audit-48 sum
// (6 + 0) and the audit-5 exclusion (the child's 99) are locked by one case:
// accumulating everything gave "105 passed" for a run of 7 tests.
const TEST_NESTED_TWO_BINARIES = `    Finished test [unoptimized + debuginfo] target(s) in 1.10s
     Running unittests src/lib.rs (target/debug/deps/myapp-1a2b3c4d5e6f)

running 6 tests

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/cli.rs (target/debug/deps/cli-9f8e7d6c5b4a)

running 1 test
test cli::reports_tally ... FAILED

failures:

---- cli::reports_tally stdout ----
thread 'cli::reports_tally' panicked at tests/cli.rs:22:5:
child cargo printed:
test result: ok. 99 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s

failures:
    cli::reports_tally

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
`

const TEST_CUT_MID_BLOCK = `---- tests::bad stdout ----
thread 'tests::bad' panicked at src/lib.rs:9:5:
assertion failed: false

test result: FAILED. 7 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`

describeCompression('cargo', [
  {
    name: 'build - strips Compiling/Updating noise, keeps the E0308 error',
    cmd: 'cargo',
    args: ['build'],
    input: BUILD_ERR,
    assert: (out) => {
      expect(out).not.toMatch(/^\s*Compiling /m)
      expect(out).not.toContain('Updating crates.io index')
      expect(out).toContain('error[E0308]: mismatched types')
      expect(out).toContain('rustc --explain E0308')
    },
  },
  {
    name: 'check - strips Blocking/Compiling noise, keeps the warning + Finished',
    cmd: 'cargo',
    args: ['check'],
    input: CHECK_WARN,
    assert: (out) => {
      expect(out).not.toMatch(/^\s*Compiling /m)
      expect(out).not.toContain('Blocking waiting')
      expect(out).toContain('warning: unused variable')
      // "Finished" is not in the noise set, so it survives.
      expect(out).toContain('Finished dev')
    },
  },
  {
    name: 'clippy - strips Updating/Compiling but preserves the Checking + lint',
    cmd: 'cargo',
    args: ['clippy'],
    input: CLIPPY_WARN,
    assert: (out) => {
      expect(out).not.toMatch(/^\s*Compiling /m)
      expect(out).not.toContain('Updating crates.io index')
      // "Checking" is intentionally NOT noise - locks that boundary.
      expect(out).toContain('Checking myapp')
      expect(out).toContain('clippy::needless_borrow')
    },
  },
  {
    name: 'build (clean) - pure Compiling noise collapses to just the Finished line',
    cmd: 'cargo',
    args: ['build'],
    input: BUILD_OK,
    assert: (out) => {
      expect(out).not.toContain('Compiling')
      expect(out).toBe('Finished dev [unoptimized + debuginfo] target(s) in 2.14s')
    },
  },
  {
    name: 'test (failure) - summary header + FAIL block capped at 6 detail lines',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_FAIL,
    assert: (out) => {
      expect(out).toContain('Cargo test: 2 passed, 1 failed')
      expect(out).toContain('FAIL: tests::test_parser')
      expect(out).toContain('assertion `left == right` failed')
      // Detail lines past the 6-line cap are dropped: the note + deeper
      // backtrace frames must not appear.
      expect(out).not.toContain('RUST_BACKTRACE')
      expect(out).not.toContain('panic_fmt')
      const details = out.split('\n').filter((l) => l.startsWith('    ') && !l.startsWith('  FAIL'))
      expect(details.length).toBeLessThanOrEqual(6)
    },
  },
  {
    name: 'test (many failures) - only 5 render, rest collapse to "... +2 more"',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_MANY,
    assert: (out) => {
      expect(out).toContain('Cargo test: 0 passed, 7 failed')
      expect(out).toContain('... +2 more')
      // The 6th and 7th failures are elided entirely.
      expect(out).not.toContain('case_06')
      expect(out).not.toContain('case_07')
      const failLines = out.split('\n').filter((l) => l.startsWith('  FAIL:'))
      expect(failLines.length).toBe(5)
    },
  },
  {
    name: 'test (all pass) - a 12-test green run collapses to one summary line',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_PASS,
    assert: (out) => {
      expect(out).toBe('Cargo test: 12 passed, 0 failed')
    },
  },
  {
    name: 'test (compile error) - no result line ⇒ passthrough, error preserved',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_COMPILE_ERR,
    assert: (out) => {
      // Guard returns the text untouched - no summary header synthesized.
      expect(out).not.toContain('Cargo test:')
      expect(out).toContain('error[E0432]: unresolved import')
      expect(out).toContain('could not compile')
    },
  },
  {
    name: 'empty output - returns empty, never throws',
    cmd: 'cargo',
    args: ['build'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── rustc diagnostics: 8-14 lines of gutter art per error ─────────────────
  // The caret block is a terminal affordance. Its information - file, line,
  // column, code, message - is entirely contained in the first two lines, and
  // the agent reads the file itself anyway.
  {
    name: 'build - each rustc diagnostic collapses to one file:line:col line, keeping code and message',
    cmd: 'cargo',
    args: ['build'],
    input: `   Compiling myapp v0.1.0 (/home/me/myapp)
error[E0308]: mismatched types
  --> src/lib.rs:42:18
   |
42 |     let n: u32 = compute_total(items);
   |            ---   ^^^^^^^^^^^^^^^^^^^^ expected \`u32\`, found \`i64\`
   |            |
   |            expected due to this
   |
help: you can convert an \`i64\` to a \`u32\` and panic if the converted value doesn't fit
   |
42 |     let n: u32 = compute_total(items).try_into().unwrap();
   |                                      ++++++++++++++++++++

error[E0433]: failed to resolve: use of undeclared crate or module \`serde_json\`
  --> src/parse.rs:7:5
   |
7  |     serde_json::from_str(raw)
   |     ^^^^^^^^^^ use of undeclared crate or module \`serde_json\`

warning: unused variable: \`cfg\`
  --> src/main.rs:15:9
   |
15 |     let cfg = load();
   |         ^^^ help: if this is intentional, prefix it with an underscore: \`_cfg\`
   |
   = note: \`#[warn(unused_variables)]\` on by default

error: aborting due to 2 previous errors; 1 warning emitted
`,
    assert: (out, input) => {
      expect(out).toContain('src/lib.rs:42:18')
      expect(out).toContain('E0308')
      expect(out).toContain('mismatched types')
      expect(out).toContain('src/parse.rs:7:5')
      expect(out).toContain('E0433')
      expect(out).toContain('src/main.rs:15:9')
      // the gutter art is gone
      expect(out).not.toMatch(/^\s*\|/m)
      expect(out).not.toContain('^^^^')
      expect(out).not.toContain('++++')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'build - a clean build keeps its Finished line and stays tiny',
    cmd: 'cargo',
    args: ['build'],
    input: '   Compiling myapp v0.1.0 (/home/me/myapp)\n    Finished dev [unoptimized + debuginfo] target(s) in 3.41s\n',
    assert: (out) => {
      expect(out).toContain('Finished')
      expect(out).not.toContain('Compiling')
    },
  },
  {
    name: 'build - output with no rustc diagnostics is left alone rather than summarised',
    cmd: 'cargo',
    args: ['build'],
    input: 'error: could not find `Cargo.toml` in `/home/me` or any parent directory\n',
    assert: (out) => {
      expect(out).toBe('error: could not find `Cargo.toml` in `/home/me` or any parent directory')
    },
  },
  {
    name: 'build --message-format=json - machine output is not reshaped',
    cmd: 'cargo',
    args: ['build', '--message-format=json'],
    input:
      Array.from({ length: 12 }, (_, i) =>
        JSON.stringify({ reason: 'compiler-message', target: { name: `crate${i}` }, message: { level: 'error' } }),
      ).join('\n') + '\n',
    assert: (out) => {
      for (const line of out.split('\n').filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    },
  },

  // ── audit #48: every `test result:` line counts ───────────────────────────
  {
    name: 'test (lib + integration binaries) - both tallies are summed, not overwritten',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_TWO_BINARIES,
    assert: (out) => {
      // 12 + 2 really ran and passed; reporting only the last binary erased 12.
      expect(out).toContain('Cargo test: 14 passed, 1 failed')
      expect(out).toContain('FAIL: api::test_create')
      expect(out).toContain('assertion `left == right` failed')
    },
  },
  {
    name: 'test --no-fail-fast - a failing first binary is not erased by a green last one',
    cmd: 'cargo',
    args: ['test', '--no-fail-fast'],
    input: TEST_NO_FAIL_FAST,
    assert: (out) => {
      // The header must not contradict the FAIL block printed underneath it.
      expect(out).toContain('Cargo test: 5 passed, 1 failed')
      expect(out).not.toMatch(/\b0 failed/)
      expect(out).toContain('FAIL: tests::bad')
      // The next binary's chrome must not leak into this failure's detail.
      expect(out).not.toContain('Running tests/integration.rs')
      expect(out).not.toContain('running 4 tests')
    },
  },

  // ── audit #5: a captured-stdout `test result:` line is not a binary's ──────
  {
    name: 'test - a `test result:` line inside a failure\'s captured stdout is not counted',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_NESTED_RESULT,
    assert: (out) => {
      // 2 tests ran in this binary: 1 passed, 1 failed. The child's "9 passed"
      // was printed BY the failing test, so it is not part of this tally.
      expect(out).toContain('Cargo test: 1 passed, 1 failed')
      expect(out).not.toContain('10 passed')
      expect(out).toContain('FAIL: harness::runs_cargo')
      // The panic message itself still survives verbatim.
      expect(out).toContain('child cargo reported the wrong tally')
    },
  },
  {
    name: 'test - real per-binary tallies still sum while the captured one is excluded',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_NESTED_TWO_BINARIES,
    assert: (out) => {
      // 6 (lib) + 0 (cli) really passed; the child's 99 never ran here.
      expect(out).toContain('Cargo test: 6 passed, 1 failed')
      expect(out).not.toContain('105')
      expect(out).not.toContain('99')
      expect(out).toContain('FAIL: cli::reports_tally')
    },
  },
  {
    // The rule above - "a `test result:` line inside a captured-stdout block
    // belongs to a CHILD run" - reads a cut stream backwards. `cargo test 2>&1
    // | tail -20` starts in the middle of a block that therefore never closes,
    // and the binary's own result line is inside it. Skipping that one left the
    // header saying "0 passed, 0 failed" directly above a FAIL block: a
    // fabricated zero, contradicting the very block printed under it.
    name: 'test - a run cut mid-block still reports the tally it did receive',
    cmd: 'cargo',
    args: ['test'],
    input: TEST_CUT_MID_BLOCK,
    assert: (out) => {
      expect(out).toContain('Cargo test: 7 passed, 1 failed')
      expect(out).not.toMatch(/\b0 passed, 0 failed\b/)
      expect(out).toContain('FAIL: tests::bad')
      // the panic is still the detail that answers "why"
      expect(out).toContain('assertion failed: false')
    },
  },
])

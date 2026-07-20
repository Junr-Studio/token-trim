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
])

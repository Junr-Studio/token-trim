import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `make` condenser (condenseMake).
// Behavior under test (src/handlers/make.ts):
//   - strips recursive-make chatter: "make[N]: Entering/Leaving directory ..."
//   - strips bare "echo <...>" recipe-echo lines (keeps the text they print)
//   - collapses runs of 3+ newlines down to a single blank line
//   - trims, and guards against emptiness: if EVERYTHING was noise it falls
//     back to the ORIGINAL text (the `|| text` at the end) instead of "".
//
// Each case is realistic raw `make` stdout. The harness asserts the output
// never grows, runs these behavioral asserts, then snapshots exact bytes.

// Recursive build across sub-directories: every recipe command is real work,
// wrapped in make's Entering/Leaving directory bookkeeping we want gone.
const RECURSIVE_BUILD = `make[1]: Entering directory '/home/user/project'
gcc -Wall -Wextra -c -o build/main.o src/main.c
gcc -Wall -Wextra -c -o build/parser.o src/parser.c
make[2]: Entering directory '/home/user/project/lib'
gcc -Wall -Wextra -c -o build/list.o src/list.c
gcc -Wall -Wextra -c -o build/hash.o src/hash.c
ar rcs build/libutil.a build/list.o build/hash.o
make[2]: Leaving directory '/home/user/project/lib'
gcc -Wall -Wextra -o build/myapp build/main.o build/parser.o -Lbuild -lutil
make[1]: Leaving directory '/home/user/project'
`

// Non-silent recipes: make echoes the literal `echo "..."` command line just
// before running it, so stdout carries both the command AND its printed text.
// The condenser drops the redundant command echo, keeps the printed message.
const ECHO_RECIPES = `make[1]: Entering directory '/home/user/webapp'
echo "==> Installing dependencies"
==> Installing dependencies
npm ci --silent
echo "==> Running build"
==> Running build
node build.js
echo "==> Build complete"
==> Build complete
make[1]: Leaving directory '/home/user/webapp'
`

// Spacing-heavy log: blank-line gutters (3, then 4 blank lines) between phases
// that a target inserted with empty `@echo` lines.
const BLANK_RUNS = `make[1]: Entering directory '/home/user/project'
gcc -c -o obj/a.o a.c



gcc -c -o obj/b.o b.c




gcc -o prog obj/a.o obj/b.o
make[1]: Leaving directory '/home/user/project'
`

// Up-to-date rebuild: the only useful line is make's own status message,
// buried between directory-change noise.
const NOTHING_TODO = `make[1]: Entering directory '/home/user/project'
make[1]: Nothing to be done for 'all'.
make[1]: Leaving directory '/home/user/project'
`

// A single top-level make with no recursion and no echo recipes: nothing to
// strip. Compiler diagnostics must survive verbatim.
const PLAIN_BUILD = `gcc -Wall -c -o main.o main.c
main.c: In function 'main':
main.c:12:5: warning: unused variable 'x' [-Wunused-variable]
gcc -Wall -o app main.o
`

// Pathological input that is ENTIRELY directory-change noise - exercises the
// `|| text` empty-guard: after stripping, nothing is left, so the condenser
// must return the original text rather than an empty string.
const ALL_NOISE = `make[1]: Entering directory '/home/user/project'
make[2]: Entering directory '/home/user/project/sub'
make[2]: Leaving directory '/home/user/project/sub'
make[1]: Leaving directory '/home/user/project'
`

describeCompression('make', [
  {
    name: 'recursive build - strips Entering/Leaving directory lines, keeps every recipe command',
    cmd: 'make',
    args: ['all'],
    input: RECURSIVE_BUILD,
    assert: (out, input) => {
      // All four bookkeeping lines removed.
      expect(out).not.toMatch(/Entering directory/)
      expect(out).not.toMatch(/Leaving directory/)
      expect(out).not.toMatch(/^make\[\d+\]:/m)
      // Real build work is preserved verbatim.
      expect(out).toContain('gcc -Wall -Wextra -c -o build/main.o src/main.c')
      expect(out).toContain('ar rcs build/libutil.a build/list.o build/hash.o')
      expect(out).toContain('gcc -Wall -Wextra -o build/myapp build/main.o build/parser.o -Lbuild -lutil')
      // And it genuinely shrank.
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'echo recipes - drops bare "echo ..." command lines, keeps the text they printed',
    cmd: 'make',
    args: ['deploy'],
    input: ECHO_RECIPES,
    assert: (out, input) => {
      // No line begins with the echoed recipe command.
      expect(out).not.toMatch(/^echo /m)
      // Directory chatter gone too.
      expect(out).not.toMatch(/directory/)
      // The messages those echoes produced, and the real commands, survive.
      expect(out).toContain('==> Installing dependencies')
      expect(out).toContain('npm ci --silent')
      expect(out).toContain('node build.js')
      expect(out).toContain('==> Build complete')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'blank runs - collapses 3+ consecutive newlines to a single blank line',
    cmd: 'make',
    args: ['all'],
    input: BLANK_RUNS,
    assert: (out, input) => {
      // No run of 3+ newlines survives (at most one blank line between blocks).
      expect(out).not.toMatch(/\n{3,}/)
      expect(out).not.toMatch(/directory/)
      expect(out).toContain('gcc -c -o obj/a.o a.c')
      expect(out).toContain('gcc -o prog obj/a.o obj/b.o')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'nothing-to-be-done - keeps make’s status line, drops surrounding dir noise',
    cmd: 'make',
    args: ['all'],
    input: NOTHING_TODO,
    assert: (out, input) => {
      expect(out).toContain("Nothing to be done for 'all'.")
      expect(out).not.toMatch(/directory/)
      // 3 lines collapse to just the meaningful one.
      expect(out.split('\n')).toHaveLength(1)
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'passthrough - plain top-level build with no make noise is preserved',
    cmd: 'make',
    args: ['all'],
    input: PLAIN_BUILD,
    assert: (out) => {
      // Nothing matched the noise filter, so all diagnostics stay intact.
      expect(out).toContain("main.c:12:5: warning: unused variable 'x' [-Wunused-variable]")
      expect(out).toContain('gcc -Wall -o app main.o')
      expect(out).not.toMatch(/directory/)
    },
  },
  {
    name: 'empty output - returns empty string unchanged (compress short-circuit)',
    cmd: 'make',
    args: ['all'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
  {
    name: 'all-noise - empty-guard falls back to original text instead of blanking output',
    cmd: 'make',
    args: ['all'],
    input: ALL_NOISE,
    assert: (out, input) => {
      // Stripping leaves nothing, so the `|| text` guard returns the original.
      expect(out.length).toBeGreaterThan(0)
      expect(out).toContain("make[1]: Entering directory '/home/user/project'")
      expect(out).toContain("make[1]: Leaving directory '/home/user/project'")
      // Still never larger than the input (only trailing newline trimmed).
      expect(out.length).toBeLessThanOrEqual(input.length)
    },
  },
])

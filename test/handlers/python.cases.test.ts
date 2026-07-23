import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `python` handler.
// Covers every condenser it dispatches to:
//   pytest → condensePytest
//   go test → condenseGoTest
//   mypy   → condenseMypy   (group by file + top error codes, strip note: lines)
//   ruff   → condenseRuff   (check: group by rule / format: count files)
//   pip    → condensePip    (install: strip download noise / list --outdated: old → new)
// Each fixture is realistic raw tool output; each assert reflects the
// condenser's PURPOSE, and the harness snapshots the exact bytes.

// ── pytest ─────────────────────────────────────────────────────────────────────

// Mixed run: collection error + 2 failures + 5 passes. Exercises the FAILED and
// ERROR line collectors and the passed/failed/error(s) count parsing.
const PYTEST_FAIL = `============================= test session starts ==============================
platform linux -- Python 3.11.4, pytest-7.4.0, pluggy-1.2.0
rootdir: /home/user/project
collected 8 items / 1 error

==================================== ERRORS ====================================
_______________ ERROR collecting tests/test_broken_import.py _______________
ImportError while importing test module 'tests/test_broken_import.py'.
Hint: make sure your test modules/packages have valid Python names.
E   ModuleNotFoundError: No module named 'nonexistent'
=================================== FAILURES ===================================
_________________________________ test_divide __________________________________
    def test_divide():
>       assert divide(10, 0) == 0
E       ZeroDivisionError: division by zero
tests/test_math.py:12: ZeroDivisionError
__________________________________ test_upper __________________________________
    def test_upper():
>       assert "hi".upper() == "hey"
E       AssertionError: assert 'HI' == 'hey'
tests/test_str.py:8: AssertionError
FAILED tests/test_math.py::test_divide - ZeroDivisionError: division by zero
FAILED tests/test_str.py::test_upper - AssertionError: assert 'HI' == 'hey'
ERROR tests/test_broken_import.py - ModuleNotFoundError: No module named 'nonexistent'
==================== 2 failed, 5 passed, 1 error in 0.42s ======================
`

// Green run: only a passed count, no FAILED/ERROR lines.
const PYTEST_PASS = `============================= test session starts ==============================
platform linux -- Python 3.11.4, pytest-7.4.0
rootdir: /home/user/project
collected 42 items

tests/test_math.py ......................                                 [ 52%]
tests/test_str.py ....................                                    [100%]

============================== 42 passed in 1.23s ==============================
`

// ── go test ────────────────────────────────────────────────────────────────────

const GO_FAIL = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- PASS: TestSubtract (0.00s)
=== RUN   TestDivide
    math_test.go:25: expected 2, got 3
--- FAIL: TestDivide (0.00s)
=== RUN   TestModulo
    math_test.go:40: expected 1, got 0
--- FAIL: TestModulo (0.01s)
=== RUN   TestMultiply
--- PASS: TestMultiply (0.00s)
FAIL
exit status 1
FAIL	example.com/mymath	0.012s
`

const GO_PASS = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- PASS: TestSubtract (0.00s)
=== RUN   TestMultiply
--- PASS: TestMultiply (0.00s)
PASS
ok  	example.com/mymath	0.008s
`

// ── mypy ────────────────────────────────────────────────────────────────────────

const MYPY_ERRORS = `src/models.py:10: error: Incompatible return value type (got "int", expected "str")  [return-value]
src/models.py:24: error: Argument 1 to "save" has incompatible type "None"; expected "User"  [arg-type]
src/models.py:31: note: See https://mypy.readthedocs.io/en/stable/_refs.html#code-return-value for more info
src/views.py:5: error: Missing return statement  [return]
src/views.py:12: error: Name "reqeust" is not defined  [name-defined]
src/utils.py:3: error: Function is missing a return type annotation  [no-untyped-def]
Found 5 errors in 3 files (checked 12 source files)
`

const MYPY_CLEAN = `Success: no issues found in 12 source files
`

// ── ruff ────────────────────────────────────────────────────────────────────────

// This is ruff's CONCISE format (`--output-format=concise`), not its default.
// Since 0.14 the default is `full`, which leads with the rule code, puts the
// location on a `-->` line beneath it and quotes the offending source - see
// RUFF_CHECK_FULL below, and test/matrix/python.matrix.ts, which measures that
// shape. Both are real ruff output and both have to keep working; naming which
// is which is what stops the next reader from taking this one for the default.
//
// Backticks in ruff messages are escaped for the surrounding template literal.
const RUFF_CHECK = `src/models.py:10:1: F401 \`os\` imported but unused
src/models.py:12:80: E501 Line too long (95 > 88)
src/views.py:5:1: F811 Redefinition of unused \`login\` from line 1
src/views.py:22:5: E722 Do not use bare \`except\`
src/utils.py:3:1: F401 \`sys\` imported but unused
src/utils.py:8:80: E501 Line too long (102 > 88)
Found 6 errors.
[*] 4 fixable with the \`--fix\` option.
`

// ruff >= 0.14 DEFAULT (`full`): rule code first, location on its own `-->`
// line, the offending source quoted with a caret, then a `help:` suggestion.
// Shape confirmed against ruff 0.14.11.
const RUFF_CHECK_FULL = `F401 [*] \`os\` imported but unused
 --> src/api/routes.py:1:8
  |
1 | import os
  |        ^^
  |
help: Remove unused import: \`os\`

E501 Line too long (95 > 88)
  --> src/api/routes.py:44:89
   |
43 | def list_orders(request):
44 |     return JSONResponse({"orders": [serialize(o) for o in Order.objects.filter(status="open")]})
   |                                                                                         ^^^^^^^
   |

F811 Redefinition of unused \`login\` from line 1
 --> src/api/views.py:5:1
  |
5 | def login(request):
  | ^^^^^^^^^
  |

Found 3 errors.
[*] 1 fixable with the \`--fix\` option.
`

const RUFF_CLEAN = `All checks passed!
`

// Per-file reformatted/unchanged lines - condenser counts matching lines.
const RUFF_FORMAT = `reformatted src/models.py
reformatted src/api/views.py
reformatted src/api/serializers.py
unchanged src/api/__init__.py
unchanged tests/conftest.py
`

// ── pip ─────────────────────────────────────────────────────────────────────────

const PIP_INSTALL = `Looking in indexes: https://pypi.org/simple
Collecting requests
  Downloading requests-2.31.0-py3-none-any.whl (62 kB)
Collecting urllib3<3,>=1.21.1
  Using cached urllib3-2.0.4-py3-none-any.whl (123 kB)
Collecting certifi>=2017.4.17
  Downloading certifi-2023.7.22-py3-none-any.whl (158 kB)
Collecting charset-normalizer<4,>=2
  Downloading charset_normalizer-3.2.0-py3-none-any.whl (199 kB)
Installing collected packages: urllib3, charset-normalizer, certifi, requests
Successfully installed certifi-2023.7.22 charset-normalizer-3.2.0 requests-2.31.0 urllib3-2.0.4
`

const PIP_OUTDATED = `Package            Version   Latest    Type
certifi            2023.7.22 2024.2.2  wheel
pip                23.1.2    24.0      wheel
requests           2.28.0    2.31.0    wheel
setuptools         67.8.0    69.5.1    wheel
urllib3            1.26.15   2.2.1     wheel
`

// No-trigger passthrough: `pip show` hits neither install nor list --outdated.
const PIP_SHOW = `Name: requests
Version: 2.31.0
Summary: Python HTTP for Humans.
Home-page: https://requests.readthedocs.io
Author: Kenneth Reitz
Author-email: me@kennethreitz.org
License: Apache 2.0
Location: /usr/lib/python3.11/site-packages
Requires: certifi, charset-normalizer, idna, urllib3
Required-by:
`

describeCompression('python', [
  // ── pytest ───────────────────────────────────────────────────────────────────
  {
    name: 'pytest - failures: header with passed/failed/error(s) counts + FAIL/ERR list, traceback stripped',
    cmd: 'pytest',
    args: [],
    input: PYTEST_FAIL,
    assert: (out) => {
      // Emits a single summary header with all three counts.
      expect(out.startsWith('Pytest: 5 passed, 2 failed, 1 error(s)')).toBe(true)
      // Keeps the failing node ids…
      expect(out).toContain('FAIL: tests/test_math.py::test_divide')
      expect(out).toContain('FAIL: tests/test_str.py::test_upper')
      // …and the collection error, prefixed ERR:.
      expect(out).toContain('FAIL: ERR:tests/test_broken_import.py')
      // Strips the verbose traceback / banner noise.
      expect(out).not.toContain('ZeroDivisionError')
      expect(out).not.toContain('test session starts')
      expect(out).not.toContain('def test_divide')
      // Real compression.
      expect(out.length).toBeLessThan(PYTEST_FAIL.length / 3)
    },
  },
  {
    name: 'pytest - all green: collapses full session to one "Pytest: N passed" line',
    cmd: 'pytest',
    args: [],
    input: PYTEST_PASS,
    assert: (out) => {
      expect(out).toBe('Pytest: 42 passed')
      expect(out).not.toContain('test session starts')
      expect(out).not.toContain('FAIL')
    },
  },
  {
    name: 'pytest - empty output passes through as empty (edge case)',
    cmd: 'pytest',
    args: [],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── go test ──────────────────────────────────────────────────────────────────
  {
    // CHANGED DELIBERATELY: the assertion line under a failing test used to be
    // stripped along with the `=== RUN` chrome. Naming the test without saying
    // how it failed forces a `--full` re-run, which costs the whole raw output
    // on top of the wasted call - the same reasoning already applied to vitest
    // and jest. `=== RUN` is still chrome and still goes.
    name: 'go test - failures: summary header, FAIL names, and the assertion under each',
    cmd: 'go',
    args: ['test', './...'],
    input: GO_FAIL,
    assert: (out) => {
      expect(out.startsWith('Go test: 3 tests passed, 2 failed')).toBe(true)
      expect(out).toContain('FAIL: TestDivide')
      expect(out).toContain('FAIL: TestModulo')
      expect(out).not.toContain('=== RUN')
      // the diagnosis survives
      expect(out).toContain('math_test.go')
      expect(out.length).toBeLessThan(GO_FAIL.length / 2)
    },
  },
  {
    name: 'go test - all pass: collapses to the single ok package line',
    cmd: 'go',
    args: ['test', './...'],
    input: GO_PASS,
    assert: (out) => {
      expect(out.startsWith('ok')).toBe(true)
      expect(out).toContain('example.com/mymath')
      expect(out).not.toContain('=== RUN')
      expect(out).not.toContain('--- PASS')
      expect(out.split('\n').length).toBe(1)
    },
  },

  // ── mypy ─────────────────────────────────────────────────────────────────────
  {
    name: 'mypy - groups errors by file, summary header with top codes, note: lines stripped',
    cmd: 'mypy',
    args: ['src'],
    input: MYPY_ERRORS,
    assert: (out) => {
      // Summary header: error count, file count, and top error codes.
      expect(out.startsWith('mypy: 5 error(s) in 3 file(s)')).toBe(true)
      expect(out).toContain('return-value(1)')
      // Grouped per file with a count.
      expect(out).toContain('src/models.py (2)')
      expect(out).toContain('src/views.py (2)')
      expect(out).toContain('src/utils.py (1)')
      // note: lines and the trailing "Found N errors" tally are dropped.
      expect(out).not.toContain('note:')
      expect(out).not.toContain('readthedocs')
      expect(out).not.toContain('Found 5 errors')
      // file:line: error: prefixes are stripped from the shown messages.
      expect(out).not.toMatch(/src\/models\.py:\d+:/)
      expect(out.length).toBeLessThan(MYPY_ERRORS.length)
    },
  },
  {
    name: 'mypy - clean run: returns the Success line only',
    cmd: 'mypy',
    args: ['src'],
    input: MYPY_CLEAN,
    assert: (out) => {
      expect(out).toBe('Success: no issues found in 12 source files')
    },
  },

  // ── ruff check ───────────────────────────────────────────────────────────────
  {
    name: 'ruff check - one summary line: total issues, file count, top rules; messages dropped',
    cmd: 'ruff',
    args: ['check', 'src'],
    input: RUFF_CHECK,
    assert: (out) => {
      expect(out).toBe('ruff: 6 issue(s) in 3 file(s)  F401(2) E501(2) F811(1) E722(1)')
      // One line, no per-finding messages.
      expect(out.split('\n').length).toBe(1)
      expect(out).not.toContain('imported but unused')
      expect(out).not.toContain('Found 6 errors')
      expect(out.length).toBeLessThan(RUFF_CHECK.length / 2)
    },
  },
  {
    // The case above is the CONCISE format. This is what ruff prints with no
    // --output-format at all, which is what an agent actually runs - and it is
    // where the compression is, because `full` quotes the offending source
    // under every finding.
    name: 'ruff check - the >=0.14 default `full` format condenses to the same one line',
    cmd: 'ruff',
    args: ['check', 'src'],
    input: RUFF_CHECK_FULL,
    assert: (out, input) => {
      expect(out).toBe('ruff: 3 issue(s) in 2 file(s)  F401(1) E501(1) F811(1)')
      expect(out.split('\n').length).toBe(1)
      // Neither the quoted source nor the help text survives ...
      expect(out).not.toContain('import os')
      expect(out).not.toContain('Remove unused import')
      // ... and the two files really are two: routes.py and views.py.
      expect(input).toContain('src/api/routes.py')
      expect(input).toContain('src/api/views.py')
    },
  },
  {
    name: 'ruff check - clean run: returns the "All checks passed" line',
    cmd: 'ruff',
    args: ['check', 'src'],
    input: RUFF_CLEAN,
    assert: (out) => {
      expect(out).toBe('All checks passed!')
    },
  },

  // ── ruff format ──────────────────────────────────────────────────────────────
  {
    name: 'ruff format - collapses per-file lines to one reformatted/unchanged tally',
    cmd: 'ruff',
    args: ['format', 'src'],
    input: RUFF_FORMAT,
    assert: (out) => {
      expect(out).toBe('ruff format: 3 reformatted, 2 unchanged')
      expect(out.split('\n').length).toBe(1)
      // Individual filenames are summarized away.
      expect(out).not.toContain('.py')
      expect(out.length).toBeLessThan(RUFF_FORMAT.length)
    },
  },

  // ── pip install ──────────────────────────────────────────────────────────────
  {
    name: 'pip install - strips Collecting/Downloading/Using cached/Looking-in noise, keeps result',
    cmd: 'pip',
    args: ['install', 'requests'],
    input: PIP_INSTALL,
    assert: (out) => {
      expect(out).toContain('Successfully installed')
      expect(out).toContain('Installing collected packages')
      expect(out).not.toContain('Collecting')
      expect(out).not.toContain('Downloading')
      expect(out).not.toContain('Using cached')
      expect(out).not.toContain('Looking in')
      // 11 noisy lines down to the 2 that matter.
      expect(out.split('\n').length).toBe(2)
      expect(out.length).toBeLessThan(PIP_INSTALL.length / 2)
    },
  },

  // ── pip list --outdated ──────────────────────────────────────────────────────
  {
    name: 'pip list --outdated - one "pkg (old → new)" row each, header + Type column dropped',
    cmd: 'pip',
    args: ['list', '--outdated'],
    input: PIP_OUTDATED,
    assert: (out) => {
      expect(out.startsWith('pip outdated:')).toBe(true)
      expect(out).toContain('requests (2.28.0 → 2.31.0)')
      expect(out).toContain('urllib3 (1.26.15 → 2.2.1)')
      // Column header and the Type column are gone.
      expect(out).not.toContain('Latest')
      expect(out).not.toContain('wheel')
      expect(out.length).toBeLessThan(PIP_OUTDATED.length)
    },
  },

  // ── no-trigger passthrough ───────────────────────────────────────────────────
  {
    name: 'pip show - unrecognized subcommand passes through unchanged (no-trigger)',
    cmd: 'pip',
    args: ['show', 'requests'],
    input: PIP_SHOW,
    assert: (out) => {
      // Not turned into any pip summary form.
      expect(out).not.toContain('pip outdated:')
      // Content preserved verbatim.
      expect(out).toContain('Name: requests')
      expect(out).toContain('Version: 2.31.0')
      expect(out).toContain('Requires: certifi, charset-normalizer, idna, urllib3')
    },
  },

  // ── audit #46: ruff rule codes are not one letter + digits ────────────────
  {
    name: 'ruff check - multi-letter rule prefixes (SIM, PLR, UP, ARG, RUF) are counted, not dropped',
    cmd: 'ruff',
    args: ['check', '.'],
    // The regex captured the code as ([A-Z]\d+), so every multi-letter prefix
    // failed to match and those violations vanished from the total, the file
    // set and the body. SIM/PLR/UP/ARG/RUF are the most commonly enabled rules
    // there are, so the reported total was routinely a fraction of the truth.
    input: `src/api/routes.py:12:1: F401 [*] \`os\` imported but unused
src/api/routes.py:31:5: SIM108 Use ternary operator instead of if-else block
src/api/routes.py:44:9: PLR2004 Magic value used in comparison, consider replacing 200
src/core/config.py:7:1: UP035 \`typing.Dict\` is deprecated, use \`dict\` instead
src/core/config.py:19:11: ARG001 Unused function argument: \`ctx\`
src/core/config.py:52:1: RUF012 Mutable class attributes should be annotated
src/util/io.py:3:1: E402 Module level import not at top of file
Found 7 errors.
`,
    assert: (out) => {
      // all seven, not just the two single-letter ones
      expect(out).toMatch(/\b7 issue/)
      expect(out).toContain('3 file(s)')
      // the multi-letter codes reach the histogram
      expect(out).toMatch(/SIM108|PLR2004|UP035|ARG001|RUF012/)
    },
  },
  {
    name: 'ruff check - a clean run is still recognised, not turned into a fabricated total',
    cmd: 'ruff',
    args: ['check', '.'],
    input: 'All checks passed!\n',
    assert: (out) => {
      expect(out).toContain('All checks passed!')
      expect(out).not.toMatch(/issue\(s\)/)
    },
  },

  // ── audit #49: go test without -v prints no "--- PASS:" lines ─────────────
  {
    name: 'go test ./... - a failing run does not report "0 passed" and does not delete the ok lines',
    cmd: 'go',
    args: ['test', './...'],
    // `passed` was counted only from `--- PASS:` at column 0, which plain
    // `go test ./...` never prints. So any run containing one failure reported
    // "0 passed" AND dropped every `ok <pkg>` line - the evidence that the
    // other packages were fine.
    input: `ok  	github.com/acme/svc/internal/auth	0.412s
ok  	github.com/acme/svc/internal/cart	0.203s
ok  	github.com/acme/svc/internal/config	0.118s
--- FAIL: TestCheckoutAppliesPromo (0.01s)
    checkout_test.go:112: status = 500, want 400
FAIL
FAIL	github.com/acme/svc/internal/checkout	0.334s
ok  	github.com/acme/svc/internal/search	0.271s
FAIL
`,
    assert: (out) => {
      // four packages passed; the rollup must not claim zero
      expect(out).not.toMatch(/\b0 passed/)
      expect(out).toMatch(/\b4\b/)
      // the failure and its assertion survive
      expect(out).toContain('TestCheckoutAppliesPromo')
      expect(out).toContain('status = 500, want 400')
    },
  },

  // ── audit #50: mypy diagnostics without a line number, and .pyi stubs ──────
  {
    name: 'mypy - file-level errors and .pyi stubs are counted and shown, not silently dropped',
    cmd: 'mypy',
    args: ['src'],
    // The matcher required `<file>.py:<line>:`, so mypy's file-level errors
    // (no line number) and every diagnostic in a `.pyi` stub fell through and
    // vanished from the count, the file list AND the body - while the header
    // still stated a total that contradicted mypy's own "Found 4 errors".
    input: `setup.py: error: Duplicate module named "setup"
src/models.py:10: error: Incompatible return value type (got "int", expected "str")  [return-value]
src/models.py:22: error: Argument 1 has incompatible type "str"; expected "int"  [arg-type]
src/stubs.pyi:4: error: Name "Foo" is not defined  [name-defined]
src/models.py:30: note: See https://mypy.readthedocs.io/en/stable/_refs.html for more info
Found 4 errors in 3 files (checked 12 source files)
`,
    assert: (out) => {
      // mypy said 4 errors in 3 files; the header must agree with it.
      expect(out.startsWith('mypy: 4 error(s) in 3 file(s)')).toBe(true)
      // both previously-invisible diagnostics survive, with their files
      expect(out).toContain('setup.py')
      expect(out).toContain('Duplicate module named "setup"')
      expect(out).toContain('src/stubs.pyi')
      expect(out).toContain('Name "Foo" is not defined')
      // note: lines and the trailing tally are still dropped
      expect(out).not.toContain('note:')
      expect(out).not.toContain('readthedocs')
    },
  },

  // ── audit #56: pip's column format prints a dashed separator row ──────────
  {
    name: 'pip list --outdated - the dashed separator row is not emitted as a package',
    cmd: 'pip',
    args: ['list', '--outdated'],
    // The header guard only skipped a first field of exactly "Package" or
    // "---", but pip's separator is a run of dashes as wide as the column, so
    // it parsed as a package and a nonexistent upgrade was invented.
    input: `Package    Version Latest Type
---------- ------- ------ -----
requests   2.28.1  2.31.0 wheel
urllib3    1.26.12 2.2.1  wheel
`,
    assert: (out) => {
      expect(out.startsWith('pip outdated:')).toBe(true)
      // No row whose "package name" is a run of dashes.
      expect(out).not.toMatch(/^\s*-+\s/m)
      expect(out).not.toContain('---------- (')
      // The two real packages are still there, and nothing else.
      expect(out).toContain('requests (2.28.1 → 2.31.0)')
      expect(out).toContain('urllib3 (1.26.12 → 2.2.1)')
      expect(out.split('\n')).toHaveLength(3)
    },
  },

  // ── audit #60: parametrized node ids contain " - " inside the brackets ────
  {
    name: 'pytest - a parametrized node id is not truncated mid-bracket',
    cmd: 'pytest',
    args: [],
    // `line.split(' - ')[0]` cut the id at the first " - ", which for a
    // parametrized id lands INSIDE the [...] list: the agent is handed
    // `tests/test_math.py::test_range[1`, which selects nothing when re-run.
    input: `============================= test session starts ==============================
platform linux -- Python 3.11.4, pytest-7.4.0
collected 10 items

tests/test_math.py ........FF                                            [100%]

=========================== short test summary info ============================
FAILED tests/test_math.py::test_range[1 - 2] - assert 1 == 2
FAILED tests/test_math.py::test_range[3 - 4] - assert 3 == 4
========================= 2 failed, 8 passed in 0.11s ==========================
`,
    assert: (out) => {
      expect(out).toContain('FAIL: tests/test_math.py::test_range[1 - 2]')
      expect(out).toContain('FAIL: tests/test_math.py::test_range[3 - 4]')
      // Every emitted id is a balanced, re-runnable selector.
      for (const l of out.split('\n').filter((x) => x.startsWith('  FAIL: '))) {
        const id = l.slice(8)
        expect(id.split('[').length, `unbalanced node id: ${id}`).toBe(id.split(']').length)
      }
      // The failure reason is still dropped - it is what the id replaces.
      expect(out).not.toContain('assert 1 == 2')
    },
  },

  // ── audit #67: ruff's DEFAULT output format is `full`, not `concise` ──────
  {
    name: 'ruff check - the default full diagnostic format is condensed, not passed through',
    cmd: 'ruff',
    args: ['check', '.'],
    // Current ruff prints the rule code FIRST and the location on a ` --> `
    // line. The condenser only understood the concise `path:l:c: CODE msg`
    // shape, so `ruff check .` got 0% reduction: the wrapper was pure cost on
    // one of the hottest Python commands there is.
    input: `F401 [*] \`os\` imported but unused
 --> api/routes.py:1:8
  |
1 | import os
2 | import sys
  |        ^^
  |
help: Remove unused import: \`os\`

E501 Line too long (95 > 88)
 --> api/routes.py:12:89
   |
12 |     return JSONResponse({"orders": [serialize(o) for o in Order.objects.all()]})
   |                                                                         ^^^^^^
   |

SIM108 Use ternary operator instead of if-else block
 --> core/config.py:31:5
   |
31 |     if debug:
   |     ^^^^^^^^^
   |
help: Replace if-else block with \`x if y else z\`

Found 3 errors.
[*] 1 fixable with the \`--fix\` option.
`,
    assert: (out, input) => {
      expect(out).toBe('ruff: 3 issue(s) in 2 file(s)  F401(1) E501(1) SIM108(1)')
      expect(out.split('\n')).toHaveLength(1)
      expect(out.length).toBeLessThan(input.length / 4)
    },
  },
])

describeCompression('python-extra', [
  // ── ruff format --diff / --check: not the same shape as `ruff format` ──────
  {
    name: 'ruff format --diff - the diff survives instead of collapsing to a fabricated 1/1 count',
    cmd: 'ruff',
    args: ['format', '--diff', '.'],
    // The trailing summary contains BOTH "reformatted" and "unchanged", so the
    // line-counting branch scored one of each and reported "1 reformatted,
    // 1 unchanged" - wrong counts AND the whole diff deleted.
    input: `--- src/app.py
+++ src/app.py
@@ -1,5 +1,5 @@
-def handler(event,context):
-    return {"statusCode":200}
+def handler(event, context):
+    return {"statusCode": 200}

--- src/util.py
+++ src/util.py
@@ -10,2 +10,3 @@
-x=1
+x = 1
+
2 files would be reformatted, 3 files left unchanged
`,
    assert: (out) => {
      expect(out).not.toBe('ruff format: 1 reformatted, 1 unchanged')
      // the counts, if reported at all, must be the real ones
      expect(out).not.toMatch(/1 reformatted, 1 unchanged/)
      // and the actual changes have to be visible - they are the whole point
      expect(out).toContain('src/app.py')
      expect(out).toContain('src/util.py')
      expect(out).toContain('def handler(event, context):')
    },
  },
  {
    name: 'ruff format --check - reports the real file counts from the summary line',
    cmd: 'ruff',
    args: ['format', '--check', '.'],
    input: '2 files would be reformatted, 3 files left unchanged\n',
    assert: (out) => {
      expect(out).toContain('2')
      expect(out).toContain('3')
      expect(out).not.toMatch(/1 reformatted, 1 unchanged/)
      // ADDED (audit #59): this case pinned only the counts, so the snapshot
      // underneath it happily recorded "2 reformatted" - past tense for a run
      // that wrote nothing. The counts were right; the verb was invented.
      expect(out).not.toMatch(/\b2 reformatted\b/)
      expect(out).toContain('would be reformatted')
    },
  },
  {
    name: 'ruff format - the plain per-file form still rolls up',
    cmd: 'ruff',
    args: ['format', '.'],
    input:
      'reformatted src/app.py\n' +
      'reformatted src/util.py\n' +
      '2 files reformatted, 3 files left unchanged\n',
    assert: (out) => {
      expect(out).toBe('ruff format: 2 reformatted, 3 unchanged')
    },
  },
  {
    name: 'ruff format - per-file lines with no summary at all still count correctly',
    cmd: 'ruff',
    args: ['format', '.'],
    input: 'reformatted src/app.py\nreformatted src/util.py\n',
    assert: (out) => {
      expect(out).toBe('ruff format: 2 reformatted, 0 unchanged')
    },
  },

  // ── audit #59: `--check` is a dry run - nothing was written ───────────────
  {
    name: 'ruff format --check - reports what WOULD change and keeps the paths',
    cmd: 'ruff',
    args: ['format', '--check', '.'],
    // "N reformatted" is past tense: it claims an action `--check` never
    // performs, and it is byte-identical to the sentence a real write emits.
    // The `Would reformat:` paths are the only actionable content of a check
    // run, and they were deleted.
    input:
      'Would reformat: src/api/routes.py\n' +
      'Would reformat: src/services/billing.py\n' +
      '2 files would be reformatted, 14 files left unchanged\n',
    assert: (out) => {
      // Not the past-tense claim, and not the write-mode sentence shape.
      expect(out).not.toMatch(/\b2 reformatted\b/)
      expect(out).toContain('would be reformatted')
      expect(out).toContain('2')
      expect(out).toContain('14')
      // The files that need formatting survive.
      expect(out).toContain('src/api/routes.py')
      expect(out).toContain('src/services/billing.py')
    },
  },
  {
    name: 'ruff format --check - "already formatted" is read, not counted as 0 unchanged',
    cmd: 'ruff',
    args: ['format', '--check', '.'],
    // Current ruff says "N files already formatted"; only "left unchanged" was
    // parsed, so the other side was reported as a flat 0 - a fabricated count
    // sitting next to a real one.
    input:
      'Would reformat: src/billing.py\n' +
      'Would reformat: src/routes.py\n' +
      '2 files would be reformatted, 1 file already formatted\n',
    assert: (out) => {
      expect(out).not.toMatch(/\b0 unchanged\b/)
      expect(out).toContain('1 already formatted')
      expect(out).toContain('would be reformatted')
      expect(out).toContain('src/billing.py')
    },
  },
])

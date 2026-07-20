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
    name: 'go test - failures: summary header + FAIL names, RUN/detail lines stripped',
    cmd: 'go',
    args: ['test', './...'],
    input: GO_FAIL,
    assert: (out) => {
      expect(out.startsWith('Go test: 3 passed, 2 failed')).toBe(true)
      expect(out).toContain('FAIL: TestDivide')
      expect(out).toContain('FAIL: TestModulo')
      expect(out).not.toContain('=== RUN')
      expect(out).not.toContain('math_test.go')
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
])

import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the golangci-lint condenser (condenseGolangci).
// It parses "file.go:L:C: linter: msg" issue lines, dedups files, groups by
// linter, and collapses the whole report to one summary line:
//   "golangci-lint: N issue(s) in M file(s)  linter(Nx)  ..."
// Non-issue noise lines are dropped. When nothing parses it either surfaces a
// "no issues found" marker or passes the raw text through unchanged.

// Verbose multi-linter report (golangci-lint run -v): 2 info/noise lines the
// condenser must strip + 8 real issues across 4 files, one linter (errcheck)
// appearing 3x and a 6th linter (staticcheck) that must fall outside the top-5.
const MANY_ISSUES = `level=info msg="[config_reader] Used config file /home/ci/repo/.golangci.yml"
level=info msg="[lintersdb] Active 18 linters"
main.go:10:5: errcheck: Error return value of \`w.Write\` is not checked (errcheck)
main.go:45:2: ineffassign: ineffectual assignment to err (ineffassign)
internal/server/server.go:88:1: gofmt: File is not \`gofmt\`-ed with \`-s\` (gofmt)
internal/server/server.go:12:6: golint: exported type Server should have comment or be unexported (golint)
utils/strings.go:33:14: govet: printf: Sprintf format %d has arg s of wrong type string (govet)
utils/strings.go:5:2: errcheck: Error return value of \`buf.WriteString\` is not checked (errcheck)
handlers/api.go:120:9: staticcheck: SA4006: this value of err is never used (staticcheck)
handlers/api.go:200:1: errcheck: Error return value of \`json.Unmarshal\` is not checked (errcheck)
`

// A single issue on a single file - exercises the always-parenthetical
// "issue(s)"/"file(s)" wording even when the count is 1.
const SINGLE_ISSUE = `internal/handlers/payment.go:142:9: errcheck: Error return value of \`tx.Rollback\` is not checked (errcheck)
`

// A clean run: only info/noise lines plus the "No issues found." marker. No
// line matches the issue format, so total === 0 and the marker line is surfaced.
const CLEAN = `level=info msg="[config_reader] Used config file /home/ci/repo/.golangci.yml"
level=info msg="[lintersdb] Active 18 linters"
level=info msg="[runner] Issues before processing: 0, after processing: 0"
level=info msg="[runner] processing took 342ms"
No issues found.
`

// A failed run: warnings + a fatal load error, no issue lines and no "no issues
// found" marker -> total === 0 with no marker -> raw text passthrough.
const LOAD_ERROR = `level=warning msg="[runner] The linter 'golint' is deprecated (since v1.41.0), please use 'revive'"
level=error msg="Running error: context loading failed: failed to load packages: no Go files to analyze in ./..."
`

// ── audit #47: the DEFAULT text format puts the linter in a trailing paren ───
// golangci-lint prints `path:line:col: <message> (<linter>)`. There is no
// `linter:` prefix; the fixtures above carry the name twice, which the real
// tool never emits. On genuine output the prefix regex captured whatever word
// of the MESSAGE happened to be followed by a colon, and dropped every issue
// whose message had no such word - from the body AND from the total.
const DEFAULT_FORMAT = `internal/store/db.go:42:2: \`ctx\` is unused (unparam)
internal/store/db.go:88:15: Error return value is not checked (errcheck)
cmd/main.go:12:1: exported function Run should have comment (golint)
cmd/main.go:31:5: S1000: should use for range instead of for { select {} } (gosimple)
pkg/api/handler.go:7:20: undefined: FooBar (typecheck)
`

// ── audit #4: no linter name in the line ⇒ no histogram entry ────────────────
// With `--print-linter-name=false` (and the `line-number` / `tab` renderings)
// there is no trailing `(linter)` parenthetical at all. The `linter:`-prefix
// fallback then reported whatever word of the MESSAGE happened to be followed
// by a colon - "undefined(1x)", "S1000(1x)", "SA4006(1x)" - naming message
// fragments as the linters that fired. The position prefix still tells us how
// many issues there are and which files they are in; the linter does not appear
// anywhere on the line, so the histogram is omitted rather than invented.
const NO_LINTER_NAME = `internal/store/db.go:42:2: undefined: FooBar
internal/store/db.go:88:15: S1000: should use for range instead of for { select {} }
cmd/main.go:12:1: SA4006: this value of err is never used
cmd/main.go:31:5: Error return value of \`w.Write\` is not checked
`

// One report can hold both shapes (a typecheck failure is printed without the
// parenthetical even in the default format). The named ones are histogrammed,
// the unnamed one is still counted - dropping it from the total to keep the
// histogram tidy would be the silent-deletion bug.
const MIXED_NAMING = `internal/store/db.go:42:2: undefined: FooBar
internal/store/db.go:88:15: Error return value is not checked (errcheck)
cmd/main.go:12:1: S1000: should use for range instead of for { select {} } (gosimple)
`

describeCompression('golangci', [
  {
    name: 'run - groups issues by linter, dedups files, caps at top-5, one summary line',
    cmd: 'golangci-lint',
    args: ['run'],
    input: MANY_ISSUES,
    assert: (out, input) => {
      // Emits a single summary header line, dropping every raw issue + noise line.
      expect(out).toMatch(/^golangci-lint: /)
      expect(out.split('\n')).toHaveLength(1)
      expect(out).not.toContain('level=info')
      // Total counts ALL 8 issues; files are deduped to the 4 unique paths.
      expect(out).toContain('8 issue(s)')
      expect(out).toContain('4 file(s)')
      // Grouped + counted per linter; errcheck seen 3x.
      expect(out).toContain('errcheck(3x)')
      // Sorted by count descending: the 3x linter leads the 1x ones.
      expect(out.indexOf('errcheck(3x)')).toBeLessThan(out.indexOf('ineffassign(1x)'))
      // Top-5 cap: the 6th linter (staticcheck) is omitted from the list even
      // though its issue still contributes to the total count of 8.
      expect(out).not.toContain('staticcheck')
      // Meaningful compression, not a passthrough.
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'run - single issue keeps parenthetical issue(s)/file(s) wording at N=1',
    cmd: 'golangci-lint',
    args: ['run'],
    input: SINGLE_ISSUE,
    assert: (out, input) => {
      expect(out).toBe('golangci-lint: 1 issue(s) in 1 file(s)  errcheck(1x)')
      expect(out).toContain('issue(s)')
      expect(out).toContain('file(s)')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'run - clean output surfaces the "No issues found" marker, strips info noise',
    cmd: 'golangci-lint',
    args: ['run'],
    input: CLEAN,
    assert: (out, input) => {
      expect(out).toMatch(/^No issues found\.?$/i)
      expect(out).not.toContain('level=info')
      expect(out).not.toMatch(/^golangci-lint:/)
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'run - load failure with no parseable issues passes raw text through',
    cmd: 'golangci-lint',
    args: ['run'],
    input: LOAD_ERROR,
    assert: (out, input) => {
      // No summary is fabricated when nothing parses.
      expect(out).not.toMatch(/^golangci-lint:/)
      // Original diagnostics are preserved verbatim (passthrough).
      expect(out).toContain('Running error')
      expect(out).toContain('deprecated')
      expect(out).toBe(input.trim())
    },
  },
  {
    name: 'empty output - nothing to compress, returns empty string',
    cmd: 'golangci-lint',
    args: ['run'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── audit #47 ──────────────────────────────────────────────────────────────
  {
    name: 'run - default format: linter read from the trailing paren, every issue counted',
    cmd: 'golangci-lint',
    args: ['run'],
    input: DEFAULT_FORMAT,
    assert: (out) => {
      // All five issues across all three files - the old regex saw two of each.
      expect(out).toContain('5 issue(s)')
      expect(out).toContain('3 file(s)')
      // The real linters, not message fragments.
      expect(out).toContain('unparam(1x)')
      expect(out).toContain('errcheck(1x)')
      expect(out).toContain('golint(1x)')
      expect(out).toContain('gosimple(1x)')
      expect(out).toContain('typecheck(1x)')
      // `S1000` and `undefined` are parts of the message, never linter names.
      expect(out).not.toContain('S1000(')
      expect(out).not.toContain('undefined(')
    },
  },

  // ── audit #4 ───────────────────────────────────────────────────────────────
  {
    name: 'run - no linter name on the line: counts stay, histogram is omitted not invented',
    cmd: 'golangci-lint',
    args: ['run', '--print-linter-name=false'],
    input: NO_LINTER_NAME,
    assert: (out) => {
      // Every issue and every file is still reported.
      expect(out).toBe('golangci-lint: 4 issue(s) in 2 file(s)')
      // Message fragments are never reported as the linter that fired.
      expect(out).not.toContain('undefined(')
      expect(out).not.toContain('S1000(')
      expect(out).not.toContain('SA4006(')
      expect(out).not.toContain('Error(')
    },
  },
  {
    name: 'run - mixed naming: named linters histogrammed, unnamed issue still counted',
    cmd: 'golangci-lint',
    args: ['run'],
    input: MIXED_NAMING,
    assert: (out) => {
      expect(out).toBe('golangci-lint: 3 issue(s) in 2 file(s)  errcheck(1x)  gosimple(1x)')
      expect(out).not.toContain('undefined(')
    },
  },
  {
    // Reading the trailing parenthetical is only safe when it LOOKS like a
    // linter. These three messages are real gosimple/staticcheck wordings and
    // all of them end in a parenthetical that is part of the message, so with
    // the name suppressed the histogram was reporting `tStart(1x)`, `...(1x)`
    // and `math/rand(1x)` as the rules that fired.
    name: 'run - a message that itself ends in a parenthetical is not read as the linter',
    cmd: 'golangci-lint',
    args: ['run', '--print-linter-name=false'],
    input:
      'main.go:10:2: S1012: should use time.Since instead of time.Now().Sub(tStart)\n' +
      'main.go:14:9: S1028: should use fmt.Errorf(...) instead of errors.New(fmt.Sprintf(...))\n' +
      'api/mw.go:29:5: G404: Use of weak random number generator (math/rand)\n',
    assert: (out) => {
      expect(out).toBe('golangci-lint: 3 issue(s) in 2 file(s)')
      expect(out).not.toContain('tStart')
      expect(out).not.toContain('...(')
      expect(out).not.toContain('math/rand')
    },
  },
  {
    // ...and the tightening must not cost a single real linter name: every
    // name golangci-lint can print is lower-case ascii.
    name: 'run - real linter names still reach the histogram after the shape check',
    cmd: 'golangci-lint',
    args: ['run'],
    input:
      'a.go:1:1: ineffectual assignment to err (ineffassign)\n' +
      'a.go:2:1: func `scan` is unused (unused)\n' +
      'b.go:3:1: G404: Use of weak random number generator (math/rand instead of crypto/rand) (gosec)\n' +
      'b.go:4:1: cyclomatic complexity 21 of func `Apply` is high (> 15) (gocyclo)\n' +
      'c.go:5:1: do not define dynamic errors (err113)\n' +
      'c.go:6:1: directive `//nolint` is unused (nolintlint)\n',
    assert: (out) => {
      expect(out).toContain('6 issue(s) in 3 file(s)')
      for (const l of ['ineffassign', 'unused', 'gosec', 'gocyclo', 'err113'])
        expect(out).toContain(l + '(1x)')
      // `math/rand` sits in a parenthetical inside the gosec message.
      expect(out).not.toContain('math/rand')
    },
  },
])

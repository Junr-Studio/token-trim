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
])

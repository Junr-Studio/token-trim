import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `tsc` command-output condenser.
//
// The dispatcher routes to condenseTsc when `cmd === 'tsc'` OR the output
// contains a /TS\d{4}:/ error code (content trigger - takes precedence over
// later branches such as npm). condenseTsc parses the non-pretty tsc format
//   file(line,col): error|warning TSxxxx: message
// groups the diagnostics by file, aggregates the top-5 codes into a summary
// header, truncates each message to 120 chars, and preserves indented
// continuation lines (overload / squiggly context). A run with no matches
// collapses "Found 0 errors" to a one-liner and otherwise passes text through.

// (a) Several errors across 3 files. Six distinct codes (so the 6th is dropped
// from the top-5 summary), one message well over 120 chars (truncation), and a
// TS2769 overload error whose indented continuation lines must be preserved.
// A realistic trailing "Found N errors" summary is included as droppable noise.
const MULTI_FILE = `src/index.ts(12,7): error TS2322: Type '{ name: string; age: number; email: string; active: boolean; }' is not assignable to type 'User'. Object literal may only specify known properties, and 'active' does not exist in type 'User'.
src/index.ts(45,3): error TS2304: Cannot find name 'unknownHelper'.
src/index.ts(88,21): error TS2322: Type 'null' is not assignable to type 'string'.
src/components/Button.tsx(23,10): error TS2339: Property 'onClik' does not exist on type 'ButtonProps'. Did you mean 'onClick'?
src/components/Button.tsx(51,5): error TS2769: No overload matches this call.
  Overload 1 of 2, '(props: ButtonProps): Button', gave the following error.
    Argument of type '{ label: number; }' is not assignable to parameter of type 'ButtonProps'.
  Overload 2 of 2, '(props: ButtonProps, ctx: RenderContext): Button', gave the following error.
    Expected 2 arguments, but got 1.
src/utils/format.ts(7,14): error TS7006: Parameter 'value' implicitly has an 'any' type.
src/utils/format.ts(19,9): error TS2531: Object is possibly 'null'.

Found 7 errors in 3 files.

Errors  Files
     3  src/index.ts
     2  src/components/Button.tsx
     2  src/utils/format.ts
`

// A bulk noUnusedLocals run - warnings + one real error. The regex alternation
// matches both `warning` and `error`; the condenser folds warnings into the
// error count and drops the error/warning label entirely in the condensed form.
// Heavy file-path repetition, so the per-file grouping genuinely compresses.
const WARNINGS = `src/legacy/parser.ts(3,7): warning TS6133: 'readFileSync' is declared but its value is never read.
src/legacy/parser.ts(4,7): warning TS6133: 'writeFileSync' is declared but its value is never read.
src/legacy/parser.ts(88,10): warning TS6133: 'tempBuffer' is declared but its value is never read.
src/legacy/parser.ts(140,3): warning TS6133: 'legacyFlag' is declared but its value is never read.
src/legacy/parser.ts(201,9): warning TS6133: 'seenTokens' is declared but its value is never read.
src/legacy/tokenizer.ts(12,3): warning TS6133: 'DEBUG_MODE' is declared but its value is never read.
src/legacy/tokenizer.ts(45,9): warning TS6133: 'scratchPad' is declared but its value is never read.
src/legacy/tokenizer.ts(77,5): warning TS6133: 'lastChar' is declared but its value is never read.
src/legacy/tokenizer.ts(98,7): warning TS6133: 'columnHint' is declared but its value is never read.
src/legacy/tokenizer.ts(120,5): warning TS6192: All imports in import declaration are unused.
src/legacy/emitter.ts(30,7): warning TS6133: 'unusedImport' is declared but its value is never read.
src/legacy/emitter.ts(51,3): warning TS6133: 'sourceMapUrl' is declared but its value is never read.
src/legacy/emitter.ts(84,11): warning TS6133: 'indentCache' is declared but its value is never read.
src/legacy/analyzer.ts(19,5): warning TS6133: 'visited' is declared but its value is never read.
src/legacy/analyzer.ts(63,9): warning TS6133: 'depthLimit' is declared but its value is never read.
src/legacy/analyzer.ts(90,14): error TS2551: Property 'porrt' does not exist on type 'Config'. Did you mean 'port'?
`

// `npm run build` that shells out to tsc. cmd is `npm`, but because the output
// contains /TS\d{4}:/ the content trigger routes it to condenseTsc *ahead* of
// the npm branch. The npm lifecycle noise is discarded in favour of the
// structured TS summary. Also locks the un-pluralized "1 files".
const NPM_BUILD = `> myapp@1.0.0 build
> tsc --noEmit

src/server.ts(14,22): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
src/server.ts(30,7): error TS2304: Cannot find name 'requre'.
src/server.ts(58,15): error TS2532: Object is possibly 'undefined'.

npm ERR! code ELIFECYCLE
npm ERR! errno 2
npm ERR! myapp@1.0.0 build: \`tsc --noEmit\`
npm ERR! Exit status 2
npm ERR!
npm ERR! Failed at the myapp@1.0.0 build script.
npm ERR! This is probably not a problem with npm. There is likely additional logging output above.
npm ERR! A complete log of this run can be found in:
npm ERR!     /home/user/.npm/_logs/2026-07-20T18_42_11_233Z-debug-0.log
`

// Clean watch-mode run. No error lines match, but "Found 0 errors" is present.
const CLEAN = `[10:23:41 AM] Starting compilation in watch mode...

[10:23:44 AM] Found 0 errors. Watching for file changes.
`

// A TS code appears in prose (triggers the content dispatch) but nothing is in
// the file(line,col): error TSxxxx: format, so condenseTsc must pass the text
// through untouched - it must not synthesize a bogus summary.
const PROSE_TS_CODE = `Building project bundle...
Note: encountered deprecation TS2345: assignability of tuple types changed in 5.0.
See https://example.com/ts-migration for the upgrade guide.
Build finished in 4.2s.
`

// Non-tsc command with no TS code anywhere - the tsc condenser is never
// invoked; output is left as-is (generic whitespace cleanup only).
const NO_TRIGGER = `Deploying to production...
  - uploading assets
  - invalidating cache
Done in 4.2s
`

// A Windows checkout: every diagnostic repeats the same 36-character absolute
// prefix. Three distinct files, so the shared directory is hoistable.
const WIN_ABSOLUTE = `C:\\Users\\dev\\source\\repos\\acme-portal\\src\\components\\Button.tsx(23,10): error TS2339: Property 'onClik' does not exist on type 'ButtonProps'. Did you mean 'onClick'?
C:\\Users\\dev\\source\\repos\\acme-portal\\src\\components\\Button.tsx(51,5): error TS2554: Expected 2 arguments, but got 1.
C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts(14,22): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
C:\\Users\\dev\\source\\repos\\acme-portal\\test\\Button.spec.tsx(88,21): error TS2532: Object is possibly 'undefined'.

Found 4 errors in 3 files.
`

// The same absolute prefix, but only one file carries it. One occurrence is not
// a repetition, so a "base:" header would cost more than it saves.
const WIN_ABSOLUTE_SINGLE_FILE = `C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts(14,22): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts(31,9): error TS2532: Object is possibly 'undefined'.
C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts(47,3): error TS2304: Cannot find name 'useSesion'.
C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts(62,15): error TS2339: Property 'refresh' does not exist on type 'Session'.

Found 4 errors in 1 file.
`

// The state an edit/typecheck loop actually spends its time in: a handful of
// diagnostics across a couple of files. condenseTsc unconditionally prepends a
// summary line, a 50-character rule and a per-file group header, so at this
// size the "compressed" form is 50-160% LARGER than the bare tsc output - the
// inverse of the product's purpose, and a counterexample to the release note
// "No condenser can return more characters than it received". Five sibling
// condensers already carry the shorter-of guard; tsc did not.
const SMALL_RUN = `src/mod1.ts(12,5): error TS2304: Cannot find name 'thing1'.
src/mod2.ts(30,5): error TS2304: Cannot find name 'thing2'.
`

// Byte-for-byte the WARNINGS run above, but with the CRLF line endings real
// Windows tsc emits (TypeScript takes sys.newLine from os.EOL). `split('\n')`
// leaves a trailing \r on every line; in JS `.` never matches \r and `$`
// without /m only matches end-of-input, so ERROR_RE's `(.+)$` could not match
// a single diagnostic. On an entire advertised platform the condenser silently
// did nothing and the frame's generic backstop then elided error lines from
// the middle that the grouped form would have kept. The rollup below must be
// identical to the one the LF fixture produces.
const CRLF_WARNINGS = WARNINGS.replace(/\n/g, '\r\n')

describeCompression('tsc', [
  {
    name: 'errors - groups by file, top-5 codes summary, truncates >120-char messages, keeps overload context',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: MULTI_FILE,
    assert: (out, input) => {
      // Summary header: total diagnostics + distinct file count.
      expect(out).toMatch(/^TypeScript: 7 errors in 3 files/)
      // Top-5 codes, most frequent first (TS2322 seen twice leads).
      expect(out).toContain('TS2322(2×)')
      expect(out).toContain('TS7006(1×)') // 5th distinct code - still in the summary
      const header = out.split('\n')[0]
      expect(header).not.toContain('TS2531') // 6th distinct code dropped from the top-5 summary
      expect(out).toContain('L19: TS2531') //  ...but its error is still listed in the body
      // Divider between summary and per-file groups.
      expect(out).toContain('─'.repeat(50))
      // Grouped by file, each with its own error count, in first-seen order.
      expect(out).toContain('src/index.ts  (3)')
      expect(out).toContain('src/components/Button.tsx  (2)')
      expect(out).toContain('src/utils/format.ts  (2)')
      // Long message truncated to 120 chars: head kept, tail dropped.
      expect(out).toContain("L12: TS2322 Type '{ name:")
      expect(out).not.toContain('known properties')
      // Overload / squiggly context lines are preserved (indented).
      expect(out).toMatch(/Overload 1 of 2/)
      // Raw per-line "(col): error TSxxxx:" prefix + column numbers are gone.
      expect(out).not.toMatch(/\(\d+,\d+\): error TS/)
      // Trailing "Found 7 errors" noise line is dropped.
      expect(out).not.toContain('Found 7 errors')
      // Meaningfully compressed.
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'warnings - folded into the error count, error/warning label dropped, codes aggregated',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: WARNINGS,
    assert: (out, input) => {
      expect(out).toMatch(/^TypeScript: 16 errors in 4 files/)
      expect(out).toContain('TS6133(14×)') // dominant code aggregated across all files
      expect(out).not.toMatch(/warning/i) // error/warning distinction is lost in condensed form
      expect(out).toContain('src/legacy/parser.ts  (5)')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'content trigger - npm build output with TS codes routes to tsc condenser ahead of npm, drops npm noise',
    cmd: 'npm',
    args: ['run', 'build'],
    input: NPM_BUILD,
    assert: (out, input) => {
      // "1 files" is intentionally un-pluralized - current behavior, locked.
      expect(out).toMatch(/^TypeScript: 3 errors in 1 files/)
      expect(out).toContain('src/server.ts  (3)')
      expect(out).not.toContain('npm ERR!') // npm lifecycle noise discarded
      expect(out).not.toContain('ELIFECYCLE')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: "clean run - 'Found 0 errors' collapses to a one-line summary",
    cmd: 'tsc',
    args: ['--watch'],
    input: CLEAN,
    assert: (out) => {
      expect(out).toBe('TypeScript: no errors')
    },
  },
  {
    name: 'prose TS code - content trigger fires but no error format matches, text passes through untouched',
    cmd: 'node',
    args: ['build.js'],
    input: PROSE_TS_CODE,
    assert: (out) => {
      expect(out).not.toContain('TypeScript:') // no synthesized summary header
      expect(out).toContain('TS2345') // prose left intact
      expect(out).toContain('Build finished in 4.2s.')
    },
  },
  {
    name: 'no trigger - non-tsc output without any TS code is left alone by the tsc condenser',
    cmd: 'echo',
    args: ['deploy'],
    input: NO_TRIGGER,
    assert: (out) => {
      expect(out).not.toContain('TypeScript:')
      expect(out).toContain('Deploying to production')
      expect(out).toContain('Done in 4.2s')
    },
  },
  {
    name: 'absolute Windows paths - the shared checkout directory is hoisted to one base line',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: WIN_ABSOLUTE,
    assert: (out, input) => {
      expect(out.split('\n')[0]).toBe('base: C:\\Users\\dev\\source\\repos\\acme-portal\\')
      // Hoisted exactly once - that is the whole saving.
      expect(out.split('C:\\Users\\dev\\source\\repos\\acme-portal\\').length - 1).toBe(1)
      // Grouping still works, on the now-relative paths.
      expect(out).toContain('src\\components\\Button.tsx  (2)')
      expect(out).toContain('src\\hooks\\useAuth.ts  (1)')
      expect(out).toContain('test\\Button.spec.tsx  (1)')
      expect(out).toMatch(/^base:.*\nTypeScript: 4 errors in 3 files/)
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'absolute path on a single file - no base line, the path is left absolute',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: WIN_ABSOLUTE_SINGLE_FILE,
    assert: (out) => {
      expect(out).not.toContain('base:')
      expect(out).toContain('C:\\Users\\dev\\source\\repos\\acme-portal\\src\\hooks\\useAuth.ts  (4)')
    },
  },
  {
    name: 'a two-error run is already terse - the summary + rule + group headers would cost more than they save',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: SMALL_RUN,
    assert: (out, input) => {
      // The one promise a compressor makes.
      expect(out.length).toBeLessThanOrEqual(input.length)
      // Declining looks like passthrough: nothing is lost by not grouping, and
      // both diagnostics are still there in tsc's own format.
      expect(out).toBe(input.trim())
      expect(out).toContain("Cannot find name 'thing1'.")
      expect(out).toContain("Cannot find name 'thing2'.")
    },
  },
  {
    name: 'CRLF stdout (real Windows tsc) - diagnostics are parsed and grouped exactly as on LF',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: CRLF_WARNINGS,
    assert: (out, input) => {
      // The same rollup the LF fixture produces - the condenser must not
      // no-op on an entire platform the README advertises.
      expect(out).toMatch(/^TypeScript: 16 errors in 4 files/)
      expect(out).toContain('TS6133(14×)')
      expect(out).toContain('src/legacy/parser.ts  (5)')
      expect(out).toContain('src/legacy/tokenizer.ts  (5)')
      expect(out).toContain('src/legacy/analyzer.ts  (3)')
      // and the one real error is still distinguishable in the code histogram
      expect(out).toContain('TS2551(1×)')
      // No stray carriage returns survive to cost a token apiece.
      expect(out).not.toContain('\r')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'empty output - returns empty, no summary synthesized',
    cmd: 'tsc',
    args: ['--noEmit'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the UNIVERSAL cleanup that runs at the top and
// bottom of compress() for EVERY command - before/after any command-specific
// condenser. We deliberately dispatch a NON-routed command name ('echocmd')
// with a harmless subcommand so NONE of the per-tool condensers run; only the
// universal passes are exercised:
//
//   1. strip ANSI cursor-position sequences   /\x1b\[\d*;\d*[Hf]/g
//   2. strip ANSI cursor-move sequences       /\x1b\[\d*[ABCDEFGsu]/g
//   3. collapse a run of 4+ \r progress redraws to only the final frame
//   4. trim trailing spaces/tabs per line, collapse 3+ blank lines to 2, .trim()
//
// SGR / color sequences (…m terminator) must be PRESERVED. Real ESC bytes are
// produced with the \x1b JS string escape so fixtures match live tool output.
//
// NB: fixtures avoid the substring /TS\d{4}:/ which would content-route to the
// tsc condenser regardless of command name.

// ── (a) cursor-position + cursor-move stripped, color preserved ───────────────
const ANSI_CURSOR =
  'Building project...\n' +
  '\x1b[1;1HStatus: compiling modules\n' +
  'Moving cursor\x1b[2A\x1b[10C then back\x1b[3D done\n' +
  '\x1b[31mERROR\x1b[0m: type mismatch in handler\n' +
  '\x1b[1;32mPASS\x1b[0m: 12 checks succeeded\n' +
  '\x1b[s cursor saved \x1b[u cursor restored\n' +
  'Column jump\x1b[5G and next\x1b[E line marker\n' +
  'Warning: \x1b[33mdeprecated API\x1b[0m used here\n'

// ── (b) 4+ carriage-return progress redraws collapse to the final frame ───────
const PROGRESS_BAR =
  'Downloading model weights...\n' +
  '\rProgress:   0% [          ]' +
  '\rProgress:  20% [##        ]' +
  '\rProgress:  40% [####      ]' +
  '\rProgress:  60% [######    ]' +
  '\rProgress:  80% [########  ]' +
  '\rProgress: 100% [##########]\n' +
  'Download complete: model.bin (240 MB)\n' +
  'Verifying checksum... ok\n'

// ── (b2) a short (<threshold) run of redraws is left intact (no-trigger) ───────
const SHORT_PROGRESS =
  'Saving file...\n' +
  '\rSaving:   0%' +
  '\rSaving: 100%\n' +
  'Saved.\n'

// ── (c) 3+ consecutive blank lines collapse to a single blank line ────────────
const BLANK_RUNS =
  'Test run finished.\n' +
  '\n\n\n' +
  'Summary: 42 passed, 0 failed.\n' +
  '\n\n\n\n\n' +
  'Coverage: 87% of statements.\n'

// ── (d) trailing spaces/tabs trimmed from every line ──────────────────────────
const TRAILING_WS =
  'name = token-trim    \n' +
  'version = 1.0.0\t\n' +
  'description = output compressor   \n' +
  '\t\n' +
  'enabled = true  \n' +
  'paths = [ /usr/bin ]\t\t\n'

// ── clean / zero case: nothing to strip, passes through untouched ─────────────
const CLEAN =
  'All checks passed.\n' +
  '3 files formatted, 0 issues found.\n' +
  'Everything is up to date.'

// ── kitchen sink: all four universal passes compose on one realistic output ───
const KITCHEN_SINK =
  '\x1b[1;1HInstaller v2.3\n' +
  'Resolving packages   \n' +
  '\rFetch [  0%]' +
  '\rFetch [ 25%]' +
  '\rFetch [ 50%]' +
  '\rFetch [ 75%]' +
  '\rFetch [100%]' +
  '\rFetched 88 pkgs\n' +
  '\n\n\n' +
  '\x1b[32mDONE\x1b[0m installation complete\t\n'

describeCompression('universal', [
  {
    name: '(a) strips ANSI cursor position + move sequences, preserves SGR color',
    cmd: 'echocmd',
    args: ['run'],
    input: ANSI_CURSOR,
    assert: (out) => {
      // cursor-position (…;…H) and every cursor-move (A B C D E F G s u) gone
      expect(out).not.toContain('\x1b[1;1H')
      expect(out).not.toMatch(/\x1b\[\d*[ABCDEFGsu]/)
      // SGR color / reset sequences (…m) are PRESERVED verbatim
      expect(out).toContain('\x1b[31m')
      expect(out).toContain('\x1b[0m')
      expect(out).toContain('\x1b[1;32m')
      expect(out).toContain('\x1b[33m')
      // human-readable text survives the strip
      expect(out).toContain('Status: compiling modules')
      expect(out).toContain('ERROR')
      expect(out).toContain('deprecated API')
    },
  },
  {
    name: '(b) collapses a run of 4+ CR progress redraws to only the final frame',
    cmd: 'echocmd',
    args: ['run'],
    input: PROGRESS_BAR,
    assert: (out) => {
      // intermediate redraw frames (distinct percentages + partial bar art) gone
      expect(out).not.toContain('20%')
      expect(out).not.toContain('40%')
      expect(out).not.toContain('60%')
      expect(out).not.toContain('80%')
      expect(out).not.toContain('[          ]')
      expect(out).not.toContain('[##        ]')
      expect(out).not.toContain('[########  ]')
      // only the final, fully-drawn frame remains
      expect(out).toContain('100% [##########]')
      // exactly one 'Progress:' frame survives (the redraws collapsed into it)
      expect(out.match(/Progress:/g)?.length).toBe(1)
      // surrounding non-redraw lines untouched
      expect(out).toContain('Downloading model weights...')
      expect(out).toContain('Download complete: model.bin (240 MB)')
    },
  },
  {
    name: '(b2) a short run of CR redraws (below threshold) is left intact',
    cmd: 'echocmd',
    args: ['run'],
    input: SHORT_PROGRESS,
    assert: (out) => {
      // too few frames to trigger the collapse - both survive
      expect(out).toContain('Saving:   0%')
      expect(out).toContain('Saving: 100%')
      expect(out).toContain('Saved.')
    },
  },
  {
    name: '(c) collapses 3+ consecutive blank lines down to one',
    cmd: 'echocmd',
    args: ['run'],
    input: BLANK_RUNS,
    assert: (out) => {
      // no run of 3+ newlines survives
      expect(out).not.toMatch(/\n{3,}/)
      expect(out).toContain('Test run finished.')
      expect(out).toContain('Summary: 42 passed, 0 failed.')
      expect(out).toContain('Coverage: 87% of statements.')
    },
  },
  {
    name: '(d) trims trailing spaces and tabs from every line',
    cmd: 'echocmd',
    args: ['run'],
    input: TRAILING_WS,
    assert: (out) => {
      // no line ends in a space or tab
      expect(out).not.toMatch(/[ \t]+$/m)
      // internal spacing and content preserved
      expect(out).toContain('name = token-trim')
      expect(out).toContain('paths = [ /usr/bin ]')
      expect(out).toContain('enabled = true')
    },
  },
  {
    name: 'clean output with no noise passes through unchanged (just trimmed)',
    cmd: 'echocmd',
    args: ['status'],
    input: CLEAN,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('0 issues found')
    },
  },
  {
    name: 'empty output returns the empty string unchanged',
    cmd: 'echocmd',
    args: ['run'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
  {
    name: 'kitchen sink - all four universal passes compose on one output',
    cmd: 'echocmd',
    args: ['run'],
    input: KITCHEN_SINK,
    assert: (out) => {
      // cursor position stripped
      expect(out).not.toContain('\x1b[1;1H')
      // progress redraws collapsed to the final summary frame
      expect(out).not.toContain('[  0%]')
      expect(out).not.toContain('[ 25%]')
      expect(out).not.toContain('[100%]')
      expect(out).toContain('Fetched 88 pkgs')
      // color preserved
      expect(out).toContain('\x1b[32m')
      // trailing whitespace gone and blank runs collapsed
      expect(out).not.toMatch(/[ \t]+$/m)
      expect(out).not.toMatch(/\n{3,}/)
      // content intact
      expect(out).toContain('Installer v2.3')
      expect(out).toContain('DONE')
      expect(out).toContain('installation complete')
    },
  },
])

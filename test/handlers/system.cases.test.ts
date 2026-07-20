import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `system` handler.
// It defines two condensers, dispatched by command name in the proxy frame:
//   - cmd 'ls'   → condenseLs   - strips the perm/owner/date columns of a
//                  `ls -la` long listing, drops the `total` line and `.`/`..`,
//                  filters noise dirs (node_modules/.git/…), humanizes sizes,
//                  emits a `N files, M dirs` summary with an extension tally,
//                  and caps the body at 50 entries.
//   - cmd 'find' → condenseFind - regroups a flat path dump under per-directory
//                  headers (printing each shared directory prefix once), adds a
//                  `<total> results in <dirs> dir(s)` summary + extension tally,
//                  shows up to 8 names per dir, and caps the whole body at 50.
//
// Each case is realistic raw tool output. The harness runs the real shipped
// compress(), asserts it does not grow (unless allowGrowth), runs the
// behavioral asserts below, then snapshots the exact bytes.

// ── ls fixtures ───────────────────────────────────────────────────────────────

// A typical project-root `ls -la`: header `total` line, `.`/`..`, dotfiles,
// small source/config files, real subdirs, plus node_modules/.git noise dirs.
const LS_LONG = `total 64
drwxr-xr-x  10 alice  staff  320 Jul 20 14:02 .
drwxr-xr-x   6 alice  staff  192 Jul 18 09:30 ..
-rw-r--r--   1 alice  staff  214 Jul 15 11:20 .gitignore
-rw-r--r--   1 alice  staff  842 Jul 20 14:02 package.json
-rw-r--r--   1 alice  staff  318 Jul 19 16:45 tsconfig.json
-rw-r--r--   1 alice  staff  523 Jul 18 10:05 README.md
-rw-r--r--   1 alice  staff  690 Jul 17 13:15 index.ts
drwxr-xr-x   8 alice  staff  256 Jul 20 12:00 src
drwxr-xr-x   3 alice  staff   96 Jul 16 08:00 test
drwxr-xr-x  42 alice  staff  896 Jul 20 11:59 node_modules
drwxr-xr-x  12 alice  staff  480 Jul 20 14:02 .git`

// Files spanning the three size bands so the humanizer emits B, KB and MB.
const LS_SIZES = `total 5208
-rw-r--r--  1 alice  staff      512 Jan 15 10:30 notes.txt
-rw-r--r--  1 alice  staff    12048 Jan 14 18:05 bundle.js
-rw-r--r--  1 alice  staff  2560000 Jan 10 08:00 demo.mp4`

// 60 files → exceeds the 50-entry body cap so the `... +N more` footer appears.
const LS_MANY = [
  'total 240',
  ...Array.from(
    { length: 60 },
    (_, i) => `-rw-r--r--  1 alice  staff  ${100 + i} Jul 20 10:00 mod${String(i).padStart(2, '0')}.ts`,
  ),
].join('\n')

// A directory whose only entries are `.` and `..` - nothing listable remains.
const LS_EMPTY_DIR = `total 0
drwxr-xr-x  2 alice  staff   64 Jul 20 14:02 .
drwxr-xr-x  9 alice  staff  288 Jul 20 13:00 ..`

// ── find fixtures ─────────────────────────────────────────────────────────────

// Deep monorepo paths sharing long directory prefixes - grouping prints each
// prefix once, which is where the real compression comes from.
const FIND_GROUPED = [
  './packages/web-app/src/components/forms/TextInput.tsx',
  './packages/web-app/src/components/forms/Checkbox.tsx',
  './packages/web-app/src/components/forms/RadioGroup.tsx',
  './packages/web-app/src/components/forms/Select.tsx',
  './packages/web-app/src/components/forms/DatePicker.tsx',
  './packages/web-app/src/components/layout/Header.tsx',
  './packages/web-app/src/components/layout/Sidebar.tsx',
  './packages/web-app/src/components/layout/Footer.tsx',
  './packages/web-app/src/hooks/useDebounce.ts',
  './packages/web-app/src/hooks/usePrevious.ts',
  './packages/web-app/src/hooks/useMediaQuery.ts',
  './packages/web-app/src/utils/validation.ts',
].join('\n')

// 12 files in a single directory → per-dir cap of 8 kicks in (`+N more here`).
const FIND_MORE_HERE = Array.from({ length: 12 }, (_, i) => `./src/pages/page${i}.tsx`).join('\n')

// 60 files across 10 dirs → the overall 50-shown cap kicks in (`... +N more`).
const FIND_CAP = Array.from({ length: 10 }, (_, d) =>
  Array.from({ length: 6 }, (_, f) => `./pkg/dir${d}/file${f}.ts`).join('\n'),
).join('\n')

// A short result set (≤ 10 lines) - below the trigger threshold, so it is
// returned untouched (a genuine no-op passthrough).
const FIND_SMALL = `./src/index.ts
./src/app.ts
./README.md
./package.json`

// Extension-less results → the extension tally is omitted from the header.
const FIND_NOEXT = Array.from({ length: 12 }, (_, i) => `./bin/tool${i}`).join('\n')

describeCompression('system', [
  // ── ls ──────────────────────────────────────────────────────────────────────
  {
    name: 'ls -la - strips perm/owner/date columns, filters noise dirs, tallies extensions, humanizes sizes',
    cmd: 'ls',
    args: ['-la'],
    input: LS_LONG,
    assert: (out) => {
      // Summary header: file/dir counts (node_modules/.git excluded from dirs).
      expect(out).toMatch(/^5 files, 2 dirs/)
      // Extension tally in the header (package.json + tsconfig.json = .json(2)).
      expect(out).toContain('.json(2)')
      // Noise dirs are dropped entirely.
      expect(out).not.toContain('node_modules')
      expect(out).not.toMatch(/(^|\n)\.git(\/|$)/)
      // The verbose columns are gone: permission bits, owner/group, the total line.
      expect(out).not.toContain('-rw-r--r--')
      expect(out).not.toContain('drwxr-xr-x')
      expect(out).not.toContain('staff')
      expect(out).not.toMatch(/^total /m)
      // `.` and `..` are filtered out.
      expect(out).not.toMatch(/^\.\.?$/m)
      // Directories keep a trailing slash; files carry a humanized size.
      expect(out).toContain('src/')
      expect(out).toContain('test/')
      expect(out).toContain('README.md (523B)')
    },
  },
  {
    name: 'ls -la - humanizes byte sizes into B / KB / MB bands',
    cmd: 'ls',
    args: ['-la'],
    input: LS_SIZES,
    assert: (out) => {
      expect(out).toMatch(/^3 files, 0 dirs/)
      expect(out).toContain('(512B)') // < 1 KiB stays in bytes
      expect(out).toContain('(12KB)') // KiB band, rounded to whole KB
      expect(out).toContain('(2.4MB)') // MiB band, one decimal
      // Still a big win despite the (known) date leaking into large-file names.
      expect(out.length).toBeLessThan(LS_SIZES.length)
    },
  },
  {
    name: 'ls -la - caps the body at 50 entries with a "+N more" footer',
    cmd: 'ls',
    args: ['-la'],
    input: LS_MANY,
    assert: (out) => {
      expect(out).toMatch(/^60 files, 0 dirs {2}\.ts\(60\)/)
      // header + 50 shown entries + footer.
      expect(out.split('\n')).toHaveLength(52)
      expect(out).toMatch(/\n\.\.\. \+10 more$/)
    },
  },
  {
    name: 'ls -la - empty directory (only . and ..) has nothing to condense, returns unchanged',
    cmd: 'ls',
    args: ['-la'],
    input: LS_EMPTY_DIR,
    assert: (out) => {
      // Nothing listable survives filtering, so the raw listing is passed through.
      expect(out).toContain('total 0')
      expect(out).toBe(LS_EMPTY_DIR)
    },
  },
  {
    name: 'ls - empty output stays empty',
    cmd: 'ls',
    args: ['-la'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── find ────────────────────────────────────────────────────────────────────
  {
    name: 'find - groups many paths under per-directory headers with an extension tally',
    cmd: 'find',
    args: ['.', '-name', '*.ts'],
    input: FIND_GROUPED,
    assert: (out) => {
      // Summary header: total results, distinct dirs, extension tally.
      expect(out).toMatch(/^12 results in 4 dir\(s\)/)
      expect(out).toContain('.tsx(8)')
      expect(out).toContain('.ts(4)')
      // Each shared directory prefix is printed once, with its file count.
      expect(out).toContain('./packages/web-app/src/components/forms/  (5)')
      // Filenames are listed as indented bare basenames (prefix stripped).
      expect(out).toMatch(/^ {2}TextInput\.tsx$/m)
      expect(out).not.toMatch(/^ {2}\.\/packages/m)
    },
  },
  {
    name: 'find - shows at most 8 names per directory then "+N more here"',
    cmd: 'find',
    args: ['.'],
    input: FIND_MORE_HERE,
    assert: (out) => {
      expect(out).toMatch(/^12 results in 1 dir\(s\)/)
      expect(out).toContain('./src/pages/  (12)')
      expect(out).toMatch(/\n {2}\.\.\. \+4 more here$/)
    },
  },
  {
    name: 'find - caps the whole body at 50 shown entries with a "+N more" footer',
    cmd: 'find',
    args: ['.'],
    input: FIND_CAP,
    assert: (out) => {
      expect(out).toMatch(/^60 results in 10 dir\(s\)/)
      expect(out).toMatch(/\n\.\.\. \+6 more$/)
    },
  },
  {
    name: 'find - extension-less results omit the extension tally from the header',
    cmd: 'find',
    args: ['.'],
    input: FIND_NOEXT,
    assert: (out) => {
      // No dot in any basename → no `.ext(n)` suffix on the summary line.
      expect(out.split('\n')[0]).toBe('12 results in 1 dir(s)')
      expect(out).toMatch(/\n {2}\.\.\. \+4 more here$/)
    },
  },
  {
    name: 'find - small result set (≤ 10 lines) is below the trigger, passes through untouched',
    cmd: 'find',
    args: ['.'],
    input: FIND_SMALL,
    assert: (out) => {
      expect(out).toBe(FIND_SMALL)
    },
  },
])

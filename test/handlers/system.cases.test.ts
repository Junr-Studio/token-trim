import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `system` handler.
// It defines two condensers, dispatched by command name in the proxy frame:
//   - cmd 'ls'   → condenseLs   - strips the perm/owner/date columns of a
//                  `ls -la` long listing, drops the `total` line and `.`/`..`,
//                  humanizes sizes, emits a `N files, M dirs` summary with an
//                  extension tally, and caps the body at 50 entries. It filters
//                  NOTHING: a noise-dir list (node_modules/.git/dist/…) used to
//                  delete rows from the body and from the tally, which answered
//                  "is dist/ there?" with a confident no.
//   - cmd 'find' → condenseFind - caps a path list, never reshapes it: every
//                  surviving line is a path find really printed and the elision
//                  is disclosed out of band (see the note above the find cases).
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

// A project root that has been built: `dist` exists. "did the build produce a
// dist/?" is one of the two questions `ls -la` is run to answer, and `dist` was
// on the drop list, so the listing answered it wrongly and the `N dirs` tally
// backed the wrong answer up.
const LS_BUILT = `total 96
drwxr-xr-x  9 alice  staff  288 Jul 22 16:04 .
drwxr-xr-x  6 alice  staff  192 Jul 19 09:22 ..
drwxr-xr-x 12 alice  staff  384 Jul 22 16:04 .git
-rw-r--r--  1 alice  staff  186 Jul 11 14:02 .gitignore
drwxr-xr-x  4 alice  staff  128 Jul 22 12:03 dist
drwxr-xr-x 42 alice  staff 1344 Jul 22 09:41 node_modules
-rw-r--r--  1 alice  staff 2841 Jul 22 15:58 package.json
drwxr-xr-x  6 alice  staff  192 Jul 22 16:02 src
drwxr-xr-x  5 alice  staff  160 Jul 22 15:44 test`

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
  // CHANGED DELIBERATELY. This case used to assert the two lines below it:
  //
  //     expect(out).toMatch(/^5 files, 2 dirs/)
  //     expect(out).not.toContain('node_modules')
  //
  // i.e. it pinned a listing from which `node_modules`, `.git`, `dist`, `target`,
  // `coverage` and `vendor` had been deleted, AND a `dirs` count that did not
  // include them. Deleting a row from the listing is compression; deleting it
  // from the COUNT is a false statement about the filesystem, and an agent that
  // runs `ls -la` to find out whether a directory exists reads the deletion as
  // an answer. The filter is gone: `ls` printed nine entries, so nine entries
  // come back and the tally counts all of them.
  {
    name: 'ls -la - strips perm/owner/date columns, tallies extensions, humanizes sizes',
    cmd: 'ls',
    args: ['-la'],
    input: LS_LONG,
    assert: (out) => {
      // Summary header counts every entry `ls` printed: src, test, node_modules, .git.
      expect(out).toMatch(/^5 files, 4 dirs/)
      // Extension tally in the header (package.json + tsconfig.json = .json(2)).
      expect(out).toContain('.json(2)')
      // Nothing `ls` printed is missing from the body.
      expect(out).toContain('node_modules/')
      expect(out).toMatch(/(^|\n)\.git\//)
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
    name: 'ls -la - every directory ls printed is listed and counted, so "was dist/ built?" gets a true answer',
    cmd: 'ls',
    args: ['-la'],
    input: LS_BUILT,
    assert: (out) => {
      // The whole point: the agent ran `ls -la` to see whether the build landed.
      expect(out).toContain('dist/')
      expect(out).toContain('node_modules/')
      expect(out).toMatch(/(^|\n)\.git\//)
      // ls printed 5 directories besides `.` and `..`; the header says 5.
      expect(out).toMatch(/^2 files, 5 dirs/)
      // and it is still a condensed listing, not a relay of the raw rows
      expect(out).not.toContain('drwxr-xr-x')
      expect(out).not.toContain('staff')
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
  // CHANGED DELIBERATELY, and the change costs compression on purpose.
  //
  // `find` output was regrouped under per-directory headers with the basenames
  // indented beneath. That reads well and cannot be piped: not one line of it
  // is a path, so `find . -name '*.ts' | xargs prettier --write` - the reason
  // the command is run - receives headers, indented fragments and markers.
  // `find` emits a DATA LIST, so it is now capped and never reshaped, with the
  // elision disclosed on stderr (ttNotice) instead of inside the stream.
  {
    name: 'find - every output line is a path find really printed, so the list stays pipeable',
    cmd: 'find',
    args: ['.', '-name', '*.ts'],
    input: FIND_GROUPED,
    assert: (out, input) => {
      const source = new Set(input.split('\n').map((l) => l.trim()).filter(Boolean))
      for (const line of out.split('\n')) {
        expect(source.has(line), `"${line}" was never printed by find`).toBe(true)
      }
      // no header, no tally, no indent, no in-band marker
      expect(out).not.toMatch(/results in/)
      expect(out).not.toContain('.tsx(')
      expect(out).not.toMatch(/^\s/m)
      expect(out).not.toContain('more here')
    },
  },
  {
    name: 'find - a list under the cap is returned entirely, in order',
    cmd: 'find',
    args: ['.'],
    input: FIND_MORE_HERE,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
  {
    name: 'find - a list over the cap keeps head and tail, and only real paths',
    cmd: 'find',
    args: ['.'],
    input: FIND_CAP,
    assert: (out, input) => {
      const lines = out.split('\n')
      const source = input.split('\n').map((l) => l.trim()).filter(Boolean)
      expect(lines).toHaveLength(60)
      expect(lines[0]).toBe(source[0])
      expect(lines[lines.length - 1]).toBe(source[source.length - 1])
      for (const line of lines) expect(source).toContain(line)
    },
  },
  {
    name: 'find - extension-less results are treated no differently; they are still just paths',
    cmd: 'find',
    args: ['.'],
    input: FIND_NOEXT,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toMatch(/results in/)
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

  // ── ls: the long-format parser must not invent entries ─────────────────────
  {
    name: 'ls (plain) - a bare name list is not long format; nothing becomes a directory',
    cmd: 'ls',
    args: [],
    // Piped, plain `ls` prints one bare name per line. The long-format parser
    // read column 0 as the file-type flag, so every name starting with "d" was
    // reported as a directory - and any that collided with the noise-dir list
    // was deleted outright.
    input: 'docs.md\ndist\ndata.json\nsrc\nREADME.md\ndeploy.sh\n',
    assert: (out) => {
      // no fabricated directory markers
      expect(out).not.toContain('docs.md/')
      expect(out).not.toContain('data.json/')
      expect(out).not.toContain('deploy.sh/')
      // and nothing silently deleted
      expect(out).toContain('dist')
      expect(out).toContain('docs.md')
      expect(out).toContain('src')
      expect(out).toContain('README.md')
      // no invented counts for a format it did not parse
      expect(out).not.toMatch(/\d+ files, \d+ dirs/)
    },
  },
  {
    name: 'ls -l - a 4-digit size is not mistaken for the timestamp when finding the name',
    cmd: 'ls',
    args: ['-l'],
    // `(?:\d{2}:\d{2}|\d{4})\s+(.+)$` scans left to right, so the SIZE 1024
    // matched \d{4} before the clock did and the date leaked into the name.
    input: `total 24
-rw-r--r-- 1 me me 1024 Jul 22 10:00 my report 2024.txt
-rw-r--r-- 1 me me 2048 Jul 22 10:01 normal.ts
-rw-r--r-- 1 me me  512 Jul 22 10:02 small.md
drwxr-xr-x 2 me me 4096 Jul 22 10:03 src
`,
    assert: (out) => {
      expect(out).not.toContain('Jul 22')
      expect(out).not.toMatch(/10:0\d/)
      // names survive intact, spaces and all
      expect(out).toContain('my report 2024.txt')
      expect(out).toContain('normal.ts')
      expect(out).toContain('small.md')
      // the real directory is marked, and only it
      expect(out).toContain('src/')
      expect(out).toMatch(/3 files, 1 dirs/)
    },
  },
  {
    name: 'ls -l - ISO timestamps (--time-style=long-iso) parse the same way',
    cmd: 'ls',
    args: ['-l', '--time-style=long-iso'],
    input: `total 8
-rw-r--r-- 1 me me 1024 2026-07-22 10:00 alpha.ts
drwxr-xr-x 2 me me 4096 2026-07-22 10:01 beta
`,
    assert: (out) => {
      expect(out).toContain('alpha.ts')
      expect(out).toContain('beta/')
      expect(out).not.toContain('2026-07-22')
    },
  },
  {
    // `ls -lh` / `ls -lah` is arguably the most common long-format invocation
    // an agent types, and the size group was `(\d+)` - which cannot match
    // `1.2K` or `12K`. Real `-h` output is MIXED (sub-1K files still print bare
    // digits), so those rows parsed, the human-readable ones did not, and the
    // `unparsed > 0` bail then returned the whole listing untouched: the
    // wrapper cost ~40 ms of node startup and bought nothing.
    name: 'ls -lh - human-readable sizes parse, and are relayed exactly as ls printed them',
    cmd: 'ls',
    args: ['-lh'],
    input: `total 48K
-rw-r--r-- 1 boris staff 1.2K Jul 22 10:00 README.md
-rw-r--r-- 1 boris staff  340 Jul 22 10:00 index.ts
drwxr-xr-x 5 boris staff  160 Jul 22 10:00 src
-rw-r--r-- 1 boris staff  12K Jul 22 10:00 package-lock.json
-rw-r--r-- 1 boris staff 2.4M Jul 22 10:00 demo.mp4
`,
    assert: (out, input) => {
      expect(out).toMatch(/^4 files, 1 dirs/)
      // ls already humanised these; restating them in another unit would
      // invent precision it did not have, so they are relayed verbatim.
      expect(out).toContain('README.md (1.2K)')
      expect(out).toContain('package-lock.json (12K)')
      expect(out).toContain('demo.mp4 (2.4M)')
      // a bare byte count is still humanised, exactly as under plain `-l`
      expect(out).toContain('index.ts (340B)')
      expect(out).toContain('src/')
      // the verbose columns are gone - i.e. it actually compressed this time
      expect(out).not.toContain('-rw-r--r--')
      expect(out).not.toContain('staff')
      expect(out.length).toBeLessThan(input.length / 1.8)
    },
  },
  {
    // `\w{3}` is ASCII-only, so under any non-English locale the month failed
    // to match and every row was unparsed - the same total no-op as `-lh`.
    name: 'ls -l - a non-English locale month still parses; the row is not abandoned',
    cmd: 'ls',
    args: ['-l'],
    input: `total 24
-rw-r--r-- 1 boris staff 1024 janv. 22 10:00 rapport.txt
-rw-r--r-- 1 boris staff 2048 févr.  3 09:12 notes.md
drwxr-xr-x 5 boris staff  160 déc.  31 23:59 archives
`,
    assert: (out, input) => {
      expect(out).toMatch(/^2 files, 1 dirs/)
      // names survive whole; the date does not leak into them
      expect(out).toContain('rapport.txt (1KB)')
      expect(out).toContain('notes.md (2KB)')
      expect(out).toContain('archives/')
      expect(out).not.toContain('janv.')
      expect(out).not.toContain('10:00')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'ls - empty output stays empty rather than reporting "0 files, 0 dirs"',
    cmd: 'ls',
    args: [],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

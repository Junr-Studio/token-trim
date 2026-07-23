import { describe, it, expect } from 'vitest'
import { compress, describeCompression, linkHandlerFunction, passedThrough } from '../support/harness.js'
import { ARGS_HANDLER } from '../../src/handlers/args.js'
import { UNIX_MATRIX } from '../matrix/unix.matrix.js'

// The out-of-band notice channel. `ttNotice` keeps its queue on globalThis
// precisely so the frame can drain it after compress(), so a separately linked
// `ttTakeNotices` reads the very same queue the shipped proxy would.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const takeNotices = linkHandlerFunction<() => string[]>('ttTakeNotices', ARGS_HANDLER)

// Characterization + behavioral suite for the unix inspection handlers:
//   - condenseTree       (cmd 'tree')
//   - condensePs         (cmd 'ps')
//   - condenseDiskUsage  (cmd 'du' and cmd 'df')
//   - condenseSystemctl  (cmd 'systemctl')
//   - condenseJournalctl (cmd 'journalctl')

// ── tree ─────────────────────────────────────────────────────────────────────

// A small project: no directory has enough same-extension children to fold, so
// this isolates the gutter/indentation rewrite from the folding behaviour.
const TREE_SMALL = `.
├── README.md
├── package.json
├── src
│   ├── index.ts
│   └── util.ts
└── tsconfig.json

1 directory, 5 files
`

// An EMPTY directory prints no children, so "the next node is deeper" - the
// only signal the condenser has - is false for it and it came back with no
// trailing slash, rendered exactly like a file. Plain `tree` marks neither
// files nor directories, so that slash is a distinction the condenser ADDS,
// and here it added it to one of the two directories and not the other, while
// the footer it faithfully preserved still said "2 directories".
const TREE_EMPTY_DIR = `.
├── empty-dir
├── src
│   └── index.ts
└── README.md

2 directories, 2 files
`

// `tree -F` marks directories itself. Stripping that trailing slash is not a
// missing affordance, it is deleting information the input carried.
const TREE_DASH_F = `.
├── empty-dir/
├── src/
│   └── index.ts
└── README.md

2 directories, 2 files
`

describeCompression('unix', [
  {
    name: 'tree - the box-drawing gutter becomes plain indentation and the count summary survives',
    cmd: 'tree',
    input: TREE_SMALL,
    assert: (out) => {
      expect(out).not.toMatch(/[├└│─]/)
      // nesting must still be readable, and directories marked as such
      expect(out).toContain('src/')
      expect(out).toMatch(/^ {2}index\.ts$/m)
      expect(out).toMatch(/^ {2}util\.ts$/m)
      // top-level entries stay at column 0
      expect(out).toMatch(/^README\.md$/m)
      expect(out).toMatch(/^tsconfig\.json$/m)
      // the summary is the line that answers "how big is this tree"
      expect(out).toContain('1 directory, 5 files')
    },
  },
  {
    name: 'tree - an empty directory is never rendered as a file: the marking is complete or it is absent',
    cmd: 'tree',
    input: TREE_EMPTY_DIR,
    assert: (out) => {
      // Nothing tree printed may be missing.
      expect(out).toContain('empty-dir')
      expect(out).toContain('src')
      expect(out).toContain('index.ts')
      expect(out).toContain('README.md')
      expect(out).toContain('2 directories, 2 files')
      // The condenser infers directory-ness from "has children", which an
      // empty directory does not have. Marking `src/` while leaving
      // `empty-dir` bare tells the agent empty-dir is a file - a claim the
      // input never made and the preserved footer contradicts. So the marking
      // must either cover every directory the footer counts, or be absent.
      const marked = out.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('/'))
      expect([0, 2]).toContain(marked.length)
      if (marked.length > 0) expect(marked).toContain('empty-dir/')
    },
  },
  {
    name: 'tree -F - the directory marker tree itself printed is preserved, not stripped',
    cmd: 'tree',
    args: ['-F'],
    input: TREE_DASH_F,
    assert: (out) => {
      // tree was explicitly asked to mark directories; both must keep the mark.
      expect(out).toContain('empty-dir/')
      expect(out).toContain('src/')
      // and the file must not acquire one
      expect(out).toMatch(/^README\.md$/m)
      expect(out).toMatch(/^ {2}index\.ts$/m)
    },
  },

  // ── ps ───────────────────────────────────────────────────────────────────
  {
    name: 'ps aux - projects to pid/cpu/mem/command, sorted by CPU, using the header not fixed offsets',
    cmd: 'ps',
    args: ['aux'],
    input: `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1 168944 11876 ?        Ss   09:01   0:03 /sbin/init
alice     4821 12.5  3.4 1298432 279104 ?      Sl   10:02   3:21 node /srv/app/dist/server.js --port 8080
alice     4899  0.3  0.2 712004 18320 ?        Sl   10:02   0:05 /usr/bin/postgres -D /var/lib/postgresql
bob       5120 47.9  8.1 3298432 664128 ?      Rl   11:14   9:02 python3 /opt/ml/train.py --epochs 200
root       220  0.0  0.0  22884  4412 ?        Ss   09:01   0:00 /lib/systemd/systemd-journald
`,
    assert: (out, input) => {
      // busiest first - the reason anyone runs ps
      const rows = out.split('\n').filter((l) => /\d/.test(l))
      expect(rows[0]).toContain('5120')
      expect(rows[0]).toContain('47.9')
      // the command survives, at least in recognisable form
      expect(out).toContain('python3')
      expect(out).toContain('node')
      // columns nobody reads are gone
      expect(out).not.toContain('VSZ')
      expect(out).not.toContain('168944')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'ps - output with no recognisable header passes through rather than being projected',
    cmd: 'ps',
    args: [],
    input: '  PID TTY          TIME CMD\n 4821 pts/0    00:00:03 bash\n 5120 pts/0    00:00:00 ps\n',
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },
  {
    name: 'ps - empty output stays empty',
    cmd: 'ps',
    args: ['aux'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── du / df ──────────────────────────────────────────────────────────────
  {
    name: 'du - sorted biggest-first, and the numeric field is left exactly as the tool printed it',
    cmd: 'du',
    args: ['-s', 'src', 'test', 'node_modules'],
    // `du -s dir | awk '{print $1}'` and `| sort -n` both depend on the raw
    // number, so no -h humanisation may be injected or applied.
    input: '412\tsrc\n88\ttest\n189432\tnode_modules\n2048\tdist\n',
    assert: (out) => {
      const first = out.split('\n')[0]
      expect(first).toContain('node_modules')
      expect(first).toContain('189432')
      // untouched numerals: no "185M", no thousands separators
      expect(out).not.toMatch(/\d[KMG]\b/)
      expect(out).toContain('412')
      expect(out).toContain('88')
    },
  },
  // CHANGED DELIBERATELY: every assertion this case used to make was satisfied
  // by the condenser RETURNING ITS INPUT. `df` rows start with the device, not
  // the size, so the size-first row pattern failed on row 1 and the function
  // bailed - and `toContain('/')`, `toContain('48%')` and "shorter than the
  // input" (by the one trailing newline compress() trims) all still passed. The
  // assertions below are the same claims made in a way only a working condenser
  // can satisfy.
  {
    // CHANGED DELIBERATELY: dropping the device column and sorting by size read
    // well but broke `df -h /var | awk 'NR==2 {print $5}'` - the canonical way a
    // script asks how full a disk is. Dropping a column shifts every field index
    // by one; sorting moves the row NR==2 names. The du branch in the same
    // function already protected exactly this idiom, so df now does too. df
    // prints one row per mount, so there was never much to win.
    name: 'df -h - relayed as printed, because awk reads its fields by position',
    cmd: 'df',
    args: ['-h'],
    input: `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  916G  412G  458G  48% /
tmpfs            32G  2.1M   32G   1% /dev/shm
/dev/nvme0n1p1  511M  6.1M  505M   2% /boot/efi
tmpfs           6.3G  2.3M  6.3G   1% /run/user/1000
`,
    assert: (out, input) => {
      expect(out).toContain('48%')
      expect(out).toContain('916G')
      // every column survives, in df's own order
      expect(out).toContain('/dev/nvme0n1p2')
      expect(out).toContain('/dev/nvme0n1p1')
      expect(out).toBe(passedThrough(input))
      // every mount df printed is still reported, with its own numbers
      expect(out).toMatch(/(^|\n).*\b48%\s+\/$/m)
      expect(out).toContain('/dev/shm')
      expect(out).toContain('/boot/efi')
      expect(out).toContain('/run/user/1000')
      expect(out).toContain('505M')
      // It does NOT shrink, and that is the point: every transform available
      // here (dropping the source column, sorting by size) moves a field or a
      // row that awk addresses positionally. Only the row cap applies, and this
      // listing is far below it.
    },
  },
  {
    name: 'df - a row shape the parser cannot read is passed through, never partially reshaped',
    cmd: 'df',
    args: ['-h'],
    // GNU df puts an over-long device name on a line of its own and wraps the
    // numbers onto the next. Half a table is worse than a whole one.
    input: `Filesystem      Size  Used Avail Use% Mounted on
/dev/mapper/vg--data-lv--postgres--primary--replica
                916G  412G  458G  48% /var/lib/postgresql
tmpfs            32G  2.1M   32G   1% /dev/shm
`,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },
  {
    name: 'df - the inode form (-i) is relayed identically; nothing about it is special-cased',
    cmd: 'df',
    args: ['-i'],
    input: `Filesystem       Inodes  IUsed    IFree IUse% Mounted on
/dev/nvme0n1p2 61054976 812443 60242533    2% /
tmpfs           8216044     41  8216003    1% /dev/shm
`,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },
  {
    name: 'du - unrecognised shape passes through instead of being sorted into nonsense',
    cmd: 'du',
    args: ['-h', '--max-depth=1'],
    input: 'du: cannot read directory ./private: Permission denied\n',
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },

  {
    // `df -h /var | awk 'NR==2 {print $5}'` is THE df idiom in scripts, and the
    // sibling du branch in the same function carries an explicit comment
    // protecting the identical `awk '{print $1}'` pattern. Dropping the device
    // column shifts every field index by one, and sorting moves the row `NR==2`
    // refers to - so the two transforms that were being applied both break the
    // consumer. df prints a handful of rows; there was never much to win.
    name: 'df -h - field positions and row order are preserved, because awk reads them positionally',
    cmd: 'df',
    args: ['-h'],
    input: `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  916G  412G  458G  48% /
tmpfs            32G  2.1M   32G   1% /dev/shm
/dev/nvme0n1p1  511M  6.1M  505M   2% /boot/efi
`,
    assert: (out) => {
      const rows = out.split('\n')
      // the header is still the header, and the first filesystem is still first
      expect(rows[0]).toMatch(/^Filesystem/)
      expect(rows[1]).toContain('/dev/nvme0n1p2')
      // field 5 is still Use%, field 1 still the device
      for (const r of rows.slice(1)) {
        const f = r.trim().split(/\s+/)
        expect(f[0]).toMatch(/^(\/dev\/|tmpfs)/)
        expect(f[4]).toMatch(/^\d+%$/)
      }
    },
  },
  {
    name: 'ls -la over several directories - the group banners survive, so a path stays answerable',
    cmd: 'ls',
    args: ['-la', 'dist', 'src'],
    // Without the banners the two listings merge into one flat list and the
    // question the agent ran `ls` to answer - "is index.ts in src or in dist?" -
    // becomes unanswerable from the output.
    input: `dist:
total 8
-rw-r--r-- 1 me me 120 Jul 22 10:00 index.js

src:
total 8
-rw-r--r-- 1 me me 240 Jul 22 10:01 index.ts
drwxr-xr-x 2 me me 4096 Jul 22 10:02 lib
`,
    assert: (out) => {
      expect(out).toContain('dist:')
      expect(out).toContain('src:')
      expect(out).toContain('index.js')
      expect(out).toContain('index.ts')
    },
  },

  // ── journalctl ───────────────────────────────────────────────────────────
  {
    name: 'journalctl - the repeated host/unit/pid prefix is hoisted and identical lines collapse',
    cmd: 'journalctl',
    args: ['-u', 'myapp', '-n', '200'],
    input: `Jul 22 10:15:03 web-01 myapp[4821]: starting worker pool
Jul 22 10:15:03 web-01 myapp[4821]: connected to postgres
Jul 22 10:15:04 web-01 myapp[4821]: retrying upstream fetch
Jul 22 10:15:05 web-01 myapp[4821]: retrying upstream fetch
Jul 22 10:15:06 web-01 myapp[4821]: retrying upstream fetch
Jul 22 10:15:07 web-01 myapp[4821]: retrying upstream fetch
Jul 22 10:15:08 web-01 myapp[4821]: listening on 0.0.0.0:8080
`,
    assert: (out, input) => {
      // the prefix appears once, not once per line
      expect((out.match(/web-01 myapp\[4821\]/g) ?? []).length).toBeLessThanOrEqual(1)
      // the repeated line is collapsed with its count, not silently deduped
      expect(out).toMatch(/retrying upstream fetch/)
      expect(out).toMatch(/4/)
      // first and last messages survive
      expect(out).toContain('starting worker pool')
      expect(out).toContain('listening on 0.0.0.0:8080')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'journalctl - a line that is not in the syslog grammar is kept verbatim',
    cmd: 'journalctl',
    args: ['-u', 'myapp'],
    input: '-- No entries --\n',
    assert: (out) => {
      expect(out).toBe('-- No entries --')
    },
  },

  // ── systemctl ────────────────────────────────────────────────────────────
  {
    name: 'systemctl status - keeps Loaded/Active and the recent log, drops the cgroup tree',
    cmd: 'systemctl',
    args: ['status', 'myapp'],
    input: `● myapp.service - My Application
     Loaded: loaded (/etc/systemd/system/myapp.service; enabled; vendor preset: enabled)
     Active: active (running) since Tue 2026-07-22 09:01:12 UTC; 1h 14min ago
   Main PID: 4821 (node)
      Tasks: 23 (limit: 38254)
     Memory: 271.4M
        CPU: 3min 21.104s
     CGroup: /system.slice/myapp.service
             ├─4821 /usr/bin/node /srv/app/dist/server.js
             ├─4899 /usr/bin/node /srv/app/dist/worker.js
             └─4901 /usr/bin/node /srv/app/dist/scheduler.js

Jul 22 10:15:08 web-01 myapp[4821]: listening on 0.0.0.0:8080
Jul 22 10:15:09 web-01 myapp[4821]: ready
`,
    assert: (out, input) => {
      expect(out).toContain('active (running)')
      expect(out).toContain('myapp.service')
      // the cgroup process tree is the bulk and carries nothing ps cannot give
      expect(out).not.toContain('CGroup')
      expect(out).not.toContain('scheduler.js')
      // the tail of the log is why anyone runs `systemctl status`
      expect(out).toContain('ready')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'systemctl - an unrecognised shape passes through',
    cmd: 'systemctl',
    args: ['is-active', 'myapp'],
    input: 'active\n',
    assert: (out) => {
      expect(out).toBe('active')
    },
  },
])

// ── df's cap notice must describe the cut it actually made ───────────────────
//
// The notice is the ONLY disclosure df's row cap gets - stdout stays a
// byte-exact positional table on purpose, so nothing may be said in band - and
// it is therefore the whole of what the agent has to go on. condenseDf handed
// ttCapDataList the full `lines` array with the `Filesystem ...` HEADER still
// in it, so the header was counted as a filesystem: a 60-mount container host
// was reported as 61, and the nominal 40-row cap actually kept 39 mounts.
//
// The one scenario the cap exists for - the hundred-mount container listing
// its own comment cites - is exactly the scenario it miscounted.
describe('unix - df row cap discloses itself accurately', () => {
  it('counts filesystems, not the header row it is not allowed to elide', () => {
    takeNotices() // drain anything an earlier case queued
    const rows = Array.from(
      { length: 60 },
      (_, i) => `overlay        102687672  30161200  67261544  31% /var/lib/docker/overlay2/m${i}`,
    )
    const input = ['Filesystem     1K-blocks      Used Available Use% Mounted on', ...rows].join('\n') + '\n'

    const out = compress(input, 'df', [])
    const notices = takeNotices()

    expect(notices).toHaveLength(1)
    // df printed 60 filesystems and one header. The header is not a mount.
    expect(notices[0]).toContain('of 60 filesystems')
    expect(notices[0]).not.toContain('of 61 filesystems')
    // The cap is on mounts, so a 40-row cap keeps 40 mounts and drops 20.
    expect(notices[0]).toMatch(/^20 of 60 filesystems/)

    const lines = out.split('\n')
    // The header is a header: never a candidate for elision, never counted,
    // and the table it labels still starts on line 2 for `awk NR==2`.
    expect(lines[0]).toMatch(/^Filesystem/)
    expect(lines[1]).toContain('/var/lib/docker/overlay2/m0')
    expect(lines).toHaveLength(41)
    expect(lines[40]).toContain('/var/lib/docker/overlay2/m39')

    // Every surviving row is a row df really printed, unreordered and unedited.
    const source = new Set(input.split('\n').filter((l) => l.trim()))
    for (const l of lines) expect(source.has(l)).toBe(true)
  })
})

// ── the matrix's du fixture has to be output its own argv can produce ─────────
//
// A matrix entry's percentage is only worth what its fixture is worth, and
// condenseDiskUsage relays du's rows byte-identically - so the only saving the
// `du` entry can measure is the 40-row cap, i.e. it is measuring the ROW COUNT
// of the fixture and nothing else. The shipped fixture carried 18 rows three
// levels below `.` (`./apps/web/src`, `./.git/objects/pack`, ...), which
// `du --max-depth=2 .` cannot print; they were the rows that pushed it past the
// cap, so the entire advertised reduction rested on output the command could
// not produce. This is the guard that keeps that from coming back.
function duPathDepth(path: string): number {
  const rel = path.replace(/^\.\/?/, '')
  return rel === '' ? 0 : rel.split('/').length
}

describe('unix matrix - a du fixture must respect its own --max-depth', () => {
  it('du --max-depth=N prints nothing deeper than N below the argument', () => {
    const entries = UNIX_MATRIX.filter((e) => e.cmd === 'du')
    expect(entries.length, 'no du entry to check').toBeGreaterThan(0)
    for (const entry of entries) {
      const flag = (entry.args ?? []).find((a) => /^--max-depth=\d+$/.test(a))
      if (!flag) continue
      const max = Number(flag.slice('--max-depth='.length))
      const tooDeep = entry.input
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split('\t')[1] ?? '')
        .filter((p) => p !== '' && duPathDepth(p) > max)
      expect(tooDeep, `\`du ${flag}\` cannot emit these rows`).toEqual([])
    }
  })
})

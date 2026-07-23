import { describe, it, expect } from 'vitest'
import { compress, describeCompression, linkHandlerFunction, passedThrough } from '../support/harness.js'
import { ARGS_HANDLER } from '../../src/handlers/args.js'
import { GIT_HANDLER } from '../../src/handlers/git.js'

// Reference example for the per-command characterization suite.
// Each case is pure data: a realistic raw command output + behavioral
// assertions. The harness runs the real compress(), checks it shrinks, runs
// the asserts, then snapshots the exact output.

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -8,7 +8,7 @@ export function main() {
   const config = load()
   const server = createServer(config)
-  server.listen(3000)
+  server.listen(config.port ?? 3000)
   return server
 }
@@ -20,3 +20,6 @@ function load() {
   return JSON.parse(readFileSync('config.json', 'utf8'))
 }
+
+export const VERSION = '2.0.0'
`

const LOG = `a1b2c3d fix: handle null config case (2 hours ago) <alice>
e4f5g6h feat: configurable server port (5 hours ago) <bob>
9c8b7a6 chore: bump deps (1 day ago) <alice>
1122334 docs: update README (2 days ago) <carol>
`

const STATUS = `## main...origin/main [ahead 1]
 M src/app.ts
 M README.md
?? src/new-feature.ts
`

// ── machine-readable diff formats ────────────────────────────────────────────
// These carry no +/- body lines, so a condenser that only keeps +/- annihilates
// them. They exist to be machine-consumed (`git diff --name-only | xargs …`),
// so they must survive verbatim.

const DIFF_NAME_ONLY = `src/app.ts
src/handlers/git.ts
test/handlers/git.cases.test.ts
README.md
`

const DIFF_NAME_STATUS = `M	src/app.ts
A	src/handlers/helm.ts
D	src/handlers/legacy.ts
`

const DIFF_NUMSTAT = `12	4	src/app.ts
3	0	src/handlers/git.ts
-	-	assets/logo.png
`

// ── --stat: a human summary that must keep paths and churn ───────────────────
const DIFF_STAT = ` src/app.ts                      | 12 ++++++------
 src/handlers/git.ts             |  3 +++
 test/handlers/git.cases.test.ts | 40 ++++++++++++++++++++++++++++
 3 files changed, 49 insertions(+), 6 deletions(-)
`

// ── a hunk whose CONTENT starts with "-- " / "++ " ───────────────────────────
// "--" is the comment marker in SQL, Haskell, Lua and Ada, so a removed comment
// line renders as "--- <text>"; any file that quotes a patch (a CHANGELOG, a
// .patch, this repo's own fixtures) has added lines that render as "+++ <text>".
// Both are ordinary content. Read as file headers they were deleted from the
// body AND from the +N/-N count, and the added text was printed as a changed
// PATH - a file name that appears nowhere in the diff. Captured from real
// `git diff` output.
const DIFF_SQL_COMMENT = `diff --git a/db/001_init.sql b/db/001_init.sql
index 3b1c8d2..7f4a9e1 100644
--- a/db/001_init.sql
+++ b/db/001_init.sql
@@ -1,5 +1,2 @@
 -- Migration 001: initial schema
--- Author: Alice
-CREATE TABLE users (id serial primary key);
--- TODO: drop the legacy audit table before release
-DROP TABLE legacy_audit;
+CREATE TABLE users (id serial primary key, email text);
`

const DIFF_PLUS_CONTENT = `diff --git a/notes/changes.md b/notes/changes.md
index e69de29..b7a3f1c 100644
--- a/notes/changes.md
+++ b/notes/changes.md
@@ -1 +1,3 @@
 notes
+++ b/etc/shadow
+++ added a new escalation path
`

// ── entries git describes without a "+++ " line ──────────────────────────────
// A rename, a mode change and a binary change have no "+++ " line at all, and a
// deletion's says "/dev/null" - so keying the path header on "+++ " counted all
// four in "N file(s)" and then named them nowhere, printing the deleted file's
// removed lines under a heading that read "/dev/null". `git diff` before
// committing is the hottest read an agent does, and rename/delete/chmod are
// exactly what it needs to see.
const DIFF_REWORK = `diff --git a/a.txt b/a2.txt
similarity index 100%
rename from a.txt
rename to a2.txt
diff --git a/b.txt b/b.txt
index 1111111..2222222 100644
--- a/b.txt
+++ b/b.txt
@@ -1,2 +1,2 @@
 bee one
-bee two
+bee three
diff --git a/c.txt b/c.txt
deleted file mode 100644
index 3333333..0000000
--- a/c.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-gone one
-gone two
diff --git a/d.txt b/d.txt
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/d.txt
@@ -0,0 +1 @@
+dee one
diff --git a/real.bin b/real.bin
index 5555555..6666666 100644
Binary files a/real.bin and b/real.bin differ
diff --git a/sub/mod.py b/sub/mod.py
old mode 100644
new mode 100755
`

const DIFF_BINARY = `diff --git a/assets/logo.png b/assets/logo.png
index 5555555..6666666 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`

const DIFF_RENAME_MODE = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
diff --git a/scripts/deploy.sh b/scripts/deploy.sh
old mode 100644
new mode 100755
`

// ── show: the commit header and message are the point of the command ─────────
const SHOW_COMMIT = `commit 4788fefabc1234567890abcdef1234567890abcd
Author: Boris <boris@junr.studio>
Date:   Tue Jul 21 10:00:00 2026 +0200

    chore: pin publint and attw as dev dependencies

    They were unpinned npx calls, which Scorecard flags.

diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,7 @@
-  "publint": "npx publint",
+  "publint": "publint",
`

// ── blame: ~50 bytes of prefix per line of code ──────────────────────────────
// Real shape: boundary commits carry a "^" and are abbreviated to 7 hex, normal
// ones to 8; the author column is space-padded to the widest author; uncommitted
// lines are attributed to the all-zero sentinel.
const BLAME = `^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 118) export function loadConfig(file) {
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 119)   const raw = readFileSync(file, 'utf8')
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 120)   if (!raw.trim()) return {}
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 121)   return JSON.parse(raw)
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 122) }
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 123)
9f8e7d6c (Alice Smith       2026-05-02 09:41:30 +0200 124) export function saveConfig(file, cfg) {
9f8e7d6c (Alice Smith       2026-05-02 09:41:30 +0200 125)   const dir = dirname(file)
9f8e7d6c (Alice Smith       2026-05-02 09:41:30 +0200 126)   mkdirSync(dir, { recursive: true })
00000000 (Not Committed Yet 2026-07-22 11:03:44 +0200 127)   writeFileSync(file, JSON.stringify(cfg, null, 2))
00000000 (Not Committed Yet 2026-07-22 11:03:44 +0200 128) }
`

// A blank source line cannot simply be passed through: the frame's post-pass
// collapses `\n{3,}` and trims the tail, so five blank lines come back as one
// and the header above them goes on claiming a range that no longer matches
// what is printed. `git blame` is run to answer "who wrote line N", so an agent
// counting down from a header must find source line N on the Nth line.
// Standing the blanks up with a placeholder glyph fixed the arithmetic by
// inventing a character; ending the run at the gap fixes it by deleting.
const BLAME_GAP = `^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  1) import { readFileSync, writeFileSync } from 'node:fs'
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  2) import { dirname } from 'node:path'
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  3) export const CONFIG_VERSION = 2
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  4)
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  5)
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  6)
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  7)
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  8)
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100  9) export function loadConfig(file) {
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100 10)   return JSON.parse(readFileSync(file, 'utf8'))
^4788fef (Boris Bembinoff 2026-03-12 14:22:01 +0100 11) }
`

// The same defect at the end of a run: the frame's final .trim() eats a trailing
// blank line, so a header claiming two lines would print one.
const BLAME_TAIL_BLANK = `a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 1) module.exports = { loadConfig, saveConfig }
a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 2)
`

// A file whose line 2 really IS a middle dot, and the same file with line 2
// blank. Rendering a blank source line as "·" puts a character into the code
// that the command never printed, and makes these two files indistinguishable:
// the agent cannot tell a one-character line from an empty one.
const BLAME_MIDDOT = `a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 1) # Changelog
a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 2) ·
a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 3) - fix: handle null config case
`

const BLAME_MIDDOT_BLANK = `a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 1) # Changelog
a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 2)
a1b2c3d4 (Alice Smith 2026-05-02 09:41:30 +0200 3) - fix: handle null config case
`

// More than one `-L` range in a single `git blame` - how an agent asks about
// two separate hunks in one call. git prints the ranges back to back with
// NOTHING between them, so consecutive OUTPUT lines are non-consecutive SOURCE
// lines: line 2 is followed by line 40. A run keyed on the hash alone jumps the
// gap and the header claims L1-41 over the four lines it printed - the same
// "header claims lines it did not print" defect the blank-line handling above
// was written to eliminate, reached by a different route. Captured from this
// repo: `git blame -L 1,2 -L 40,41 -- package.json`, all four lines from one
// boundary commit.
const BLAME_MULTI_RANGE = `^f2b896a (Junr Studio 2026-07-20 12:00:00 +0200  1) {
^f2b896a (Junr Studio 2026-07-20 12:00:00 +0200  2)   "name": "@junr_studio/token-trim",
^f2b896a (Junr Studio 2026-07-20 12:00:00 +0200 40)       "types": "./dist/index.d.ts",
^f2b896a (Junr Studio 2026-07-20 12:00:00 +0200 41)       "import": "./dist/index.js"
`

// `--line-porcelain` is git's machine format for blame. It is not one of the
// flags `isMachineOutput` knows, so the handler has to guard it itself.
const BLAME_PORCELAIN = `4788fef0d695715cffb695047522014f50de8504 118 118 2
author Boris Bembinoff
author-mail <boris@junr.studio>
author-time 1773322921
author-tz +0100
summary feat: configurable config loader
filename src/config.js
	export function loadConfig(file) {
4788fef0d695715cffb695047522014f50de8504 119 119
author Boris Bembinoff
author-mail <boris@junr.studio>
author-time 1773322921
author-tz +0100
summary feat: configurable config loader
filename src/config.js
	  const raw = readFileSync(file, 'utf8')
`

// ── branch: local list, remote list, and the tracking column ─────────────────
const BRANCH_ALL = `  feat/extend-commands
* main
  release/2.0
  remotes/origin/HEAD -> origin/main
  remotes/origin/dependabot/npm_and_yarn/vite-5.4.11
  remotes/origin/feat/extend-commands
  remotes/origin/fix/windows-path-resolution
  remotes/origin/main
  remotes/origin/release/2.0
`

const BRANCH_VV = `* main                 4788fef [origin/main: ahead 2] chore: pin publint and attw as dev deps
  feat/extend-commands a1b2c3d [origin/feat/extend-commands: ahead 1, behind 3] wip: blame condenser
  legacy               9c8b7a6 [origin/legacy: gone] last work before the rewrite
  spike                1122334 no upstream yet
`

const BRANCH_SMALL = `  feat/extend-commands
* main
  release/2.0
`

// A caller-supplied --format is a shape only the caller knows how to read.
const BRANCH_FORMAT = `main origin/main
feat/extend-commands origin/feat/extend-commands
release/2.0
`

// ── tag: a long-lived repo has hundreds, printed in git's default lexical order
const TAGS =
  Array.from({ length: 84 }, (_, i) => `v${Math.floor(i / 20)}.${i % 20}.0`)
    .sort()
    .join('\n') + '\n'

const TAGS_FEW = `v1.0.0
v1.1.0
v1.2.0
v2.0.0
`

// ── ls-files: a bare path list, i.e. canonical `| xargs` input ───────────────
const LS_FILES =
  ['.editorconfig', '.gitignore', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'package.json', 'tsconfig.json']
    .concat(Array.from({ length: 40 }, (_, i) => `src/handlers/h${i}.ts`))
    .concat(Array.from({ length: 40 }, (_, i) => `test/handlers/h${i}.cases.test.ts`))
    .join('\n') + '\n'

const LS_FILES_FEW = `src/frame.ts
src/handlers/git.ts
src/write-proxy.ts
`

// -z is git's NUL-delimited form; splitting or trimming it corrupts the paths.
const LS_FILES_Z = 'src/frame.ts\0src/handlers/git.ts\0src/write-proxy.ts\0'

// ── remote -v: every URL is printed twice, once for fetch and once for push ──
const REMOTE_V = `origin\tgit@github.com:junr-studio/token-trim.git (fetch)
origin\tgit@github.com:junr-studio/token-trim.git (push)
upstream\thttps://github.com/token-trim/token-trim.git (fetch)
upstream\thttps://github.com/token-trim/token-trim.git (push)
`

// A push URL that differs from the fetch URL is the whole reason -v exists.
const REMOTE_V_SPLIT = `origin\thttps://github.com/acme/app.git (fetch)
origin\tgit@github.com:acme/app.git (push)
`

const REMOTE_SHOW = `* remote origin
  Fetch URL: git@github.com:junr-studio/token-trim.git
  Push  URL: git@github.com:junr-studio/token-trim.git
  HEAD branch: main
  Remote branches:
    main   tracked
    v2-dev tracked
`

// ── reflog: newest first, and every line repeats the ref it belongs to ───────
const REFLOG =
  [
    '4788fef HEAD@{0}: commit: chore: pin publint and attw as dev dependencies',
    'a1b2c3d HEAD@{1}: checkout: moving from feat/extend-commands to main',
    '9c8b7a6 HEAD@{2}: commit: feat: collapse contiguous git blame runs',
    '1122334 HEAD@{3}: pull origin main: Fast-forward',
  ]
    .concat(
      Array.from(
        { length: 48 },
        (_, i) => `abc${String(i).padStart(4, '0')} HEAD@{${i + 4}}: commit: chore: routine change ${i}`,
      ),
    )
    .join('\n') + '\n'

// `--date=iso` puts a timestamp where the index normally is.
const REFLOG_DATED = `4788fef HEAD@{2026-07-21 11:54:37 +0200}: commit: chore: pin publint
a1b2c3d HEAD@{2026-07-21 09:12:03 +0200}: checkout: moving from main to feat/x
`

// ── stash list ───────────────────────────────────────────────────────────────
const STASH_LIST = `stash@{0}: WIP on main: 4788fef chore: pin publint and attw as dev dependencies
stash@{1}: On feat/extend-commands: blame condenser, half finished
stash@{2}: WIP on main: a1b2c3d fix: handle null config case
`

// ── worktree list: a column-aligned table whose padding grows with the longest path
const WORKTREE_LIST = `/home/boris/projects/token-trim                    4788fef [main]
/home/boris/projects/token-trim/wt-blame           a1b2c3d [feat/blame-condenser]
/home/boris/projects/token-trim/wt-detached        9c8b7a6 (detached HEAD)
/home/boris/projects/token-trim/wt-bare            (bare)
`

// ── shortlog: grouped subjects sit under a 6-space indent, one blank per group
const SHORTLOG = `Alice Smith (4):
      fix: handle null config case
      feat: configurable server port
      chore: bump deps
      docs: rewrite the contributing guide

Bob Jones (2):
      test: cover the blame condenser
      refactor: split the git handler by subcommand

Carol Danvers (1):
      docs: update README
`

const SHORTLOG_SN = `   142\tAlice Smith
    87\tBob Jones
     3\tCarol Danvers
`

// `git shortlog -w60` wraps a long subject and indents the continuation by 9
// spaces (indent1=6, indent2=9). A continuation is not another commit: this
// group holds 5 commits across 18 physical lines. Counting physical lines makes
// `seen` overshoot the declared 5, which truncated the group mid-subject and
// printed a NEGATIVE overflow count.
const SHORTLOG_W60 = `Alice Smith (5):
      refactor: split the git handler into one condenser per
         subcommand shape so that no output is ever parsed
         by two functions and an unrecognised shape is
         handed straight back
      feat: collapse contiguous git blame runs under a
         single attribution header that carries the line
         range the run covers instead of repeating fifty
         bytes of prefix per line
      fix: stop the shortlog condenser from counting a
         wrapped continuation line as another commit
         subject, which truncated a group at ten physical
         lines and cut a subject in half
      test: cover every git subcommand with a realistic
         captured fixture and a behavioural assertion rather
         than a bare snapshot
      docs: explain in the handler header why a condenser
         that cannot recognise its input has to return the
         text unchanged
`

// The same wrapping, but the group genuinely overflows the per-author cap:
// 14 commits over 22 physical lines, so 10 are kept and 4 are elided.
const SHORTLOG_W60_OVERFLOW = `Bob Jones (14):
      fix: handle a null config file without throwing on the
         first read
      feat: configurable server port
      chore: bump deps
      docs: rewrite the contributing guide so a first-time
         contributor can get a working checkout without
         asking
      test: cover the blame condenser
      refactor: split the git handler by subcommand
      fix: keep the stash@{n} handle exactly as git printed
         it because that is the argument git stash pop takes
      perf: stop re-splitting the same text in every
         condenser
      chore: pin publint and attw as dev dependencies
      fix: do not reshape machine-readable output
      feat: cap the reflog at forty entries and say so in
         the header
      test: add a regression case for the negative overflow
         count
      chore: drop the unused graph gutter helper
      docs: note that a bare path list is canonical xargs
         input
`

// `-w<width>,<indent1>,<indent2>` lets the caller flatten the two indents into
// one. git still wraps at <width> - it just stops MARKING the continuation, so
// there is nothing on the line itself that says whether it opens a new commit
// or continues the one above. These are 4 subjects wrapped at 60 with both
// indents set to 6, i.e. 12 physical lines under a header that says "(4)".
const SHORTLOG_W60_FLAT = `Alice Smith (4):
      refactor: split the git handler into one condenser per
      subcommand shape so that no output is ever parsed by
      two functions
      feat: collapse contiguous git blame runs under a
      single attribution header that carries the line range
      the run covers
      fix: stop the shortlog condenser from counting a
      wrapped continuation line as another commit subject of
      its own
      docs: explain in the handler header why a condenser
      that cannot recognise its input has to hand the text
      straight back
`

// The same flattened indents, but no subject is long enough to reach the wrap
// column: every physical line really is its own commit and must stay one.
const SHORTLOG_W60_FLAT_SHORT = `Bob Jones (3):
      test: cover the blame condenser
      chore: bump deps
      docs: update README
`

// Flattened indents, and this group genuinely overflows the per-author cap:
// 12 commits over 17 physical lines, so 10 are kept and 2 are elided - not the
// 7 a physical-line count would have reported.
const SHORTLOG_W60_FLAT_OVERFLOW = `Carol Danvers (12):
      fix: handle a null config file without throwing on the
      first read
      feat: configurable server port
      chore: bump deps
      docs: rewrite the contributing guide so a first-time
      contributor can get a working checkout
      test: cover the blame condenser
      refactor: split the git handler by subcommand
      fix: keep the stash handle exactly as git printed it
      because that is the argument git stash pop takes
      perf: stop re-splitting the same text in every
      condenser
      chore: pin publint and attw as dev dependencies
      fix: do not reshape machine-readable output
      feat: cap the reflog at forty entries and say so in
      the header
      chore: drop the unused graph gutter helper
`

// The case flattened indents cannot be talked out of: subject 1 ends 58 columns
// wide, and subject 2 opens with a 9-letter word that would not have fitted
// after it. Nothing distinguishes that from a wrap, so the reconstruction reads
// two commits as one - and disagrees with the "(2)" git printed in the header.
const SHORTLOG_W60_FLAT_AMBIGUOUS = `Dave Lee (2):
      fix: keep the stash handle exactly as git printed it
      refactor: split the git handler by subcommand
`

// ── log --graph: an ASCII gutter down the left of every single line ──────────
// Captured from a real merge, so the gutter widens to two columns and back and
// the message indent sits *behind* the gutter.
const GRAPH_LOG = `*   commit af8531b54386647b1833a54acd0b29b627aaea06
|\\  Merge: 1955427 ab2cb23
| | Author: Bob Jones <bob@example.com>
| | Date:   Wed Jul 22 15:14:53 2026 +0200
| |
| |     Merge branch 'feat/alpha2'
| |
| * commit ab2cb2336df3e14c3563bc970e0896e1a19f3374
| | Author: Bob Jones <bob@example.com>
| | Date:   Wed Jul 22 15:14:52 2026 +0200
| |
| |     feat: add alpha
| |
* | commit 195542757d47932d1892cd24a89808ff704482f6
|/  Author: Alice Smith <alice@example.com>
|   Date:   Wed Jul 22 14:57:23 2026 +0200
|
|       fix: handle null config case
|
* commit 85fb44bf79c417241e52262171c8790c4fb578de
| Author: Alice Smith <alice@example.com>
| Date:   Wed Jul 22 14:57:23 2026 +0200
|
|     chore: bump deps
`

const GRAPH_ONELINE = `*   af8531b Merge branch 'feat/alpha2'
|\\
| * ab2cb23 feat: add alpha
* | 1955427 fix: handle null config case
|/
* 85fb44b chore: bump deps
`

const LOG_STAT = `commit 4788fef0d695715cffb695047522014f50de8504
Author: Boris Bembinoff <boris@junr.studio>
Date:   Tue Jul 21 11:54:37 2026 +0200

    chore: pin publint and attw as dev dependencies

 package.json      | 4 ++--
 package-lock.json | 8 ++++----
 2 files changed, 6 insertions(+), 6 deletions(-)

commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678
Author: Alice Smith <alice@example.com>
Date:   Mon Jul 20 09:12:03 2026 +0200

    feat: collapse contiguous git blame runs

 src/handlers/git.ts             | 62 ++++++++++++++++++++++++++++++++++
 test/handlers/git.cases.test.ts | 41 +++++++++++++++++++++++++++++
 2 files changed, 103 insertions(+)
`

// The gutter also hides "diff --git" from the frame's diff sniff, so a graphed
// patch arrives at the log condenser and has to be handed to condenseDiff here.
const GRAPH_PATCH = `*   commit af8531b54386647b1833a54acd0b29b627aaea06
|\\  Merge: 1955427 ab2cb23
| | Author: Bob Jones <bob@example.com>
| | Date:   Wed Jul 22 15:14:53 2026 +0200
| |
| |     Merge branch 'feat/alpha2'
| |
| * commit ab2cb2336df3e14c3563bc970e0896e1a19f3374
| | Author: Bob Jones <bob@example.com>
| | Date:   Wed Jul 22 15:14:52 2026 +0200
| |
| |     feat: add alpha
| |
| | diff --git a/a.txt b/a.txt
| | new file mode 100644
| | index 0000000..4a58007
| | --- /dev/null
| | +++ b/a.txt
| | @@ -0,0 +1 @@
| | +alpha
`

// What `git log --stat` actually produces once rewriteGitArgs has injected its
// --pretty format: no "commit <sha>" blocks at all, just a subject line per
// commit followed by that commit's stat rows. Captured from this repo.
const LOG_STAT_PRETTY = `4788fef chore: pin publint and attw as dev dependencies (28 hours ago) <Junr Studio>
 .github/workflows/ci.yml |   4 +-
 CHANGELOG.md             |  11 ++-
 package.json             |   6 +-
 3 files changed, 14 insertions(+), 7 deletions(-)

6374018 chore: harden supply-chain posture and fix license badge (2 days ago) <Junr Studio>
 .github/workflows/scorecard.yml | 42 ++++++++++++++++++++++++++++++++++++++++++
 README.md                       |  2 +-
 2 files changed, 43 insertions(+), 1 deletion(-)
`

/**
 * The property every `git blame` header has to keep: an agent that reads
 * "L118-122" and counts down from the next line must land on source line 122.
 * So the number of code lines printed under a header must equal the width of
 * the range it claims - which is what the "·" placeholder was invented to
 * protect, and what dropping the blank line and restarting the run protects
 * without putting a character into the code.
 */
function expectBlameRangesMatchPrintedLines(out: string): void {
  const HEADER = /^\S+ <.+> \d{4}-\d{2}-\d{2}  L(\d+)(?:-(\d+))?$/
  let claimed: number | null = null
  let printed = 0
  const check = (): void => {
    if (claimed !== null) expect(printed).toBe(claimed)
  }
  for (const line of out.split('\n')) {
    const m = line.match(HEADER)
    if (!m) {
      printed++
      continue
    }
    check()
    claimed = m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1
    printed = 0
  }
  check()
}

describeCompression('git', [
  {
    name: 'diff --name-only - machine format survives verbatim (was annihilated to "0 file(s)")',
    cmd: 'git',
    args: ['diff', '--name-only'],
    input: DIFF_NAME_ONLY,
    assert: (out) => {
      // every path must still be there, one per line, in order
      expect(out.split('\n')).toEqual([
        'src/app.ts',
        'src/handlers/git.ts',
        'test/handlers/git.cases.test.ts',
        'README.md',
      ])
      expect(out).not.toContain('0 file(s)')
    },
  },
  {
    name: 'diff --name-status - status letters survive verbatim',
    cmd: 'git',
    args: ['diff', '--name-status'],
    input: DIFF_NAME_STATUS,
    assert: (out) => {
      expect(out).toBe(passedThrough(DIFF_NAME_STATUS))
      expect(out).not.toContain('0 file(s)')
    },
  },
  {
    name: 'diff --numstat - binary rows (-\t-\tpath) are not miscounted as removals',
    cmd: 'git',
    args: ['diff', '--numstat'],
    input: DIFF_NUMSTAT,
    assert: (out) => {
      expect(out).toBe(passedThrough(DIFF_NUMSTAT))
      expect(out).toContain('assets/logo.png')
      expect(out).not.toContain('-1')
    },
  },
  {
    name: 'diff --stat - keeps every path, its churn, and the totals line',
    cmd: 'git',
    args: ['diff', '--stat'],
    input: DIFF_STAT,
    assert: (out) => {
      expect(out).toContain('src/app.ts')
      expect(out).toContain('src/handlers/git.ts')
      expect(out).toContain('test/handlers/git.cases.test.ts')
      // the totals line is the single most useful line in a stat block
      expect(out).toMatch(/3 files changed/)
      expect(out).toMatch(/49 insertions/)
      expect(out).not.toContain('0 file(s)')
    },
  },
  {
    name: 'show --stat - commit header is condensed, not dumped raw into the stat rows',
    cmd: 'git',
    args: ['show', '--stat', 'HEAD'],
    input: `commit 4788fef0d695715cffb695047522014f50de8504
Author: Junr Studio <boris@junr.studio>
Date:   Tue Jul 21 11:54:37 2026 +0200

    chore: pin publint and attw as dev dependencies

    Invoke them through npm scripts instead of unpinned npx.

 package.json      | 4 ++--
 package-lock.json | 8 ++++----
 2 files changed, 6 insertions(+), 6 deletions(-)
`,
    assert: (out) => {
      // header is condensed the same way `git show` condenses it
      expect(out).toContain('4788fef')
      expect(out).toContain('chore: pin publint and attw as dev dependencies')
      // ...not dumped verbatim: no 40-char hash, no field labels, no email
      expect(out).not.toContain('4788fef0d695715cffb695047522014f50de8504')
      expect(out).not.toContain('Author:')
      expect(out).not.toContain('Date:')
      expect(out).not.toContain('boris@junr.studio')
      // and the stat block still summarises correctly
      expect(out).toContain('2 files changed')
      expect(out).toContain('package.json')
    },
  },
  {
    name: 'show - the commit hash, author and message survive alongside the diff',
    cmd: 'git',
    args: ['show'],
    input: SHOW_COMMIT,
    assert: (out) => {
      expect(out).toContain('4788fef')
      expect(out).toContain('chore: pin publint and attw as dev dependencies')
      expect(out).toContain('Boris')
      // and the patch is still condensed, not passed through whole
      expect(out).not.toContain('index 1111111')
      expect(out).toContain('publint')
    },
  },
  {
    name: 'diff - drops hunk/index headers, keeps +/- and a summary',
    cmd: 'git',
    args: ['diff'],
    input: DIFF,
    assert: (out) => {
      expect(out).not.toMatch(/^@@ /m)
      expect(out).not.toContain('index 1234567')
    },
  },
  {
    name: 'diff - a removed line whose content starts with "-- " is a REMOVAL, not a file header',
    cmd: 'git',
    args: ['diff', '--', 'db/001_init.sql'],
    input: DIFF_SQL_COMMENT,
    assert: (out) => {
      // git removed four lines here. Two of them are SQL comments, so git
      // renders them as "--- <text>" - which used to be swallowed by the
      // file-header skip, deleting them from the body AND from the count.
      expect(out).toContain('+1 -4')
      expect(out).toContain('- -- Author: Alice')
      expect(out).toContain('- -- TODO: drop the legacy audit table before release')
      expect(out).toContain('- DROP TABLE legacy_audit;')
      // exactly one file was touched, so exactly one path heading
      expect(out.split('\n').filter((l) => l.startsWith('── '))).toEqual(['── db/001_init.sql'])
    },
  },
  {
    name: 'diff - an added line whose content starts with "++ " is an ADDITION, not a changed path',
    cmd: 'git',
    args: ['diff', '--', 'notes/changes.md'],
    input: DIFF_PLUS_CONTENT,
    assert: (out) => {
      // This diff adds two lines. Both used to be printed as file headings -
      // naming "etc/shadow", a file nothing in the diff touches - while the
      // summary said "+0 -0", i.e. "nothing changed", for a real change.
      expect(out).toContain('+2 -0')
      expect(out).not.toContain('+0 -0')
      expect(out).toContain('+ ++ b/etc/shadow')
      expect(out).toContain('+ ++ added a new escalation path')
      expect(out.split('\n').filter((l) => l.startsWith('── '))).toEqual(['── notes/changes.md'])
    },
  },
  {
    name: 'diff - every entry is named, including the rename, the deletion, the binary and the chmod',
    cmd: 'git',
    args: ['diff', 'HEAD~1', 'HEAD'],
    input: DIFF_REWORK,
    assert: (out) => {
      const headings = out.split('\n').filter((l) => l.startsWith('── '))
      // six entries counted, six entries named - the count and the body agree
      expect(out).toContain('6 file(s)')
      expect(headings).toEqual([
        '── a.txt -> a2.txt (rename)',
        '── b.txt',
        '── c.txt (deleted)',
        '── d.txt (new)',
        '── real.bin',
        '── sub/mod.py (mode 100644 -> 100755)',
      ])
      // the deleted file's removed lines belong to c.txt; they used to be
      // printed under a heading that read "/dev/null"
      expect(out).not.toContain('/dev/null')
      expect(out).toContain('- gone one')
      // a binary change is not silently "+0 -0" with no file name: git's own
      // sentence survives under the path
      expect(out).toContain('Binary files a/real.bin and b/real.bin differ')
      expect(out).toContain('+2 -3')
    },
  },
  {
    name: 'diff - a binary-only change keeps the file name and git’s "differ" line',
    cmd: 'git',
    args: ['diff', '--', 'assets/logo.png'],
    input: DIFF_BINARY,
    assert: (out) => {
      // This used to condense to exactly "diff: 1 file(s)  +0 -0": the file
      // name deleted, and a real change reading as "nothing changed".
      expect(out).toContain('── assets/logo.png')
      expect(out).toContain('Binary files a/assets/logo.png and b/assets/logo.png differ')
    },
  },
  {
    name: 'diff - a pure rename and a pure mode change name both paths (the only information they carry)',
    cmd: 'git',
    args: ['diff', 'HEAD~1', 'HEAD'],
    input: DIFF_RENAME_MODE,
    assert: (out) => {
      // Neither entry has a "+++ " line, so both used to condense to nothing
      // but "diff: 2 file(s)  +0 -0" - two files declared changed and not one
      // of the four paths involved printed anywhere.
      expect(out.split('\n').filter((l) => l.startsWith('── '))).toEqual([
        '── src/old-name.ts -> src/new-name.ts (rename)',
        '── scripts/deploy.sh (mode 100644 -> 100755)',
      ])
    },
  },
  {
    name: 'log - passes an already-compact pretty log through cleanly',
    cmd: 'git',
    args: ['log'],
    input: LOG,
    assert: (out) => {
      expect(out).toContain('a1b2c3d')
    },
  },
  {
    name: 'status - short/branch format stays compact',
    cmd: 'git',
    args: ['status'],
    input: STATUS,
    assert: (out) => {
      expect(out).toContain('src/new-feature.ts')
    },
  },
  {
    name: 'blame - contiguous lines from one commit collapse to a single attribution header, code keeps its indentation',
    cmd: 'git',
    args: ['blame', 'src/config.js'],
    input: BLAME,
    assert: (out, input) => {
      // three commits -> three headers, with the line range they cover.
      // Line 123 is blank, so it is dropped and the run it ended stops at 122:
      // the header states the lines that are actually printed under it. It used
      // to say L118-123 and print a "·" for 123 - a character the file never
      // contained, and one that a source line reading "·" would collide with.
      expect(out).toContain('4788fef <Boris Bembinoff> 2026-03-12  L118-122')
      expect(out).not.toContain('·')
      expect(out).toContain('9f8e7d6 <Alice Smith> 2026-05-02  L124-126')
      // the all-zero sentinel is spelled out; "0000000" reads like a real hash
      expect(out).toContain('uncommitted <Not Committed Yet> 2026-07-22  L127-128')
      // the per-line prefix is gone from the code itself...
      expect(out).not.toMatch(/^\^?[0-9a-f]{7,8} \(/m)
      expect(out).not.toContain('+0100')
      // ...and the code survives verbatim, indentation included
      expect(out).toContain("  const raw = readFileSync(file, 'utf8')")
      expect(out).toContain('  writeFileSync(file, JSON.stringify(cfg, null, 2))')
      expect(out.length).toBeLessThan(input.length / 2)
      expectBlameRangesMatchPrintedLines(out)
    },
  },
  {
    name: 'blame - a gap of blank source lines splits the run, so no header claims a line it did not print',
    cmd: 'git',
    args: ['blame', 'f.ts'],
    input: BLAME_GAP,
    assert: (out) => {
      // This case used to expect one header claiming L1-11 with five "·"
      // placeholders standing in for the blank lines 4-8. The placeholder was
      // invented content: no such character is anywhere in the file, and a
      // source line whose content really is "·" became indistinguishable from
      // an empty one. Blank lines are DROPPED instead - deleting is always
      // allowed - and the run restarts after the gap, which keeps the property
      // the placeholder existed to protect: counting down from a header lands
      // on the right source line.
      const lines = out.split('\n')
      expect(lines).toEqual([
        '4788fef <Boris Bembinoff> 2026-03-12  L1-3',
        "import { readFileSync, writeFileSync } from 'node:fs'",
        "import { dirname } from 'node:path'",
        'export const CONFIG_VERSION = 2',
        '4788fef <Boris Bembinoff> 2026-03-12  L9-11',
        'export function loadConfig(file) {',
        "  return JSON.parse(readFileSync(file, 'utf8'))",
        '}',
      ])
      expect(out).not.toContain('·')
      expectBlameRangesMatchPrintedLines(out)
    },
  },
  {
    name: 'blame - a trailing blank line is dropped rather than stood in for, and the range shrinks to match',
    cmd: 'git',
    args: ['blame', 'index.js'],
    input: BLAME_TAIL_BLANK,
    assert: (out) => {
      // Also a rewritten case: the old expectation was a "·" third line under a
      // header claiming L1-2, which only existed because the frame's final
      // .trim() eats a truly blank last line. Dropping line 2 and claiming L1
      // says the same thing without adding a character to the file.
      expect(out.split('\n')).toEqual([
        'a1b2c3d <Alice Smith> 2026-05-02  L1',
        'module.exports = { loadConfig, saveConfig }',
      ])
      expectBlameRangesMatchPrintedLines(out)
    },
  },
  {
    name: 'blame - a source line that really is “·” stays distinguishable from a blank one',
    cmd: 'git',
    args: ['blame', 'CHANGELOG.md'],
    input: BLAME_MIDDOT,
    assert: (out) => {
      // The file's own middle dot survives, on the line it was written on.
      expect(out.split('\n')).toEqual([
        'a1b2c3d <Alice Smith> 2026-05-02  L1-3',
        '# Changelog',
        '·',
        '- fix: handle null config case',
      ])
      // The same file with line 2 BLANK has to read differently: a blank line
      // is dropped and the run restarts, so nothing is invented and every
      // header still covers exactly the lines printed under it.
      const blank = compress(BLAME_MIDDOT_BLANK, 'git', ['blame', 'CHANGELOG.md'])
      expect(blank.split('\n')).toEqual([
        'a1b2c3d <Alice Smith> 2026-05-02  L1',
        '# Changelog',
        'a1b2c3d <Alice Smith> 2026-05-02  L3',
        '- fix: handle null config case',
      ])
      expect(blank).not.toBe(out)
    },
  },
  {
    name: 'blame -L 1,2 -L 40,41 - a run that spans a gap in the printed line numbers is split, so no header claims the lines between the ranges',
    cmd: 'git',
    args: ['blame', '-L', '1,2', '-L', '40,41', '--', 'package.json'],
    input: BLAME_MULTI_RANGE,
    assert: (out) => {
      // One commit, two ranges, two headers. Keying the run on the hash alone
      // emitted a single "L1-41" header over these four lines: an agent that
      // counts down from it lands on source line 4, which git never printed.
      expect(out.split('\n')).toEqual([
        'f2b896a <Junr Studio> 2026-07-20  L1-2',
        '{',
        '  "name": "@junr_studio/token-trim",',
        'f2b896a <Junr Studio> 2026-07-20  L40-41',
        '      "types": "./dist/index.d.ts",',
        '      "import": "./dist/index.js"',
      ])
      expect(out).not.toContain('L1-41')
      expectBlameRangesMatchPrintedLines(out)
    },
  },
  {
    name: 'blame --line-porcelain - git’s own machine format is left parseable',
    cmd: 'git',
    args: ['blame', '--line-porcelain', 'src/config.js'],
    input: BLAME_PORCELAIN,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('L118')
    },
  },
  {
    name: 'branch -a - locals stay one per line, remotes collapse onto a single line',
    cmd: 'git',
    args: ['branch', '-a'],
    input: BRANCH_ALL,
    assert: (out) => {
      expect(out.split('\n')[0]).toBe('[git] 3 local, 6 remote branches')
      // the checked-out branch keeps its marker
      expect(out).toContain('* main')
      // remotes are one line, and the "remotes/" bookkeeping prefix is gone
      const remoteLine = out.split('\n').find((l) => l.startsWith('remote: '))
      expect(remoteLine).toBeDefined()
      expect(remoteLine).toContain('origin/fix/windows-path-resolution')
      expect(remoteLine).toContain('origin/HEAD -> origin/main')
      expect(out).not.toContain('remotes/origin')
    },
  },
  {
    name: 'branch -vv - keeps ahead/behind and gone markers, drops the padding and the redundant upstream name',
    cmd: 'git',
    args: ['branch', '-vv'],
    input: BRANCH_VV,
    assert: (out) => {
      expect(out).toContain('* main 4788fef [ahead 2] chore: pin publint and attw as dev deps')
      expect(out).toContain('feat/extend-commands a1b2c3d [ahead 1, behind 3] wip: blame condenser')
      expect(out).toContain('legacy 9c8b7a6 [gone] last work before the rewrite')
      // a branch with no upstream keeps its subject and gains no bracket
      expect(out).toContain('spike 1122334 no upstream yet')
      // the upstream name is only dropped where it repeats the branch name
      expect(out).not.toContain('origin/main:')
      expect(out).not.toMatch(/ {3}/)
    },
  },
  {
    name: 'branch - a three-branch list has nothing to gain and is left alone',
    cmd: 'git',
    args: ['branch'],
    input: BRANCH_SMALL,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('[git]')
    },
  },
  {
    name: 'branch --format - a caller-defined shape is never reinterpreted',
    cmd: 'git',
    args: ['branch', '--format=%(refname:short) %(upstream:short)'],
    input: BRANCH_FORMAT,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('[git]')
    },
  },
  {
    name: 'tag - a long list is capped in place, keeping the newest-looking entries at the end',
    cmd: 'git',
    args: ['tag'],
    input: TAGS,
    // CHANGED DELIBERATELY: the elision marker used to sit INSIDE the list.
    // `git tag | xargs -I{} git show {}` would then be handed the marker's
    // words as tag names. The disclosure moved out of band (stderr, via
    // ttNotice) so stdout carries only tags git actually printed.
    assert: (out) => {
      const lines = out.split('\n')
      // 5 oldest + 35 newest, and nothing else
      expect(lines).toHaveLength(40)
      expect(lines[0]).toBe('v0.0.0')
      expect(lines[lines.length - 1]).toBe('v4.3.0')
      // every line is a tag, not a message about tags
      for (const l of lines) expect(l).toMatch(/^v\d+\.\d+\.\d+$/)
      // the elided middle really is gone, and nothing was reordered
      expect(out).not.toContain('v1.13.0')
      expect(lines).toEqual([...lines].sort())
    },
  },
  {
    name: 'tag - a list under the cap is left exactly as git printed it',
    cmd: 'git',
    args: ['tag'],
    input: TAGS_FEW,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('elided')
    },
  },
  {
    name: 'tag - a repo with no tags stays empty rather than reporting "0 tags"',
    cmd: 'git',
    args: ['tag'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
  {
    name: 'ls-files - a long path list is only capped: never indented, grouped or reordered',
    cmd: 'git',
    args: ['ls-files'],
    input: LS_FILES,
    // CHANGED DELIBERATELY, same reason as the tag case: `git ls-files | xargs
    // prettier --write` is the canonical use, and an inline marker becomes six
    // filenames that do not exist. stdout is pure path data now.
    assert: (out) => {
      const lines = out.split('\n')
      expect(lines).toHaveLength(60)
      expect(lines[0]).toBe('.editorconfig')
      expect(lines[lines.length - 1]).toBe('test/handlers/h39.cases.test.ts')
      // EVERY line is a usable path: no indent, no bullet, no marker, no header
      for (const l of lines) expect(l).toMatch(/^[\w.][\w./-]*$/)
      expect(out).not.toContain('[git]')
      expect(out).not.toContain('elided')
      expect(out).not.toContain('--full')
    },
  },
  {
    name: 'ls-files - a short path list is handed back byte for byte',
    cmd: 'git',
    args: ['ls-files'],
    input: LS_FILES_FEW,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },
  {
    name: 'ls-files -z - the NUL-delimited form stays splittable on NUL',
    cmd: 'git',
    args: ['ls-files', '-z'],
    input: LS_FILES_Z,
    assert: (out) => {
      expect(out.split('\0').filter(Boolean)).toEqual([
        'src/frame.ts',
        'src/handlers/git.ts',
        'src/write-proxy.ts',
      ])
    },
  },
  {
    name: 'remote -v - a remote whose fetch and push URL agree is printed once',
    cmd: 'git',
    args: ['remote', '-v'],
    input: REMOTE_V,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        'origin git@github.com:junr-studio/token-trim.git',
        'upstream https://github.com/token-trim/token-trim.git',
      ])
    },
  },
  {
    name: 'remote -v - a push URL that differs from the fetch URL keeps both, labelled',
    cmd: 'git',
    args: ['remote', '-v'],
    input: REMOTE_V_SPLIT,
    assert: (out) => {
      expect(out).toContain('origin https://github.com/acme/app.git (fetch)')
      expect(out).toContain('origin git@github.com:acme/app.git (push)')
    },
  },
  {
    name: 'remote show - a shape the handler does not parse is handed back',
    cmd: 'git',
    args: ['remote', 'show', 'origin'],
    input: REMOTE_SHOW,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
    },
  },
  {
    name: 'reflog - the ref is stated once in a header that spells out the index syntax, and the oldest entries are capped away',
    cmd: 'git',
    args: ['reflog'],
    input: REFLOG,
    assert: (out) => {
      const lines = out.split('\n')
      expect(lines[0]).toBe(
        '[git] 52 reflog entries, index n is HEAD@{n} (40 shown, --full for all)',
      )
      expect(lines[1]).toBe('@{0} 4788fef commit: chore: pin publint and attw as dev dependencies')
      expect(lines).toHaveLength(41)
      // the ref name is stated once, not repeated on all 52 entries
      expect(lines.slice(1).join('\n')).not.toContain('HEAD@{')
      expect(out).toContain('@{39} ')
      expect(out).not.toContain('@{40} ')
    },
  },
  {
    name: 'reflog --date=iso - a timestamped index is a shape we do not parse, so nothing is touched',
    cmd: 'git',
    args: ['reflog', '--date=iso'],
    input: REFLOG_DATED,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('[git]')
    },
  },
  {
    name: 'stash list - drops the "WIP on"/"On" boilerplate but keeps the stash@{n} handle intact',
    cmd: 'git',
    args: ['stash', 'list'],
    input: STASH_LIST,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        'stash@{0} main 4788fef chore: pin publint and attw as dev dependencies',
        'stash@{1} feat/extend-commands blame condenser, half finished',
        'stash@{2} main a1b2c3d fix: handle null config case',
      ])
      // the handle is what "git stash pop <handle>" takes; a bare "@{0}" is not it
      expect(out).toContain('stash@{2}')
    },
  },
  {
    name: 'worktree list - column padding goes, every path stays exactly as git printed it',
    cmd: 'git',
    args: ['worktree', 'list'],
    input: WORKTREE_LIST,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        '/home/boris/projects/token-trim 4788fef [main]',
        '/home/boris/projects/token-trim/wt-blame a1b2c3d [feat/blame-condenser]',
        '/home/boris/projects/token-trim/wt-detached 9c8b7a6 (detached HEAD)',
        '/home/boris/projects/token-trim/wt-bare (bare)',
      ])
    },
  },
  {
    name: 'shortlog - keeps every author, count and subject; drops the 6-space indent and the group blanks',
    cmd: 'git',
    args: ['shortlog'],
    input: SHORTLOG,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        'Alice Smith (4):',
        '  fix: handle null config case',
        '  feat: configurable server port',
        '  chore: bump deps',
        '  docs: rewrite the contributing guide',
        'Bob Jones (2):',
        '  test: cover the blame condenser',
        '  refactor: split the git handler by subcommand',
        'Carol Danvers (1):',
        '  docs: update README',
      ])
    },
  },
  {
    name: 'shortlog -w60 - a wrapped subject is one commit, not one per physical line (was "+-5 more", cut mid-subject)',
    cmd: 'git',
    args: ['shortlog', '-w60'],
    input: SHORTLOG_W60,
    assert: (out) => {
      const lines = out.split('\n')
      // 5 commits declared, 5 subjects printed: nothing was elided...
      expect(lines).toHaveLength(6)
      expect(lines[0]).toBe('Alice Smith (5):')
      expect(out).not.toContain('more (--full)')
      // ...so no overflow marker at all, and certainly no negative count
      expect(out).not.toMatch(/\+-\d/)
      // every subject survives whole rather than being cut at the wrap point
      expect(lines[1]).toBe(
        '  refactor: split the git handler into one condenser per subcommand shape so that no output is ever parsed by two functions and an unrecognised shape is handed straight back',
      )
      expect(lines[5]).toBe(
        '  docs: explain in the handler header why a condenser that cannot recognise its input has to return the text unchanged',
      )
      // a continuation must never be re-indented into something that reads as
      // its own commit
      expect(lines.filter((l) => l.startsWith('  '))).toHaveLength(5)
    },
  },
  {
    name: 'shortlog -w60 - an overflowing group reports the number of subjects actually elided',
    cmd: 'git',
    args: ['shortlog', '-w60'],
    input: SHORTLOG_W60_OVERFLOW,
    assert: (out) => {
      const lines = out.split('\n')
      // header + 10 kept subjects + the marker
      expect(lines).toHaveLength(12)
      expect(lines[0]).toBe('Bob Jones (14):')
      expect(lines[10]).toBe('  fix: do not reshape machine-readable output')
      expect(lines[11]).toBe('  ... +4 more (--full)')
      // a kept subject that wrapped is rejoined whole, not cut at the wrap point
      expect(lines[7]).toBe(
        '  fix: keep the stash@{n} handle exactly as git printed it because that is the argument git stash pop takes',
      )
      // and the 11th commit really is one of the four that were elided
      expect(out).not.toContain('cap the reflog at forty entries')
    },
  },
  {
    name: 'shortlog -w60,6,6 - a caller-flattened indent2 still groups by commit, not by physical line',
    cmd: 'git',
    args: ['shortlog', '-w60,6,6'],
    input: SHORTLOG_W60_FLAT,
    assert: (out) => {
      const lines = out.split('\n')
      // The header declares 4 commits, so 4 subjects come out. Counting the 12
      // physical lines instead kept 10, cut the tenth mid-subject and invented
      // "  ... +2 more (--full)" for an author with 4 commits.
      expect(lines).toHaveLength(5)
      expect(lines[0]).toBe('Alice Smith (4):')
      expect(out).not.toContain('more (--full)')
      expect(lines[1]).toBe(
        '  refactor: split the git handler into one condenser per subcommand shape so that no output is ever parsed by two functions',
      )
      expect(lines[2]).toBe(
        '  feat: collapse contiguous git blame runs under a single attribution header that carries the line range the run covers',
      )
      expect(lines[3]).toBe(
        '  fix: stop the shortlog condenser from counting a wrapped continuation line as another commit subject of its own',
      )
      expect(lines[4]).toBe(
        '  docs: explain in the handler header why a condenser that cannot recognise its input has to hand the text straight back',
      )
    },
  },
  {
    name: 'shortlog -w60,6,6 - short subjects under flattened indents are not glued to each other',
    cmd: 'git',
    args: ['shortlog', '-w60,6,6'],
    input: SHORTLOG_W60_FLAT_SHORT,
    assert: (out) => {
      // Nothing here reaches the wrap column, so no line can be a continuation.
      expect(out.split('\n')).toEqual([
        'Bob Jones (3):',
        '  test: cover the blame condenser',
        '  chore: bump deps',
        '  docs: update README',
      ])
    },
  },
  {
    name: 'shortlog -w60,6,6 - an overflowing group counts commits, not the physical lines they wrapped onto',
    cmd: 'git',
    args: ['shortlog', '-w60,6,6'],
    input: SHORTLOG_W60_FLAT_OVERFLOW,
    assert: (out) => {
      const lines = out.split('\n')
      // header + 10 kept subjects + the marker
      expect(lines).toHaveLength(12)
      expect(lines[0]).toBe('Carol Danvers (12):')
      expect(lines[11]).toBe('  ... +2 more (--full)')
      // a kept subject that wrapped is rejoined whole, not cut at the wrap point
      expect(lines[7]).toBe(
        '  fix: keep the stash handle exactly as git printed it because that is the argument git stash pop takes',
      )
      // and the 11th commit really is one of the two that were elided
      expect(out).not.toContain('cap the reflog at forty entries')
    },
  },
  {
    name: 'shortlog -w60,6,6 - a wrap the flattened indents make genuinely ambiguous is handed back whole',
    cmd: 'git',
    args: ['shortlog', '-w60,6,6'],
    input: SHORTLOG_W60_FLAT_AMBIGUOUS,
    assert: (out, input) => {
      // Reading the second subject as a continuation would print ONE commit
      // under a header that says (2). The reconstruction is checked against
      // that count, and a disagreement means the text goes back untouched -
      // mis-grouped subjects would be a lie, an uncompressed group is not.
      expect(out).toBe(input.trimEnd())
      expect(out.split('\n')).toHaveLength(3)
    },
  },
  {
    name: 'shortlog -sn - the count column loses its alignment padding and its tab',
    cmd: 'git',
    args: ['shortlog', '-sn'],
    input: SHORTLOG_SN,
    assert: (out) => {
      expect(out.split('\n')).toEqual(['142 Alice Smith', '87 Bob Jones', '3 Carol Danvers'])
    },
  },
  {
    name: 'log --graph - the gutter is dropped and each commit collapses to one line',
    cmd: 'git',
    args: ['log', '--graph'],
    input: GRAPH_LOG,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        "af8531b Merge branch 'feat/alpha2' <Bob Jones>",
        'ab2cb23 feat: add alpha <Bob Jones>',
        '1955427 fix: handle null config case <Alice Smith>',
        '85fb44b chore: bump deps <Alice Smith>',
      ])
    },
  },
  {
    name: 'log --graph --oneline - flattening the gutter leaves the one-line log untouched otherwise',
    cmd: 'git',
    args: ['log', '--graph', '--oneline'],
    input: GRAPH_ONELINE,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        "af8531b Merge branch 'feat/alpha2'",
        'ab2cb23 feat: add alpha',
        '1955427 fix: handle null config case',
        '85fb44b chore: bump deps',
      ])
    },
  },
  {
    name: 'log --stat - the per-commit file churn survives instead of being swallowed with the header',
    cmd: 'git',
    args: ['log', '--stat'],
    input: LOG_STAT,
    assert: (out) => {
      expect(out).toContain('4788fef chore: pin publint and attw as dev dependencies <Boris Bembinoff>')
      expect(out).toContain('a1b2c3d feat: collapse contiguous git blame runs <Alice Smith>')
      // both stat blocks are still there, one per commit
      expect(out).toContain('2 files changed, 6 insertions(+), 6 deletions(-)')
      expect(out).toContain('2 files changed, 103 insertions(+)')
      expect(out).toContain('package-lock.json')
      expect(out).toContain('test/handlers/git.cases.test.ts')
      // ...without the header noise or the +++--- histogram
      expect(out).not.toContain('Author:')
      expect(out).not.toContain('boris@junr.studio')
      expect(out).not.toContain('++++')
    },
  },
  {
    name: 'log --graph -p - each commit’s patch goes through the diff condenser',
    cmd: 'git',
    args: ['log', '--graph', '-p'],
    input: GRAPH_PATCH,
    assert: (out) => {
      expect(out).toContain("af8531b Merge branch 'feat/alpha2' <Bob Jones>")
      expect(out).toContain('ab2cb23 feat: add alpha <Bob Jones>')
      // the patch is summarised and its +/- body kept, not passed through whole
      expect(out).toContain('diff: 1 file(s)  +1 -0')
      expect(out).toContain('+ alpha')
      expect(out).not.toContain('index 0000000..4a58007')
      expect(out).not.toContain('@@ -0,0 +1 @@')
      // and no gutter survives anywhere
      expect(out).not.toMatch(/^\| /m)
    },
  },
  {
    name: 'describe - a single-line answer has nothing to condense and is not touched',
    cmd: 'git',
    args: ['describe', '--tags'],
    input: 'v2.3.1-14-g4788fef\n',
    assert: (out) => {
      expect(out).toBe('v2.3.1-14-g4788fef')
    },
  },
  {
    name: 'config --list - a subcommand with no condenser is handed back, not summarised',
    cmd: 'git',
    args: ['config', '--list'],
    input: `user.name=Boris Bembinoff
user.email=boris@junr.studio
core.autocrlf=true
core.editor=code --wait
alias.lg=log --graph --oneline
`,
    assert: (out, input) => {
      expect(out).toBe(passedThrough(input))
      expect(out).not.toContain('[git]')
    },
  },
  {
    name: 'log --stat with an injected --pretty - the stat rows are still condensed, one block per commit',
    cmd: 'git',
    args: ['log', '--stat', '--pretty=format:%h %s (%ar) <%an>', '-20'],
    input: LOG_STAT_PRETTY,
    assert: (out) => {
      // the subject lines are already compact and must survive untouched
      expect(out).toContain('4788fef chore: pin publint and attw as dev dependencies (28 hours ago) <Junr Studio>')
      expect(out).toContain('6374018 chore: harden supply-chain posture and fix license badge (2 days ago) <Junr Studio>')
      // each commit keeps its own totals and its own files
      expect(out).toContain('3 files changed, 14 insertions(+), 7 deletions(-)')
      expect(out).toContain('2 files changed, 43 insertions(+), 1 deletion(-)')
      expect(out).toContain('.github/workflows/scorecard.yml')
      expect(out).toContain('README.md')
      // the histogram bar is the only thing dropped - it says nothing the count does not
      expect(out).not.toContain('+++')
      expect(out).not.toMatch(/\|\s+\d+ [+-]/)
    },
  },
])
// ── the pre-spawn seam ───────────────────────────────────────────────────────
// rewriteGitArgs runs BEFORE git is spawned, so it is invisible to compress()
// and cannot be reached through describeCompression. It is a pure function of
// argv, so it is linked out of the same handler source the proxy ships.
describe('rewriteGitArgs - an injected flag must not change the answer it claims', () => {
  interface Rewrite {
    args: string[]
    injected: string[]
    limit: number
  }
  const rewriteArgs = linkHandlerFunction<(cmd: string, args: string[]) => Rewrite>(
    'rewriteArgs',
    ARGS_HANDLER,
    GIT_HANDLER,
  )
  const rewriteGitArgs = linkHandlerFunction<(args: string[]) => Rewrite>(
    'rewriteGitArgs',
    ARGS_HANDLER,
    GIT_HANDLER,
  )

  it('splices the injected log flags IN FRONT of a "--" pathspec separator', () => {
    // Everything after "--" is a pathspec. Appended there, "-20" and the
    // --pretty format are handed to git as two more PATHS: no format is
    // applied, no limit is applied, and every commit is printed - while the
    // frame goes on to tell the agent "capped at the 20 most recent entries",
    // a false statement about the text it just read.
    const r = rewriteGitArgs(['log', '--', 'b.txt'])
    expect(r.args).toEqual(['log', '--pretty=format:%h %s (%ar) <%an>', '-20', '--', 'b.txt'])
    expect(r.args.indexOf('-20')).toBeLessThan(r.args.indexOf('--'))
    expect(r.limit).toBe(20)

    // ...and with no separator this is still a plain append
    expect(rewriteGitArgs(['log']).args).toEqual([
      'log',
      '--pretty=format:%h %s (%ar) <%an>',
      '-20',
    ])
    // the composed result the proxy actually runs says the same thing
    expect(rewriteArgs('git', ['log', '--', 'b.txt']).args).toEqual([
      'log',
      '--pretty=format:%h %s (%ar) <%an>',
      '-20',
      '--',
      'b.txt',
    ])
  })

  it('leaves `git status -v` alone, because --short deletes the diff -v exists to print', () => {
    // In short mode git prints no diff at all, so injecting --short throws away
    // exactly what the flag asked for - silently: `injected` is only surfaced
    // when a limit was set, and status sets none.
    for (const flag of ['-v', '-vv', '--verbose']) {
      const r = rewriteArgs('git', ['status', flag])
      expect(r.args, flag).toEqual(['status', flag])
      expect(r.injected, flag).toEqual([])
    }
  })

  it('keeps the first row of `git status --short` readable as unstaged', () => {
    // In git's XY short format the first column is the INDEX state, so the
    // leading blank is data: " M f" is modified-but-not-staged and "M  f" is
    // staged. compress() ends in .trim(), which eats the first row's blank and
    // turns an unstaged file into what reads as a staged one. --branch puts
    // git's own "## <branch>" line in front of it - the same thing bare
    // `git status` already relies on.
    // "-uno" attaches its value to the flag, so a cluster scan must not read it
    // as -u -n -o; the short format it accompanies still gets the header.
    for (const argv of [['--short'], ['-s'], ['-s', '-uno'], ['-uno']]) {
      const r = rewriteArgs('git', ['status', ...argv])
      expect(r.args, argv.join(' ')).toContain('--branch')
      // whatever the caller typed is still there, and short mode is still on
      for (const a of argv) expect(r.args, argv.join(' ')).toContain(a)
      expect(
        r.args.includes('-s') || r.args.includes('--short'),
        argv.join(' '),
      ).toBe(true)
    }
    // ...and never twice: a caller who already asked for the header, in either
    // spelling, gets exactly what they typed
    expect(rewriteArgs('git', ['status', '-s', '--branch']).injected).toEqual([])
    expect(rewriteArgs('git', ['status', '-sb']).injected).toEqual([])

    const withHeader = compress(
      '## main...origin/main [ahead 1]\n M b.txt\nM  d.txt\n',
      'git',
      rewriteArgs('git', ['status', '--short']).args,
    )
    expect(withHeader.split('\n')).toEqual([
      '## main...origin/main [ahead 1]',
      ' M b.txt',
      'M  d.txt',
    ])
  })

  it('never adds a "## branch" record to --porcelain, which something else is parsing', () => {
    const r = rewriteArgs('git', ['status', '--porcelain'])
    expect(r.args).toEqual(['status', '--porcelain'])
    expect(r.injected).toEqual([])
  })

  it('still injects --short --branch into a bare `git status`', () => {
    const r = rewriteArgs('git', ['status'])
    expect(r.args).toEqual(['status', '--short', '--branch'])
    expect(r.injected).toEqual(['--short', '--branch'])
    expect(r.limit).toBe(0)
  })
})

describe('condenseGitStatus - a NUL-delimited stream is not a shape to reshape', () => {
  const condenseGitStatus = linkHandlerFunction<(text: string) => string>(
    'condenseGitStatus',
    GIT_HANDLER,
  )

  // `git status -z` terminates every entry with NUL instead of LF - which is
  // the whole point of it, because a path may contain a space or a newline and
  // `git status -z | xargs -0` still reads it correctly. A NUL can therefore
  // only ever be the entry terminator: no path may contain one.
  const STATUS_Z = ' M src/app.ts\0?? src/new-feature.ts\0M  README.md\0'

  it('hands the whole stream back byte for byte', () => {
    // The condenser ended in .trim(), which ate the leading blank of the FIRST
    // record. In git's XY code that blank is data: " M f" is
    // modified-but-not-staged, "M  f" is staged. Trimmed, " M src/app.ts" came
    // back as "M src/app.ts", so a consumer reading columns 1-2 as XY sees a
    // STAGED file and then reads the path from column 3 - "rc/app.ts", a file
    // that exists nowhere in the repo.
    expect(condenseGitStatus(STATUS_Z)).toBe(STATUS_Z)
    expect(condenseGitStatus(STATUS_Z).split('\0').filter(Boolean)).toEqual([
      ' M src/app.ts',
      '?? src/new-feature.ts',
      'M  README.md',
    ])
  })

  it('still strips the advice lines out of the human format', () => {
    // The guard is keyed on the NUL, so the long format it was written for is
    // untouched by it.
    const long = [
      'On branch main',
      "Your branch is ahead of 'origin/main' by 1 commit.",
      '',
      'Changes not staged for commit:',
      '\tmodified:   src/app.ts',
      '',
      'nothing added to commit but untracked files present (use "git add" to track)',
      '',
    ].join('\n')
    const out = condenseGitStatus(long)
    expect(out).toContain('modified:   src/app.ts')
    expect(out).not.toContain('nothing added to commit')
  })

  it('carries every record through compress() with no "##" record invented', () => {
    // End to end, through the same dispatcher the proxy runs: every record git
    // printed is still there, in order, still split by NUL, nothing that is not
    // a status record was put in front of them - and the LEADING BLANK of the
    // first record survives, which is the byte the finding was about.
    //
    // Asserted as byte equality, not as a set of properties. A property that
    // tolerates the first record coming back as "M src/app.ts" is a property
    // that stays green through exactly the corruption this test exists to
    // catch; the stream is machine input, so the only correct output is the
    // input.
    for (const argv of [
      ['status', '-z'],
      ['status', '-s', '-z'],
      ['status', '--short', '-z'],
      ['status', '-sz'],
      ['status', '-zs'],
      ['status', '--null'],
    ]) {
      const out = compress(STATUS_Z, 'git', argv)
      const label = argv.join(' ')
      expect(out, label).toBe(STATUS_Z)
      expect(out, label).not.toContain('##')
      expect(out.split('\0').filter(Boolean), label).toEqual([
        ' M src/app.ts',
        '?? src/new-feature.ts',
        'M  README.md',
      ])
    }
  })
})

describe('condenseDiffBody - names the file or hands back the line that named it', () => {
  const condenseDiffBody = linkHandlerFunction<(text: string) => string>(
    'condenseDiffBody',
    GIT_HANDLER,
  )

  it('echoes git’s own "diff --git" line when the two halves cannot be split', () => {
    // A path may contain spaces, so "diff --git a/<old> b/<new>" is only
    // splittable when the two halves are the same string. When they are not and
    // no other line names the file, the honest move is to hand back the line
    // git printed rather than guess where one path ends and the other begins.
    const out = condenseDiffBody(
      'diff --git a/old name.txt b/new name.txt\nold mode 100644\nnew mode 100755\n',
    )
    expect(out).toContain('diff --git a/old name.txt b/new name.txt (mode 100644 -> 100755)')
    expect(out).toContain('1 file(s)')
  })
})

describe('git handler source - the re-run marker names the flag the host configured', () => {
  it('contains no hard-coded --full outside comments', () => {
    // `fullFlag` is a documented customization (README: fullFlag: '--raw'). A
    // literal "--full" in an overflow marker tells the agent to re-run with a
    // flag that does not exist on that host: the proxy forwards it to git,
    // which exits 129 with a usage dump. Every marker must go through the
    // __TT_FULL_FLAG__ placeholder writeProxyScripts substitutes.
    const live = GIT_HANDLER.split('\n').filter((l) => !l.trim().startsWith('//'))
    expect(live.filter((l) => l.includes('--full'))).toEqual([])
  })
})
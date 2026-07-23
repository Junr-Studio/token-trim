import type { MatrixEntry } from '../support/matrix.js'

// Coverage matrix - version control (git, gh).
//
// git is the single hottest command an agent runs, and it is really seven
// different tools behind one binary: a patch printer, a stat summariser, a
// machine-format emitter, a log, a status, a blame and a branch listing. Each
// one has its own output shape and its own honest ceiling, so each gets its own
// entry - a single "git" row would only ever prove one of them.
//
// Two of the rows below promise nothing, and say why. `git diff --name-only`
// prints a bare path list that exists to be piped into xargs, and `git status`
// has already been rewritten to --short --branch BEFORE the process is spawned,
// so the saving is banked pre-spawn and what arrives is a column format whose
// leading whitespace is data. Reshaping either would break the consumer; the
// wrapper is there to make sure nothing does.

// ── git diff: a unified diff ─────────────────────────────────────────────────
// Real review-sized diff. Context lines, the index/---/@@ scaffolding and the
// per-file "diff --git" restatement are all dropped; the +/- lines - the only
// part that says what changed - are kept verbatim under one path header.
const DIFF = `diff --git a/src/handlers/gh.ts b/src/handlers/gh.ts
index 3f9a1c2..7d40e18 100644
--- a/src/handlers/gh.ts
+++ b/src/handlers/gh.ts
@@ -104,18 +104,27 @@ function condenseGhChecks(text) {
 // ── gh run view --log / --log-failed ─────────────────────────────────────────
 // Every line is "<job>\\t<step>\\t<ISO-8601 with 7 fractional digits> <message>".
 // On a real run that prefix repeats across six-figure line counts.
 function condenseGhRunLog(text) {
-  const ROW = /^([^\\t]*)\\t([^\\t]*)\\t(.*)$/;
+  const ROW = /^([^\\t]*)\\t([^\\t]*)\\t\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z ?(.*)$/;
   const out = [];
-  let job = null, step = null;
+  let job = null, step = null, matched = 0;

   for (const raw of text.split('\\n')) {
     const m = raw.match(ROW);
-    if (!m) continue;
+    // A line that is not in the log grammar is kept as-is; reshaping what we
+    // did not parse is how a condenser starts inventing.
+    if (!m) { out.push(raw); continue; }
+    matched++;
     if (m[1] !== job || m[2] !== step) {
       job = m[1]; step = m[2];
       out.push('── ' + job + ' / ' + step);
     }
-    out.push(m[3]);
+    if (/^##\\[endgroup\\]\\s*$/.test(m[3])) continue;
+    out.push(m[3].replace(/^##\\[group\\]/, ''));
   }
+
+  if (matched === 0) return text;
   return out.join('\\n');
 }

@@ -205,9 +214,12 @@ function condenseGhList(text) {
 function condenseGhList(text) {
   const CAP = 50;
   const TIME = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z?$/;
   const rows = [];

   for (const raw of text.split('\\n')) {
     if (!raw.trim()) continue;
     const f = raw.split('\\t');
+    // No tab, or a ragged row: this is not the TSV table, and summarising a
+    // shape we did not parse is how "0 items" gets reported for real output.
     if (f.length < 2) return text;
+    if (rows.length && f.length !== rows[0].length) return text;
     rows.push(f);
   }
diff --git a/test/handlers/gh.cases.test.ts b/test/handlers/gh.cases.test.ts
index a10b3c4..b21c4d5 100644
--- a/test/handlers/gh.cases.test.ts
+++ b/test/handlers/gh.cases.test.ts
@@ -41,6 +41,24 @@ const RUN_LOG = [
   'build\\tRun tests\\t2026-07-21T09:14:22.4415207Z ok 12 - condenses a run log',
 ].join('\\n')

+// gh prints its own diagnostics into the same stream, untabbed. A condenser
+// that drops every line it cannot parse silently deletes the reason the run
+// failed, which is the one line the agent ran this command to read.
+const RUN_LOG_WITH_DIAGNOSTIC = [
+  'build\\tSet up job\\t2026-07-21T09:14:02.1874431Z Current runner version',
+  'failed to fetch logs for job 46352119887: HTTP 404',
+].join('\\n')
+
+describeCompression('gh run view --log', [
+  {
+    name: 'keeps a diagnostic line that is not in the log grammar',
+    cmd: 'gh',
+    args: ['run', 'view', '--log'],
+    input: RUN_LOG_WITH_DIAGNOSTIC,
+    assert: (out) => {
+      expect(out).toContain('failed to fetch logs for job 46352119887')
+    },
+  },
+])
+
 describeCompression('gh', [
   {
     name: 'condenses a run log to one header per step',
`

// ── git diff --stat ──────────────────────────────────────────────────────────
// Every row is padded to the widest path and then carries a +++--- histogram
// bar that says exactly what the number beside it already said. The paths and
// the churn counts are the answer and all of them are kept.
//
// The bars are SCALED, because git scales them: it fits the graph to ~80
// columns whenever stdout is not a tty, which is always true under the proxy,
// so a 210-change file gets ~10 glyphs and not 210. An earlier version of this
// fixture carried unscaled bars up to 72 glyphs on 120-character rows, which
// inflated the input and with it the measured reduction. Checked against
// `git --no-pager diff --stat --no-color` in this worktree: 79 columns at most.
const DIFF_STAT = ` src/frame.ts                             |  14 ++-
 src/handlers/args.ts                     |  38 ++++-
 src/handlers/gh.ts                       | 126 ++++++++++-----
 src/handlers/git.ts                      |  61 +++++---
 src/handlers/unix.ts                     |   9 +-
 src/index.ts                             |   3 +-
 src/write-proxy.ts                       |  22 ++--
 test/arg-rewrite.test.ts                 |  47 ++++++
 test/coverage-matrix.test.ts             |  18 ++-
 test/handlers/gh.cases.test.ts           | 210 +++++++++++++++++++++++
 test/handlers/git.cases.test.ts          |  84 +++++++--
 test/handlers/unix.cases.test.ts         |  31 ++--
 test/matrix/vcs.matrix.ts                | 172 ++++++++++++++++++
 test/support/harness.ts                  |  12 +-
 test/support/invariants.ts               |  26 ++-
 README.md                                |  40 +++--
 docs/handlers.md                         |  15 +-
 assets/coverage-badge.png                | Bin 0 -> 4523 bytes
 18 files changed, 843 insertions(+), 85 deletions(-)
`

// ── git diff --name-only ─────────────────────────────────────────────────────
// The canonical `git diff --name-only | xargs prettier --write` shape. One bare
// path per line and nothing else: a header, an indent or an elision marker
// would each become a filename the next process cannot open.
const DIFF_NAME_ONLY = `src/frame.ts
src/handlers/args.ts
src/handlers/gh.ts
src/handlers/git.ts
src/handlers/unix.ts
src/index.ts
src/write-proxy.ts
test/arg-rewrite.test.ts
test/coverage-matrix.test.ts
test/handlers/gh.cases.test.ts
test/handlers/git.cases.test.ts
test/handlers/unix.cases.test.ts
test/matrix/vcs.matrix.ts
test/support/harness.ts
test/support/invariants.ts
README.md
docs/handlers.md
`

// ── git log --graph ──────────────────────────────────────────────────────────
// `--graph` counts as a format flag, so no --pretty is injected and git prints
// its full "commit <40 hex> / Author / Date / body" block for every commit,
// behind an ASCII gutter drawn down the left of every single line. Flattened
// into a context window the topology is decoration - and while it is there it
// also hides the "commit " marker the block splitter keys on.
const LOG_GRAPH = `* commit 7f3c1a94b2e5d6f8a0b1c2d3e4f5a6b7c8d9e0f1
| Author: Boris Bembinoff <boris@junr.studio>
| Date:   Tue Jul 21 18:42:11 2026 +0200
|
|     feat(gh): condense gh run view --log to one header per step
|
|     Every line of a workflow log repeats the job name, the step name and an
|     ISO-8601 timestamp with seven fractional digits. On a real run that
|     prefix is where essentially all of the token cost sits.
|
* commit 4a1c8e2d5b6f7a8c9d0e1f2a3b4c5d6e7f809a1b
| Author: Boris Bembinoff <boris@junr.studio>
| Date:   Tue Jul 21 14:03:57 2026 +0200
|
|     fix(git): never summarise a diff shape the condenser did not parse
|
|     condenseDiff routed --name-only through the +/- body condenser, which
|     annihilated it and answered "0 file(s)" for a real diff.
|
*   commit 2b9d4e17c3a5f6081d2e3f4a5b6c7d8e9f0a1b2c
|\\  Merge: 9f3b7d5 c81a20e
| | Author: Alice Nguyen <alice@example.com>
| | Date:   Mon Jul 20 11:05:33 2026 +0200
| |
| |     Merge pull request #141 from Junr-Studio/feat/blame-runs
| |
| |     Collapse contiguous blame runs to one header
| |
| * commit c81a20eb4f5a6d7c8b9e0f1a2b3c4d5e6f708192
| | Author: Alice Nguyen <alice@example.com>
| | Date:   Mon Jul 20 10:47:12 2026 +0200
| |
| |     test(git): a blank source line still counts against the blame range
| |
| * commit d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8
|/  Author: Alice Nguyen <alice@example.com>
|   Date:   Sun Jul 19 22:18:04 2026 +0200
|
|       feat(git): collapse contiguous blame runs to one header
|
|       Every line carries roughly fifty bytes of hash, author, date and line
|       number before the code starts.
|
* commit 9f3b7d5a0e1f2c3b4a5d6e7f8091a2b3c4d5e6f7
| Author: Boris Bembinoff <boris@junr.studio>
| Date:   Sun Jul 19 16:31:45 2026 +0200
|
|     chore: pin publint and attw as dev dependencies
|
* commit 1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819243
  Author: Carol Diaz <carol@example.com>
  Date:   Sat Jul 18 09:12:44 2026 +0200

      docs: document the out-of-band notice channel
`

// ── git status ───────────────────────────────────────────────────────────────
// What the proxy really captures: rewriteGitArgs splices --short --branch in
// before the process is spawned, so git never prints the paragraph-per-section
// long format at all.
const STATUS_SHORT = `## feat/extend-commands...origin/feat/extend-commands [ahead 3, behind 1]
 M src/frame.ts
 M src/handlers/gh.ts
MM src/handlers/git.ts
A  test/matrix/vcs.matrix.ts
 D docs/legacy-handlers.md
R  docs/handlers.md -> docs/reference/handlers.md
UU src/handlers/unix.ts
?? scratch/measure.mjs
?? test/matrix/vcs.snapshot.json
`

// ── git blame ────────────────────────────────────────────────────────────────
// Roughly fifty bytes of hash, author, date, timezone and line number in front
// of every line of code. Adjacent lines almost always share a commit, so one
// header per contiguous run says the same thing at a fraction of the cost.
const BLAME = `^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 118) function condenseGitBlame(text) {
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 119)   const lines = text.split('\\n');
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 120)   while (lines.length && !lines[lines.length - 1]) lines.pop();
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 121)   if (!lines.length) return text;
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 122)
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 123)   const out = [];
^4788fef (Boris Bembinoff   2026-03-12 14:22:01 +0100 124)   const buf = [];
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 125)   let hash = '', author = '', date = '';
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 126)   let first = 0, last = 0, open = false;
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 127)
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 128)   function flush() {
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 129)     if (!open) return;
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 130)     const id = /^0+$/.test(hash) ? 'uncommitted' : hash.slice(0, 7);
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 131)     const range = first === last ? 'L' + first : 'L' + first + '-' + last;
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 132)     out.push(id + ' <' + author + '> ' + date + '  ' + range);
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 133)     for (const c of buf) out.push(c);
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 134)     buf.length = 0;
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 135)     open = false;
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 136)   }
9f8e7d6c (Alice Nguyen      2026-05-02 09:41:30 +0200 137)
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 138)   for (const raw of lines) {
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 139)     const m = raw.match(BLAME_ROW);
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 140)     if (!m) return text;
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 141)     const id = m[1].replace(/^\\^/, '');
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 142)     const lineNo = Number(m[4]);
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 143)     if (!open || id !== hash) {
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 144)       flush();
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 145)       hash = id; author = m[2].trim(); date = m[3];
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 146)       first = lineNo; open = true;
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 147)     }
3c1d5b90 (Carol Diaz        2026-06-18 17:55:09 +0200 148)     last = lineNo;
00000000 (Not Committed Yet 2026-07-22 11:03:44 +0200 149)     const code = m[5] ?? '';
00000000 (Not Committed Yet 2026-07-22 11:03:44 +0200 150)     buf.push(code.trim() ? code : '·');
00000000 (Not Committed Yet 2026-07-22 11:03:44 +0200 151)   }
`

// ── git branch -a ────────────────────────────────────────────────────────────
// A working repo carries a handful of local branches and a long tail of remote
// ones, each on its own indented line. The locals are what the agent acts on;
// the remotes are inventory, and inventory belongs on one line.
const BRANCH_ALL = `  feat/blame-runs
* feat/extend-commands
  feat/gh-run-log
  fix/name-only-passthrough
  main
  remotes/origin/HEAD -> origin/main
  remotes/origin/chore/bump-vitest
  remotes/origin/chore/pin-dev-deps
  remotes/origin/dependabot/npm_and_yarn/typescript-6.0.3
  remotes/origin/dependabot/npm_and_yarn/vitest-4.1.5
  remotes/origin/docs/handler-reference
  remotes/origin/feat/blame-runs
  remotes/origin/feat/cloud-extra
  remotes/origin/feat/coverage-matrix
  remotes/origin/feat/extend-commands
  remotes/origin/feat/gh-run-log
  remotes/origin/feat/golangci
  remotes/origin/feat/helm-template
  remotes/origin/feat/jq-schema
  remotes/origin/feat/out-of-band-notices
  remotes/origin/feat/ruby-handlers
  remotes/origin/feat/stats-socket
  remotes/origin/feat/unix-handlers
  remotes/origin/fix/ansi-osc-strip
  remotes/origin/fix/graph-gutter
  remotes/origin/fix/name-only-passthrough
  remotes/origin/fix/zero-file-claim
  remotes/origin/main
  remotes/origin/release/0.1.3
  remotes/origin/release/0.1.4
`

// ── gh run view --log ────────────────────────────────────────────────────────
// The biggest single win in the library. Every line of a workflow log is
// "<job>\t<step>\t<ISO-8601 with seven fractional digits> <message>", and on a
// real run that ~55-character prefix repeats across six-figure line counts
// while carrying nothing the step header does not already say.
const RUN_LOG = [
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1874431Z Current runner version: 2.328.0',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1901238Z ##[group]Runner Image Provisioner',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1902114Z Hosted Compute Agent',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1902880Z Version: 20260701.363',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1903512Z Commit: 4b1e0a2c7d9f',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1904190Z ##[endgroup]',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1905003Z ##[group]Operating System',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1905744Z Ubuntu',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1906401Z 24.04.2',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1907088Z LTS',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1907760Z ##[endgroup]',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1908431Z ##[group]Runner Image',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1909102Z Image: ubuntu-24.04',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1909770Z Version: 20260714.1.0',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.1910442Z ##[endgroup]',
  'build (22.x)\tSet up job\t2026-07-21T09:14:02.2110889Z Complete job name: build (22.x)',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0412771Z ##[group]Run actions/checkout@v4',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0413550Z with:',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0414128Z   repository: Junr-Studio/token-trim',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0414803Z   fetch-depth: 0',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0415477Z   persist-credentials: true',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.0416140Z ##[endgroup]',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.4188213Z Syncing repository: Junr-Studio/token-trim',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.4201007Z ##[group]Getting Git version info',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.4211884Z Working directory is /home/runner/work/token-trim/token-trim',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.4402219Z git version 2.51.0',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:03.4413006Z ##[endgroup]',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:04.9017442Z Fetching the repository',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:06.2231180Z Determining the checkout info',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:06.2318005Z Checking out the ref',
  'build (22.x)\tRun actions/checkout@v4\t2026-07-21T09:14:06.3910442Z HEAD is now at 7f3c1a9 feat(gh): condense gh run view --log',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:06.5502118Z ##[group]Run actions/setup-node@v4',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:06.5503004Z with:',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:06.5503655Z   node-version: 22.x',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:06.5504310Z   cache: npm',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:06.5504961Z ##[endgroup]',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:07.1180023Z Attempting to download 22.x',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:09.8842217Z Acquiring 22.19.0 from nodejs.org',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:12.4471900Z Extracting the downloaded archive',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:14.0028841Z Adding to the cache',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:14.7719302Z Environment details',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:14.7720188Z node: v22.19.0',
  'build (22.x)\tRun actions/setup-node@v4\t2026-07-21T09:14:14.7720811Z npm: 10.9.3',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:15.1002773Z ##[group]Run npm ci',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:15.1003401Z npm ci',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:15.1004032Z shell: /usr/bin/bash -e',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:15.1004660Z ##[endgroup]',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:19.8813344Z npm warn deprecated inflight@1.0.6: This module is not supported',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0044120Z',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0045002Z added 214 packages, and audited 215 packages in 8s',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0045730Z',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0046401Z 61 packages are looking for funding',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0047080Z   run npm fund for details',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0047744Z',
  'build (22.x)\tRun npm ci\t2026-07-21T09:14:23.0048399Z found 0 vulnerabilities',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:23.3311204Z ##[group]Run npm run typecheck',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:23.3312006Z npm run typecheck',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:23.3312688Z shell: /usr/bin/bash -e',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:23.3313360Z ##[endgroup]',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:24.1204471Z',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:24.1205288Z > @junr_studio/token-trim@0.1.4 typecheck',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:24.1206002Z > tsc -p tsconfig.json --noEmit',
  'build (22.x)\tRun npm run typecheck\t2026-07-21T09:14:24.1206712Z',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.0044182Z ##[group]Run npm test',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.0044901Z npm test',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.0045550Z shell: /usr/bin/bash -e',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.0046201Z ##[endgroup]',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.8817330Z',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.8818114Z > @junr_studio/token-trim@0.1.4 test',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.8818793Z > vitest run',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:31.8819443Z',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:32.4410021Z RUN v4.1.5 /home/runner/work/token-trim/token-trim',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:32.4410880Z',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:34.1102266Z test/arg-rewrite.test.ts (28 tests) 41ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:34.6620145Z test/handler-contract.test.ts (9 tests) 22ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:35.2214008Z test/handlers/git.cases.test.ts (34 tests) 88ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:35.9018844Z test/handlers/gh.cases.test.ts (26 tests) 71ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:36.4417291Z test/handlers/unix.cases.test.ts (31 tests) 64ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.0021553Z test/coverage-matrix.test.ts (44 tests) 112ms',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.5514772Z',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.5515604Z Test Files 22 passed (22)',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.5516288Z Tests 418 passed (418)',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.5516961Z Start at 09:14:32',
  'build (22.x)\tRun npm test\t2026-07-21T09:14:37.5517620Z Duration 5.11s',
  'build (22.x)\tRun npm run lint:package\t2026-07-21T09:14:38.0110447Z ##[group]Run npm run lint:package',
  'build (22.x)\tRun npm run lint:package\t2026-07-21T09:14:38.0111233Z npm run lint:package',
  'build (22.x)\tRun npm run lint:package\t2026-07-21T09:14:38.0111905Z shell: /usr/bin/bash -e',
  'build (22.x)\tRun npm run lint:package\t2026-07-21T09:14:38.0112570Z ##[endgroup]',
  'build (22.x)\tRun npm run lint:package\t2026-07-21T09:14:39.2204118Z All good!',
  'build (22.x)\tPost Run actions/setup-node@v4\t2026-07-21T09:14:39.8814402Z Post job cleanup.',
  'build (22.x)\tPost Run actions/setup-node@v4\t2026-07-21T09:14:40.1102885Z Cache hit occurred on the primary key',
  'build (22.x)\tPost Run actions/setup-node@v4\t2026-07-21T09:14:40.1103661Z Cache saved successfully',
  'build (22.x)\tPost Run actions/checkout@v4\t2026-07-21T09:14:40.4418003Z Post job cleanup.',
  'build (22.x)\tPost Run actions/checkout@v4\t2026-07-21T09:14:40.6620774Z git version 2.51.0',
  'build (22.x)\tPost Run actions/checkout@v4\t2026-07-21T09:14:40.6621550Z Temporarily overriding HOME',
  'build (22.x)\tPost Run actions/checkout@v4\t2026-07-21T09:14:40.6622218Z Removing auth from git config',
  'build (22.x)\tComplete job\t2026-07-21T09:14:40.9013220Z Cleaning up orphan processes',
  'build (22.x)\tComplete job\t2026-07-21T09:14:40.9014001Z Uploading runner diagnostic logs',
  'build (22.x)\tComplete job\t2026-07-21T09:14:40.9014672Z Completed runner diagnostic log upload',
  'build (22.x)\tComplete job\t2026-07-21T09:14:40.9015338Z Finishing: build (22.x)',
].join('\n') + '\n'

// ── gh pr checks ─────────────────────────────────────────────────────────────
// Non-TTY rows are "<name>\t<bucket>\t<elapsed>\t<url>\t<description>" with no
// header and no rollup. A green check costs an agent nothing to know
// individually - the count is the whole message - while a red one needs its
// name and its URL so the agent can go and read the failure.
//
// The red ones are relayed as ROWS, tabs and all. This is gh's machine format -
// tab-separated precisely because stdout is not a tty - and
// `gh pr checks | grep -P '\tfail\t' | cut -f4` is the pipeline it exists for.
// Rejoining the kept fields with two spaces (which is what this entry measured
// before) left that pipeline reading a description as a URL, with the field
// boundaries unrecoverable: names and descriptions both contain spaces.
const PR_CHECKS = [
  'build (20.x)\tpass\t2m14s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119881\t',
  'build (22.x)\tpass\t2m09s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119882\t',
  'build (24.x)\tpass\t1m58s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119883\t',
  'build (windows-latest)\tfail\t4m31s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119884\tProcess completed with exit code 1',
  'build (macos-latest)\tpass\t3m02s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119885\t',
  'typecheck\tpass\t48s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119886\t',
  'typecheck-tests\tpass\t51s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119887\t',
  'lint:package\tpass\t22s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119888\t',
  'lint:types\tfail\t35s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119889\tattw found problems with the published types',
  'coverage\tpending\t0\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887701/job/46352119890\t',
  'codeql / analyze (javascript)\tpass\t3m47s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887702/job/46352119891\t',
  'scorecard\tpass\t1m12s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887703/job/46352119892\t',
  'dependency-review\tskipping\t0\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887704/job/46352119893\t',
  'publish-dry-run\tskipping\t0\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887705/job/46352119894\t',
  'semantic-pr-title\tpass\t9s\thttps://github.com/Junr-Studio/token-trim/actions/runs/16412887706/job/46352119895\t',
].join('\n') + '\n'

// ── gh pr list ───────────────────────────────────────────────────────────────
// Non-TTY list output is a headerless TSV - gh's MACHINE format, emitted in
// that shape because stdout is not a tty, and the input to
// `gh pr list | cut -f1 | xargs -n1 gh pr view`. So two things are data here
// and neither changes: the TAB, and the INDEX of every field that survives.
//
// The trailing created-at column (a ~21-char ISO timestamp in every row) is
// dropped as a whole column. Everything an agent addresses a PR by - number,
// title, branch, state - is kept exactly as gh printed it, at the field number
// gh printed it at, still tab-separated.
//
// Two things this entry used to claim and no longer does. It said every field
// was kept "exactly as gh printed it" while condenseGhList rejoined them with
// two spaces, which destroyed the delimiter: since titles contain spaces,
// `cut -f2` came back with the whole line and the boundaries could not be
// recovered. And it dropped an empty column wherever it sat, which renumbered
// every field behind it - so only TRAILING columns come off now. What a
// consumer does lose is any field number at or past the dropped column: on this
// fixture `cut -f5` returns nothing instead of a timestamp. That is a deletion,
// visible in the field count, not a relabelling of data that is still there.
const PR_LIST = [
  '148\tfeat(gh): condense gh run view --log to one header per step\tfeat/gh-run-log\tOPEN\t2026-07-21T18:44:02Z',
  '147\tfix(git): never summarise a diff shape the condenser did not parse\tfix/name-only-passthrough\tOPEN\t2026-07-21T14:06:11Z',
  '146\ttest: measure every proxied command in a coverage matrix\tfeat/coverage-matrix\tDRAFT\t2026-07-21T11:32:57Z',
  '145\tfeat(unix): condense tree, ps, du and df\tfeat/unix-handlers\tOPEN\t2026-07-20T20:19:40Z',
  '144\tfeat: out-of-band notices for truncated data lists\tfeat/out-of-band-notices\tOPEN\t2026-07-20T16:51:23Z',
  '143\tchore(deps): bump vitest from 4.1.4 to 4.1.5\tchore/bump-vitest\tOPEN\t2026-07-20T13:07:08Z',
  '141\tCollapse contiguous blame runs to one header\tfeat/blame-runs\tMERGED\t2026-07-20T10:58:14Z',
  '140\tfeat(helm): pass helm template through untouched\tfeat/helm-template\tMERGED\t2026-07-19T22:41:55Z',
  '139\tfeat(jq): summarise a schema instead of echoing the document\tfeat/jq-schema\tMERGED\t2026-07-19T17:24:36Z',
  '138\tfix: strip OSC strings as well as CSI escapes\tfix/ansi-osc-strip\tMERGED\t2026-07-19T09:13:02Z',
  '137\tfix(git): strip the --graph gutter before splitting commit blocks\tfix/graph-gutter\tMERGED\t2026-07-18T19:47:29Z',
  '136\tfeat(ruby): condense rspec, rake and rubocop\tfeat/ruby-handlers\tMERGED\t2026-07-18T14:22:41Z',
  '135\tfeat: report savings over a unix socket\tfeat/stats-socket\tMERGED\t2026-07-18T10:05:17Z',
  '134\tfix: stop claiming 0 file(s) for a real diff\tfix/zero-file-claim\tCLOSED\t2026-07-17T21:38:50Z',
  '133\tdocs: a reference page per handler\tdocs/handler-reference\tOPEN\t2026-07-17T15:11:06Z',
].join('\n') + '\n'

// ── gh api ───────────────────────────────────────────────────────────────────
// GitHub pretty-prints its REST responses, so a bare `gh api repos/{owner}/{repo}`
// arrives as indented JSON. This one is NOT a passthrough: the payload is
// re-serialised compactly, which is pure whitespace, and only `_links` and
// `node_id` are dropped by name. The result is still valid JSON, because
// something downstream may still parse it.
const API_REPO = `{
  "id": 912834471,
  "node_id": "R_kgDOOZ3wZw",
  "name": "token-trim",
  "full_name": "Junr-Studio/token-trim",
  "private": false,
  "owner": {
    "login": "Junr-Studio",
    "id": 199384412,
    "node_id": "O_kgDOC-N0XA",
    "avatar_url": "https://avatars.githubusercontent.com/u/199384412?v=4",
    "gravatar_id": "",
    "url": "https://api.github.com/users/Junr-Studio",
    "html_url": "https://github.com/Junr-Studio",
    "followers_url": "https://api.github.com/users/Junr-Studio/followers",
    "following_url": "https://api.github.com/users/Junr-Studio/following{/other_user}",
    "gists_url": "https://api.github.com/users/Junr-Studio/gists{/gist_id}",
    "starred_url": "https://api.github.com/users/Junr-Studio/starred{/owner}{/repo}",
    "subscriptions_url": "https://api.github.com/users/Junr-Studio/subscriptions",
    "organizations_url": "https://api.github.com/users/Junr-Studio/orgs",
    "repos_url": "https://api.github.com/users/Junr-Studio/repos",
    "events_url": "https://api.github.com/users/Junr-Studio/events{/privacy}",
    "received_events_url": "https://api.github.com/users/Junr-Studio/received_events",
    "type": "Organization",
    "user_view_type": "public",
    "site_admin": false
  },
  "html_url": "https://github.com/Junr-Studio/token-trim",
  "description": "Compress the output of shell commands your AI agent runs, to cut the tokens they cost in its context window.",
  "fork": false,
  "url": "https://api.github.com/repos/Junr-Studio/token-trim",
  "forks_url": "https://api.github.com/repos/Junr-Studio/token-trim/forks",
  "keys_url": "https://api.github.com/repos/Junr-Studio/token-trim/keys{/key_id}",
  "collaborators_url": "https://api.github.com/repos/Junr-Studio/token-trim/collaborators{/collaborator}",
  "teams_url": "https://api.github.com/repos/Junr-Studio/token-trim/teams",
  "hooks_url": "https://api.github.com/repos/Junr-Studio/token-trim/hooks",
  "issue_events_url": "https://api.github.com/repos/Junr-Studio/token-trim/issues/events{/number}",
  "events_url": "https://api.github.com/repos/Junr-Studio/token-trim/events",
  "assignees_url": "https://api.github.com/repos/Junr-Studio/token-trim/assignees{/user}",
  "branches_url": "https://api.github.com/repos/Junr-Studio/token-trim/branches{/branch}",
  "tags_url": "https://api.github.com/repos/Junr-Studio/token-trim/tags",
  "blobs_url": "https://api.github.com/repos/Junr-Studio/token-trim/git/blobs{/sha}",
  "git_tags_url": "https://api.github.com/repos/Junr-Studio/token-trim/git/tags{/sha}",
  "git_refs_url": "https://api.github.com/repos/Junr-Studio/token-trim/git/refs{/sha}",
  "trees_url": "https://api.github.com/repos/Junr-Studio/token-trim/git/trees{/sha}",
  "statuses_url": "https://api.github.com/repos/Junr-Studio/token-trim/statuses/{sha}",
  "languages_url": "https://api.github.com/repos/Junr-Studio/token-trim/languages",
  "stargazers_url": "https://api.github.com/repos/Junr-Studio/token-trim/stargazers",
  "contributors_url": "https://api.github.com/repos/Junr-Studio/token-trim/contributors",
  "subscribers_url": "https://api.github.com/repos/Junr-Studio/token-trim/subscribers",
  "subscription_url": "https://api.github.com/repos/Junr-Studio/token-trim/subscription",
  "commits_url": "https://api.github.com/repos/Junr-Studio/token-trim/commits{/sha}",
  "git_commits_url": "https://api.github.com/repos/Junr-Studio/token-trim/git/commits{/sha}",
  "comments_url": "https://api.github.com/repos/Junr-Studio/token-trim/comments{/number}",
  "issue_comment_url": "https://api.github.com/repos/Junr-Studio/token-trim/issues/comments{/number}",
  "contents_url": "https://api.github.com/repos/Junr-Studio/token-trim/contents/{+path}",
  "compare_url": "https://api.github.com/repos/Junr-Studio/token-trim/compare/{base}...{head}",
  "merges_url": "https://api.github.com/repos/Junr-Studio/token-trim/merges",
  "archive_url": "https://api.github.com/repos/Junr-Studio/token-trim/{archive_format}{/ref}",
  "downloads_url": "https://api.github.com/repos/Junr-Studio/token-trim/downloads",
  "issues_url": "https://api.github.com/repos/Junr-Studio/token-trim/issues{/number}",
  "pulls_url": "https://api.github.com/repos/Junr-Studio/token-trim/pulls{/number}",
  "milestones_url": "https://api.github.com/repos/Junr-Studio/token-trim/milestones{/number}",
  "notifications_url": "https://api.github.com/repos/Junr-Studio/token-trim/notifications{?since,all,participating}",
  "labels_url": "https://api.github.com/repos/Junr-Studio/token-trim/labels{/name}",
  "releases_url": "https://api.github.com/repos/Junr-Studio/token-trim/releases{/id}",
  "deployments_url": "https://api.github.com/repos/Junr-Studio/token-trim/deployments",
  "created_at": "2026-05-02T09:41:30Z",
  "updated_at": "2026-07-21T18:44:02Z",
  "pushed_at": "2026-07-21T18:44:05Z",
  "git_url": "git://github.com/Junr-Studio/token-trim.git",
  "ssh_url": "git@github.com:Junr-Studio/token-trim.git",
  "clone_url": "https://github.com/Junr-Studio/token-trim.git",
  "svn_url": "https://github.com/Junr-Studio/token-trim",
  "homepage": "https://github.com/Junr-Studio/token-trim#readme",
  "size": 1284,
  "stargazers_count": 312,
  "watchers_count": 312,
  "language": "TypeScript",
  "has_issues": true,
  "has_projects": false,
  "has_downloads": true,
  "has_wiki": false,
  "has_pages": false,
  "has_discussions": true,
  "forks_count": 17,
  "mirror_url": null,
  "archived": false,
  "disabled": false,
  "open_issues_count": 6,
  "license": {
    "key": "apache-2.0",
    "name": "Apache License 2.0",
    "spdx_id": "Apache-2.0",
    "url": "https://api.github.com/licenses/apache-2.0",
    "node_id": "MDc6TGljZW5zZTI="
  },
  "allow_forking": true,
  "is_template": false,
  "web_commit_signoff_required": false,
  "topics": [
    "agent",
    "claude",
    "cli",
    "compression",
    "context-window",
    "llm",
    "shell",
    "tokens"
  ],
  "visibility": "public",
  "forks": 17,
  "open_issues": 6,
  "watchers": 312,
  "default_branch": "main",
  "permissions": {
    "admin": true,
    "maintain": true,
    "push": true,
    "triage": true,
    "pull": true
  },
  "network_count": 17,
  "subscribers_count": 9
}
`

export const VCS_MATRIX: MatrixEntry[] = [
  {
    cmd: 'git',
    args: ['diff'],
    what: 'a review-sized unified diff across two files',
    // Measured 45%: context lines, the index/---/@@ scaffolding and the
    // per-file "diff --git" restatement go; every +/- line survives verbatim.
    input: DIFF,
    minReduction: 35,
  },
  {
    cmd: 'git',
    args: ['diff', '--stat'],
    what: 'the --stat summary of an 18-file branch',
    // Measured 44.6% (1065 -> 590 chars), and it is all padding: the alignment
    // columns and the +++--- histogram bar, which says exactly what the count
    // beside it says.
    //
    // The comment used to claim 56% and the floor was set to 45, which the
    // entry has never actually cleared - it passed only because the harness
    // rounded 44.601 up to 45. Both numbers are the measurement now, with the
    // floor set below it so a real regression is what breaks this, not a
    // rounding boundary.
    input: DIFF_STAT,
    minReduction: 40,
  },
  {
    cmd: 'git',
    args: ['diff', '--name-only'],
    what: 'the machine format that gets piped into xargs',
    input: DIFF_NAME_ONLY,
    minReduction: 0,
    passthroughReason:
      '--name-only is a machine format: one bare path per line, the canonical ' +
      '`git diff --name-only | xargs prettier --write` input. A header, an ' +
      'indent or an inline elision marker would each be handed to the next ' +
      'process as a filename that does not exist, so the wrapper exists to ' +
      'route this shape AWAY from the +/- body condenser that used to ' +
      'annihilate it and answer "0 file(s)" for a real diff.',
  },
  {
    cmd: 'git',
    args: ['log', '--graph'],
    what: 'the verbose commit blocks --graph forces, behind an ASCII gutter',
    // Measured 72%: seven six-to-ten-line blocks collapse to seven subject
    // lines, and the gutter comes off every one of them.
    input: LOG_GRAPH,
    minReduction: 60,
  },
  {
    cmd: 'git',
    args: ['status'],
    what: 'a dirty worktree, as --short --branch really prints it',
    input: STATUS_SHORT,
    minReduction: 0,
    passthroughReason:
      'The saving is banked BEFORE the process is spawned: rewriteGitArgs ' +
      'splices --short --branch in, so git never prints the paragraph-per-' +
      'section long format. What arrives is a two-column status code where ' +
      'leading whitespace is data (" M" is worktree-modified, "M " is staged, ' +
      '"MM" is both, "UU" is a conflict) and every remaining line is a path an ' +
      'agent will act on, so there is nothing left to remove.',
  },
  {
    cmd: 'git',
    args: ['blame', '-L', '118,151', 'src/handlers/git.ts'],
    what: '34 blamed lines across four commits',
    // Measured 57%: ~52 bytes of hash, author, date, timezone and line number
    // in front of every line, replaced by one header per contiguous run.
    input: BLAME,
    minReduction: 45,
  },
  {
    cmd: 'git',
    args: ['branch', '-a'],
    what: 'five local branches and a long tail of remotes',
    // Measured 18%, and that is the honest ceiling for this shape: the branch
    // NAMES are the answer and every one of them is kept, so all that comes
    // off is the "remotes/" prefix and one line break per remote.
    input: BRANCH_ALL,
    minReduction: 10,
  },
  {
    cmd: 'gh',
    args: ['run', 'view', '--log'],
    what: 'a CI workflow log - the biggest single win in the library',
    // Measured 70% on this 8 KB excerpt, and the ratio only improves with
    // length: the ~55-character "<job>\t<step>\t<ISO timestamp> " prefix is a
    // fixed cost per line, so a real 260 KB run log is almost entirely prefix.
    // Sized to stay under the frame's 8000-char backstop deliberately, so the
    // number below measures the CONDENSER and not the backstop cap.
    input: RUN_LOG,
    minReduction: 55,
  },
  {
    cmd: 'gh',
    args: ['pr', 'checks'],
    what: '15 checks, two of them red',
    // Measured 79%: the thirteen non-failing rows carry a name, an elapsed time
    // and a ~95-character job URL each, and the count is the whole message. The
    // two red ones are relayed as the rows gh printed - every field, tabs
    // intact - which is one point of reduction less than the two-space rejoin
    // this used to measure, and the difference between a row a pipeline can
    // still cut and one it cannot.
    input: PR_CHECKS,
    minReduction: 65,
  },
  {
    cmd: 'gh',
    args: ['pr', 'list'],
    what: '15 pull requests as headerless TSV',
    // Measured 21% (was 18% when the fields were rejoined with two spaces: a
    // tab is one character where two spaces are two). Only the trailing
    // created-at column goes - every field an agent addresses a PR by is kept,
    // at its own field number - so this is a column-level win, not a summary,
    // and ~20% is what a column-level win is worth.
    input: PR_LIST,
    minReduction: 15,
  },
  {
    cmd: 'gh',
    args: ['api', 'repos/Junr-Studio/token-trim'],
    what: 'a pretty-printed REST payload - a small reduction, not a passthrough',
    // A REDUCTION, not a passthrough, and worth saying which: `gh api` names no
    // format flag, so isMachineOutput cannot see that the body is JSON and the
    // handler has to guard itself. It re-serialises compactly and drops only
    // `_links` and `node_id` by name, leaving VALID JSON for anything
    // downstream that still parses it.
    //
    // Measured 10%, which is low for this file and correct for this payload: a
    // repo response is dominated by 60-100 character *_url strings, and those
    // are kept on purpose (`gh api repos/x` is run to read clone_url /
    // ssh_url / html_url). What comes off is the API's own indentation, the
    // newlines and the space after each colon.
    input: API_REPO,
    minReduction: 5,
  },
]

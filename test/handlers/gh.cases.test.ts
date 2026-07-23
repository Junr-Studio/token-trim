import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `gh` condenser (condenseGh).
//
// condenseGh filters markdown "noise" out of a PR/issue body - single-line
// HTML comments, shields-style badge lines, image-only lines, and horizontal
// rules - and collapses runs of blank lines to a single blank, while leaving
// everything inside a ``` fenced code block byte-for-byte intact. Each case
// below feeds a realistic `gh pr view` / `gh issue view` body, asserts the
// condenser's intent, then snapshots the exact current output.

// A bare triple-backtick, kept out of the template literals so the fixtures
// stay readable (no per-backtick escaping).
const FENCE = '```'

// Comprehensive body: every noise type at once, plus a real code fence that
// must survive untouched.
const PR_BODY = `# Add configurable server port

<!-- Please describe your changes in detail. -->
<!-- Link any related issues below. -->

[![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/widget/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/acme/widget)](https://codecov.io/gh/acme/widget)

## Summary

This PR makes the listening port configurable via \`config.port\`, falling back
to 3000 when the key is absent, so no existing deployment changes behavior.

---

## Screenshot

![before and after](https://user-images.githubusercontent.com/1/demo.png)

## Example

${FENCE}ts
const server = createServer(config)
server.listen(config.port ?? 3000)
${FENCE}

***

<!-- Reviewer checklist below. -->

## Checklist


- [x] Tests added
- [x] Docs updated
`

// Single-line HTML comments (what gh's PR template scatters through a body).
const HTML_COMMENTS = `## Description

<!-- Thanks for opening a pull request! -->
Fixes the flaky retry logic in the uploader.
<!-- Please make sure CI is green before requesting review. -->

<!-- markdownlint-disable -->
The retry now uses exponential backoff with jitter and a capped ceiling.
<!-- markdownlint-enable -->
`

// A README-style badge header - several stacked shields/actions badges.
const BADGES = `# widget

[![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/widget/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/widget.svg)](https://www.npmjs.com/package/widget)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dm/widget.svg)](https://npm-stat.com/charts.html?package=widget)

A tiny, dependency-free widget toolkit.
`

// Image-only lines (a screenshots section), including a relative-path image.
const IMAGES = `## Screenshots

Before and after the redesign:

![login screen before](https://user-images.githubusercontent.com/10/before.png)
![login screen after](https://user-images.githubusercontent.com/10/after.png)

The spacing is now consistent across every breakpoint.

![mobile view](./docs/mobile.png)
`

// Horizontal rules of all three flavors plus over-long blank runs to collapse.
const RULES_AND_BLANKS = `## Notes

First section of notes.



Second section, after a long run of blank lines.

---

Third section, after a dashed rule.

***

Fourth section, after an asterisk rule.

___

Fifth section, after an underscore rule.
`

// Noise-looking lines living INSIDE a fenced code block must be preserved,
// while the identical noise OUTSIDE the fence is stripped - the crucial
// fence-preservation contract.
const FENCE_PROTECTS_NOISE = `The failing workflow config, quoted verbatim:

<!-- outside the fence, so this comment is stripped -->

${FENCE}yaml
# CI pipeline
---
name: ci
<!-- inside the fence, this comment must survive -->
***
![not really an image](inside-fence.png)
on:
  push:
    branches: [main]
${FENCE}

---

Everything above is quoted exactly from the file.
`

// A clean body with no noise at all - the no-trigger passthrough / "zero" case.
const CLEAN_BODY = `## What changed

Refactored the config loader so required keys are validated at startup
instead of lazily on first access.

### Why

Late validation made misconfigured deploys fail deep inside a request
handler, which was painful to debug.

### Testing

- Ran the full unit suite locally
- Added a regression test for the missing-key path
- Verified the staging deploy boots cleanly
`

describeCompression('gh', [
  {
    name: 'pr view - strips every noise type (comments, badges, images, rules, blanks) but keeps the code fence',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: PR_BODY,
    assert: (out) => {
      // All four noise categories are gone from the body proper.
      expect(out).not.toMatch(/^\s*<!--/m) // HTML comments
      expect(out).not.toContain('badge.svg') // actions badge
      expect(out).not.toContain('shields.io') // shields badge
      expect(out).not.toContain('githubusercontent.com') // image-only line
      expect(out).not.toMatch(/^\s*---\s*$/m) // --- rule
      expect(out).not.toMatch(/^\s*\*\*\*\s*$/m) // *** rule
      // The fence and its exact contents survive.
      expect(out).toContain(`${FENCE}ts`)
      expect(out).toContain('server.listen(config.port ?? 3000)')
      // Real content is untouched, and blank runs are collapsed.
      expect(out).toContain('# Add configurable server port')
      expect(out).toContain('## Checklist')
      expect(out).not.toMatch(/\n\n\n/)
    },
  },
  {
    name: 'issue body - drops single-line HTML comments, keeps prose',
    cmd: 'gh',
    args: ['issue', 'view'],
    input: HTML_COMMENTS,
    assert: (out) => {
      expect(out).not.toContain('<!--')
      expect(out).not.toContain('-->')
      expect(out).toContain('Fixes the flaky retry logic in the uploader.')
      expect(out).toContain('exponential backoff with jitter')
      // Two comment lines removed → strictly shorter.
      expect(out.split('\n').length).toBeLessThan(HTML_COMMENTS.split('\n').length)
    },
  },
  {
    name: 'repo view - removes stacked badge lines, keeps the heading and tagline',
    cmd: 'gh',
    args: ['repo', 'view'],
    input: BADGES,
    assert: (out) => {
      expect(out).not.toContain('img.shields.io')
      expect(out).not.toContain('badge.svg')
      expect(out).not.toMatch(/^\s*\[!\[/m) // no badge line survives
      expect(out).toContain('# widget')
      expect(out).toContain('A tiny, dependency-free widget toolkit.')
    },
  },
  {
    name: 'pr view - strips image-only lines (screenshots), keeps surrounding text',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: IMAGES,
    assert: (out) => {
      expect(out).not.toMatch(/^\s*!\[/m) // no image-only line
      expect(out).not.toContain('.png')
      expect(out).toContain('Before and after the redesign:')
      expect(out).toContain('The spacing is now consistent across every breakpoint.')
    },
  },
  {
    name: 'pr view - drops ---/***/___ horizontal rules and collapses blank runs',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: RULES_AND_BLANKS,
    assert: (out) => {
      expect(out).not.toMatch(/^\s*---\s*$/m)
      expect(out).not.toMatch(/^\s*\*\*\*\s*$/m)
      expect(out).not.toMatch(/^\s*___\s*$/m)
      expect(out).not.toMatch(/\n\n\n/) // never more than one blank in a row
      for (const s of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) {
        expect(out).toContain(`${s} section`)
      }
    },
  },
  {
    name: 'pr view - noise inside a ``` fence is preserved while identical noise outside is stripped',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: FENCE_PROTECTS_NOISE,
    assert: (out) => {
      // Inside the fence: every noise-shaped line survives verbatim.
      expect(out).toContain(`${FENCE}yaml`)
      expect(out).toContain('name: ci')
      expect(out).toContain('---') // YAML doc separator, protected by the fence
      expect(out).toContain('<!-- inside the fence, this comment must survive -->')
      expect(out).toContain('***')
      expect(out).toContain('![not really an image](inside-fence.png)')
      expect(out).toContain('branches: [main]')
      // Outside the fence: the comment is stripped.
      expect(out).not.toContain('outside the fence, so this comment is stripped')
    },
  },
  {
    name: 'clean body - no noise, passes through verbatim (modulo trim)',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: CLEAN_BODY,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).toContain('## What changed')
      expect(out).toContain('- Verified the staging deploy boots cleanly')
    },
  },
  {
    name: 'empty output - nothing to compress, stays empty',
    cmd: 'gh',
    args: ['pr', 'view'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

// ── subcommand-aware condensers ──────────────────────────────────────────────
//
// `gh` is a dozen unrelated tools behind one binary, so the cases below are
// grouped by the subcommand that selects a condenser. Every fixture is the
// NON-TTY shape: the proxy always captures gh through a pipe, and gh switches
// to its tab-separated/raw output whenever stdout is not a terminal. Using the
// pretty TTY shape here would test output the proxy can never receive.

// ── gh run view --log ────────────────────────────────────────────────────────
// Every line is "<job>\t<step>\t<ISO-8601 with 7 fractional digits> <message>".
// The prefix repeats on all ~100k lines of a real run, which is where nearly
// all of the token cost lives.
const RUN_LOG = `build\tSet up job\t2026-07-20T09:12:44.1234567Z Current runner version: '2.317.0'
build\tSet up job\t2026-07-20T09:12:44.1256789Z ##[group]Operating System
build\tSet up job\t2026-07-20T09:12:44.1258901Z Ubuntu
build\tSet up job\t2026-07-20T09:12:44.1259123Z 22.04.4
build\tSet up job\t2026-07-20T09:12:44.1260012Z ##[endgroup]
build\tCheckout\t2026-07-20T09:12:45.0114567Z ##[group]Run actions/checkout@v4
build\tCheckout\t2026-07-20T09:12:45.0115678Z with:
build\tCheckout\t2026-07-20T09:12:45.0116789Z   repository: acme/widget
build\tCheckout\t2026-07-20T09:12:45.0117890Z ##[endgroup]
build\tCheckout\t2026-07-20T09:12:45.9912345Z Syncing repository: acme/widget
build\tInstall dependencies\t2026-07-20T09:12:52.4412345Z added 214 packages in 8s
build\tRun tests\t2026-07-20T09:13:03.1123456Z > widget@2.0.0 test
build\tRun tests\t2026-07-20T09:13:03.1124567Z > vitest run
build\tRun tests\t2026-07-20T09:13:09.8823456Z FAIL test/handlers/gh.cases.test.ts
build\tRun tests\t2026-07-20T09:13:09.8824567Z Tests  1 failed | 212 passed (213)
build\tRun tests\t2026-07-20T09:13:09.9012345Z ##[error]Process completed with exit code 1.
build\tPost Checkout\t2026-07-20T09:13:10.2212345Z Post job cleanup.
build\tComplete job\t2026-07-20T09:13:10.5512345Z Cleaning up orphan processes
`

// `gh run view` without --log prints a run summary, not the log. It shares the
// subcommand with the log condenser, so it doubles as the proof that a shape
// the log parser does not recognise comes back untouched.
const RUN_SUMMARY = `X main CI · 4812993017
Triggered via push about 5 minutes ago

JOBS
X build in 1m26s (ID 13234567890)
  ✓ Set up job
  ✓ Checkout
  X Run tests
  ✓ Post Checkout
  ✓ Complete job

ANNOTATIONS
X Process completed with exit code 1.
build: .github#1

To see what failed, try: gh run view 4812993017 --log-failed
View this run on GitHub: https://github.com/acme/widget/actions/runs/4812993017
`

// ── gh api ───────────────────────────────────────────────────────────────────
// The GitHub REST API pretty-prints its responses, and roughly half of a repo
// payload is hypermedia (`*_url`), `_links` and `node_id` - fields an agent
// never acts on. Abbreviated in the middle only; every key here is real.
const API_REPO = `{
  "id": 212613049,
  "node_id": "MDEwOlJlcG9zaXRvcnkyMTI2MTMwNDk=",
  "name": "widget",
  "full_name": "acme/widget",
  "private": false,
  "owner": {
    "login": "acme",
    "id": 59704711,
    "node_id": "MDEyOk9yZ2FuaXphdGlvbjU5NzA0NzEx",
    "avatar_url": "https://avatars.githubusercontent.com/u/59704711?v=4",
    "gravatar_id": "",
    "url": "https://api.github.com/users/acme",
    "html_url": "https://github.com/acme",
    "followers_url": "https://api.github.com/users/acme/followers",
    "following_url": "https://api.github.com/users/acme/following{/other_user}",
    "gists_url": "https://api.github.com/users/acme/gists{/gist_id}",
    "starred_url": "https://api.github.com/users/acme/starred{/owner}{/repo}",
    "subscriptions_url": "https://api.github.com/users/acme/subscriptions",
    "organizations_url": "https://api.github.com/users/acme/orgs",
    "repos_url": "https://api.github.com/users/acme/repos",
    "events_url": "https://api.github.com/users/acme/events{/privacy}",
    "received_events_url": "https://api.github.com/users/acme/received_events",
    "type": "Organization",
    "site_admin": false
  },
  "html_url": "https://github.com/acme/widget",
  "description": "A tiny, dependency-free widget toolkit",
  "fork": false,
  "url": "https://api.github.com/repos/acme/widget",
  "forks_url": "https://api.github.com/repos/acme/widget/forks",
  "keys_url": "https://api.github.com/repos/acme/widget/keys{/key_id}",
  "collaborators_url": "https://api.github.com/repos/acme/widget/collaborators{/collaborator}",
  "hooks_url": "https://api.github.com/repos/acme/widget/hooks",
  "issue_events_url": "https://api.github.com/repos/acme/widget/issues/events{/number}",
  "events_url": "https://api.github.com/repos/acme/widget/events",
  "created_at": "2019-10-03T15:32:00Z",
  "updated_at": "2026-07-19T08:11:43Z",
  "pushed_at": "2026-07-20T09:12:44Z",
  "size": 41822,
  "stargazers_count": 38412,
  "watchers_count": 38412,
  "language": "TypeScript",
  "forks_count": 6017,
  "open_issues_count": 812,
  "license": {
    "key": "mit",
    "name": "MIT License",
    "spdx_id": "MIT",
    "url": "https://api.github.com/licenses/mit",
    "node_id": "MDc6TGljZW5zZTEz"
  },
  "default_branch": "main",
  "permissions": {
    "admin": false,
    "maintain": false,
    "push": false,
    "triage": false,
    "pull": true
  }
}
`

describeCompression('gh subcommands', [
  {
    name: 'run view --log - drops the timestamp and the repeated job/step prefix, heading each new step once',
    cmd: 'gh',
    args: ['run', 'view', '4812993017', '--log'],
    input: RUN_LOG,
    assert: (out) => {
      // No timestamp survives anywhere.
      expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      // The tab-separated prefix is gone from every line.
      expect(out).not.toMatch(/^[^\n]*\t/m)
      // One header per (job, step) transition - 6 distinct steps here.
      expect(out.match(/^── /gm) ?? []).toHaveLength(6)
      expect(out).toContain('── build / Run tests')
      expect(out).toContain('── build / Set up job')
      // Message text is untouched.
      expect(out).toContain('Tests  1 failed | 212 passed (213)')
      expect(out).toContain("Current runner version: '2.317.0'")
      expect(out).toContain('##[error]Process completed with exit code 1.')
    },
  },
  {
    name: 'run view --log - unwraps ##[group] and drops ##[endgroup], but keeps ##[error]',
    cmd: 'gh',
    args: ['run', 'view', '--log'],
    input: RUN_LOG,
    assert: (out) => {
      // The fold markers are UI structure for the Actions web view; in a log
      // being read by a model they are two wasted lines per group.
      expect(out).not.toContain('##[endgroup]')
      expect(out).not.toContain('##[group]')
      // ...but the label the group carried is real content and survives.
      expect(out).toContain('Operating System')
      expect(out).toContain('Run actions/checkout@v4')
      // ##[error] is the single most useful marker in a failing log.
      expect(out).toContain('##[error]Process completed with exit code 1.')
    },
  },

  {
    name: 'run view --log-failed - the failed-only log takes the same path as the full log',
    cmd: 'gh',
    args: ['run', 'view', '--log-failed'],
    input: `build\tRun tests\t2026-07-20T09:13:09.8823456Z FAIL test/handlers/gh.cases.test.ts
build\tRun tests\t2026-07-20T09:13:09.8824567Z Tests  1 failed | 212 passed (213)
build\tRun tests\t2026-07-20T09:13:09.9012345Z ##[error]Process completed with exit code 1.
`,
    assert: (out) => {
      expect(out).toBe(
        '── build / Run tests\n' +
          'FAIL test/handlers/gh.cases.test.ts\n' +
          'Tests  1 failed | 212 passed (213)\n' +
          '##[error]Process completed with exit code 1.',
      )
    },
  },
  {
    name: 'run view - the run summary is not the log grammar, so no step headers are invented',
    cmd: 'gh',
    args: ['run', 'view', '4812993017'],
    input: RUN_SUMMARY,
    assert: (out) => {
      expect(out).not.toContain('──')
      expect(out).toContain('X build in 1m26s (ID 13234567890)')
      expect(out).toContain('X Process completed with exit code 1.')
      expect(out).toContain('gh run view 4812993017 --log-failed')
    },
  },
  {
    name: 'run view --log - text that is not the log grammar is returned unchanged, never reshaped',
    cmd: 'gh',
    args: ['run', 'view', '4812993017', '--log'],
    input: RUN_SUMMARY,
    assert: (out) => {
      // Not one line of the input is dropped or rewritten by the log parser.
      for (const l of RUN_SUMMARY.split('\n')) if (l.trim()) expect(out).toContain(l)
      expect(out).not.toContain('──')
    },
  },

  // ── gh pr checks ───────────────────────────────────────────────────────────
  // Non-TTY rows are "<name>\t<bucket>\t<elapsed>\t<url>\t<description>", with
  // bucket one of pass/fail/pending/skipping. There is no rollup line and no
  // header in this mode, so the counts have to be computed here.
  {
    // CHANGED DELIBERATELY: this case used to assert the failing rows rejoined
    // as "[x] test (18)  <url>" - name, description and URL glued with two
    // spaces, elapsed dropped. gh emits this table as a headerless TSV BECAUSE
    // stdout is not a tty; it is the machine format, and `gh pr checks |
    // grep -P '\tfail\t' | cut -f4` is the pipeline it exists for. Rejoining
    // the fields with spaces destroys the only delimiter that pipeline can key
    // on - check names and descriptions both contain spaces, so the boundaries
    // are unrecoverable. The rollup line stays (the count IS the message for
    // twelve green checks); the rows that survive are now relayed byte-for-byte
    // as gh printed them.
    name: 'pr checks - rolls up to counts and relays the failing rows exactly as gh printed them, tabs intact',
    cmd: 'gh',
    args: ['pr', 'checks'],
    input: `lint\tpass\t45s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567888\t
build\tpass\t1m12s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567889\t
test (18)\tfail\t2m3s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567890\t
test (20)\tpass\t1m58s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567891\t
codecov/patch\tpending\t0\thttps://app.codecov.io/gh/acme/widget/pull/123\tWaiting for status to be reported
Vercel\tfail\t0\thttps://vercel.com/acme/widget/deployments/dpl_7Qk2\tDeployment has failed
`,
    assert: (out) => {
      expect(out.split('\n')[0]).toBe('[gh] 6 checks: 3 passed, 2 failed, 1 pending')
      // Only the two failures are listed, and each is the row gh printed: the
      // fields are still tab-separated, so `cut -f4` still returns the URL.
      const rows = out.split('\n').slice(1)
      expect(rows).toHaveLength(2)
      for (const r of rows) expect(r.split('\t')[1]).toBe('fail')
      expect(rows[0]).toBe(
        'test (18)\tfail\t2m3s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567890',
      )
      expect(rows[1]).toBe(
        'Vercel\tfail\t0\thttps://vercel.com/acme/widget/deployments/dpl_7Qk2\tDeployment has failed',
      )
      // Passing and pending rows contribute to the counts and nothing else.
      expect(out).not.toContain('lint')
      expect(out).not.toContain('codecov/patch')
      expect(out).not.toContain('1m12s')
    },
  },
  {
    name: 'pr checks - all green collapses to the rollup alone, with no failure list',
    cmd: 'gh',
    args: ['pr', 'checks'],
    input: `lint\tpass\t45s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567888\t
build\tpass\t1m12s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567889\t
test (18)\tpass\t2m3s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567890\t
test (20)\tpass\t1m58s\thttps://github.com/acme/widget/actions/runs/4812993017/job/13234567891\t
`,
    assert: (out) => {
      expect(out).toBe('[gh] 4 checks: 4 passed')
      expect(out).not.toContain('[x]')
      expect(out).not.toContain('failed')
    },
  },
  {
    name: 'pr status - the human summary is not a checks table, so it is left alone',
    cmd: 'gh',
    args: ['pr', 'status'],
    input: `Relevant pull requests in acme/widget

Current branch
  #123  feat: configurable server port [feat/port]
  - 1/4 checks failing

Created by you
  #118  fix: retry backoff jitter [fix/retry]
  ✓ Checks passing - Review required

Requesting a code review from you
  You have no pull requests to review
`,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      // Never a fabricated rollup for a shape the parser did not recognise.
      expect(out).not.toContain('[gh]')
      expect(out).not.toContain('checks:')
    },
  },

  // ── gh pr diff ─────────────────────────────────────────────────────────────
  // The payload is a plain unified diff, so it goes through the git condenser
  // rather than a second implementation that would drift from it.
  {
    name: 'pr diff - a unified diff is condensed by the git diff condenser',
    cmd: 'gh',
    args: ['pr', 'diff', '123'],
    input: `diff --git a/src/app.ts b/src/app.ts
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
diff --git a/README.md b/README.md
index aaaaaaa..bbbbbbb 100644
--- a/README.md
+++ b/README.md
@@ -12,3 +12,4 @@ npm install widget
 \`\`\`
+Set \`config.port\` to change the listening port.
`,
    assert: (out) => {
      expect(out).toMatch(/^diff: 2 file\(s\)  \+2 -1/)
      expect(out).not.toMatch(/^@@ /m)
      expect(out).not.toContain('index 1234567')
      expect(out).toContain('+   server.listen(config.port ?? 3000)')
    },
  },
  {
    name: 'pr diff --name-only - a bare path list is canonical xargs input and survives verbatim',
    cmd: 'gh',
    args: ['pr', 'diff', '--name-only'],
    input: `src/app.ts
src/handlers/gh.ts
test/handlers/gh.cases.test.ts
README.md
`,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        'src/app.ts',
        'src/handlers/gh.ts',
        'test/handlers/gh.cases.test.ts',
        'README.md',
      ])
      expect(out).not.toContain('diff:')
      expect(out).not.toContain('0 file(s)')
    },
  },

  // ── gh pr view / gh issue view ─────────────────────────────────────────────
  // Non-TTY view output is "<field>:\t<value>" lines, a "--" separator, then
  // the body. gh emits every field whether or not it has a value.
  {
    name: 'pr view - keeps the populated header fields, drops the ones gh emitted empty',
    cmd: 'gh',
    args: ['pr', 'view', '123'],
    input: `title:\tfeat: configurable server port
state:\tOPEN
author:\talice
labels:\tenhancement
assignees:\t
reviewers:\tcarol (Approved), dave (Requested)
projects:\t
milestone:\t
number:\t123
url:\thttps://github.com/acme/widget/pull/123
additions:\t120
deletions:\t14
auto-merge:\tdisabled
--
<!-- Describe your changes. -->

## Summary

Makes the listening port configurable via \`config.port\`, falling back to 3000.
`,
    assert: (out) => {
      // Populated fields survive with their values.
      expect(out).toContain('title:\tfeat: configurable server port')
      expect(out).toContain('state:\tOPEN')
      expect(out).toContain('number:\t123')
      expect(out).toContain('url:\thttps://github.com/acme/widget/pull/123')
      expect(out).toContain('reviewers:\tcarol (Approved), dave (Requested)')
      // Fields gh printed with no value are pure padding.
      expect(out).not.toContain('assignees:')
      expect(out).not.toContain('projects:')
      expect(out).not.toContain('milestone:')
      // The header/body boundary is still explicit, and the body is still
      // markdown-stripped the way a bare body would be.
      expect(out).toMatch(/^--$/m)
      expect(out).not.toContain('<!--')
      expect(out).toContain('## Summary')
    },
  },

  {
    name: 'issue view --comments - keeps the first few comments and discloses how many were dropped',
    cmd: 'gh',
    args: ['issue', 'view', '42', '--comments'],
    input: `title:\tLogin button unresponsive on mobile
state:\tOPEN
author:\tdana
labels:\tbug, p1
comments:\t5
number:\t42
url:\thttps://github.com/acme/widget/issues/42
--
The login button does not respond to taps on iOS Safari 17.

--
author:\talice
association:\tmember
edited:\tfalse
status:\tnone
--
Reproduced on an iPhone 14, iOS 17.5.
--
author:\tbob
association:\tcontributor
edited:\tfalse
status:\tnone
--
Looks like the tap target is 20px tall; the overlay swallows the event.
--
author:\tcarol
association:\tmember
edited:\ttrue
status:\tnone
--
Bumped the hit area to 44px in #43.
--
author:\tdana
association:\tnone
edited:\tfalse
status:\tnone
--
Confirmed fixed on the preview deploy.
--
author:\terin
association:\tmember
edited:\tfalse
status:\tnone
--
Closing once #43 lands.
--
`,
    assert: (out) => {
      // The issue itself and the start of the discussion are what matter.
      expect(out).toContain('title:\tLogin button unresponsive on mobile')
      expect(out).toContain('The login button does not respond to taps on iOS Safari 17.')
      expect(out).toContain('Reproduced on an iPhone 14, iOS 17.5.')
      expect(out).toContain('Bumped the hit area to 44px in #43.')
      // The tail is dropped, and the drop is disclosed rather than silent.
      expect(out).not.toContain('Confirmed fixed on the preview deploy.')
      expect(out).not.toContain('Closing once #43 lands.')
      expect(out).toContain('... +2 more comments (--full)')
      // Three comment blocks survive; the "author:" in the header is the
      // issue's own author and is not one of them.
      const thread = out.slice(out.indexOf('\n--\n') + 4)
      expect(thread.match(/^author:\t/gm) ?? []).toHaveLength(3)
    },
  },

  {
    name: 'pr view --comments - drops "edited" and a "none" status, keeps a real review verdict',
    cmd: 'gh',
    args: ['pr', 'view', '--comments'],
    input: `title:\tfeat: configurable server port
state:\tOPEN
author:\talice
number:\t123
url:\thttps://github.com/acme/widget/pull/123
--
Makes the listening port configurable via config.port.
--
author:\tbob
association:\tmember
edited:\tfalse
status:\tchanges requested
--
The fallback should be a named constant, not a literal 3000.
--
author:\tcarol
association:\tcontributor
edited:\ttrue
status:\tnone
--
Agreed, and the README needs the new key documented.
--
`,
    assert: (out) => {
      // "edited" never changes what an agent would do, and "none" is gh's way
      // of saying "this is a plain comment" - which the block already says.
      expect(out).not.toContain('edited:')
      expect(out).not.toContain('status:\tnone')
      // A review verdict is the single most useful field on a PR thread.
      expect(out).toContain('status:\tchanges requested')
      // Author and association say whose opinion this is; both stay.
      expect(out).toContain('author:\tbob')
      expect(out).toContain('association:\tcontributor')
      expect(out).toContain('The fallback should be a named constant, not a literal 3000.')
      expect(out).toContain('Agreed, and the README needs the new key documented.')
    },
  },

  {
    name: 'pr view - "author:" lines in the BODY are body text, not comments, so no comment count is invented',
    cmd: 'gh',
    args: ['pr', 'view', '7'],
    input: `title:\tAdd contributor metadata
state:\tOPEN
number:\t7
--
This PR adds the following records:

author:\talice
role:\tlead
author:\tbob
role:\tdev
author:\tcarol
role:\tdev
author:\tdan
role:\tdev
author:\terin
role:\tqa

Please review.
`,
    assert: (out) => {
      // gh precedes every comment block with its own "--" line. A body that
      // merely happens to contain "author:<TAB>…" lines is not a thread, and
      // counting it produces a confident number for a PR with ZERO comments -
      // plus a "--full" escape hatch pointing at content never parsed.
      expect(out).not.toContain('more comments')
      expect(out).not.toContain('--full')
      // ...and, worse than the invented count, the tail of the body was being
      // deleted to make room for it. Every body line survives.
      expect(out).toContain('This PR adds the following records:')
      expect(out).toContain('author:\tdan')
      expect(out).toContain('author:\terin')
      expect(out).toContain('role:\tqa')
      expect(out).toContain('Please review.')
    },
  },

  {
    name: 'pr view - a body that QUOTES a thread verbatim is still body, so no comment count is invented',
    cmd: 'gh',
    args: ['pr', 'view', '7'],
    input: `title:\tImport review transcript
state:\tOPEN
--
Pasting the upstream discussion verbatim:

--
author:\talice
--
first
--
author:\tbob
--
second
--
author:\tcarol
--
third
--
author:\tdan
--
fourth

That is the whole transcript; please review.
`,
    assert: (out) => {
      // The narrower "a '--' line immediately before an author: line" rule was
      // still fooled by this: gh only ever emits the comment section when
      // -c/--comments was asked for (it was not), and every block it emits
      // carries author/association/edited/status before its "--". A body that
      // merely alternates "--" and "author:<TAB>…" has neither signal.
      expect(out).not.toContain('more comments')
      expect(out).not.toContain('--full')
      // Nothing may be deleted to make room for the count that was invented.
      expect(out).toContain('Pasting the upstream discussion verbatim:')
      for (const who of ['alice', 'bob', 'carol', 'dan']) expect(out).toContain(`author:\t${who}`)
      for (const nth of ['first', 'second', 'third', 'fourth']) expect(out).toContain(nth)
      expect(out).toContain('That is the whole transcript; please review.')
    },
  },

  {
    name: 'pr view --comments - a quoted author line in the body does not move the body/thread boundary',
    cmd: 'gh',
    args: ['pr', 'view', '7', '--comments'],
    input: `title:\tImport review transcript
state:\tOPEN
number:\t7
--
Pasting the upstream discussion verbatim:

--
author:\talice
--
first

That is the whole transcript; please review.
--
author:\tbob
association:\tmember
edited:\tfalse
status:\tnone
--
The transcript above is missing the last message.
--
`,
    assert: (out) => {
      // --comments was really passed here, so the section does exist - and the
      // grammar has to find where it starts on its own. gh emits four fields
      // and a "--" for every comment; the quoted "author:<TAB>alice" carries
      // none of them, so it stays body.
      expect(out).toContain('Pasting the upstream discussion verbatim:')
      expect(out).toContain('author:\talice')
      expect(out).toContain('first')
      expect(out).toContain('That is the whole transcript; please review.')
      // The one real comment is condensed as a comment.
      expect(out).toContain('author:\tbob')
      expect(out).toContain('association:\tmember')
      expect(out).toContain('The transcript above is missing the last message.')
      expect(out).not.toContain('edited:')
      expect(out).not.toContain('status:\tnone')
      // One comment, under the cap: nothing was dropped, so nothing is claimed.
      expect(out).not.toContain('more comments')
    },
  },

  {
    name: 'pr --repo o/r view - a global flag before the verb still resolves to the view condenser',
    cmd: 'gh',
    args: ['pr', '--repo', 'acme/widget', 'view', '7'],
    input: `title:\tfeat: x
state:\tOPEN
assignees:\t
projects:\t
--
<!-- hidden -->
Body.
`,
    assert: (out) => {
      // A value-taking global flag placed between the noun and the verb used to
      // resolve the verb to the flag's VALUE ("acme/widget"), so `pr view`
      // never reached condenseGhView. gh's flag table in ttGlobalFlags now
      // consumes the value; this case keeps that true.
      expect(out).not.toContain('assignees:')
      expect(out).not.toContain('projects:')
      expect(out).toContain('title:\tfeat: x')
      expect(out).toContain('state:\tOPEN')
      expect(out).not.toContain('<!--')
      expect(out).toContain('Body.')
    },
  },

  // ── gh <noun> list ─────────────────────────────────────────────────────────
  // Non-TTY list output is a headerless TSV whose column ORDER differs per
  // noun (pr list puts state 4th, issue list 2nd), so the condenser drops
  // columns by what they contain rather than where they sit - see the note on
  // condenseGhList.
  {
    // CHANGED DELIBERATELY: this case used to assert '123  feat: configurable
    // server port  feat/port  OPEN', i.e. the kept fields rejoined with two
    // spaces. That is gh's MACHINE format - a headerless TSV emitted precisely
    // because stdout is not a tty - and the two-space rejoin destroys the only
    // delimiter a consumer can key on. `gh pr list | cut -f2` came back with
    // the whole line, and since titles contain spaces the field boundaries were
    // unrecoverable. Same argument that earned `git diff --name-only` its
    // passthrough; here the fix is to keep the delimiter, not the column.
    name: "pr list - drops the trailing created-at column and keeps gh's TAB delimiter intact",
    cmd: 'gh',
    args: ['pr', 'list'],
    input: `123\tfeat: configurable server port\tfeat/port\tOPEN\t2026-07-20T09:12:44Z
118\tfix: retry backoff jitter\tfix/retry\tOPEN\t2026-07-19T16:04:02Z
117\tchore: bump vitest to 4.1\tchore/vitest\tDRAFT\t2026-07-19T11:47:31Z
110\tdocs: document the port option\tdocs/port\tMERGED\t2026-07-15T08:22:10Z
`,
    assert: (out) => {
      expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
      const rows = out.split('\n').map((l) => l.split('\t'))
      expect(rows).toHaveLength(4)
      // `cut -f2` is the whole point: every row still has four TAB-separated
      // fields, in the order and at the index gh put them.
      for (const f of rows) expect(f).toHaveLength(4)
      expect(rows[0]).toEqual(['123', 'feat: configurable server port', 'feat/port', 'OPEN'])
      expect(rows[3]).toEqual(['110', 'docs: document the port option', 'docs/port', 'MERGED'])
      // No row is dropped and no count is invented.
      expect(out).toContain('117')
      expect(out).toContain('118')
    },
  },
  {
    // CHANGED DELIBERATELY: the expected output was the same three rows glued
    // with two spaces. Same reason as `pr list` above - this is a TSV, and the
    // tab is data.
    name: 'issue list - trailing columns that are empty or a timestamp on every row are dropped',
    cmd: 'gh',
    args: ['issue', 'list'],
    input: `42\tOPEN\tLogin button unresponsive on mobile\t\t2026-07-20T07:31:09Z
41\tOPEN\tPort option is ignored when config.json is absent\t\t2026-07-19T22:14:55Z
39\tOPEN\tDocument the retry backoff ceiling\t\t2026-07-18T13:02:41Z
`,
    assert: (out) => {
      expect(out.split('\n')).toHaveLength(3)
      expect(out).toBe(
        '42\tOPEN\tLogin button unresponsive on mobile\n' +
          '41\tOPEN\tPort option is ignored when config.json is absent\n' +
          '39\tOPEN\tDocument the retry backoff ceiling',
      )
    },
  },
  {
    // A queued `gh run list`: the conclusion column (field 2) is empty on every
    // row, and so is elapsed (field 8). Dropping the EMPTY INTERIOR column would
    // renumber every field behind it, so `gh run list | cut -f7` - the idiom for
    // getting run ids - would come back with the branch instead, with nothing to
    // signal the shift. Only trailing columns may go.
    name: 'run list - an interior empty column is KEPT, so the fields behind it keep their index',
    cmd: 'gh',
    args: ['run', 'list'],
    input: `queued\t\tfeat: retry backoff jitter\tCI\tfix/retry\tpush\t9876543210\t\t2026-07-21T09:12:44Z
queued\t\tfix: strip the graph gutter\tCI\tfix/gutter\tpush\t9876543211\t\t2026-07-21T09:11:02Z
queued\t\tdocs: handler reference\tCI\tdocs/ref\tpush\t9876543212\t\t2026-07-21T09:09:38Z
`,
    assert: (out) => {
      const rows = out.split('\n').map((l) => l.split('\t'))
      expect(rows).toHaveLength(3)
      for (const f of rows) {
        // conclusion is still field 2, empty, exactly as gh printed it...
        expect(f[1]).toBe('')
        // ...so the run id is still field 7.
        expect(f[6]).toMatch(/^98765432\d\d$/)
      }
      expect(rows[0]).toEqual([
        'queued',
        '',
        'feat: retry backoff jitter',
        'CI',
        'fix/retry',
        'push',
        '9876543210',
      ])
      expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    },
  },
  {
    // CHANGED DELIBERATELY: the marker "... +70 more rows (--full)" used to sit
    // INSIDE the row stream. These rows are gh's machine format, and
    // `gh run list | cut -f7 | xargs -n1 gh run view` would take the marker's
    // words as run ids. The disclosure moved out of band (stderr, via ttNotice)
    // so stdout carries only rows gh actually printed.
    name: 'run list - a long list is capped without putting a marker in the row stream',
    cmd: 'gh',
    args: ['run', 'list', '--limit', '120'],
    input:
      Array.from(
        { length: 120 },
        (_, i) =>
          `completed\tsuccess\tfix: retry backoff jitter\tCI\tfix/retry\tpush\t${9876543210 + i}\t1m23s\t2026-07-20T09:12:44Z`,
      ).join('\n') + '\n',
    assert: (out) => {
      const lines = out.split('\n')
      expect(lines).toHaveLength(50)
      expect(out).not.toContain('more rows')
      expect(out).not.toContain('--full')
      expect(lines[0]).toBe(
        'completed\tsuccess\tfix: retry backoff jitter\tCI\tfix/retry\tpush\t9876543210\t1m23s',
      )
      // Every surviving line is a row the command really printed.
      const printed = new Set(
        Array.from(
          { length: 120 },
          (_, i) =>
            `completed\tsuccess\tfix: retry backoff jitter\tCI\tfix/retry\tpush\t${9876543210 + i}\t1m23s`,
        ),
      )
      for (const l of lines) expect(printed.has(l)).toBe(true)
    },
  },
  {
    name: 'list - output that is not a tab-separated table is returned unchanged, never summarised',
    cmd: 'gh',
    args: ['release', 'list'],
    input: `Showing 0 of 0 releases in acme/widget
`,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('more rows')
    },
  },

  // ── gh api ─────────────────────────────────────────────────────────────────
  // A bare `gh api` names no format flag, so isMachineOutput cannot see that
  // the payload is JSON - this handler has to guard it itself. The output must
  // stay valid JSON: something downstream may still be parsing it.
  {
    // CHANGED: this case used to assert `expect(out).not.toMatch(/"[a-z_]*_url"/)`
    // and `not.toContain('avatars.githubusercontent.com')`, i.e. it locked in a
    // blanket `*_url` strip. That rule deleted clone_url / ssh_url / html_url /
    // browser_download_url - the exact fields most `gh api` calls exist to
    // obtain - and left valid JSON with no marker, so the loss was undetectable
    // to the agent and to any downstream parser. `_links` and `node_id` are
    // defensible (a hypermedia envelope and a GraphQL relay handle); `*_url` is
    // payload. The assertions below are the inverse of the two that were wrong.
    name: 'api - drops _links / node_id noise keys, keeps the payload, stays valid JSON',
    cmd: 'gh',
    args: ['api', 'repos/acme/widget'],
    input: API_REPO,
    assert: (out) => {
      const parsed = JSON.parse(out) as Record<string, unknown>
      // Still the same document, minus the noise.
      expect(parsed['full_name']).toBe('acme/widget')
      expect(parsed['stargazers_count']).toBe(38412)
      expect(parsed['default_branch']).toBe('main')
      expect((parsed['owner'] as Record<string, unknown>)['login']).toBe('acme')
      expect((parsed['permissions'] as Record<string, unknown>)['pull']).toBe(true)
      // node_id is gone at every depth (top level, owner, license).
      expect(out).not.toContain('"node_id"')
      // ...and every URL the caller may have run this for is intact.
      expect(parsed['html_url']).toBe('https://github.com/acme/widget')
      expect((parsed['owner'] as Record<string, unknown>)['avatar_url']).toBe(
        'https://avatars.githubusercontent.com/u/59704711?v=4',
      )
      // A plain "url" key is the resource itself and survives too.
      expect(parsed['url']).toBe('https://api.github.com/repos/acme/widget')
      // The win here is the API's pretty-printing, not deleted fields.
      expect(out).not.toContain('\n')
      expect(out.length).toBeLessThan(API_REPO.length)
    },
  },
  {
    name: 'api - the *_url fields callers run `gh api` to OBTAIN are payload, not hypermedia noise',
    cmd: 'gh',
    args: ['api', 'repos/acme/widget'],
    input: `{"full_name":"acme/widget","html_url":"https://github.com/acme/widget","clone_url":"https://github.com/acme/widget.git","ssh_url":"git@github.com:acme/widget.git","default_branch":"main"}
`,
    assert: (out) => {
      // Deleting these is not compression, it is answering a different
      // question: `gh api repos/x` is run precisely to learn the clone URL.
      // The result stays valid JSON with no marker, so neither the agent nor a
      // downstream parser can tell the field was ever there.
      expect(JSON.parse(out)).toEqual({
        full_name: 'acme/widget',
        html_url: 'https://github.com/acme/widget',
        clone_url: 'https://github.com/acme/widget.git',
        ssh_url: 'git@github.com:acme/widget.git',
        default_branch: 'main',
      })
    },
  },
  {
    name: 'api - a release asset keeps its browser_download_url, the only field the call is for',
    cmd: 'gh',
    args: ['api', 'repos/acme/widget/releases/latest'],
    input: `{"tag_name":"v2.0.0","node_id":"MDc6UmVsZWFzZTEz","assets":[{"name":"widget-linux-x64.tar.gz","size":8123456,"node_id":"MDEyOlJlbGVhc2VBc3NldDE=","browser_download_url":"https://github.com/acme/widget/releases/download/v2.0.0/widget-linux-x64.tar.gz"}]}
`,
    assert: (out) => {
      const parsed = JSON.parse(out) as Record<string, unknown>
      const assets = parsed['assets'] as Record<string, unknown>[]
      expect(assets).toHaveLength(1)
      const asset = assets[0] as Record<string, unknown>
      expect(asset['browser_download_url']).toBe(
        'https://github.com/acme/widget/releases/download/v2.0.0/widget-linux-x64.tar.gz',
      )
      expect(asset['name']).toBe('widget-linux-x64.tar.gz')
      // node_id is a GraphQL relay handle, not payload, and stays stripped.
      expect(out).not.toContain('node_id')
    },
  },
  {
    name: 'api --jq - an explicit projection is the caller\'s field list, so nothing is stripped from it',
    cmd: 'gh',
    args: ['api', 'repos/acme/widget', '--jq', '{name, html_url, node_id}'],
    input: `{"name":"widget","html_url":"https://github.com/acme/widget","node_id":"MDEwOlJlcG9zaXRvcnkyMTI2MTMwNDk="}
`,
    assert: (out, input) => {
      // Stripping here would delete exactly the fields that were asked for.
      expect(out).toBe(input.trim())
      expect(JSON.parse(out)).toEqual({
        name: 'widget',
        html_url: 'https://github.com/acme/widget',
        node_id: 'MDEwOlJlcG9zaXRvcnkyMTI2MTMwNDk=',
      })
    },
  },
  {
    name: 'api graphql - every key is named by the caller\'s own query, so the response is left alone',
    cmd: 'gh',
    args: ['api', 'graphql', '-f', 'query=query { repository { ... } }'],
    input: `{"data":{"repository":{"name":"widget","homepage_url":"https://acme.dev","releases":{"nodes":[{"tagName":"v1","release_url":"https://x/1"}]}}}}
`,
    assert: (out) => {
      expect(JSON.parse(out)).toEqual({
        data: {
          repository: {
            name: 'widget',
            homepage_url: 'https://acme.dev',
            releases: { nodes: [{ tagName: 'v1', release_url: 'https://x/1' }] },
          },
        },
      })
    },
  },
  {
    name: 'api graphql - a caller-aliased node_id is the field that was asked for, not REST noise',
    cmd: 'gh',
    args: ['api', 'graphql', '-f', 'query=query { repository(owner:"acme", name:"widget") { node_id: id } }'],
    input: `{"data":{"repository":{"node_id":"R_kgDOAyz1uQ","name":"widget"}}}
`,
    assert: (out) => {
      // In GraphQL the response keys ARE the query - `node_id: id` is a common
      // alias when porting a REST call. The same reasoning that exempts --jq
      // exempts graphql: the caller already chose the field list, so filtering
      // it deletes exactly what was requested and returns `{}`-shaped lies.
      expect(JSON.parse(out)).toEqual({
        data: { repository: { node_id: 'R_kgDOAyz1uQ', name: 'widget' } },
      })
    },
  },
  {
    name: 'pr list --json - a machine format stays byte-identical and parseable',
    cmd: 'gh',
    args: ['pr', 'list', '--json', 'number,title,state'],
    input: `[{"number":123,"state":"OPEN","title":"feat: configurable server port"},{"number":118,"state":"OPEN","title":"fix: retry backoff jitter"}]
`,
    assert: (out, input) => {
      expect(JSON.parse(out)).toEqual(JSON.parse(input))
      expect(out).toBe(input.trimEnd())
      // The list condenser must not have touched it.
      expect(out).not.toContain('more rows')
    },
  },
  {
    name: 'api - a non-JSON body (jq raw output) is returned untouched',
    cmd: 'gh',
    args: ['api', 'repos/acme/widget/contents/README.md', '--header', 'Accept: application/vnd.github.raw'],
    input: `# widget

A tiny, dependency-free widget toolkit.
`,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
])

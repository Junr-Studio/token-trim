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

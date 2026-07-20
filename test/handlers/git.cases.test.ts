import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

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

describeCompression('git', [
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
])

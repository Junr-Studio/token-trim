#!/usr/bin/env node
// Pre-publish smoke test: build, pack, install the REAL tarball into a clean
// throwaway project, and import the published entrypoints. Catches packaging
// bugs (missing files, broken exports/paths) that in-repo unit tests cannot.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const isWin = process.platform === 'win32'
const base = { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
// npm is a .cmd on Windows → needs shell:true there; node is spawned by its
// absolute path so it never depends on PATH resolution.
const npm = (args, opts = {}) => execFileSync(isWin ? 'npm.cmd' : 'npm', args, { ...base, shell: isWin, ...opts })
const node = (args, opts = {}) => execFileSync(process.execPath, args, { ...base, ...opts })

console.log('› building…')
npm(['run', 'build'])

console.log('› packing…')
const tgz = resolve(JSON.parse(npm(['pack', '--json']))[0].filename)
console.log('  tarball:', tgz)

const dir = mkdtempSync(join(tmpdir(), 'tt-smoke-'))
let ok = false
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }))

  console.log('› installing the tarball into a clean project…')
  npm(['install', '--no-audit', '--no-fund', tgz], { cwd: dir })

  console.log('› importing the published entrypoints…')
  const check = `
import * as main from '@junr_studio/token-trim'
import * as stats from '@junr_studio/token-trim/stats'
const need = {
  '@junr_studio/token-trim': ['createCommandProxy', 'writeProxyScripts', 'PROXIED_COMMANDS'],
  '@junr_studio/token-trim/stats': ['parseSavingsFrame', 'createStatsReceiver', 'bytesToTokens', 'formatTokens', 'createSavingsAccumulator'],
}
const mods = { '@junr_studio/token-trim': main, '@junr_studio/token-trim/stats': stats }
let good = true
for (const [m, names] of Object.entries(need)) {
  for (const n of names) if (typeof mods[m][n] === 'undefined') { console.error('MISSING export:', m, '->', n); good = false }
}
if (!good) process.exit(1)
console.log('  all published exports present')
`
  node(['--input-type=module', '-e', check], { cwd: dir })
  ok = true
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(tgz, { force: true })
}

console.log(ok ? '✔ tarball smoke test passed' : '✖ tarball smoke test failed')
process.exit(ok ? 0 : 1)

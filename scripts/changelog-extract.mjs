#!/usr/bin/env node
// Print the CHANGELOG.md section body for a given version, for use as GitHub
// release notes. Usage: node scripts/changelog-extract.mjs <version>

import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/changelog-extract.mjs <version>')
  process.exit(2)
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)
const start = new RegExp(`^##\\s*\\[?${version.replace(/\./g, '\\.')}\\]?`)
const nextSection = /^##\s/

let capturing = false
const out = []
for (const line of lines) {
  if (capturing && nextSection.test(line)) break
  if (capturing) out.push(line)
  else if (start.test(line)) capturing = true
}

const body = out.join('\n').trim()
if (!body) {
  console.error(`No CHANGELOG section found for ${version}`)
  process.exit(1)
}
process.stdout.write(`${body}\n`)

#!/usr/bin/env node
// Version guard - enforced on every pull request targeting `main`.
//
// Fails unless package.json's version is:
//   1. a valid stable semver (x.y.z, no pre-release on the release branch),
//   2. exactly ONE logical step above the version currently on `main`
//      (next patch, next minor, or next major - nothing skipped, never lower),
//   3. documented by a matching "## [x.y.z]" section in CHANGELOG.md.
//
// Usage: node scripts/check-version.mjs --base <mainVersion>
//        (or set BASE_VERSION in the environment)

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flagIdx = args.indexOf('--base')
const baseVersion = (flagIdx >= 0 ? args[flagIdx + 1] : undefined) ?? process.env.BASE_VERSION

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!baseVersion) {
  die('no base version given (pass --base <version> or set BASE_VERSION).')
}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const current = String(pkg.version)

const curM = STABLE.exec(current)
if (!curM) {
  die(`package.json version "${current}" must be a stable semver "x.y.z" for a main release (no pre-release/build suffix).`)
}
const baseM = STABLE.exec(baseVersion)
if (!baseM) {
  die(`base (main) version "${baseVersion}" is not a stable semver "x.y.z".`)
}

const [maj, min, pat] = [Number(baseM[1]), Number(baseM[2]), Number(baseM[3])]
const nextPatch = `${maj}.${min}.${pat + 1}`
const nextMinor = `${maj}.${min + 1}.0`
const nextMajor = `${maj + 1}.0.0`
const allowed = [nextPatch, nextMinor, nextMajor]

if (current === baseVersion) {
  die(
    `version is unchanged (${current}). Every promotion to main is a release - bump it first:\n` +
      `      npm version patch --no-git-tag-version   (bug fixes  -> ${nextPatch})\n` +
      `      npm version minor --no-git-tag-version   (features   -> ${nextMinor})\n` +
      `      npm version major --no-git-tag-version   (breaking   -> ${nextMajor})`,
  )
}

if (!allowed.includes(current)) {
  die(
    `version ${current} is not a single logical step above main's ${baseVersion}.\n` +
      `      Expected exactly one of: ${nextPatch} (patch), ${nextMinor} (minor), or ${nextMajor} (major).`,
  )
}

// Release note must exist for the new version.
let changelog
try {
  changelog = readFileSync('CHANGELOG.md', 'utf8')
} catch {
  die('CHANGELOG.md not found - a release note is required before promoting to main.')
}
const heading = new RegExp(`^##\\s*\\[?${current.replace(/\./g, '\\.')}\\]?`, 'm')
if (!heading.test(changelog)) {
  die(
    `CHANGELOG.md has no entry for ${current}.\n` +
      `      Add a "## [${current}] - YYYY-MM-DD" section describing what changed.`,
  )
}

const bump = current === nextPatch ? 'patch' : current === nextMinor ? 'minor' : 'major'
console.log(`✔ version ${baseVersion} → ${current} (${bump}) and documented in CHANGELOG.md.`)

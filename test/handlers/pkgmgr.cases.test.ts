import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `pkgmgr` handler (npm / pnpm / yarn).
// Routing (see frame.ts compress dispatcher):
//   cmd in {npm,pnpm,yarn} + args[0] === 'audit' -> condensePkgAudit
//   cmd in {npm,pnpm,yarn} + anything else        -> stripPkgNoise
// Each case is pure data: realistic raw tool output + behavioral asserts.
// The harness runs the real compress(), checks it shrinks, runs the asserts,
// then snapshots the exact byte-for-byte output.

// ── stripPkgNoise fixtures ────────────────────────────────────────────────────

// npm install: deprecation warnings, upgrade notices, and timing lines are all
// noise; the "added N packages" / funding / audit summary lines are the payload.
const NPM_INSTALL = `npm warn deprecated har-validator@5.1.5: this library is no longer supported
npm warn deprecated uuid@3.4.0: Please upgrade to version 7 or higher
npm notice New minor version of npm available! 10.2.3 -> 10.8.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v10.8.1
npm notice To update run: npm install -g npm@10.8.1
npm timing idealTree:buildDeps Completed in 452ms
npm timing reify:unpack Completed in 1203ms

added 1043 packages, and audited 1044 packages in 24s

142 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities
`

// pnpm install: braille spinners, Progress:, Downloading, the hard-link notice
// and node_modules/.pnpm paths are noise; the dependency summary is the payload.
const PNPM_INSTALL = `Lockfile is up to date, resolution step is skipped
Progress: resolved 1250, reused 1200, downloaded 50, added 0
⠋ Resolving: total 1250, reused 1200, downloaded 50
Packages are hard linked from the content-addressable store to the virtual store.
node_modules/.pnpm/lodash@4.17.21
Downloading registry.npmjs.org/typescript/5.4.5: 12.5 MB/12.5 MB, done

dependencies:
+ express 4.19.2
+ typescript 5.4.5

Done in 8.3s
`

// yarn install: line-start Resolving:/Fetching/Downloading and the "> pkg@N"
// lifecycle line are stripped; the yarn banner and success lines survive.
const YARN_INSTALL = `yarn install v1.22.19
Resolving: total 1053, reused 1000, downloaded 53
Fetching typescript@5.4.5 ...
Downloading https://registry.yarnpkg.com/typescript/-/typescript-5.4.5.tgz
> core-js@3.36.1 postinstall
success Saved lockfile.
success Saved 1053 new dependencies.
Done in 34.21s.
`

// Every line is noise -> the naive strip would return an empty string, so the
// condenser's `|| text` fallback must return the ORIGINAL output unchanged.
const NPM_ALL_NOISE = `npm warn deprecated foo@1.0.0: deprecated
npm timing reify:reify Completed in 12ms
Progress: resolved 10, reused 10, downloaded 0, added 0
`

// npm run/ls tree: no noise lines at all -> meaningful output passes through
// intact (the condenser must not mangle already-useful output).
const NPM_LS = `my-app@1.0.0 /home/user/my-app
├── express@4.19.2
├── lodash@4.17.21
├── typescript@5.4.5
└── vitest@1.6.0
`

// ── condensePkgAudit fixtures ─────────────────────────────────────────────────

// npm audit --json: a large JSON report whose metadata.vulnerabilities holds
// the severity histogram the condenser collapses into one line.
const NPM_AUDIT_JSON = `{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "minimist": {
      "name": "minimist",
      "severity": "critical",
      "isDirect": false,
      "via": [ { "source": 1179, "name": "minimist", "title": "Prototype Pollution in minimist", "url": "https://github.com/advisories/GHSA-xvch-5gv4-984h", "severity": "critical", "range": "<1.2.6" } ],
      "effects": [ "mkdirp" ],
      "range": "<1.2.6",
      "nodes": [ "node_modules/minimist" ],
      "fixAvailable": true
    },
    "lodash": {
      "name": "lodash",
      "severity": "high",
      "isDirect": true,
      "via": [ { "source": 1065, "name": "lodash", "title": "Prototype Pollution in lodash", "url": "https://github.com/advisories/GHSA-p6mc-m28h-5vfr", "severity": "high", "range": ">=3.7.0 <4.17.19" } ],
      "effects": [],
      "range": ">=3.7.0 <4.17.19",
      "nodes": [ "node_modules/lodash" ],
      "fixAvailable": true
    }
  },
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 2, "moderate": 1, "high": 3, "critical": 1, "total": 7 },
    "dependencies": { "prod": 850, "dev": 420, "optional": 12, "peer": 0, "peerOptional": 0, "total": 1282 }
  }
}`

// npm audit --json with a clean tree: every severity is zero.
const NPM_AUDIT_JSON_CLEAN = `{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": { "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0 },
    "dependencies": { "prod": 850, "dev": 420, "optional": 12, "peer": 0, "peerOptional": 0, "total": 1282 }
  }
}`

// npm audit plain-text report: advisory blocks plus the trailing summary line
// that carries the per-severity counts.
const NPM_AUDIT_TEXT = `# npm audit report

lodash  <=4.17.20
Severity: high
Prototype Pollution in lodash - https://github.com/advisories/GHSA-p6mc-m28h-5vfr
Command Injection in lodash - https://github.com/advisories/GHSA-35jh-r3h4-6jhm
fix available via \`npm audit fix\`
node_modules/lodash

minimist  <1.2.6
Severity: critical
Prototype Pollution in minimist - https://github.com/advisories/GHSA-xvch-5gv4-984h
fix available via \`npm audit fix --force\`
node_modules/minimist

7 vulnerabilities (2 low, 1 moderate, 3 high, 1 critical)

To address all issues, run:
  npm audit fix
`

// npm audit plain-text with no findings -> the "found 0 vulnerabilities" line
// is surfaced verbatim.
const NPM_AUDIT_TEXT_CLEAN = `audited 1282 packages in 2s

142 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities
`

describeCompression('pkgmgr', [
  // ── stripPkgNoise ───────────────────────────────────────────────────────────
  {
    name: 'npm install - strips deprecation warnings / notices / timing, keeps summary',
    cmd: 'npm',
    args: ['install'],
    input: NPM_INSTALL,
    assert: (out, input) => {
      // Noise gone.
      expect(out).not.toContain('npm warn')
      expect(out).not.toContain('npm notice')
      expect(out).not.toContain('npm timing')
      expect(out).not.toMatch(/^npm (warn|notice|timing)/m)
      // Payload preserved.
      expect(out).toContain('added 1043 packages, and audited 1044 packages in 24s')
      expect(out).toContain('found 0 vulnerabilities')
      // Real compression.
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'pnpm install - strips braille spinners / Progress / Downloading / .pnpm paths',
    cmd: 'pnpm',
    args: ['install'],
    input: PNPM_INSTALL,
    assert: (out, input) => {
      expect(out).not.toMatch(/[⠀-⣿]/) // no braille spinner chars
      expect(out).not.toMatch(/^Progress:/m)
      expect(out).not.toMatch(/^Downloading/m)
      expect(out).not.toContain('node_modules/.pnpm')
      expect(out).not.toContain('Packages are hard linked')
      // Dependency summary survives.
      expect(out).toContain('dependencies:')
      expect(out).toContain('+ express 4.19.2')
      expect(out).toContain('Done in 8.3s')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'yarn install - strips Resolving/Fetching/Downloading + "> pkg@N" lifecycle',
    cmd: 'yarn',
    args: ['install'],
    input: YARN_INSTALL,
    assert: (out, input) => {
      expect(out).not.toMatch(/^Resolving:/m)
      expect(out).not.toMatch(/^Fetching/m)
      expect(out).not.toMatch(/^Downloading/m)
      expect(out).not.toContain('core-js@3.36.1') // "> pkg@N" lifecycle line dropped
      // Banner + success lines survive.
      expect(out).toContain('yarn install v1.22.19')
      expect(out).toContain('success Saved lockfile.')
      expect(out).toContain('Done in 34.21s.')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'install - safety fallback: all-noise output returns the ORIGINAL, never empty',
    cmd: 'npm',
    args: ['install'],
    input: NPM_ALL_NOISE,
    assert: (out) => {
      // Stripping every line would yield '' - the condenser must fall back to
      // the original text rather than emit nothing.
      expect(out.length).toBeGreaterThan(0)
      expect(out).toContain('npm warn deprecated foo@1.0.0: deprecated')
      expect(out).toContain('npm timing reify:reify Completed in 12ms')
      expect(out).toContain('Progress: resolved 10, reused 10, downloaded 0, added 0')
    },
  },
  {
    name: 'npm ls - no-noise tree passes through intact (no mangling)',
    cmd: 'npm',
    args: ['ls'],
    input: NPM_LS,
    assert: (out) => {
      expect(out).toContain('my-app@1.0.0 /home/user/my-app')
      expect(out).toContain('├── express@4.19.2')
      expect(out).toContain('└── vitest@1.6.0')
    },
  },
  {
    name: 'install - empty output stays empty (no crash, no growth)',
    cmd: 'npm',
    args: ['install'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── condensePkgAudit ────────────────────────────────────────────────────────
  {
    name: 'npm audit --json - collapses metadata histogram to a one-line summary',
    cmd: 'npm',
    args: ['audit', '--json'],
    input: NPM_AUDIT_JSON,
    assert: (out, input) => {
      expect(out).toBe('audit: 1 critical, 3 high, 1 moderate, 2 low (7 total)')
      expect(out).not.toContain('{') // no raw JSON leaks through
      expect(out).not.toContain('GHSA')
      expect(out.length).toBeLessThan(input.length / 10)
    },
  },
  {
    name: 'npm audit --json - clean tree reports "0 vulnerabilities"',
    cmd: 'npm',
    args: ['audit', '--json'],
    input: NPM_AUDIT_JSON_CLEAN,
    assert: (out, input) => {
      expect(out).toBe('audit: 0 vulnerabilities')
      expect(out).not.toContain('{')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'npm audit (text) - parses the summary line into a severity rollup',
    cmd: 'npm',
    args: ['audit'],
    input: NPM_AUDIT_TEXT,
    assert: (out, input) => {
      expect(out).toBe('audit: 1 critical, 3 high, 1 moderate, 2 low (7 total)')
      expect(out).not.toContain('GHSA') // advisory URLs stripped
      expect(out).not.toContain('# npm audit report')
      expect(out.length).toBeLessThan(input.length / 5)
    },
  },
  {
    name: 'npm audit (text) - clean tree surfaces the "found 0 vulnerabilities" line',
    cmd: 'npm',
    args: ['audit'],
    input: NPM_AUDIT_TEXT_CLEAN,
    assert: (out, input) => {
      expect(out).toBe('found 0 vulnerabilities')
      expect(out).not.toContain('funding')
      expect(out.length).toBeLessThan(input.length)
    },
  },
])

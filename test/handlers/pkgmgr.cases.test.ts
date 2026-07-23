import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `pkgmgr` handler (npm / pnpm / yarn).
// Routing (see frame.ts compress dispatcher, then condensePkgSub):
//   args[0] === 'audit'                -> condensePkgAudit
//   ls / list / la / ll                -> condensePkgLs
//   outdated                           -> condensePkgOutdated
//   why / explain                      -> condensePkgWhy
//   view / v / info / show             -> condensePkgView
//   pack / publish                     -> condensePkgPack, else stripPkgNoise
//   doctor                             -> condensePkgDoctor
//   anything else (install, run, fund, config ...) -> stripPkgNoise
// Every subcommand condenser returns its input untouched when it does not
// recognise the shape, so an unparsed tree can never come back as "0 deps".
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

// ── condensePkgLs fixtures ────────────────────────────────────────────────────

// `npm ls --all` on a real project runs to thousands of lines. Depth beyond the
// direct dependencies is noise - EXCEPT where npm flagged a problem, which is
// the only reason anyone reads this output. `deduped` on its own is npm's
// normal bookkeeping (the package resolved higher up), not a conflict.
const NPM_LS_DEEP = `my-app@1.0.0 /home/user/my-app
├─┬ express@4.19.2
│ ├── accepts@1.3.8
│ ├─┬ body-parser@1.20.2
│ │ ├── bytes@3.1.2
│ │ ├── content-type@1.0.5
│ │ └── debug@2.6.9 deduped
│ ├── cookie@0.6.0
│ ├─┬ finalhandler@1.2.0
│ │ └── statuses@2.0.1 deduped
│ └── UNMET DEPENDENCY send@^0.18.0
├── lodash@4.17.21
├─┬ typescript@5.4.5
│ └── UNMET OPTIONAL DEPENDENCY fsevents@^2.3.3
└─┬ vitest@1.6.0
  ├─┬ @vitest/expect@1.6.0
  │ └── chai@4.4.1 deduped
  └─┬ chai@4.4.1
    ├── assertion-error@1.1.0
    └── deep-eql@4.1.3 invalid: "^5.0.0" from the root project
`

// `npm ls --json`: the machine form of the tree above. Guarded globally by
// isMachineOutput, and this fixture is here so a future refactor of the ls
// condenser cannot silently start reshaping it.
const NPM_LS_JSON = `{
  "name": "my-app",
  "version": "1.0.0",
  "problems": [
    "invalid: deep-eql@4.1.3 /home/user/my-app/node_modules/deep-eql"
  ],
  "dependencies": {
    "express": { "version": "4.19.2", "resolved": "https://registry.npmjs.org/express/-/express-4.19.2.tgz" },
    "lodash": { "version": "4.17.21", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" },
    "typescript": { "version": "5.4.5", "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.4.5.tgz" }
  }
}`

// `npm ls --parseable` is npm's OWN machine flag - one absolute path per line,
// canonical \`| xargs\` input. isMachineOutput does not know about it.
const NPM_LS_PARSEABLE = `/home/user/my-app
/home/user/my-app/node_modules/express
/home/user/my-app/node_modules/lodash
/home/user/my-app/node_modules/typescript
`

// `npm ll --all` (aka `npm la`, `npm ls --long`) prints the same tree but with
// CONTINUATION lines under every entry - description, repo URL, homepage. Those
// are not tree rows, so the row parser cannot tell which package owns them: fold
// the nested rows away and the surviving descriptions silently re-attach to the
// nearest direct dependency above. Long form is a shape this condenser does not
// parse, so it must come back untouched.
const NPM_LL_LONG = `my-app@1.0.0 /home/user/my-app
├─┬ express@4.19.2
│ │ Fast, unopinionated, minimalist web framework
│ ├── accepts@1.3.8
│ │ Higher-level content negotiation
│ ├── cookie@0.6.0
│ │ HTTP server cookie parsing and serialization
│ └── debug@2.6.9
│   small debugging utility
└─┬ lodash@4.17.21
  │ Lodash modular utilities.
  └── nothing@1.0.0
`

// A perfectly healthy tree whose packages happen to have "invalid" / "valid" in
// their NAMES. npm emits its problem markers in a fixed position - `UNMET
// DEPENDENCY x` as a prefix, `pkg@1.0.0 invalid: "^5.0.0" from ...` as a suffix
// - never as a substring of a package name. `is-invalid-path` is a real, healthy
// npm package; hoisting it into a "1 problem:" list is a fabricated defect
// report for output npm reported as clean.
const NPM_LS_INNOCENT_NAMES = `my-app@1.0.0 /home/user/my-app
├─┬ valid-path@1.0.0
│ ├── is-invalid-path@1.0.2
│ ├── is-valid-path@0.1.1
│ ├── a@1.0.0
│ ├── b@1.0.0
│ ├── c@1.0.0
│ └── d@1.0.0
└── lodash@4.17.21
`

// A SHORT-form tree that happens to end with an indented note. Nothing here is
// a long-form description - the note follows a blank line, not a package row -
// so the tree above it is still the shape this condenser parses. Reading every
// indented line as long form aborts condensation for the whole tree and hands
// back thousands of lines because of one trailing note.
const NPM_LS_TRAILING_NOTE = `my-app@1.0.0 /home/user/my-app
├─┬ express@4.19.2
│ ├── accepts@1.3.8
│ ├── cookie@0.6.0
│ ├── debug@2.6.9
│ └── qs@6.11.0
└── lodash@4.17.21

  npm ls output truncated
`

// A shallow tree with one flagged entry: the condensed form is LONGER than the
// input, because five short nested rows cost less than the summary line plus a
// spelled-out problem list. The flagged entry is the only reason anyone reads
// `npm ls` output, so trading it away for a few characters hides the defect.
const NPM_LS_SHALLOW_PROBLEM = `my-app@1.0.0 /home/user/my-app
├─┬ pkg@1.0.0
│ ├── leftover@1.0.0 extraneous
│ ├── a@1.0.0
│ ├── b@1.0.0
│ ├── c@1.0.0
│ └── d@1.0.0
└── lodash@4.17.21
`

// A tree in which EVERY nested row is flagged. Nothing is foldable: `hidden` is
// 0, so the summary line would announce "0 nested entries hidden" about a tree
// that plainly has nested rows, and the problem list below it is those same
// rows re-printed one indent shallower. The whole "condensed" form is longer
// than what npm sent, for zero information gained.
const NPM_LS_ALL_FLAGGED = `my-app@1.0.0 /home/user/my-app
├─┬ pkg@1.0.0
│ ├── leftover@1.0.0 extraneous
│ └── UNMET DEPENDENCY send@^0.18.0
└── lodash@4.17.21
`

// ── condensePkgOutdated fixtures ──────────────────────────────────────────────

// `npm outdated`: a padded table whose Location and "Depended by" columns are
// derivable from the package name. "MISSING" is what npm prints in Current for
// a dependency that is declared but not installed.
const NPM_OUTDATED = `Package               Current   Wanted   Latest  Location                  Depended by
@types/node           20.11.30  20.14.9  22.0.0  node_modules/@types/node  my-app
eslint                8.57.0    8.57.1   9.7.0   node_modules/eslint       my-app
express               4.18.2    4.19.2   4.19.2  node_modules/express      my-app
typescript            5.3.3     5.4.5    5.5.4   node_modules/typescript   my-app
vite                  MISSING   5.3.3    5.3.3   node_modules/vite         my-app
`

// `yarn outdated` puts a banner and a colour legend above the same
// Package/Current/Wanted/Latest header, and a timing line below it.
const YARN_OUTDATED = `yarn outdated v1.22.19
info Color legend :
 "<red>"    : Major Update backward-incompatible updates
 "<yellow>" : Minor Update backward-compatible features
 "<green>"  : Patch Update backward-compatible bug fixes
Package     Current  Wanted   Latest   Package Type   URL
express     4.18.2   4.19.2   4.19.2   dependencies   https://expressjs.com/
lodash      4.17.20  4.17.21  4.17.21  dependencies   https://lodash.com/
Done in 1.23s.
`

// `pnpm outdated` draws a box table with no Wanted column - a shape this
// condenser does not parse, so it must come back untouched rather than be
// summarised from a guess.
const PNPM_OUTDATED_TABLE = `┌────────────────┬──────────┬────────┐
│ Package        │ Current  │ Latest │
├────────────────┼──────────┼────────┤
│ express        │ 4.18.2   │ 4.19.2 │
├────────────────┼──────────┼────────┤
│ typescript     │ 5.3.3    │ 5.5.4  │
└────────────────┴──────────┴────────┘
`

// ── condensePkgWhy fixtures ───────────────────────────────────────────────────

// `npm explain lodash`. The question is "who needs this?", and the direct
// requirers answer it; the chains explaining how each requirer itself got
// installed are longer paths to the same root. The node_modules/ line under
// every requirer just restates the "from <pkg>" clause above it.
const NPM_EXPLAIN = `lodash@4.17.21 dev
node_modules/lodash
  dev lodash@"^4.17.21" from the root project
  lodash@"^4.17.20" from eslint@8.57.0
  node_modules/eslint
    dev eslint@"^8.57.0" from the root project
  lodash@"^4.17.15" from @typescript-eslint/utils@7.13.1
  node_modules/@typescript-eslint/utils
    @typescript-eslint/utils@"7.13.1" from @typescript-eslint/eslint-plugin@7.13.1
    node_modules/@typescript-eslint/eslint-plugin
      dev @typescript-eslint/eslint-plugin@"^7.13.1" from the root project
`

// `yarn why lodash`: a four-step progress counter and four disk-size trivia
// lines wrapped around the three lines that actually answer the question.
const YARN_WHY = `yarn why v1.22.19
[1/4] Why do we have the module "lodash"?...
[2/4] Initialising dependency graph...
[3/4] Finding dependency...
[4/4] Calculating file sizes...
=> Found "lodash@4.17.21"
info Has been hoisted to "lodash"
info Reasons this module exists
   - "workspace-aggregator-8b1f" depends on it
   - Specified in "devDependencies"
   - Hoisted from "eslint#lodash"
info Disk size without dependencies: "4.9MB"
info Disk size with unique dependencies: "4.9MB"
info Disk size with transitive dependencies: "4.9MB"
info Number of shared dependencies: 0
Done in 1.32s.
`

// `pnpm why lodash` prints a section list, not npm's requirer chains - a shape
// this condenser does not parse, so it comes back untouched.
const PNPM_WHY = `Legend: production dependency, optional only, dev only

my-app@1.0.0 /home/user/my-app

devDependencies:
eslint 8.57.0
└── lodash 4.17.21
`

// ── condensePkgView fixtures ──────────────────────────────────────────────────

// `yarn info express` prints the whole packument. The versions array is the
// enormous part - 280 entries for express - and everything an agent asks this
// command for (name, version, licence, deps) sits around it. Truncated here to
// eight entries; the shape is what matters.
const YARN_INFO = `yarn info v1.22.19
{ name: 'express',
  description: 'Fast, unopinionated, minimalist web framework',
  'dist-tags': { latest: '4.19.2' },
  versions:
   [ '0.14.0',
     '0.14.1',
     '1.0.0',
     '2.0.0',
     '3.21.2',
     '4.17.1',
     '4.18.2',
     '4.19.2' ],
  maintainers: [ { name: 'dougwilson', email: 'doug@somethingdoug.com' } ],
  license: 'MIT',
  homepage: 'http://expressjs.com/',
  dependencies: { accepts: '~1.3.8', 'body-parser': '1.20.2', cookie: '0.6.0' } }
Done in 0.83s.
`

// `npm view express` carries no version array at all - "versions: 280" is
// already a count. Nothing here may be summarised away.
const NPM_VIEW = `express@4.19.2 | MIT | deps: 31 | versions: 280
Fast, unopinionated, minimalist web framework
http://expressjs.com/

dist
.tarball: https://registry.npmjs.org/express/-/express-4.19.2.tgz
.unpackedSize: 209.5 kB

dependencies:
accepts: ~1.3.8            array-flatten: 1.1.1       body-parser: 1.20.2

dist-tags:
latest: 4.19.2

published 3 months ago by dougwilson <doug@somethingdoug.com>
`

// `npm view express versions` prints the array on its own, with no key - and
// as a JS inspect dump, not JSON, so nothing downstream is parsing it.
const NPM_VIEW_VERSIONS = `[
  '0.14.0', '0.14.1', '1.0.0',
  '2.0.0',  '3.21.2', '4.17.1',
  '4.18.2', '4.19.2'
]
`

// `npm view express maintainers` is the same bare-array shape carrying
// something that is not a version list. Collapsing it would relabel the
// maintainers as "versions" - a summary invented from a shape we recognised
// only by its brackets.
const NPM_VIEW_MAINTAINERS = `[
  'dougwilson <doug@somethingdoug.com>',
  'wesleytodd <wes@wesleytodd.com>',
  'jonchurch <npm@jonchurch.com>',
  'ctcpip <c@labsyn.com>'
]
`

// ── condensePkgPack fixtures ──────────────────────────────────────────────────

// `npm pack --dry-run` lists every file in the tarball - hundreds of lines for
// a real package, of which the count, the two sizes and the shape of the tree
// are the whole answer. (npm >= 7 writes this block to stderr, so it reaches a
// stdout condenser only when the streams are merged or under npm 6 / pnpm.)
const NPM_PACK_DRY_RUN = `npm notice
npm notice 📦  token-trim@0.4.1
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 4.5kB README.md
npm notice 2.1kB package.json
npm notice 512B  dist/cli.js
npm notice 18.4kB dist/index.js
npm notice 1.2kB dist/index.d.ts
npm notice 3.3kB dist/handlers/git.js
npm notice 2.7kB dist/handlers/pkgmgr.js
npm notice 1.9kB src/cli.ts
npm notice 6.8kB src/index.ts
npm notice Tarball Details
npm notice name: token-trim
npm notice version: 0.4.1
npm notice filename: token-trim-0.4.1.tgz
npm notice package size: 12.3 kB
npm notice unpacked size: 48.7 kB
npm notice shasum: 0d5e3f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e
npm notice integrity: sha512-Lp9zX8vLPmjBhrQiAcRZ0kcAy0Cur8ntH1XmSFAtcJl==
npm notice total files: 10
npm notice
token-trim-0.4.1.tgz
`

// ── condensePkgDoctor fixtures ────────────────────────────────────────────────

// `npm doctor`: a checklist where every passing row says the same thing. Only
// the failures are actionable.
const NPM_DOCTOR = `Check                               Value   Recommendation/Notes
npm ping                            ok
npm -v                              ok      current: v10.8.1, latest: v10.8.1
node -v                             not ok  Use node v22.11.0 (current: v20.9.0)
npm config get registry             ok      using default registry
git executable in PATH              ok      /usr/bin/git
global bin folder in PATH           ok
Perms check on cached files         ok
Perms check on local node_modules   ok
Perms check on global node_modules  ok
Perms check on global bin folder    ok
Verify cache contents               not ok  Cache verification failed, run npm cache verify
`

// A healthy machine: every row says ok, so there is nothing to list.
const NPM_DOCTOR_CLEAN = `Check                               Value   Recommendation/Notes
npm ping                            ok
npm -v                              ok      current: v10.8.1, latest: v10.8.1
node -v                             ok      current: v22.11.0, recommended: v22.11.0
npm config get registry             ok      using default registry
git executable in PATH              ok      /usr/bin/git
global bin folder in PATH           ok
Perms check on cached files         ok
Perms check on local node_modules   ok
Perms check on global node_modules  ok
Perms check on global bin folder    ok
Verify cache contents               ok      verified 3421 tarballs
`

// ── light noise-stripping fixtures ────────────────────────────────────────────

// `npm ls` in a project with no dependencies. The literal answer is "(empty)" -
// there is nothing here to summarise, and a "0 direct deps" banner would cost
// tokens to say less.
const NPM_LS_EMPTY = `my-app@1.0.0 /home/user/my-app
└── (empty)
`

// `npm fund` groups packages under funding URLs. Already compact; the light
// stripper must leave the grouping intact.
const NPM_FUND = `my-app@1.0.0
├─┬ https://github.com/sponsors/sindresorhus
│ └── ansi-styles@6.2.1, chalk@5.3.0, slash@5.1.0
├─┬ https://opencollective.com/express
│ └── express@4.19.2
└─┬ https://github.com/sponsors/isaacs
  └── glob@10.4.2, rimraf@5.0.7
`

// `npm config list`. The settings are the answer and the "; ..." lines carry
// the environment they were resolved in - dropping either would be guessing.
const NPM_CONFIG_LIST = `; "user" config from /home/user/.npmrc

//registry.npmjs.org/:_authToken = (protected)
registry = "https://registry.npmjs.org/"
save-exact = true

; node bin location = /usr/local/bin/node
; node version = v22.11.0
; npm version = 10.8.1
; cwd = /home/user/my-app
; Run \`npm config ls -l\` to show all defaults.
`

// A real publish prints no tarball listing on stdout, so the pack condenser
// finds nothing and the install-noise stripper handles it.
const NPM_PUBLISH_PLAIN = `npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access
+ token-trim@0.4.1
`

// "-p" means --parseable to `npm ls`, but here it is an argument being passed
// through to the script. A blanket "-p disables compression" rule would quietly
// stop stripping npm's noise for every script that takes one.
const NPM_RUN_WITH_P_FLAG = `> my-app@1.0.0 build
> vite build -p production

npm notice New minor version of npm available! 10.2.3 -> 10.8.1
vite v5.3.3 building for production...
dist/index.html   0.46 kB
dist/assets/index-4f2a8b1c.js  142.87 kB
built in 1.23s
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
    name: 'npm ls --all - keeps the direct deps, drops nested entries, surfaces only the flagged ones',
    cmd: 'npm',
    args: ['ls', '--all'],
    input: NPM_LS_DEEP,
    assert: (out, input) => {
      // Direct dependencies survive verbatim, with their resolved versions.
      expect(out).toContain('├─┬ express@4.19.2')
      expect(out).toContain('├── lodash@4.17.21')
      expect(out).toContain('├─┬ typescript@5.4.5')
      expect(out).toContain('└─┬ vitest@1.6.0')
      // Healthy transitive entries are gone.
      expect(out).not.toContain('bytes@3.1.2')
      expect(out).not.toContain('assertion-error@1.1.0')
      // A plain `deduped` is normal resolution, not a conflict.
      expect(out).not.toContain('debug@2.6.9 deduped')
      // Every flagged entry survives, at any depth.
      expect(out).toContain('UNMET DEPENDENCY send@^0.18.0')
      expect(out).toContain('UNMET OPTIONAL DEPENDENCY fsevents@^2.3.3')
      expect(out).toContain('deep-eql@4.1.3 invalid: "^5.0.0" from the root project')
      // Counts are reported so the elision is visible, never silent.
      expect(out).toMatch(/4 direct/)
      expect(out).toMatch(/19 total/)
      // The point of the condenser: one line per direct dep plus the flagged
      // entries, instead of one line per node in the tree.
      expect(out.split('\n').length).toBeLessThanOrEqual(input.trim().split('\n').length / 2)
    },
  },
  {
    name: 'npm ls --json - machine format still parses as JSON',
    cmd: 'npm',
    args: ['ls', '--json'],
    input: NPM_LS_JSON,
    assert: (out) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).dependencies.express.version).toBe('4.19.2')
      expect(JSON.parse(out).problems).toHaveLength(1)
    },
  },
  {
    name: 'npm ls --parseable - bare path list survives verbatim as xargs input',
    cmd: 'npm',
    args: ['ls', '--parseable'],
    input: NPM_LS_PARSEABLE,
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        '/home/user/my-app',
        '/home/user/my-app/node_modules/express',
        '/home/user/my-app/node_modules/lodash',
        '/home/user/my-app/node_modules/typescript',
      ])
      expect(out).not.toMatch(/direct|total|hidden/)
    },
  },
  {
    name: 'npm ll --all - long-form continuation lines are never re-attributed to the wrong package',
    cmd: 'npm',
    args: ['ll', '--all'],
    input: NPM_LL_LONG,
    assert: (out, input) => {
      // Hiding the nested rows would leave their descriptions stranded under
      // express, which did not write any of them.
      expect(out).not.toMatch(/nested entries hidden/)
      // Every description still sits directly under the package it describes.
      expect(out).toContain('├── accepts@1.3.8\n│ │ Higher-level content negotiation')
      expect(out).toContain('├── cookie@0.6.0\n│ │ HTTP server cookie parsing and serialization')
      expect(out).toContain('└── debug@2.6.9\n│   small debugging utility')
      expect(out).toContain('└─┬ lodash@4.17.21\n  │ Lodash modular utilities.')
      // A shape we cannot parse comes back exactly as npm printed it.
      expect(out).toBe(input.trim())
    },
  },
  {
    name: 'npm ls --all - a package NAMED "is-invalid-path" is not a problem report',
    cmd: 'npm',
    args: ['ls', '--all'],
    input: NPM_LS_INNOCENT_NAMES,
    assert: (out, input) => {
      // npm reported a clean tree; inventing a defect list from a name match is
      // the fabrication this whole condenser exists to avoid.
      expect(out).not.toMatch(/problem/)
      expect(out).not.toContain('[x]')
      expect(out).not.toContain('is-invalid-path')
      // The healthy nested rows are folded like any other nested entry.
      expect(out).toContain('... 6 nested entries hidden - 2 direct of 8 total')
      expect(out).toContain('├─┬ valid-path@1.0.0')
      expect(out).toContain('└── lodash@4.17.21')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'npm ls --all - an indented note after the tree is not a long-form description, so the tree is still condensed',
    cmd: 'npm',
    args: ['ls', '--all'],
    input: NPM_LS_TRAILING_NOTE,
    assert: (out, input) => {
      // The long-form bail-out exists for description lines attached to the row
      // above them. This note is attached to nothing, so it costs no compression.
      expect(out).toContain('... 4 nested entries hidden - 2 direct of 6 total')
      expect(out).toContain('├─┬ express@4.19.2')
      expect(out).toContain('└── lodash@4.17.21')
      expect(out).not.toContain('accepts@1.3.8')
      expect(out).not.toContain('qs@6.11.0')
      // Output the condenser did not parse is kept, never dropped.
      expect(out).toContain('npm ls output truncated')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    // CHANGED DELIBERATELY. This case used to assert the opposite, with
    // allowGrowth: true - the problem list was worth more than the characters
    // it cost. It is not, for one reason: NOTHING IS LOST by falling back.
    // npm printed `leftover@1.0.0 extraneous` in place, inside the tree, with
    // its parent above it - so the agent sees the defect either way. All the
    // summary adds is convenience, and buying convenience by making the output
    // LARGER breaks the single promise a compressor makes.
    name: 'npm ls --all - a shallow tree whose problem list would cost more than it saves comes back whole',
    cmd: 'npm',
    args: ['ls', '--all'],
    input: NPM_LS_SHALLOW_PROBLEM,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      // the defect is still right there, where npm put it
      expect(out).toContain('leftover@1.0.0 extraneous')
      // and no fabricated rollup was bought with extra characters
      expect(out).not.toContain('1 problem:')
      expect(out).not.toContain('nested entries hidden')
    },
  },
  {
    name: 'npm ls --all - a tree whose every nested row is flagged has nothing to fold, so it comes back verbatim instead of growing',
    cmd: 'npm',
    args: ['ls', '--all'],
    input: NPM_LS_ALL_FLAGGED,
    assert: (out, input) => {
      // Deliberately NOT allowGrowth: the case above earns its extra characters
      // by folding four nested rows away, this one folds nothing. There is
      // nothing to disclose, so "0 nested entries hidden" is a zero asserted
      // about a tree that had nested rows - and the rows it introduces to say
      // so are the rows npm already printed.
      expect(out).not.toContain('nested entries hidden')
      expect(out).toBe(input.trim())
      // Every flagged row still reaches the agent, in place, as npm wrote it.
      expect(out).toContain('│ ├── leftover@1.0.0 extraneous')
      expect(out).toContain('│ └── UNMET DEPENDENCY send@^0.18.0')
    },
  },
  {
    name: 'npm outdated - the wide table becomes one line per package',
    cmd: 'npm',
    args: ['outdated'],
    input: NPM_OUTDATED,
    assert: (out, input) => {
      expect(out.split('\n')).toEqual([
        '5 outdated (current → wanted/latest):',
        '@types/node 20.11.30 → 20.14.9/22.0.0',
        'eslint 8.57.0 → 8.57.1/9.7.0',
        // wanted === latest, so one target instead of a repeated pair
        'express 4.18.2 → 4.19.2',
        'typescript 5.3.3 → 5.4.5/5.5.4',
        'vite MISSING → 5.3.3',
      ])
      // Location and "Depended by" are derivable from the package name.
      expect(out).not.toContain('node_modules/')
      expect(out).not.toContain('Depended by')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'yarn outdated - banner and colour legend go, unparsed lines are still kept',
    cmd: 'yarn',
    args: ['outdated'],
    input: YARN_OUTDATED,
    assert: (out, input) => {
      expect(out).toContain('express 4.18.2 → 4.19.2')
      expect(out).toContain('lodash 4.17.20 → 4.17.21')
      expect(out).not.toContain('Color legend')
      expect(out).not.toContain('Major Update')
      expect(out).not.toContain('https://')
      // Anything the row parser did not understand is preserved, never dropped
      // on the assumption that it did not matter.
      expect(out).toContain('Done in 1.23s.')
      expect(out.length).toBeLessThan(input.length / 3)
    },
  },
  {
    name: 'pnpm outdated - an unrecognised box table is returned unchanged, not summarised',
    cmd: 'pnpm',
    args: ['outdated'],
    input: PNPM_OUTDATED_TABLE,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toMatch(/\d+ outdated/)
    },
  },
  {
    name: 'npm outdated - everything up to date prints nothing and stays nothing',
    cmd: 'npm',
    args: ['outdated'],
    input: '',
    assert: (out) => {
      // The failure mode this guards: emitting a confident "0 outdated" banner
      // for output that was never parsed.
      expect(out).toBe('')
    },
  },
  {
    name: 'npm explain - keeps the direct requirers, folds the longer paths behind a count',
    cmd: 'npm',
    args: ['explain', 'lodash'],
    input: NPM_EXPLAIN,
    assert: (out, input) => {
      expect(out).toContain('lodash@4.17.21 dev')
      // Every direct requirer - the shortest paths - survives.
      expect(out).toContain('dev lodash@"^4.17.21" from the root project')
      expect(out).toContain('lodash@"^4.17.20" from eslint@8.57.0')
      expect(out).toContain('lodash@"^4.17.15" from @typescript-eslint/utils@7.13.1')
      // How eslint itself got installed is a longer path to the same root.
      expect(out).not.toContain('dev eslint@"^8.57.0" from the root project')
      expect(out).not.toContain('@typescript-eslint/eslint-plugin@7.13.1')
      // The install locations restate the "from <pkg>" clause above them.
      expect(out).not.toContain('node_modules/')
      // The elision is counted, never silent.
      expect(out).toContain('3 longer paths folded')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'yarn why - progress counter and disk-size trivia go, the reasons stay',
    cmd: 'yarn',
    args: ['why', 'lodash'],
    input: YARN_WHY,
    assert: (out, input) => {
      expect(out).not.toMatch(/^\[\d+\/\d+\]/m)
      expect(out).not.toContain('Disk size')
      expect(out).not.toContain('Number of shared dependencies')
      // The answer, verbatim.
      expect(out).toContain('=> Found "lodash@4.17.21"')
      expect(out).toContain('info Reasons this module exists')
      expect(out).toContain('- "workspace-aggregator-8b1f" depends on it')
      expect(out).toContain('- Specified in "devDependencies"')
      expect(out).toContain('- Hoisted from "eslint#lodash"')
      // Where it ended up is resolution info, not trivia.
      expect(out).toContain('info Has been hoisted to "lodash"')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'pnpm why - an unrecognised section list is returned unchanged',
    cmd: 'pnpm',
    args: ['why', 'lodash'],
    input: PNPM_WHY,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('folded')
    },
  },
  {
    name: 'yarn info - the version history array collapses to a count and a range',
    cmd: 'yarn',
    args: ['info', 'express'],
    input: YARN_INFO,
    assert: (out, input) => {
      expect(out).toContain('versions: 8 (0.14.0 … 4.19.2)')
      // Intermediate history is gone; the endpoints and the count remain.
      expect(out).not.toContain("'3.21.2'")
      expect(out).not.toContain("'4.17.1'")
      // The summary an agent actually asked for survives.
      expect(out).toContain("name: 'express'")
      expect(out).toContain("license: 'MIT'")
      expect(out).toContain("dependencies: { accepts: '~1.3.8'")
      expect(out).toContain("'dist-tags': { latest: '4.19.2' }")
      // The whole array is now one line, so the cost stops scaling with the
      // package's release count (8 here, 280 for the real express).
      const versionLines = out.split('\n').filter((l) => l.includes('versions:'))
      expect(versionLines).toHaveLength(1)
      // Nine lines of array ("versions:" + 8 entries) become one.
      expect(out.split('\n').length).toBe(input.trim().split('\n').length - 8)
    },
  },
  {
    name: 'npm view - output with no version array keeps every field',
    cmd: 'npm',
    args: ['view', 'express'],
    input: NPM_VIEW,
    assert: (out) => {
      expect(out).toContain('express@4.19.2 | MIT | deps: 31 | versions: 280')
      expect(out).toContain('accepts: ~1.3.8')
      expect(out).toContain('latest: 4.19.2')
      expect(out).toContain('.unpackedSize: 209.5 kB')
      // "versions: 280" is already a count, not an array to collapse.
      expect(out).not.toMatch(/versions: \d+ \(/)
    },
  },
  {
    name: 'npm view <pkg> versions - a bare version array collapses to a count and a range',
    cmd: 'npm',
    args: ['view', 'express', 'versions'],
    input: NPM_VIEW_VERSIONS,
    assert: (out) => {
      expect(out).toBe('versions: 8 (0.14.0 … 4.19.2)')
    },
  },
  {
    name: 'npm view <pkg> maintainers - a non-version array is not relabelled as versions',
    cmd: 'npm',
    args: ['view', 'express', 'maintainers'],
    input: NPM_VIEW_MAINTAINERS,
    assert: (out) => {
      expect(out).not.toContain('versions')
      // Every maintainer is still there - brackets alone are not recognition.
      expect(out).toContain('dougwilson <doug@somethingdoug.com>')
      expect(out).toContain('wesleytodd <wes@wesleytodd.com>')
      expect(out).toContain('jonchurch <npm@jonchurch.com>')
      expect(out).toContain('ctcpip <c@labsyn.com>')
    },
  },
  {
    name: 'npm pack --dry-run - the file listing becomes a count, the sizes and the top directories',
    cmd: 'npm',
    args: ['pack', '--dry-run'],
    input: NPM_PACK_DRY_RUN,
    assert: (out, input) => {
      expect(out).toContain('token-trim@0.4.1: 10 files, 12.3 kB packed, 48.7 kB unpacked')
      // Shape of the tarball, not its inventory.
      expect(out).toContain('dist/ 5 files')
      expect(out).toContain('./ 3 files')
      expect(out).toContain('src/ 2 files')
      expect(out).not.toContain('README.md')
      expect(out).not.toContain('dist/handlers/git.js')
      // Hashes are unreadable and unactionable.
      expect(out).not.toContain('shasum')
      expect(out).not.toContain('integrity')
      // The tarball name is the command's actual stdout payload.
      expect(out).toContain('token-trim-0.4.1.tgz')
      expect(out.length).toBeLessThan(input.length / 3)
    },
  },
  {
    name: 'npm doctor - passing checks collapse to a tally, failures keep their advice',
    cmd: 'npm',
    args: ['doctor'],
    input: NPM_DOCTOR,
    assert: (out, input) => {
      expect(out.split('\n')).toEqual([
        'doctor: 9 of 11 checks ok',
        '  [x] node -v: Use node v22.11.0 (current: v20.9.0)',
        '  [x] Verify cache contents: Cache verification failed, run npm cache verify',
      ])
      expect(out).not.toContain('Perms check')
      expect(out.length).toBeLessThan(input.length / 3)
    },
  },
  {
    name: 'npm doctor - a clean run is a single tally line',
    cmd: 'npm',
    args: ['doctor'],
    input: NPM_DOCTOR_CLEAN,
    assert: (out, input) => {
      expect(out).toBe('doctor: 11 checks ok')
      expect(out.length).toBeLessThan(input.length / 10)
    },
  },
  {
    name: 'npm ls - a project with no dependencies is left exactly as npm printed it',
    cmd: 'npm',
    args: ['ls'],
    input: NPM_LS_EMPTY,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
      expect(out).not.toContain('direct')
    },
  },
  {
    name: 'npm fund - the funding groups survive the light strip intact',
    cmd: 'npm',
    args: ['fund'],
    input: NPM_FUND,
    assert: (out, input) => {
      expect(out).toBe(input.trim())
    },
  },
  {
    name: 'npm config list - settings and the resolved environment both survive',
    cmd: 'npm',
    args: ['config', 'list'],
    input: NPM_CONFIG_LIST,
    assert: (out) => {
      expect(out).toContain('registry = "https://registry.npmjs.org/"')
      expect(out).toContain('save-exact = true')
      expect(out).toContain('; npm version = 10.8.1')
      // npm redacts the token itself; the condenser must not undo that.
      expect(out).toContain('_authToken = (protected)')
    },
  },
  {
    name: 'npm publish - output with no tarball listing falls back to install-noise stripping',
    cmd: 'npm',
    args: ['publish'],
    input: NPM_PUBLISH_PLAIN,
    assert: (out) => {
      // No file rows were found, so no count/size summary may be invented.
      expect(out).toBe('+ token-trim@0.4.1')
      expect(out).not.toContain('files')
    },
  },
  {
    name: 'npm run - a "-p" bound for the script does not disable noise stripping',
    cmd: 'npm',
    args: ['run', 'build', '--', '-p', 'production'],
    input: NPM_RUN_WITH_P_FLAG,
    assert: (out, input) => {
      expect(out).not.toContain('npm notice')
      expect(out).not.toContain('> my-app@1.0.0 build')
      expect(out).toContain('vite v5.3.3 building for production...')
      expect(out).toContain('built in 1.23s')
      expect(out.length).toBeLessThan(input.length)
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
    // CHANGED DELIBERATELY: --json is a machine format. Collapsing it to
    // "audit: 1 critical, ..." emits text that is not JSON at all, so the
    // idiomatic `npm audit --json | jq '.metadata.vulnerabilities.high'` fails
    // to parse - the same silent-corruption class as `cat data.json | jq`.
    // The one-line summary is still produced for the human-facing plain-text
    // form below, which is where the tokens actually are.
    name: 'npm audit --json - machine format passes through as valid JSON',
    cmd: 'npm',
    args: ['audit', '--json'],
    input: NPM_AUDIT_JSON,
    assert: (out) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).metadata.vulnerabilities.critical).toBe(1)
    },
  },
  {
    name: 'npm audit --json - clean tree also passes through as valid JSON',
    cmd: 'npm',
    args: ['audit', '--json'],
    input: NPM_AUDIT_JSON_CLEAN,
    assert: (out) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).metadata.vulnerabilities.total).toBe(0)
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

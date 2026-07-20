# Publishing & release process

token-trim publishes to **public npm** from GitHub Actions. This document is the
runbook: the branch model, the one-time setup, and the day-to-day flow.

## Branch model & channels

```
feature/*  ──PR──▶  dev  ──PR──▶  canary  ──PR──▶  main
(no publish)     (integration)  (pre-release)     (stable)
                                     │                │
                                     ▼                ▼
                          npm dist-tag "canary"   npm dist-tag "latest"
                          x.y.z-canary.N          x.y.z
                          pnpm add @junr_studio/token-trim@canary   pnpm add @junr_studio/token-trim
```

- **`dev`** - integration branch. CI runs; nothing is published.
- **`canary`** - early-access channel. Every push publishes a **pre-release**
  (`x.y.z-canary.<run>`) under the `canary` dist-tag, **without** moving `latest`.
  Opt in with `pnpm add @junr_studio/token-trim@canary`.
- **`main`** - stable channel. Every push publishes the stable `x.y.z` under
  `latest`, tags the commit `vx.y.z`, and cuts a GitHub Release from the CHANGELOG.

`package.json` always holds the **target stable version** (e.g. `0.2.0`). Canary
stamps it as `0.2.0-canary.N` at publish time only (never committed); main
publishes the same `0.2.0` as stable.

## Workflows

| File | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push to dev/canary/main + all PRs | typecheck (src+tests), test, build on ubuntu+windows × node 18/20/22 |
| `version-guard.yml` | PR → main | fails unless the version is bumped one logical step and has a CHANGELOG entry |
| `release-canary.yml` | push → canary | publish `@canary` pre-release |
| `release.yml` | push → main | publish `@latest`, tag, GitHub Release (idempotent) |

## One-time setup

Requires the [`gh`](https://cli.github.com/) CLI authenticated for the `Junr-Studio` org and an npm **Automation** access token (npmjs.com → Access Tokens → Generate New Token → *Automation*; it bypasses 2FA for CI).

Run from the package root, **in this order** (the secret must exist before the first push to main so the release job can publish):

```sh
# 1. Initialise git and make the first commit
git init -b main
git add -A
git commit -m "chore: token-trim 0.1.0 - initial public release"

# 2. Create the PUBLIC GitHub repo (no push yet)
gh repo create Junr-Studio/token-trim --public --source=. --remote=origin \
  --description "Compress the output of shell commands your AI agent runs, to cut the tokens they cost."

# 3. Store the npm token as a repo secret
gh secret set NPM_TOKEN --body "<your-npm-automation-token>"

# 4. Push main → triggers release.yml → publishes @junr_studio/token-trim@0.1.0 to latest
git push -u origin main

# 5. Create the other long-lived branches
git branch canary && git push -u origin canary
git branch dev    && git push -u origin dev
```

### Branch protection

Protect **main** (strict - force PRs, both status checks, a review, linear history):

```sh
gh api -X PUT repos/Junr-Studio/token-trim/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["CI success", "version bump + changelog"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

Protect **canary** (lighter - force PRs + CI, no mandatory review):

```sh
gh api -X PUT repos/Junr-Studio/token-trim/branches/canary/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["CI success"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

> The context names above must match the workflow job names exactly:
> `CI success` (from `ci.yml`) and `version bump + changelog` (from `version-guard.yml`).

## Day-to-day: cutting a release

1. Build features on `feature/*`, PR into **`dev`**.
2. When ready to preview, PR **`dev` → `canary`**. On merge, a pre-release lands on
   the `canary` dist-tag. Testers run `pnpm add @junr_studio/token-trim@canary`.
3. To ship stable, PR **`canary` → `main`**. In that PR you MUST:
   - bump the version (choose per [semver](https://semver.org); `0.x` minors may break):
     ```sh
     npm version patch --no-git-tag-version   # bug fixes
     npm version minor --no-git-tag-version   # features
     npm version major --no-git-tag-version   # breaking changes
     ```
     (`--no-git-tag-version` - CI creates the tag, not you.)
   - add a matching `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.

   `version-guard.yml` blocks the merge unless the bump is exactly one logical
   step above main and the CHANGELOG entry exists. On merge, `release.yml`
   publishes the stable version, tags `vx.y.z`, and opens a GitHub Release.

You can check the guard locally before opening the PR:

```sh
node scripts/check-version.mjs --base "$(git show origin/main:package.json | jq -r .version)"
```

## Production hardening

Most safeguards are wired into the workflows already; a few need one-time
settings in the GitHub/npm UI.

### What runs automatically
- **CI** (`ci.yml`): the test matrix + a `package checks` job - packs the real
  tarball, installs it into a clean project and imports it, then runs `publint`
  and `arethetypeswrong` on the package.
- **CodeQL** + **OpenSSF Scorecard**: static analysis and supply-chain scoring
  (the Scorecard badge is in the README).
- **Dependabot**: weekly PRs bumping the pinned Action SHAs and devDependencies.
- Actions in the publish path are **pinned to commit SHAs** (not moving tags).
- The publish job runs in the **`production`** GitHub Environment.

### Recommended: OIDC trusted publishing (drop the token)
Instead of a long-lived `NPM_TOKEN`, npm supports **trusted publishing** via
GitHub OIDC - no secret to store, leak, or rotate. The token path works today;
migrate once the package exists:
1. npmjs.com → `token-trim` → *Settings → Trusted Publisher* → add repository
   `Junr-Studio/token-trim`, workflows `release.yml` and `release-canary.yml`
   (environment `production` for the stable one).
2. Remove the `NODE_AUTH_TOKEN` env from the publish steps (keep
   `permissions: id-token: write`), then delete the `NPM_TOKEN` secret.

### One-time GitHub settings
- *Settings → Actions → General → Workflow permissions*: **read-only** default
  `GITHUB_TOKEN`.
- *Settings → Environments → production*: optionally add **required reviewers**
  to gate every publish behind a manual approval, and store `NPM_TOKEN` as an
  environment secret (scoped) rather than a repo secret.

### npm account
- Enable **2FA** (auth + writes) on the account/org.
- If you keep the token, use an **Automation** token (bypasses 2FA in CI).

### If a release is bad
You cannot un-publish after 72h - deprecate and ship a fix instead:
```sh
npm deprecate @junr_studio/token-trim@x.y.z "Broken - upgrade to the next patch"
# then bump + release the fix through canary → main
```
Consumers can verify provenance/signatures of any release with:
```sh
npm audit signatures
```

## Installing

```sh
pnpm add @junr_studio/token-trim           # stable (latest)
pnpm add @junr_studio/token-trim@canary    # early-access pre-releases
```

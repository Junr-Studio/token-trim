# Security Policy

## Supported versions

token-trim is pre-1.0 and released from the `main` line. Security fixes are
applied to the latest published release only.

| Version | Supported |
| --- | --- |
| 0.1.x | :white_check_mark: |
| < 0.1.0 | :x: |

We recommend always running the most recent release.

## Scope

token-trim **generates and then executes local wrapper scripts** (`proxy.mjs`,
per-command `bin/` wrappers, and `setup.sh`) that a spawned process runs via a
prepended `PATH`. It performs no network access of its own and sends no
telemetry. The relevant threat surface is therefore **the local developer
machine** where these scripts are written and run - for example, unintended code
execution through a generated wrapper, or path/environment handling that could be
abused by untrusted input passed into the API.

Because the wrappers intercept commands your agent runs, treat the `dir` you hand
to `createCommandProxy` / `writeProxyScripts` as trusted, writable-by-you
location, and be mindful of what you allow a proxied process to execute.

## Reporting a vulnerability

Please report security issues **privately** - do not open a public GitHub issue.

Email **security@junr.studio** with:

- a description of the issue and its potential impact,
- steps to reproduce (a minimal proof of concept is ideal),
- affected version(s) and your operating system, and
- any suggested remediation, if you have one.

We aim to acknowledge your report within a few business days and will keep you
updated as we investigate. Once a fix is available we will coordinate a
disclosure timeline with you and credit you in the release notes if you'd like.

Thank you for helping keep token-trim and its users safe.

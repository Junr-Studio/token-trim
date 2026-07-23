import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `http` handler (src/handlers/http.ts).
// Two condensers dispatched by command name:
//   curl → condenseCurl  - truncate any response body longer than 2000 chars.
//   wget → condenseWget  - strip wget's own transfer log, keep the downloaded
//                          content. The log is recognised BY POSITION - a run
//                          opened by wget's `--<timestamp>--  <url>` banner -
//                          not by the shape of a line, because with `-O -` the
//                          stdout compress() sees IS the payload and a payload
//                          line may say anything, including "Length: 42".
// Each case pairs a realistic raw command output with behavioral assertions;
// the harness runs the real compress(), checks it shrinks (unless allowGrowth),
// runs the asserts, then snapshots the exact byte-for-byte output.

// ── curl fixtures ─────────────────────────────────────────────────────────────

// A big JSON API response (~5 KB): well past the 2000-char truncation limit.
// A marker sits at the very start (must survive) and another at the very end
// (must be dropped by the truncation).
const CURL_LONG =
  '{\n' +
  '  "head_marker": "START_OF_BODY",\n' +
  '  "users": [\n' +
  Array.from(
    { length: 60 },
    (_, i) =>
      `    { "id": ${i}, "name": "user_${i}", "email": "user_${i}@example.com", "active": true }`,
  ).join(',\n') +
  '\n  ],\n' +
  '  "tail_marker": "END_OF_BODY_SECRET_TAIL"\n' +
  '}\n'

// A small JSON body well under the limit - nothing to truncate (passthrough).
const CURL_SHORT = `{
  "id": 42,
  "name": "Ada Lovelace",
  "role": "admin",
  "active": true,
  "teams": ["core", "infra"]
}`

// Deterministic bodies pinned to the exact 2000-char boundary. condenseCurl
// keeps `<= 2000` verbatim and truncates only when strictly greater.
const CURL_PREFIX = '{"ok":true,"payload":"' // 22 chars
const CURL_2001 = CURL_PREFIX + 'x'.repeat(2001 - CURL_PREFIX.length - 2) + '"}' // exactly 2001

/** Guards the fixture's own premise: it must really be JSON for the case to mean anything. */
function input2001IsJson(): boolean {
  try { JSON.parse(CURL_2001); return true } catch { return false }
}

// ── wget fixtures ─────────────────────────────────────────────────────────────

// Verbose download streamed to stdout (`wget -O - ... 2>&1`): connection
// chatter + dot-mode progress rows wrapped around the actual JSON payload and
// the final "saved" confirmation.
const WGET_VERBOSE = `--2026-07-20 12:34:56--  https://example.com/data.json
Resolving example.com (example.com)... 93.184.216.34, 2606:2800:220:1:248:1893:25c8:1946
Connecting to example.com (example.com)|93.184.216.34|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 4096 (4.0K) [application/json]
Saving to: 'data.json'

     0K .......... .......... .......... .......... .......... 12%  1.15M 3s
    50K .......... .......... .......... .......... .......... 25%  2.30M 2s
   100K .......... .......... .......... .......... .......... 38%  3.45M 2s
   150K .......... .......... .......... .......... .......... 51%  4.60M 1s
   200K .......... .......... .......... .......... .......... 100% 5.75M=0.1s

{"status":"ok","items":[{"id":1,"name":"alpha"},{"id":2,"name":"beta"}],"total":2}

2026-07-20 12:34:57 (5.75 MB/s) - 'data.json' saved [4096/4096]`

// A plain file download (content saved to disk, not stdout): every line is
// transfer noise, so condenseWget's filter empties the output and the `|| text`
// safety net returns the original untouched.
const WGET_NOISE_ONLY = `--2026-07-20 12:40:00--  https://example.com/big.iso
Resolving example.com (example.com)... 93.184.216.34
Connecting to example.com (example.com)|93.184.216.34|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1073741824 (1.0G) [application/octet-stream]
Saving to: 'big.iso'

     0K .......... .......... .......... .......... .......... 0%  1.15M 15m
 50000K .......... .......... .......... .......... .......... 5%  2.30M 12m`

// A payload fetched with `-qO -`: wget printed no transfer log at all, so every
// line here came off the wire. Three of them are shaped exactly like wget's own
// chatter - a `Length:` header, a dot-meter row, a size-prefixed line - and one
// is a bare blank separator. Deleting any of them corrupts the download.
const WGET_PAYLOAD_LOOKALIKE = `metric,value
Length: 42 (unspecified)
19M of raw telemetry follows
     0K .......... .......... rows below this line are data
Resolving hostnames is done by the collector, not here
Connecting to the socket took 3ms
HTTP request sent, awaiting response was logged by the app itself
Saving to: /var/lib/collector/spool
requests_total,481203
bytes_in_total,99182334`

// A shell installer fetched for piping into sh. Truncating this does not
// produce a shorter message - it produces a HALF-EXECUTED INSTALL.
const CURL_INSTALL_SCRIPT =
  '#!/bin/sh\nset -eu\n' +
  Array.from(
    { length: 80 },
    (_, i) => `echo "step ${i}: preparing component number ${i} of the installation"`,
  ).join('\n') +
  '\ninstall_everything\necho "done"\n'

// An HTML page: prose-shaped, nobody pipes it into a parser, safe to cap.
const CURL_HTML =
  '<!doctype html>\n<html><head><title>Example</title>\n' +
  Array.from(
    { length: 120 },
    (_, i) => `<meta name="tag-${i}" content="value number ${i} for the page metadata">`,
  ).join('\n') +
  '\n</head><body><h1>Hello</h1><p>The content lives here.</p></body></html>\n'

describeCompression('http', [
  // ── curl ────────────────────────────────────────────────────────────────────
  // CHANGED DELIBERATELY: curl used to cut every body at 2000 characters
  // regardless of what it was. curl's stdout is whatever the server returned and
  // is routinely piped straight into another program, so a blind character cut
  // corrupts the consumer. The condenser is shape-aware now.
  {
    name: 'curl JSON body - condensed but still parseable, because `| jq` is the canonical use',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/users'],
    input: CURL_LONG,
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'curl shell script - never cut, because the pipe target executes it',
    cmd: 'curl',
    args: ['-sL', 'https://example.com/install.sh'],
    input: CURL_INSTALL_SCRIPT,
    assert: (out) => {
      // `curl -sL … | sh` on a truncated script runs half an installation and
      // then stops, leaving the machine in an undefined state.
      expect(out).toBe(CURL_INSTALL_SCRIPT.trim())
      expect(out).toContain('install_everything')
      expect(out).toContain('echo "done"')
    },
  },
  {
    name: 'curl HTML page - prose-shaped, so it is capped and the elision is disclosed',
    cmd: 'curl',
    args: ['-s', 'https://example.com/'],
    input: CURL_HTML,
    assert: (out, input) => {
      expect(out.length).toBeLessThan(input.length)
      expect(out).toMatch(/truncated|elided/i)
    },
  },
  {
    name: 'curl - short body under the limit passes through unchanged (no trigger)',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/users/42'],
    input: CURL_SHORT,
    assert: (out, input) => {
      expect(out).toBe(input)
      expect(out).not.toContain('truncated')
      expect(out).toContain('Ada Lovelace')
    },
  },
  {
    name: 'curl - a body at the size boundary that is valid JSON stays valid JSON',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/blob'],
    input: CURL_2001,
    assert: (out) => {
      expect(input2001IsJson()).toBe(true)
      expect(() => JSON.parse(out)).not.toThrow()
    },
  },
  {
    name: 'curl - empty output short-circuits to empty (zero case)',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/health'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── wget ────────────────────────────────────────────────────────────────────
  {
    name: 'wget - strips resolving/connecting/progress-bar noise, keeps downloaded content',
    cmd: 'wget',
    args: ['-O', '-', 'https://example.com/data.json'],
    input: WGET_VERBOSE,
    assert: (out, input) => {
      // Verbose transfer headers are gone.
      expect(out).not.toContain('Resolving ')
      expect(out).not.toContain('Connecting to')
      expect(out).not.toContain('HTTP request sent')
      expect(out).not.toContain('Length:')
      expect(out).not.toContain('Saving to:')
      // Progress dot rows and the request timestamp header are gone.
      expect(out).not.toMatch(/^\s*\d+K /m)
      expect(out).not.toMatch(/^--2026-/m)
      // The actual payload and the completion line survive.
      expect(out).toContain('{"status":"ok"')
      expect(out).toContain("'data.json' saved")
      // Substantial compression.
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'wget - a payload whose lines merely LOOK like the transfer log is returned byte-for-byte',
    cmd: 'wget',
    args: ['-qO', '-', 'https://metrics.example.com/spool.csv'],
    input: WGET_PAYLOAD_LOOKALIKE,
    assert: (out, input) => {
      // wget's chatter goes to stderr and compress() only ever sees stdout, so
      // with `-qO -` every one of these lines came from the server. The
      // condenser recognises the log by POSITION (a run opened by wget's own
      // `--<timestamp>--  <url>` header line), never by the shape of a line, so
      // none of these is eligible for deletion.
      expect(out).toBe(input)
      expect(out).toContain('Length: 42 (unspecified)')
      expect(out).toContain('19M of raw telemetry follows')
      expect(out).toContain('0K .......... .......... rows below this line are data')
      expect(out).toContain('Resolving hostnames is done by the collector, not here')
      expect(out).toContain('Saving to: /var/lib/collector/spool')
      expect(out).toContain('bytes_in_total,99182334')
    },
  },
  {
    name: 'wget - two URLs in one run: each log block is stripped, each payload is kept',
    cmd: 'wget',
    args: ['-O', '-', 'https://example.com/a.txt', 'https://example.com/b.txt'],
    input: `--2026-07-20 12:34:56--  https://example.com/a.txt
Resolving example.com (example.com)... 93.184.216.34
Connecting to example.com (example.com)|93.184.216.34|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 18 [text/plain]
Saving to: 'STDOUT'

     0K                                                       100% 1.15M=0s

alpha payload line
--2026-07-20 12:34:58--  https://example.com/b.txt
Reusing existing connection to example.com:443.
HTTP request sent, awaiting response... 200 OK
Length: 17 [text/plain]
Saving to: 'STDOUT'

     0K                                                       100% 2.30M=0s

beta payload line
2026-07-20 12:34:58 (2.30 MB/s) - written to stdout [17/17]`,
    assert: (out) => {
      // Both bodies survive; the second URL's banner reopened the log run, so
      // its chatter is stripped like the first one's.
      expect(out).toContain('alpha payload line')
      expect(out).toContain('beta payload line')
      expect(out).not.toMatch(/^--2026-/m)
      expect(out).not.toContain('Resolving ')
      expect(out).not.toContain('Length:')
      // The reused-connection block opens with "Reusing existing connection"
      // rather than "Resolving", so that line has to be chatter too or the run
      // ends early and the rest of the block leaks through.
      expect(out).not.toContain('Reusing existing connection')
      expect(out).not.toContain('Saving to:')
      // The completion line is not part of a log run: it is the answer to
      // "did the transfer finish", and it survives.
      expect(out).toContain('written to stdout [17/17]')
    },
  },
  {
    name: 'wget - all-noise output (file saved to disk) falls back to the original via the || text safety net',
    cmd: 'wget',
    args: ['-O', 'big.iso', 'https://example.com/big.iso'],
    input: WGET_NOISE_ONLY,
    assert: (out, input) => {
      // Filtering everything would yield "", so the condenser returns the
      // original rather than emitting nothing.
      expect(out).toBe(input)
      expect(out).toContain('Resolving ')
      expect(out).toContain('Length:')
      expect(out).toMatch(/^\s*0K /m)
    },
  },
])

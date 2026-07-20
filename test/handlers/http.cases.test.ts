import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `http` handler (src/handlers/http.ts).
// Two condensers dispatched by command name:
//   curl → condenseCurl  - truncate any response body longer than 2000 chars.
//   wget → condenseWget  - strip progress bars + verbose transfer headers,
//                          keep the actual downloaded content.
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
const CURL_2000 = CURL_PREFIX + 'x'.repeat(2000 - CURL_PREFIX.length - 2) + '"}' // exactly 2000
const CURL_2001 = CURL_PREFIX + 'x'.repeat(2001 - CURL_PREFIX.length - 2) + '"}' // exactly 2001

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

describeCompression('http', [
  // ── curl ────────────────────────────────────────────────────────────────────
  {
    name: 'curl - truncates a long response body (>2000 chars) with a byte-count footer',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/users'],
    input: CURL_LONG,
    assert: (out, input) => {
      // Head of the body is preserved, tail past 2000 chars is dropped.
      expect(out).toContain('START_OF_BODY')
      expect(out).not.toContain('END_OF_BODY_SECRET_TAIL')
      // Truncation footer reports the original size.
      expect(out).toMatch(/\.\.\. \(\d+ bytes total, truncated\)$/)
      // Real compression: ~5 KB collapses to the ~2 KB cap.
      expect(out.length).toBeLessThan(input.length)
      expect(out.length).toBeLessThan(2100)
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
    name: 'curl - body exactly at the 2000-char boundary is kept verbatim (<= MAX)',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/blob'],
    input: CURL_2000,
    assert: (out, input) => {
      expect(input.length).toBe(2000)
      expect(out).toBe(input)
      expect(out).not.toContain('truncated')
    },
  },
  {
    name: 'curl - body just over the limit GROWS because the truncation footer adds overhead (allowGrowth)',
    cmd: 'curl',
    args: ['-s', 'https://api.example.com/v1/blob'],
    input: CURL_2001,
    allowGrowth: true,
    assert: (out, input) => {
      expect(input.length).toBe(2001)
      // Truncated to the 2000-char cap plus a ~34-char footer => net larger.
      expect(out).toContain('2001 bytes total, truncated')
      expect(out.length).toBeGreaterThan(input.length)
      expect(out.startsWith(CURL_PREFIX)).toBe(true)
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

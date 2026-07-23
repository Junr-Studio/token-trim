import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `jq` condenser (condenseJq).
//
// condenseJq's contract:
//   - ≤20 raw lines            → pass through untouched (small / scalar result)
//   - JSON array, length > 5   → "[N items  schema: {…}]" + first 5 items + "… +K more items"
//                                (schema header only when items are objects)
//   - JSON object, keys  > 20  → "{N keys}" + first 20 keys + "… +K more keys"
//   - non-JSON / other, >50 ln → first 50 lines + "… +K more lines"
//
// Fixtures below are built as real `jq` stdout: pretty-printed JSON uses the
// same 2-space indentation jq emits by default (JSON.stringify(x, null, 2)),
// and `-r` raw output is bare newline-separated lines.

// ── large array of OBJECTS → schema-tagged preview ────────────────────────────
const USER_NAMES = [
  'Alice Johnson', 'Bob Smith', 'Carol White', 'David Brown',
  'Eve Davis', 'Frank Miller', 'Grace Lee', 'Henry Wilson',
  'Iris Moore', 'Jack Taylor', 'Kate Anderson', 'Liam Thomas',
]
const USERS = USER_NAMES.map((name, i) => ({
  id: i + 1,
  name,
  email: name.toLowerCase().split(' ')[0] + '@example.com',
  role: i === 0 ? 'admin' : 'member',
  active: i % 3 !== 0,
}))
const USERS_JSON = JSON.stringify(USERS, null, 2)

// ── large array of SCALARS → count-only preview (no schema) ────────────────────
const TAGS = Array.from({ length: 30 }, (_, i) => 'tag-' + String(i + 1).padStart(2, '0'))
const TAGS_JSON = JSON.stringify(TAGS, null, 2)

// ── large OBJECT (>20 keys) → key preview ─────────────────────────────────────
const CONFIG = {
  host: '0.0.0.0',
  port: 8080,
  workers: 4,
  timeout_ms: 30000,
  max_connections: 1000,
  keepalive: true,
  tls_enabled: true,
  tls_cert: '/etc/ssl/cert.pem',
  tls_key: '/etc/ssl/key.pem',
  log_level: 'info',
  log_format: 'json',
  metrics_enabled: true,
  metrics_port: 9090,
  db_host: 'db.internal',
  db_port: 5432,
  db_name: 'app',
  db_pool_min: 2,
  db_pool_max: 10,
  cache_ttl: 300,
  cache_backend: 'redis',
  // ── everything below is key #21+ and must be dropped from the preview ──
  redis_url: 'redis://cache.internal:6379/0',
  rate_limit: 100,
  cors_origin: '*',
  debug: false,
  session_secret: 'change-me',
  upload_max_mb: 25,
  static_dir: '/var/www/static',
  health_check_path: '/healthz',
  shutdown_grace_ms: 15000,
  environment: 'production',
}
const CONFIG_JSON = JSON.stringify(CONFIG, null, 2)

// ── non-JSON raw output (jq -r) → line truncation ─────────────────────────────
const EMAILS = Array.from(
  { length: 80 },
  (_, i) => 'user' + String(i + 1).padStart(2, '0') + '@example.com',
).join('\n')

// ── small object (≤20 lines) → passthrough ────────────────────────────────────
const WIDGET_JSON = JSON.stringify(
  { id: 42, name: 'widget', price: 9.99, in_stock: true, tags: ['a', 'b'], sku: 'WID-042' },
  null,
  2,
)

// ── default MULTI-DOCUMENT stream (`jq '.[]' data.json`) ──────────────────────
// jq's normal, non-`-r` output for a filter that yields more than one value is
// a STREAM of pretty-printed documents - many lines per record, not one record
// per line. `JSON.parse` of the whole thing fails (it is a stream, not a
// document), so this used to fall through to the flat-data-list cap, which cuts
// whole LINES out of the middle: the cut landed inside an object, two documents
// vanished, and the survivor lost its opening brace, leaving stdout holding
// syntactically corrupt JSON presented as jq's answer.
const JQ_STREAM =
  Array.from({ length: 12 }, (_, i) =>
    JSON.stringify({ id: i + 1, name: `item-${i + 1}`, active: true }, null, 2),
  ).join('\n') + '\n'

// The same 12 records in `-c` compact form: one self-contained document per
// line, which IS a flat data list and stays safe to cap.
const JQ_COMPACT =
  Array.from({ length: 60 }, (_, i) =>
    JSON.stringify({ id: i + 1, name: `item-${i + 1}`, active: true }),
  ).join('\n') + '\n'

describeCompression('jq', [
  {
    name: 'empty output - nothing to compress, returns empty',
    cmd: 'jq',
    args: ['.'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
  {
    name: 'scalar result - a single value passes through untouched',
    cmd: 'jq',
    args: ['.total'],
    input: '1234\n',
    assert: (out) => {
      expect(out).toBe('1234')
      // scalar path never adds a preview/summary header
      expect(out).not.toMatch(/items|keys|more/)
    },
  },
  {
    name: 'small object - under 20 lines, passes through with every key intact',
    cmd: 'jq',
    args: ['.'],
    input: WIDGET_JSON,
    assert: (out) => {
      // untouched: no summary header, no truncation marker
      expect(out).not.toMatch(/keys\}|items\]/)
      expect(out).not.toContain('... +')
      // all keys survive
      expect(out).toContain('"name": "widget"')
      expect(out).toContain('"sku": "WID-042"')
      expect(out).toContain('"in_stock": true')
    },
  },
  {
    name: 'large array of objects - previews first 5 items behind a schema header',
    cmd: 'jq',
    args: ['.'],
    input: USERS_JSON,
    assert: (out) => {
      // "[12 items  schema: {id, name, email, role, active}]" - two spaces before schema
      expect(out).toMatch(/^\[12 items {2}schema: \{id, name, email, role, active\}\]/)
      // exactly 5 shown, 7 summarized away
      expect(out).toContain('... +7 more items')
      // first item kept …
      expect(out).toContain('Alice Johnson')
      expect(out).toContain('David Brown') // item #4, still in the first 5
      // … the 6th item onward is dropped
      expect(out).not.toContain('Frank Miller')
      expect(out).not.toContain('Liam Thomas')
      // real shrink
      expect(out.length).toBeLessThan(USERS_JSON.length)
    },
  },
  {
    name: 'large array of scalars - previews first 5 with a count but no schema',
    cmd: 'jq',
    args: ['[.items[].tag]'],
    input: TAGS_JSON,
    assert: (out) => {
      // scalar items ⇒ jsonSchema() returns '' ⇒ header has NO "schema:" segment
      expect(out).toMatch(/^\[30 items\]/)
      expect(out).not.toContain('schema')
      expect(out).toContain('... +25 more items')
      // first 5 kept, 6th onward gone
      expect(out).toContain('tag-01')
      expect(out).toContain('tag-05')
      expect(out).not.toContain('tag-06')
      expect(out).not.toContain('tag-30')
    },
  },
  {
    name: 'large object - over 20 keys, previews first 20 and counts the rest',
    cmd: 'jq',
    args: ['.'],
    input: CONFIG_JSON,
    assert: (out) => {
      expect(out).toMatch(/^\{30 keys\}/)
      expect(out).toContain('... +10 more keys')
      // first key present, key #21+ dropped
      expect(out).toContain('"host"')
      expect(out).toContain('"cache_backend"') // key #20, last one kept
      expect(out).not.toContain('redis_url') // key #21
      expect(out).not.toContain('environment') // key #30
      expect(out.length).toBeLessThan(CONFIG_JSON.length)
    },
  },
  {
    // CHANGED DELIBERATELY: `jq -r` emits raw values one per line, headed for
    // another program (`jq -r '.[].email' | mail -t`). The old in-band
    // "... +30 more lines" footer was read as one more email address. The
    // elision is disclosed on stderr now, and the tail is kept as well as the
    // head - the end of a list is as informative as its start.
    name: 'raw (-r) non-JSON output - capped to real values only, elision disclosed out of band',
    cmd: 'jq',
    args: ['-r', '.[].email'],
    input: EMAILS,
    assert: (out, input) => {
      const source = new Set(input.split('\n').map((l) => l.trim()).filter(Boolean))
      for (const line of out.split('\n')) {
        expect(source.has(line), `"${line}" is not a value jq printed`).toBe(true)
      }
      expect(out).not.toContain('more lines')
      expect(out).toContain('user01@example.com') // head kept
      expect(out).toContain('user80@example.com') // tail kept too
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    // A condenser may delete information; it may never INVENT it, and emitting
    // JSON that jq did not produce - and that no longer parses - is the worst
    // form of inventing. The flat-list cap's own contract is "one independent
    // record per line", which a pretty-printed stream violates, so this shape
    // is handed back whole rather than cut at an arbitrary line.
    name: "default multi-document stream (jq '.[]') - never cut mid-document, so the stream still parses",
    cmd: 'jq',
    args: ['.[]', 'data.json'],
    input: JQ_STREAM,
    assert: (out, input) => {
      // Every document that comes back must be a complete, parseable value.
      const docs = out.split(/\n(?=\{)/).filter((d) => d.trim())
      expect(docs.length).toBeGreaterThan(0)
      for (const d of docs) {
        expect(() => JSON.parse(d), `not parseable JSON:\n${d}`).not.toThrow()
      }
      // No brace may have been eaten: a `}` is never followed by a bare field.
      expect(out).not.toMatch(/^\}\n\s+"/m)
      // And no record vanished from the middle without a trace.
      for (let i = 1; i <= 12; i++) expect(out).toContain(`"id": ${i}`)
      expect(out).toBe(input.trim())
    },
  },
  {
    // `jq -c` (and `jq '.[] | @json'`) really is one self-contained record per
    // line, so the data-list cap applies exactly as it does to `-r` output.
    name: 'compact (-c) document stream - one record per line, so the cap still applies',
    cmd: 'jq',
    args: ['-c', '.[]', 'data.json'],
    input: JQ_COMPACT,
    assert: (out, input) => {
      const source = new Set(input.split('\n').map((l) => l.trim()).filter(Boolean))
      for (const line of out.split('\n')) {
        expect(source.has(line), `"${line}" is not a document jq printed`).toBe(true)
        expect(() => JSON.parse(line)).not.toThrow()
      }
      expect(out).toContain('"id":1,')
      expect(out).toContain('"id":60,')
      expect(out.length).toBeLessThan(input.length)
    },
  },
])

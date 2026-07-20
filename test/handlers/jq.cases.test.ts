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
    name: 'raw (-r) non-JSON output - over 50 lines, truncates with a line-count footer',
    cmd: 'jq',
    args: ['-r', '.[].email'],
    input: EMAILS,
    assert: (out, input) => {
      // not parseable as JSON ⇒ falls through to plain line truncation
      expect(out).toMatch(/\n\.\.\. \+30 more lines$/)
      expect(out).toContain('user01@example.com') // first line kept
      expect(out).toContain('user50@example.com') // 50th line kept
      expect(out).not.toContain('user51@example.com') // 51st line dropped
      expect(out).not.toContain('user80@example.com') // last line dropped
      // exactly 50 emails survive
      expect(out.match(/@example\.com/g)?.length).toBe(50)
      expect(out.length).toBeLessThan(input.length)
    },
  },
])

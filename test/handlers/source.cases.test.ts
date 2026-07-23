import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization suite for the `source` handler (cat / head / tail).
//
// Dispatch (from PROXY_FRAME): for cat|head|tail the proxy calls
//   aggressiveStrip(out, detectLang(args[0]))
// where args[0] is the FILENAME. detectLang keys off the file EXTENSION, so
// every fixture below is invoked with a real extension in args[0]. Two families:
//   - source code (ts/js/go/rust/ruby/python/shell) -> comment stripping, and
//     for brace/py languages, function BODIES collapse to "... implementation".
//   - data formats (json/yaml/toml/csv/xml) -> NEVER comment-stripped; instead
//     structurally condensed (schema/keys/sections headers + truncation) once a
//     per-format line/item threshold is crossed. Below threshold => passthrough.

// ── source code fixtures ──────────────────────────────────────────────────────

const TS_FILE = `// Application entry point.
// Handles server bootstrap and config loading.
import { readFileSync } from 'fs'
import { createServer } from 'http'

/*
 * Multi-line license banner.
 * Copyright 2026.
 */
export interface Config {
  port: number
  host: string
}

export function main(): void {
  const config = load()
  const server = createServer((req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  server.listen(config.port, config.host)
}

function load(): Config {
  const raw = readFileSync('config.json', 'utf8')
  const parsed = JSON.parse(raw)
  return { port: parsed.port ?? 3000, host: parsed.host ?? 'localhost' }
}
`

const PY_FILE = `#!/usr/bin/env python3
# This module does things.
import os
import sys


def greet(name):
    # local comment
    message = f"Hello, {name}"
    print(message)
    return message


class Worker:
    def run(self):
        for i in range(10):
            self.step(i)
        return True
`

const SHELL_FILE = `#!/bin/bash
# Deploy script for staging.
set -euo pipefail

# Build the project first.
npm run build

deploy() {
  echo "Deploying..."
  scp -r dist/ server:/var/www
}

deploy
`

// ── data-format fixtures (all sized past their condensing thresholds) ─────────

const JSON_ARRAY = `[
  {
    "id": 1,
    "name": "Alice Anderson",
    "email": "alice@example.com",
    "role": "admin",
    "active": true
  },
  {
    "id": 2,
    "name": "Bob Brown",
    "email": "bob@example.com",
    "role": "user",
    "active": true
  },
  {
    "id": 3,
    "name": "Carol Clark",
    "email": "carol@example.com",
    "role": "user",
    "active": false
  },
  {
    "id": 4,
    "name": "Dan Davis",
    "email": "dan@example.com",
    "role": "editor",
    "active": true
  },
  {
    "id": 5,
    "name": "Eve Evans",
    "email": "eve@example.com",
    "role": "user",
    "active": true
  },
  {
    "id": 6,
    "name": "Frank Ford",
    "email": "frank@example.com",
    "role": "user",
    "active": false
  },
  {
    "id": 7,
    "name": "Grace Green",
    "email": "grace@example.com",
    "role": "admin",
    "active": true
  },
  {
    "id": 8,
    "name": "Heidi Hall",
    "email": "heidi@example.com",
    "role": "user",
    "active": true
  },
  {
    "id": 9,
    "name": "Ivan Iverson",
    "email": "ivan@example.com",
    "role": "user",
    "active": false
  },
  {
    "id": 10,
    "name": "Judy Jones",
    "email": "judy@example.com",
    "role": "editor",
    "active": true
  },
  {
    "id": 11,
    "name": "Karl King",
    "email": "karl@example.com",
    "role": "user",
    "active": true
  },
  {
    "id": 12,
    "name": "Lorna Last",
    "email": "lorna@example.com",
    "role": "user",
    "active": false
  }
]
`

const JSON_OBJECT = `{
  "key01": "value01",
  "key02": "value02",
  "key03": "value03",
  "key04": "value04",
  "key05": "value05",
  "key06": "value06",
  "key07": "value07",
  "key08": "value08",
  "key09": "value09",
  "key10": "value10",
  "key11": "value11",
  "key12": "value12",
  "key13": "value13",
  "key14": "value14",
  "key15": "value15",
  "key16": "value16",
  "key17": "value17",
  "key18": "value18",
  "key19": "value19",
  "key20": "value20",
  "key21": "value21",
  "key22": "value22",
  "key23": "value23",
  "key24": "value24",
  "key25": "value25",
  "key26": "value26",
  "key27": "value27",
  "key28": "value28",
  "key29": "value29",
  "key30": "value30",
  "key31": "value31",
  "key32": "value32",
  "key33": "value33",
  "key34": "value34",
  "key35": "value35",
  "key36": "value36",
  "key37": "value37",
  "key38": "value38",
  "key39": "value39",
  "key40": "value40"
}
`

const JSON_SMALL = `{
  "name": "my-app",
  "version": "1.2.3",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  }
}
`

const YAML_FILE = `version: "3.9"

services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./html:/usr/share/nginx/html
    depends_on:
      - api
  api:
    image: node:20
    environment:
      - NODE_ENV=production
      - PORT=3000
      - LOG_LEVEL=info
      - DATABASE_URL=postgres://app:secret@db:5432/app
      - REDIS_URL=redis://cache:6379
    ports:
      - "3000:3000"
    depends_on:
      - db
      - cache
  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=app
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "app"]
      interval: 10s
      retries: 5
  cache:
    image: redis:7
    command: redis-server --appendonly yes
    volumes:
      - cache-data:/data

networks:
  default:
    driver: bridge

volumes:
  db-data:
    driver: local
  cache-data:
    driver: local

configs:
  app_config:
    file: ./config/app.yaml
`

const TOML_FILE = `[package]
name = "my-crate"
version = "0.4.2"
edition = "2021"
license = "MIT"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.35", features = ["full"] }
anyhow = "1.0"
thiserror = "1.0"
clap = { version = "4.4", features = ["derive"] }
tracing = "0.1"
tracing-subscriber = "0.3"
reqwest = { version = "0.11", features = ["json"] }
hyper = "0.14"
tower = "0.4"
futures = "0.3"
bytes = "1.5"
uuid = { version = "1.6", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
regex = "1.10"
once_cell = "1.19"
rand = "0.8"
base64 = "0.21"
sha2 = "0.10"
hex = "0.4"

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }
proptest = "1.4"
mockall = "0.12"
tempfile = "3.9"
wiremock = "0.5"
assert_cmd = "2.0"

[build-dependencies]
cc = "1.0"
prost-build = "0.12"

[features]
default = ["std", "tracing"]
std = []
extra = ["serde_json"]
full = ["extra", "tracing", "metrics"]
metrics = ["dep:prometheus"]

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true

[[bin]]
name = "mycli"
path = "src/main.rs"
`

const CSV_FILE = `timestamp,endpoint,method,status,latency_ms,bytes
2026-07-20T10:00:01Z,/api/users,GET,200,45,1204
2026-07-20T10:00:02Z,/api/users,POST,201,88,512
2026-07-20T10:00:03Z,/api/orders,GET,200,63,3320
2026-07-20T10:00:04Z,/api/orders,GET,500,120,88
2026-07-20T10:00:05Z,/api/login,POST,401,32,64
2026-07-20T10:00:06Z,/api/products,GET,200,51,2048
2026-07-20T10:00:07Z,/api/products,GET,304,12,0
2026-07-20T10:00:08Z,/api/cart,PUT,200,74,256
2026-07-20T10:00:09Z,/api/checkout,POST,200,210,1536
2026-07-20T10:00:10Z,/api/logout,POST,204,18,0
`

const XML_FILE = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>32.1.3-jre</version>
    </dependency>
  </dependencies>
  <build>
    <finalName>my-app</finalName>
  </build>
</project>
`

// A LINE comment that merely mentions the block-comment opener. `/*` inside a
// `//` comment, a glob string or a regex is not the start of a block comment,
// and treating it as one blanks every line down to the next `*/` - usually the
// rest of the file. Real trigger, found in node_modules/publint/src/shared/message.js.
const JS_GLOB_IN_LINE_COMMENT = `export function f(a) {
  return a
}

// \`@types/*\` packages have an empty main field
export const SECRET_TOKEN_COUNT = 42

export function g() {
  return SECRET_TOKEN_COUNT
}
`

// The same trigger from a plain STRING: a glob argument in a data literal. This
// one fires on this repository's own test/matrix/unix.matrix.ts.
const TS_GLOB_IN_STRING = `export const FIND_ARGS = [
  '.',
  '-name', '*.ts',
  '-not', '-path', './node_modules/*',
]

export const LAST_EXPORT = 'still here'
`

// A brace inside a STRING literal is not a block opener. One of these pushed the
// depth counter to 1 for good, so every line below it was replaced by a single
// marker plus blanks and the file's remaining top-level declarations vanished.
const GO_BRACE_IN_STRING = `package main

// Package main is the entry point for the demo binary.
import "fmt"

const OpenBrace = "{"

func Critical() string {
	// Assemble the answer the caller is waiting for.
	answer := fmt.Sprintf("%s answer %s", OpenBrace, OpenBrace)
	return answer
}

const Version = "9.9.9"
`

// Same defect reached through a REGEX literal - the shape that empties ~100 of
// highlight.js's language definitions.
const JS_BRACE_IN_REGEX = String.raw`export function parse(s) {
  return s.replace(/\{+/g, '')
}

export const OPEN = 'still here'

module.exports = parse
`

// A pretty-printed API dump. 64-bit snowflake ids are past 2^53, so a
// re-serialisation through JSON.parse rewrites them into digits that were never
// in the file - and rewrites three distinct ids into one identical value.
const JSON_SNOWFLAKE = `{
  "events": [
    {
      "id": 1234567890123456789,
      "author_id": 9876543210987654321,
      "text": "hello"
    },
    {
      "id": 1234567890123456790,
      "author_id": 9876543210987654322,
      "text": "world"
    },
    {
      "id": 1234567890123456791,
      "author_id": 9876543210987654323,
      "text": "again"
    }
  ],
  "total": 3,
  "cursor": null,
  "limit": 1e5,
  "ratio": 1.0,
  "offset": -0
}
`

const PLAIN_NOTES = `TODO list for the release:
// this looks like a comment but is plain text
# so does this line
- ship the thing
- write the changelog
`

describeCompression('source', [
  // ── source code: TypeScript (brace-body collapse + comment strip) ──
  {
    name: 'cat app.ts - strips // and /* */ comments, collapses fn bodies to "... implementation"',
    cmd: 'cat',
    args: ['src/app.ts'],
    input: TS_FILE,
    assert: (out, input) => {
      // line + block comments removed
      expect(out).not.toContain('// Application entry point.')
      expect(out).not.toContain('Multi-line license banner')
      expect(out).not.toContain('Copyright 2026')
      // signatures preserved, bodies replaced by the marker
      expect(out).toContain('export interface Config {')
      expect(out).toContain('export function main(): void {')
      expect(out).toContain('function load(): Config {')
      expect(out).toContain('// ... implementation')
      // body statements gone
      expect(out).not.toContain("res.end('ok')")
      expect(out).not.toContain('server.listen')
      expect(out).not.toContain('JSON.parse(raw)')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── source code: Python (dedented body collapse + # comment strip) ──
  {
    name: 'cat worker.py - strips # comments/shebang, collapses def/class bodies',
    cmd: 'cat',
    args: ['worker.py'],
    input: PY_FILE,
    assert: (out, input) => {
      expect(out).not.toContain('#!/usr/bin/env')
      expect(out).not.toContain('# This module does things.')
      expect(out).not.toContain('# local comment')
      // def/class headers kept, bodies replaced with the python marker
      expect(out).toContain('def greet(name):')
      expect(out).toContain('class Worker:')
      expect(out).toContain('# ... implementation')
      // body lines gone
      expect(out).not.toContain('print(message)')
      expect(out).not.toContain('range(10)')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── source code: shell (comment strip ONLY - bodies preserved) ──
  {
    name: 'cat deploy.sh - strips # comments but keeps bodies (no brace collapse for shell)',
    cmd: 'cat',
    args: ['deploy.sh'],
    input: SHELL_FILE,
    assert: (out, input) => {
      expect(out).not.toContain('#!/bin/bash')
      expect(out).not.toContain('# Deploy script for staging.')
      expect(out).not.toContain('# Build the project first.')
      // shell is NOT brace-collapsed: the body survives verbatim
      expect(out).toContain('echo "Deploying..."')
      expect(out).toContain('scp -r dist/ server:/var/www')
      expect(out).not.toContain('// ... implementation')
      expect(out).toContain('set -euo pipefail')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: JSON array (schema header + 5-item preview + tail count) ──
  {
    // CHANGED DELIBERATELY. The "[12 items  schema: {...}]" header over a
    // five-item preview reads beautifully and is not JSON, so
    // `cat users.json | jq '.[].email'` failed to parse - and the seven items
    // past the preview were gone with no way to ask for them. Compact
    // re-serialisation is lossless, still parses, and the indentation it drops
    // was the bulk of the file anyway.
    name: 'cat users.json - the array survives whole as compact, parseable JSON',
    cmd: 'cat',
    args: ['users.json'],
    input: JSON_ARRAY,
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      const items = JSON.parse(out) as Array<{ name: string }>
      expect(items).toHaveLength(12)
      // nothing is dropped any more - including the items the preview cut
      expect(items.map((i) => i.name)).toEqual(
        expect.arrayContaining(['Alice Anderson', 'Frank Ford', 'Lorna Last']),
      )
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: JSON object with > 20 keys (keys header + 20-key preview) ──
  {
    // CHANGED DELIBERATELY, same reason as the array case above.
    name: 'cat settings.json - the object survives whole as compact, parseable JSON',
    cmd: 'cat',
    args: ['settings.json'],
    input: JSON_OBJECT,
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      const cfg = JSON.parse(out) as Record<string, string>
      expect(Object.keys(cfg)).toHaveLength(40)
      // the twenty keys the preview used to cut are back
      expect(cfg['key01']).toBe('value01')
      expect(cfg['key40']).toBe('value40')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: small JSON below threshold => passthrough (clean/no-op case) ──
  {
    name: 'cat package.json - small JSON (<=20 lines) passes through unchanged',
    cmd: 'cat',
    args: ['package.json'],
    input: JSON_SMALL,
    assert: (out) => {
      // under the 20-line threshold nothing is condensed
      expect(out).not.toContain('keys}')
      expect(out).not.toContain('more keys')
      expect(out).toContain('"name": "my-app"')
      expect(out).toContain('"build": "tsc"')
      expect(out).toBe(JSON_SMALL)
    },
  },

  // ── data: YAML (top-keys header + first-30 lines + truncation) ──
  {
    name: 'head docker-compose.yaml - emits [yaml top keys] header + truncates past 30 lines',
    cmd: 'head',
    args: ['docker-compose.yaml'],
    input: YAML_FILE,
    assert: (out, input) => {
      expect(out).toContain('[yaml - top keys: version, services, networks, volumes, configs]')
      expect(out).toMatch(/\+\d+ more lines/)
      // early content kept, trailing content dropped
      expect(out).toContain('image: nginx:1.25')
      expect(out).not.toContain('./config/app.yaml')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: TOML (sections header + first-30 lines + truncation) ──
  {
    name: 'cat Cargo.toml - emits [toml sections] header + truncates past 30 lines',
    cmd: 'cat',
    args: ['Cargo.toml'],
    input: TOML_FILE,
    assert: (out, input) => {
      expect(out).toContain('[toml - sections:')
      expect(out).toContain('[dependencies]')
      expect(out).toContain('[dev-dependencies]')
      expect(out).toMatch(/\+\d+ more lines/)
      // content past line 30 dropped
      expect(out).not.toContain('mockall')
      expect(out).not.toContain('full = ["extra"')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: CSV (header + [rows, cols] summary + 5-row preview) ──
  {
    name: 'tail metrics.csv - keeps header, emits [N rows, C cols], previews 5 rows',
    cmd: 'tail',
    args: ['metrics.csv'],
    input: CSV_FILE,
    assert: (out, input) => {
      // header row preserved verbatim
      expect(out).toContain('timestamp,endpoint,method,status,latency_ms,bytes')
      expect(out).toMatch(/\[10 rows, 6 cols\]/)
      expect(out).toContain('... +5 more rows')
      // first data rows previewed, later rows dropped
      expect(out).toContain('/api/users,GET,200,45,1204')
      expect(out).not.toContain('/api/logout')
      expect(out).not.toContain('/api/checkout')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: XML (first-20 lines + truncation, no comment stripping) ──
  {
    name: 'cat pom.xml - truncates past 20 lines with a "more lines" tail',
    cmd: 'cat',
    args: ['pom.xml'],
    input: XML_FILE,
    assert: (out, input) => {
      expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(out).toContain('<artifactId>my-app</artifactId>')
      expect(out).toMatch(/\+\d+ more lines/)
      // second dependency (guava) is past line 20 -> dropped
      expect(out).not.toContain('guava')
      expect(out).not.toContain('<finalName>')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── a `/*` that is not a block comment ───────────────────────────────────
  // The block-comment tracker opened on any line CONTAINING the opener, so a
  // `//` comment that mentions `/*`, a glob string, or a regex switched it on
  // and every line down to the next `*/` - often EOF - came back blank. Nothing
  // marks the loss: the agent reads a file whose second half is empty and
  // concludes the declarations below the trigger do not exist.
  {
    name: 'cat message.js - a // comment mentioning /* does not blank the rest of the file',
    cmd: 'cat',
    args: ['message.js'],
    input: JS_GLOB_IN_LINE_COMMENT,
    assert: (out) => {
      expect(out).toContain('export const SECRET_TOKEN_COUNT = 42')
      expect(out).toContain('export function g() {')
      // the comment itself is still stripped - this is not a passthrough
      expect(out).not.toContain('packages have an empty main field')
    },
  },
  {
    name: 'cat matrix.ts - a glob inside a string is not a block comment either',
    cmd: 'cat',
    args: ['matrix.ts'],
    input: TS_GLOB_IN_STRING,
    assert: (out) => {
      expect(out).toContain("'-not', '-path', './node_modules/*',")
      expect(out).toContain("export const LAST_EXPORT = 'still here'")
    },
  },

  // ── a brace that is not code ─────────────────────────────────────────────
  // Brace depth decides which lines are a body worth folding away. Counting the
  // braces inside string and regex literals pushed the depth to 1 permanently,
  // so the file's remaining top-level declarations were replaced by one
  // "... implementation" marker and blanks, indistinguishable from a short file.
  {
    name: 'cat main.go - a brace inside a string literal does not swallow the rest of the file',
    cmd: 'cat',
    args: ['main.go'],
    input: GO_BRACE_IN_STRING,
    assert: (out) => {
      expect(out).toContain('const OpenBrace = "{"')
      expect(out).toContain('func Critical() string {')
      expect(out).toContain('const Version = "9.9.9"')
    },
  },
  {
    name: 'cat parse.js - a brace inside a regex literal does not swallow the rest either',
    cmd: 'cat',
    args: ['parse.js'],
    input: JS_BRACE_IN_REGEX,
    assert: (out) => {
      expect(out).toContain("export const OPEN = 'still here'")
      expect(out).toContain('module.exports = parse')
    },
  },
  {
    // The general guard behind both cases above. A body is only folded away once
    // its closing brace has been seen. A span still open at the end of the input
    // - a `head -20` that cut mid-function, or a brace this stripper miscounted
    // for a reason nobody anticipated - is evidence that folding would be a
    // guess, so those lines are emitted exactly as they arrived. That is the
    // difference between "I deleted a body I could identify" and "everything
    // after line N is gone".
    name: 'head -20 app.ts - a body the input cuts off mid-way is never folded away',
    cmd: 'head',
    args: ['-20', 'app.ts'],
    input: `// a comment to prove this is not a plain passthrough
export function complete(): number {
  const a = 1
  return a
}

export function truncated(): void {
  const first = compute(1)
  const second = compute(2)
`,
    assert: (out) => {
      // the closed body is folded, as always
      expect(out).toContain('export function complete(): number {')
      expect(out).toContain('// ... implementation')
      expect(out).not.toContain('const a = 1')
      // the body the input cut off is still all there
      expect(out).toContain('const first = compute(1)')
      expect(out).toContain('const second = compute(2)')
      // and the comment is still stripped
      expect(out).not.toContain('a comment to prove')
    },
  },

  // ── JSON numbers are literals, not values to re-derive ───────────────────
  // Compacting through JSON.parse/JSON.stringify is not lossless: a 19-digit
  // snowflake id is past 2^53 and comes back as different digits - three
  // distinct ids collapsed into one identical value - `1e5` becomes `100000`,
  // `1.0` becomes `1` and `-0` becomes `0`. Those digits were never in the file.
  // This is the one place the library INVENTED a value rather than deleting one.
  {
    name: 'cat events.json - large integer ids survive byte-for-byte, not round-tripped',
    cmd: 'cat',
    args: ['events.json'],
    input: JSON_SNOWFLAKE,
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      // every id is still the one in the file, and all three are still distinct
      expect(out).toContain('1234567890123456789')
      expect(out).toContain('1234567890123456790')
      expect(out).toContain('1234567890123456791')
      expect(out).toContain('9876543210987654321')
      expect(out).toContain('9876543210987654323')
      // and the literal forms are untouched
      expect(out).toContain('1e5')
      expect(out).toContain('1.0')
      expect(out).toContain('-0')
      // still a real compression - the indentation is what goes
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── no-trigger passthrough: unknown extension is never touched ──
  {
    name: 'cat notes.txt - unknown extension passes through; comment-like lines preserved',
    cmd: 'cat',
    args: ['notes.txt'],
    input: PLAIN_NOTES,
    assert: (out) => {
      // .txt -> lang "unknown" -> no stripping at all
      expect(out).toContain('// this looks like a comment but is plain text')
      expect(out).toContain('# so does this line')
      expect(out).toContain('- ship the thing')
      expect(out).toBe(PLAIN_NOTES)
    },
  },

  // ── edge: empty output short-circuits to empty ──
  {
    name: 'cat empty.ts - empty input yields empty output',
    cmd: 'cat',
    args: ['empty.ts'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── line positions are the file's own ────────────────────────────────────
  // A condenser that DELETES lines from a file shifts every line after them, and
  // two consumers read that shift as fact:
  //   - a program: `cat app.py | wc -l` returns a count that is not the file's,
  //     and `sed -n '42p'` prints the wrong line;
  //   - the agent itself: it reads the condensed output, sees a function at
  //     line 10, and edits line 10 of a file where that function is at line 25.
  // Blanking a removed line instead of dropping it keeps every surviving line at
  // its true position. Measured cost across the cat/head/tail matrix entries:
  // one point of reduction (44% -> 43%), because a blank line is a single token.
  {
    name: 'cat app.py - every surviving line keeps the line number it has in the file',
    cmd: 'cat',
    args: ['app.py'],
    input: `# module docstring line
# second comment line
import os

# a comment before the function
def compute(total):
    # inner comment
    scaled = total * 2
    return scaled

# trailing note
VERSION = "2.0.0"
`,
    assert: (out, input) => {
      const inLines = input.split('\n')
      const outLines = out.split('\n')
      // the file's shape is preserved, so a line number means the same thing
      expect(outLines).toHaveLength(inLines.length)
      // and each surviving line sits exactly where it did - the only line that
      // may differ from its input is the elision marker itself, which announces
      // that the body under it was folded away
      for (let i = 0; i < inLines.length; i++) {
        const kept = outLines[i]?.trim()
        if (!kept) continue
        if (kept.endsWith('... implementation')) continue
        expect(inLines[i]?.trim(), `line ${i + 1} moved`).toBe(kept)
      }
      // the comments are still gone - this is not a passthrough
      expect(out).not.toContain('module docstring')
      expect(out).not.toContain('inner comment')
      expect(out).toContain('def compute(total):')
      expect(out).toContain('VERSION = "2.0.0"')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── JSON read through cat/head/tail must stay JSON ───────────────────────
  // `cat data.json | jq '.[].name'` is how an agent reads a JSON file, and the
  // condenser used to answer it with "[12 items  schema: {id, name, active}]"
  // followed by a five-item preview - text that is not JSON at all, so jq exits
  // with a parse error. The same hazard was already fixed for `curl` and `aws`
  // by re-serialising compactly; it simply had not been carried over here.
  {
    name: 'cat data.json - an array stays parseable JSON instead of gaining a prose header',
    cmd: 'cat',
    args: ['data.json'],
    input: JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({ id: i, name: `item${i}`, active: i % 2 === 0 })),
      null,
      2,
    ),
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      // lossless: every item survives, not a five-item preview
      expect(JSON.parse(out)).toHaveLength(12)
      expect(JSON.parse(out)[11].name).toBe('item11')
      // and it still compresses - the indentation is what goes
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'cat config.json - a wide object stays parseable JSON, keys intact',
    cmd: 'cat',
    args: ['config.json'],
    input: JSON.stringify(
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, `value ${i}`])),
      null,
      2,
    ),
    assert: (out, input) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(Object.keys(JSON.parse(out))).toHaveLength(30)
      expect(JSON.parse(out).key29).toBe('value 29')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'cat broken.json - content that only looks like JSON is passed through, never guessed at',
    cmd: 'cat',
    args: ['broken.json'],
    input: '{\n  "a": 1,\n' + Array.from({ length: 30 }, (_, i) => `  "k${i}": ${i},`).join('\n') + '\n  MISSING QUOTES\n}\n',
    assert: (out) => {
      expect(out).toContain('MISSING QUOTES')
      expect(out).not.toContain('keys}')
    },
  },

  // ── the file argument is not always args[0] ──────────────────────────────
  // detectLang(cmdArgs[0]) resolved the language from "-50", so the single most
  // common head/tail form got no handling at all.
  {
    name: 'head -50 src/app.ts - language resolved from the file, not the flag',
    cmd: 'head',
    args: ['-50', 'src/app.ts'],
    input: `// leading comment that should be stripped for a .ts file
import { readFileSync } from 'node:fs'

// another comment
export function load(): string {
  // inner comment
  return readFileSync('config.json', 'utf8')
}
`,
    assert: (out) => {
      expect(out).not.toContain('leading comment')
      expect(out).not.toContain('another comment')
      expect(out).toContain('export function load()')
    },
  },
  {
    name: 'head -n 50 src/app.ts - the flag VALUE is not mistaken for the file',
    cmd: 'head',
    args: ['-n', '50', 'src/app.ts'],
    input: `// comment to strip
export const PORT = 3000
`,
    assert: (out) => {
      expect(out).not.toContain('comment to strip')
      expect(out).toContain('export const PORT = 3000')
    },
  },
  {
    name: 'tail -n 200 app.log - a .log file is not source, so nothing is stripped as a comment',
    cmd: 'tail',
    args: ['-n', '200', 'app.log'],
    input: `2026-07-22T10:00:00Z INFO  # not a comment, a log message
2026-07-22T10:00:01Z INFO  // neither is this
`,
    assert: (out) => {
      expect(out).toContain('# not a comment, a log message')
      expect(out).toContain('// neither is this')
    },
  },

  // ── python triple quotes are a string, not a comment ────────────────────────
  // `"""` opens AND closes, so treating it as a block-comment delimiter meant
  // the line that opened a run also closed it: both delimiters were blanked and
  // whatever sat between them was emitted at statement position. Every case
  // below came back as Python that does not parse, from `cat`, which is how an
  // agent reads a file before editing it.
  {
    name: 'cat query.py - a multi-line string assignment keeps its closing delimiter',
    cmd: 'cat',
    args: ['query.py'],
    input: `SQL = """
SELECT id, name
FROM users
"""
LIMIT = 100
`,
    assert: (out) => {
      // The closing delimiter used to be blanked, leaving the string open and
      // the file unparseable. Counting the token rather than the line, because
      // the opener shares its line with the assignment.
      expect(out.split('"""')).toHaveLength(3)
      expect(out).toContain('SQL = """')
      // The string is data, not prose: its contents are the value of SQL.
      expect(out).toContain('SELECT id, name')
      expect(out).toContain('LIMIT = 100')
    },
  },
  {
    name: 'cat settings.py - the module docstring is emptied but still opens and closes',
    cmd: 'cat',
    args: ['settings.py'],
    input: `"""
Application settings.

Every value here can be overridden by an environment variable.
"""
import os

TIMEOUT = 30
`,
    assert: (out, input) => {
      const lines = out.split('\n')
      // Both delimiter lines survive, so the string terminates ...
      expect(lines[0]).toBe('"""')
      expect(lines[4]).toBe('"""')
      // ... and the prose between them is gone rather than promoted to code.
      expect(out).not.toContain('Application settings.')
      expect(out).not.toContain('environment variable')
      // Line numbers are the file's own: `import os` is on line 6 in both.
      expect(input.split('\n')[5]).toBe('import os')
      expect(lines[5]).toBe('import os')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'cat cli.py - a docstring below a shebang is still the module docstring',
    cmd: 'cat',
    args: ['cli.py'],
    input: `#!/usr/bin/env python3
"""
Command line entry point.
"""
import sys

sys.exit(0)
`,
    assert: (out) => {
      expect(out).not.toContain('Command line entry point.')
      expect(out.split('\n').filter((l) => l.trim() === '"""')).toHaveLength(2)
      expect(out).toContain('sys.exit(0)')
    },
  },
  {
    name: 'cat truncated.py - a docstring the file never closes takes nothing with it',
    cmd: 'cat',
    args: ['truncated.py'],
    input: `"""
Module docs that head -3 cut off in the middle.
CONSTANT = 1
`,
    assert: (out, input) => {
      // Without a closer there is no way to know where the string ends, so
      // blanking forward would delete the rest of the file on a `head` cut.
      expect(out.trim()).toBe(input.trim())
    },
  },
])

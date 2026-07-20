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
    name: 'cat users.json - array condensed to [N items schema:{...}] + 5-item preview',
    cmd: 'cat',
    args: ['users.json'],
    input: JSON_ARRAY,
    assert: (out, input) => {
      expect(out).toContain('12 items')
      expect(out).toContain('schema: {id, name, email, role, active}')
      expect(out).toContain('+7 more items')
      // first 5 items previewed, remainder dropped
      expect(out).toContain('Alice Anderson')
      expect(out).toContain('Eve Evans')
      expect(out).not.toContain('Frank Ford')
      expect(out).not.toContain('Lorna Last')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── data: JSON object with > 20 keys (keys header + 20-key preview) ──
  {
    name: 'cat settings.json - wide object condensed to {N keys} + first-20 preview',
    cmd: 'cat',
    args: ['settings.json'],
    input: JSON_OBJECT,
    assert: (out, input) => {
      expect(out).toContain('{40 keys}')
      expect(out).toContain('+20 more keys')
      expect(out).toContain('"key01": "value01"')
      expect(out).toContain('"key20": "value20"')
      expect(out).not.toContain('"key21"')
      expect(out).not.toContain('"key40"')
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
      expect(out).toBe(JSON_SMALL.trim())
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
      expect(out).toBe(PLAIN_NOTES.trim())
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
])

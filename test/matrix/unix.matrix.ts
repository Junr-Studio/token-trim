import type { MatrixEntry } from '../support/matrix.js'

// Coverage matrix - group "unix".
//
// The file readers (cat/head/tail), the search pair (grep/rg), the filesystem
// pair (ls/find) and the inspection utilities (tree/ps/du/df/systemctl/
// journalctl). Every fixture below is the shape the real tool prints, and every
// floor was measured against compress() and then set a few points below the
// measurement so an unrelated tweak cannot turn the matrix red for nothing.

// ── cat ──────────────────────────────────────────────────────────────────────
// A commented TypeScript module: the modal thing an agent cats. Comment blocks
// and function bodies are exactly what it does NOT need in order to answer
// "what is the shape of this file".
const CAT_TS = `/**
 * Token-bucket rate limiter.
 *
 * Shared between the HTTP edge and the worker queue, so it has to be safe to
 * call from both. Bucket state lives in Redis; this module owns only the
 * arithmetic and the key layout.
 *
 * @see docs/adr/0014-rate-limiting.md
 */
import type { RedisClientType } from 'redis'
import { NotConfigured } from './errors.js'

// Buckets are keyed per tenant and per route family, never per request path:
// a per-path key set grows without bound and evicts itself under memory
// pressure, which silently disables the limiter instead of failing loudly.
export interface BucketSpec {
  capacity: number
  refillPerSecond: number
  /** Burst allowance on top of the steady rate. Defaults to one second. */
  burst?: number
}

export interface Verdict {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export class RateLimiter {
  private readonly client: RedisClientType
  private readonly specs: Map<string, BucketSpec>

  constructor(client: RedisClientType, specs: Map<string, BucketSpec>) {
    this.client = client
    this.specs = specs
  }

  // Returns the tokens left after the take, or a rejection with the wait.
  // Callers MUST treat allowed=false as "reject", never as "retry now".
  async take(tenant: string, route: string): Promise<Verdict> {
    const spec = this.specs.get(route)
    if (!spec) throw new NotConfigured('no bucket spec for route ' + route)

    const key = bucketKey(tenant, route)
    const now = Date.now()
    const state = await this.client.hGetAll(key)
    const level = refill(state, now, spec)

    if (level < 1) {
      return { allowed: false, remaining: 0, retryAfterMs: waitMs(level, spec) }
    }

    await this.client.hSet(key, { level: String(level - 1), at: String(now) })
    await this.client.expire(key, ttlSeconds(spec))
    return { allowed: true, remaining: level - 1, retryAfterMs: 0 }
  }

  /* Drops every bucket for a tenant. Used by the offboarding job, and by the
     integration tests between cases - which is why it tolerates a miss. */
  async reset(tenant: string): Promise<void> {
    const keys = await this.client.keys('rl:' + tenant + ':*')
    if (keys.length > 0) await this.client.del(keys)
  }
}

// Key layout is part of the wire contract with the dashboard, which scans
// "rl:<tenant>:*" to render per-tenant usage. Do not reorder the segments.
function bucketKey(tenant: string, route: string): string {
  return 'rl:' + tenant + ':' + route
}

// Monotonic-ish refill. Redis clocks and app clocks drift, so a negative
// elapsed is clamped to zero rather than draining the bucket backwards.
function refill(state: Record<string, string>, now: number, spec: BucketSpec): number {
  const level = Number(state.level ?? spec.capacity)
  const at = Number(state.at ?? now)
  const elapsed = Math.max(0, now - at) / 1000
  const ceiling = spec.capacity + (spec.burst ?? spec.refillPerSecond)
  return Math.min(ceiling, level + elapsed * spec.refillPerSecond)
}

function waitMs(level: number, spec: BucketSpec): number {
  return Math.ceil(((1 - level) / spec.refillPerSecond) * 1000)
}

function ttlSeconds(spec: BucketSpec): number {
  return Math.ceil(spec.capacity / spec.refillPerSecond) * 4
}
`

// ── head ─────────────────────────────────────────────────────────────────────
// `head -50 src/ingest/normalize.py`: args[0] is "-50", NOT the file, which is
// the form that used to resolve the language from the flag and get no handling.
const HEAD_PY = `"""Normalise raw vendor payloads into the canonical Order shape.

Every vendor sends a different envelope; the only thing they agree on is that
the interesting part is somewhere inside it. Each adapter returns a complete
canonical Order or raises NormalizeError - never a half-built one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

LOG = logging.getLogger(__name__)

# Vendors that still send prices as JSON floats. Those round-trip through
# Decimal on the way in, so that 0.1 + 0.2 never reaches the ledger.
FLOAT_PRICE_VENDORS = frozenset({"acme", "globex", "initech"})


class NormalizeError(ValueError):
    """Raised when a payload cannot be mapped to the canonical shape."""


@dataclass(frozen=True)
class Order:
    vendor: str
    external_id: str
    placed_at: datetime
    total_cents: int
    currency: str


def normalize(vendor: str, payload: dict) -> Order:
    # The envelope key differs per vendor; unwrap before dispatching.
    body = payload.get("data") or payload.get("order") or payload
    if not isinstance(body, dict):
        raise NormalizeError("payload is not an object")
    adapter = _ADAPTERS.get(vendor)
    if adapter is None:
        raise NormalizeError("no adapter for vendor " + vendor)
    return adapter(body)


def _acme(body: dict) -> Order:
    placed = datetime.fromisoformat(body["created"]).astimezone(timezone.utc)
    return Order(
        vendor="acme",
        external_id=str(body["id"]),
        placed_at=placed,
`

// ── tail ─────────────────────────────────────────────────────────────────────
// A .log has no comment grammar, so nothing is stripped: what earns `tail` its
// wrapper here is the 8000-char backstop, which is the difference between a
// bounded read and a whole access log landing in the context window.
const TAIL_ACCESS_LOG = `10.42.0.17 - - [22/Jul/2026:15:41:02 +0000] "GET /api/v1/orders?page=2&limit=50 HTTP/1.1" 200 18432 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.9 - - [22/Jul/2026:15:41:02 +0000] "POST /api/v1/checkout HTTP/1.1" 201 812 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:03 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.17 - - [22/Jul/2026:15:41:03 +0000] "GET /api/v1/orders/8814/items HTTP/1.1" 200 6122 "https://app.example.com/orders/8814" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.22 - - [22/Jul/2026:15:41:04 +0000] "GET /static/app.9f2c41ab.js HTTP/1.1" 304 0 "https://app.example.com/" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.14 - - [22/Jul/2026:15:41:04 +0000] "GET /api/v1/customers/4471 HTTP/1.1" 200 1944 "https://app.example.com/customers/4471" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
10.42.0.9 - - [22/Jul/2026:15:41:05 +0000] "POST /api/v1/payments HTTP/1.1" 502 166 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:05 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.31 - - [22/Jul/2026:15:41:06 +0000] "GET /api/v1/catalog?category=outdoor&sort=price HTTP/1.1" 200 41288 "https://app.example.com/c/outdoor" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
10.42.0.9 - - [22/Jul/2026:15:41:06 +0000] "POST /api/v1/payments HTTP/1.1" 502 166 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.44 - - [22/Jul/2026:15:41:07 +0000] "GET /api/v1/orders?page=1&limit=50 HTTP/1.1" 200 18109 "https://app.example.com/orders" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
10.42.0.3 - - [22/Jul/2026:15:41:07 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.17 - - [22/Jul/2026:15:41:08 +0000] "PATCH /api/v1/orders/8814 HTTP/1.1" 200 411 "https://app.example.com/orders/8814" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.58 - - [22/Jul/2026:15:41:08 +0000] "GET /api/v1/search?q=tent+4+person HTTP/1.1" 200 9931 "https://app.example.com/search" "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
10.42.0.9 - - [22/Jul/2026:15:41:09 +0000] "POST /api/v1/payments HTTP/1.1" 200 733 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:09 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.22 - - [22/Jul/2026:15:41:10 +0000] "GET /static/vendor.5c81de07.js HTTP/1.1" 200 288114 "https://app.example.com/" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.14 - - [22/Jul/2026:15:41:10 +0000] "GET /api/v1/customers/4471/addresses HTTP/1.1" 200 812 "https://app.example.com/customers/4471" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
10.42.0.71 - - [22/Jul/2026:15:41:11 +0000] "GET /api/v1/orders?page=3&limit=50 HTTP/1.1" 200 17740 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:11 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.31 - - [22/Jul/2026:15:41:12 +0000] "GET /api/v1/catalog/12841 HTTP/1.1" 200 3318 "https://app.example.com/c/outdoor" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
10.42.0.9 - - [22/Jul/2026:15:41:12 +0000] "GET /api/v1/orders/8901 HTTP/1.1" 404 153 "https://app.example.com/orders/8901" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:13 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.58 - - [22/Jul/2026:15:41:13 +0000] "GET /api/v1/search?q=sleeping+bag HTTP/1.1" 200 8814 "https://app.example.com/search" "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
10.42.0.44 - - [22/Jul/2026:15:41:14 +0000] "POST /api/v1/cart/items HTTP/1.1" 201 288 "https://app.example.com/c/outdoor/12841" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
10.42.0.3 - - [22/Jul/2026:15:41:15 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.17 - - [22/Jul/2026:15:41:15 +0000] "GET /api/v1/orders/8814/events HTTP/1.1" 200 2214 "https://app.example.com/orders/8814" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.90 - - [22/Jul/2026:15:41:16 +0000] "GET /api/v1/admin/reports/daily HTTP/1.1" 403 121 "-" "curl/8.6.0"
10.42.0.22 - - [22/Jul/2026:15:41:16 +0000] "GET /static/app.9f2c41ab.css HTTP/1.1" 304 0 "https://app.example.com/" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:17 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.14 - - [22/Jul/2026:15:41:17 +0000] "PUT /api/v1/customers/4471/addresses/771 HTTP/1.1" 200 419 "https://app.example.com/customers/4471" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
10.42.0.71 - - [22/Jul/2026:15:41:18 +0000] "GET /api/v1/orders/9002 HTTP/1.1" 200 1188 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.9 - - [22/Jul/2026:15:41:18 +0000] "POST /api/v1/checkout HTTP/1.1" 201 804 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:19 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.31 - - [22/Jul/2026:15:41:19 +0000] "GET /api/v1/catalog?category=camping&sort=new HTTP/1.1" 200 38821 "https://app.example.com/c/camping" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
10.42.0.58 - - [22/Jul/2026:15:41:20 +0000] "GET /api/v1/catalog/12902 HTTP/1.1" 200 3412 "https://app.example.com/c/camping" "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:21 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.44 - - [22/Jul/2026:15:41:21 +0000] "DELETE /api/v1/cart/items/331 HTTP/1.1" 204 0 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
10.42.0.17 - - [22/Jul/2026:15:41:22 +0000] "GET /api/v1/orders?page=4&limit=50 HTTP/1.1" 200 16994 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:23 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.90 - - [22/Jul/2026:15:41:23 +0000] "GET /api/v1/admin/reports/daily HTTP/1.1" 403 121 "-" "curl/8.6.0"
10.42.0.22 - - [22/Jul/2026:15:41:24 +0000] "GET /static/media/hero.4a1c98.webp HTTP/1.1" 200 141822 "https://app.example.com/" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.14 - - [22/Jul/2026:15:41:25 +0000] "GET /api/v1/customers/4471/orders HTTP/1.1" 200 7712 "https://app.example.com/customers/4471" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
10.42.0.3 - - [22/Jul/2026:15:41:25 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.71 - - [22/Jul/2026:15:41:26 +0000] "POST /api/v1/orders/9002/refund HTTP/1.1" 409 188 "https://app.example.com/orders/9002" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.9 - - [22/Jul/2026:15:41:27 +0000] "GET /api/v1/cart HTTP/1.1" 200 1421 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:27 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.58 - - [22/Jul/2026:15:41:28 +0000] "GET /api/v1/search?q=headlamp HTTP/1.1" 200 6641 "https://app.example.com/search" "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
10.42.0.31 - - [22/Jul/2026:15:41:29 +0000] "GET /api/v1/catalog/12988 HTTP/1.1" 200 3290 "https://app.example.com/c/camping" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
10.42.0.3 - - [22/Jul/2026:15:41:29 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.44 - - [22/Jul/2026:15:41:30 +0000] "POST /api/v1/checkout HTTP/1.1" 201 799 "https://app.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
10.42.0.17 - - [22/Jul/2026:15:41:31 +0000] "GET /api/v1/orders/9014 HTTP/1.1" 200 1204 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:31 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.90 - - [22/Jul/2026:15:41:32 +0000] "GET /api/v1/admin/reports/daily HTTP/1.1" 200 22841 "-" "curl/8.6.0"
10.42.0.22 - - [22/Jul/2026:15:41:33 +0000] "GET /static/app.9f2c41ab.js HTTP/1.1" 304 0 "https://app.example.com/orders" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
10.42.0.3 - - [22/Jul/2026:15:41:33 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.29"
10.42.0.14 - - [22/Jul/2026:15:41:34 +0000] "GET /api/v1/customers/4471 HTTP/1.1" 200 1944 "https://app.example.com/customers/4471" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
10.42.0.71 - - [22/Jul/2026:15:41:35 +0000] "GET /api/v1/orders?page=5&limit=50 HTTP/1.1" 200 15882 "https://app.example.com/orders" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
`

// ── grep ─────────────────────────────────────────────────────────────────────
// `grep -rn` repeats the whole path on every hit; grouping pays exactly because
// the same file appears several times.
const GREP_RN = `src/api/handlers/orders.ts:14:import { getUserById } from '../../domain/user.js'
src/api/handlers/orders.ts:88:  const owner = await getUserById(order.userId)
src/api/handlers/orders.ts:141:  const buyer = await getUserById(req.auth.subject)
src/api/handlers/orders.ts:203:    // getUserById returns null for soft-deleted accounts
src/api/handlers/orders.ts:204:    const user = await getUserById(id)
src/api/handlers/users.ts:9:import { getUserById, listUsers } from '../../domain/user.js'
src/api/handlers/users.ts:31:  const user = await getUserById(req.params.id)
src/api/handlers/users.ts:47:  const user = await getUserById(req.auth.subject)
src/api/handlers/users.ts:96:  const target = await getUserById(body.targetUserId)
src/domain/user.ts:22:export async function getUserById(id: string): Promise<User | null> {
src/domain/user.ts:41:  // getUserById is the only reader that bypasses the tenant scope
src/domain/user.ts:58:export async function getUserByIdOrThrow(id: string): Promise<User> {
src/domain/user.ts:59:  const user = await getUserById(id)
src/infra/cache/user-cache.ts:18:import { getUserById } from '../../domain/user.js'
src/infra/cache/user-cache.ts:44:  const fresh = await getUserById(id)
src/infra/cache/user-cache.ts:71:  // warm the cache the same way getUserById would
src/infra/cache/user-cache.ts:73:  const user = await getUserById(id)
src/jobs/reconcile-orders.ts:12:import { getUserById } from '../domain/user.js'
src/jobs/reconcile-orders.ts:64:    const owner = await getUserById(row.user_id)
src/jobs/reconcile-orders.ts:102:      const u = await getUserById(orphan.user_id)
src/jobs/reconcile-orders.ts:118:  const admin = await getUserById(ADMIN_USER_ID)
test/api/orders.test.ts:7:import { getUserById } from '../../src/domain/user.js'
test/api/orders.test.ts:22:  vi.mock('../../src/domain/user.js', () => ({ getUserById: vi.fn() }))
test/api/orders.test.ts:58:  expect(getUserById).toHaveBeenCalledWith('u_8814')
test/api/orders.test.ts:91:  expect(getUserById).toHaveBeenCalledTimes(2)
test/api/orders.test.ts:140:  expect(getUserById).not.toHaveBeenCalled()
test/domain/user.test.ts:11:import { getUserById, getUserByIdOrThrow } from '../../src/domain/user.js'
test/domain/user.test.ts:29:  const user = await getUserById('u_4471')
test/domain/user.test.ts:44:  const missing = await getUserById('u_does_not_exist')
test/domain/user.test.ts:61:  await expect(getUserByIdOrThrow('u_nope')).rejects.toThrow(NotFound)
test/domain/user.test.ts:78:  const user = await getUserById('u_soft_deleted')
`

// ── rg ───────────────────────────────────────────────────────────────────────
// `rg -l` is the canonical `| xargs` producer. Under the 60-path cap every byte
// has to survive, which is the whole point of the entry.
const RG_L = `src/api/handlers/orders.ts
src/api/handlers/users.ts
src/api/middleware/auth.ts
src/domain/order.ts
src/domain/payment.ts
src/domain/user.ts
src/infra/cache/user-cache.ts
src/infra/db/client.ts
src/infra/queue/consumer.ts
src/jobs/reconcile-orders.ts
src/lib/logger.ts
src/lib/result.ts
test/api/orders.test.ts
test/domain/user.test.ts
test/infra/queue.test.ts
scripts/backfill-orders.ts
scripts/seed-dev-data.ts
docs/adr/0014-rate-limiting.md
`

// ── ls ───────────────────────────────────────────────────────────────────────
const LS_LA = `total 412
drwxr-xr-x  14 alice alice   4096 Jul 22 16:04 .
drwxr-xr-x   6 alice alice   4096 Jul 19 09:22 ..
-rw-r--r--   1 alice alice    221 Jul 11 14:02 .editorconfig
-rw-r--r--   1 alice alice    418 Jul 20 11:37 .eslintrc.json
drwxr-xr-x   8 alice alice   4096 Jul 22 16:04 .git
-rw-r--r--   1 alice alice    186 Jul 11 14:02 .gitignore
drwxr-xr-x   3 alice alice   4096 Jul 18 08:15 .github
-rw-r--r--   1 alice alice    112 Jul 11 14:02 .npmrc
-rw-r--r--   1 alice alice   1094 Jul 21 17:48 CHANGELOG.md
-rw-r--r--   1 alice alice  11357 Jul 11 14:02 LICENSE
-rw-r--r--   1 alice alice   6482 Jul 22 15:11 README.md
drwxr-xr-x   4 alice alice   4096 Jul 22 12:03 dist
drwxr-xr-x   3 alice alice   4096 Jul 20 13:31 docs
drwxr-xr-x 812 alice alice  32768 Jul 22 09:41 node_modules
-rw-r--r--   1 alice alice 284116 Jul 22 09:41 package-lock.json
-rw-r--r--   1 alice alice   2841 Jul 22 15:58 package.json
drwxr-xr-x   2 alice alice   4096 Jul 21 10:12 scripts
drwxr-xr-x   6 alice alice   4096 Jul 22 16:02 src
drwxr-xr-x   5 alice alice   4096 Jul 22 15:44 test
-rw-r--r--   1 alice alice    612 Jul 14 10:09 tsconfig.json
-rw-r--r--   1 alice alice    398 Jul 14 10:09 tsconfig.test.json
-rw-r--r--   1 alice alice    944 Jul 20 16:20 vitest.config.ts
`

// ── find ─────────────────────────────────────────────────────────────────────
// The long path list an agent actually gets back from a monorepo. Over the cap,
// so this measures the elision - and the elision has to be invisible in stdout,
// because `find ... | xargs prettier --write` is why the command was run.
const FIND_TS = `./apps/web/src/app/layout.ts
./apps/web/src/app/page.ts
./apps/web/src/app/orders/page.ts
./apps/web/src/app/orders/detail.ts
./apps/web/src/app/customers/page.ts
./apps/web/src/app/customers/detail.ts
./apps/web/src/app/checkout/page.ts
./apps/web/src/components/OrderTable.ts
./apps/web/src/components/OrderRow.ts
./apps/web/src/components/CustomerCard.ts
./apps/web/src/components/CartSummary.ts
./apps/web/src/components/PriceTag.ts
./apps/web/src/components/Spinner.ts
./apps/web/src/hooks/useOrders.ts
./apps/web/src/hooks/useCustomer.ts
./apps/web/src/hooks/useCart.ts
./apps/web/src/lib/api-client.ts
./apps/web/src/lib/format.ts
./apps/web/src/lib/query-keys.ts
./apps/web/src/types/order.ts
./apps/web/src/types/customer.ts
./apps/web/src/types/catalog.ts
./apps/admin/src/app/layout.ts
./apps/admin/src/app/page.ts
./apps/admin/src/app/reports/daily.ts
./apps/admin/src/app/reports/monthly.ts
./apps/admin/src/components/ReportTable.ts
./apps/admin/src/components/DateRangePicker.ts
./apps/admin/src/lib/api-client.ts
./apps/admin/src/lib/export-csv.ts
./packages/config/src/index.ts
./packages/config/src/env.ts
./packages/config/src/schema.ts
./packages/logger/src/index.ts
./packages/logger/src/redact.ts
./packages/logger/src/transports.ts
./packages/money/src/index.ts
./packages/money/src/currency.ts
./packages/money/src/rounding.ts
./packages/money/src/format.ts
./packages/result/src/index.ts
./packages/result/src/try-catch.ts
./packages/sdk/src/index.ts
./packages/sdk/src/orders.ts
./packages/sdk/src/customers.ts
./packages/sdk/src/catalog.ts
./packages/sdk/src/payments.ts
./packages/sdk/src/http.ts
./packages/ui/src/index.ts
./packages/ui/src/Button.ts
./packages/ui/src/Dialog.ts
./packages/ui/src/Field.ts
./packages/ui/src/Table.ts
./packages/ui/src/Toast.ts
./packages/ui/src/tokens.ts
./services/checkout/src/index.ts
./services/checkout/src/server.ts
./services/checkout/src/routes/checkout.ts
./services/checkout/src/routes/health.ts
./services/checkout/src/domain/cart.ts
./services/checkout/src/domain/order.ts
./services/checkout/src/domain/pricing.ts
./services/checkout/src/infra/db.ts
./services/checkout/src/infra/queue.ts
./services/checkout/src/infra/redis.ts
./services/payments/src/index.ts
./services/payments/src/server.ts
./services/payments/src/routes/payments.ts
./services/payments/src/routes/webhooks.ts
./services/payments/src/domain/charge.ts
./services/payments/src/domain/refund.ts
./services/payments/src/providers/stripe.ts
./services/payments/src/providers/adyen.ts
./services/payments/src/infra/db.ts
./services/catalog/src/index.ts
./services/catalog/src/server.ts
./services/catalog/src/routes/catalog.ts
./services/catalog/src/routes/search.ts
./services/catalog/src/domain/product.ts
./services/catalog/src/domain/facet.ts
./services/catalog/src/infra/opensearch.ts
./services/catalog/src/infra/db.ts
./services/identity/src/index.ts
./services/identity/src/server.ts
./services/identity/src/routes/session.ts
./services/identity/src/routes/tokens.ts
./services/identity/src/domain/user.ts
./services/identity/src/domain/tenant.ts
./services/identity/src/infra/db.ts
./tools/codegen/src/index.ts
./tools/codegen/src/openapi.ts
./tools/codegen/src/emit.ts
./tools/migrate/src/index.ts
./tools/migrate/src/runner.ts
./tools/migrate/src/plan.ts
./tools/release/src/index.ts
./tools/release/src/changelog.ts
./tools/release/src/version.ts
`

// ── tree ─────────────────────────────────────────────────────────────────────
const TREE_SRC = `src
├── api
│   ├── handlers
│   │   ├── health.ts
│   │   ├── orders.ts
│   │   └── users.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   └── rate-limit.ts
│   └── server.ts
├── domain
│   ├── order.ts
│   ├── payment.ts
│   └── user.ts
├── infra
│   ├── db
│   │   ├── migrations
│   │   │   ├── 0001_init.sql
│   │   │   └── 0002_add_orders.sql
│   │   ├── client.ts
│   │   └── schema.ts
│   └── queue
│       ├── consumer.ts
│       └── producer.ts
├── lib
│   ├── logger.ts
│   └── result.ts
└── index.ts

9 directories, 18 files
`

// ── ps ───────────────────────────────────────────────────────────────────────
const PS_AUX = `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1 168944 11876 ?        Ss   09:01   0:03 /sbin/init
root       220  0.0  0.0  22884  4412 ?        Ss   09:01   0:00 /lib/systemd/systemd-journald
root       311  0.0  0.0  25352  6120 ?        Ss   09:01   0:00 /lib/systemd/systemd-udevd
systemd+   488  0.0  0.0  16104  6832 ?        Ss   09:01   0:01 /lib/systemd/systemd-resolved
message+   601  0.0  0.0   9256  4884 ?        Ss   09:01   0:02 /usr/bin/dbus-daemon --system --address=systemd:
root       688  0.0  0.1 1338448 22104 ?       Ssl  09:01   0:12 /usr/bin/containerd
root       702  0.0  0.2 2114832 41288 ?       Ssl  09:01   1:41 /usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
root      1195  0.0  0.0  55236  1904 ?        Ss   09:01   0:00 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
www-data  1196  0.4  0.0  55908  6112 ?        S    09:01   1:44 nginx: worker process
www-data  1197  0.4  0.0  55908  6048 ?        S    09:01   1:41 nginx: worker process
www-data  1198  0.3  0.0  55908  6100 ?        S    09:01   1:22 nginx: worker process
www-data  1199  0.4  0.0  55908  6084 ?        S    09:01   1:39 nginx: worker process
postgres  1841  2.1  4.4 3298432 361024 ?      Ss   09:02  18:02 /usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main
postgres  1902  0.1  0.6 3300112 51228 ?       Ss   09:02   0:44 postgres: 16/main: checkpointer
postgres  1903  0.0  0.1 3298560 12904 ?       Ss   09:02   0:11 postgres: 16/main: background writer
postgres  2044  1.4  1.9 3312880 158112 ?      Ss   10:14   9:18 postgres: 16/main: app orders 10.42.0.9(51882) SELECT
redis     2188  0.9  0.3 128844 28816 ?        Ssl  09:02   7:41 /usr/bin/redis-server 127.0.0.1:6379
deploy    3187 18.7  6.2 12884416 508992 ?     Ssl  10:02  71:04 node /srv/checkout-api/dist/server.js --port 8080
deploy    3204  6.3  3.1 11298304 254112 ?     Ssl  10:02  24:11 node /srv/checkout-api/dist/worker.js --queue payments
deploy    3211  0.8  2.8 11288832 231104 ?     Ssl  10:02   3:02 node /srv/checkout-api/dist/scheduler.js
deploy    4412 42.5  9.8 14882304 802144 ?     Rl   14:51  38:22 python3 /srv/ml/rerank/train.py --epochs 200 --batch 512
deploy    4488  0.2  1.1 1298432 91104 ?       Sl   14:51   0:14 python3 /srv/ml/rerank/serve.py --model rerank-v4
prom      5120  3.6  1.7 2884416 141288 ?      Ssl  09:03  28:41 /usr/bin/prometheus --config.file=/etc/prometheus/prometheus.yml
prom      5188  0.5  0.4 1188432 38112 ?       Ssl  09:03   4:12 /usr/bin/node_exporter
alice     8841  0.0  0.0  12884  5104 pts/0    Ss   15:38   0:00 -bash
alice     8902  0.0  0.0  10884  3312 pts/0    R+   15:41   0:00 ps aux
`

// ── du ───────────────────────────────────────────────────────────────────────
// "what is eating this checkout" - the invocation that produces enough rows for
// the 40-row cap to bite. The size field is left byte-identical throughout,
// because `du ... | sort -n` and `| awk '{print $1}'` both read it.
//
// REWRITTEN: this fixture used to carry 18 rows THREE levels below `.`
// (`./apps/web/src`, `./.git/objects/pack`, `./packages/config/src`, ...), which
// `--max-depth=2` cannot emit - and since condenseDiskUsage relays every row
// verbatim and only sorts, those impossible rows were the only reason the row
// count cleared the 40-row cap. The whole advertised reduction came from them.
// What follows is a real depth-2 traversal: every directory one and two levels
// below `.`, children before parents, `.` last, parents never smaller than the
// children listed under them. It is a wider monorepo than before because that
// is what it takes for a genuine `--max-depth=2` listing to reach 40 rows.
// `node_modules` contributes only `.pnpm` and `.bin`: pnpm's other entries are
// symlinks and du does not follow them.
const DU_H = `16K\t./.github/workflows
4.0K\t./.github/ISSUE_TEMPLATE
28K\t./.github
8.0K\t./.vscode
1.4M\t./.git/objects
64K\t./.git/refs
128K\t./.git/logs
44K\t./.git/hooks
12K\t./.git/info
1.7M\t./.git
12K\t./docs/adr
48K\t./docs/api
24K\t./docs/guides
92K\t./docs
4.0K\t./scripts/dev
12K\t./scripts/ci
36K\t./scripts
2.0M\t./apps/web
1.6M\t./apps/admin
912K\t./apps/ops
4.5M\t./apps
44K\t./packages/config
52K\t./packages/logger
61K\t./packages/money
28K\t./packages/result
141K\t./packages/sdk
132K\t./packages/ui
96K\t./packages/http-client
72K\t./packages/testing
88K\t./packages/telemetry
36K\t./packages/eslint-config
772K\t./packages
312K\t./services/checkout
288K\t./services/payments
344K\t./services/catalog
228K\t./services/identity
196K\t./services/notifications
1.4M\t./services
96K\t./tools/codegen
68K\t./tools/migrate
52K\t./tools/release
220K\t./tools
412M\t./node_modules/.pnpm
216K\t./node_modules/.bin
418M\t./node_modules
88K\t./test/api
64K\t./test/domain
44K\t./test/infra
32K\t./test/e2e
232K\t./test
427M\t.
`

// ── df ───────────────────────────────────────────────────────────────────────
const DF_H = `Filesystem                Size  Used Avail Use% Mounted on
udev                       31G     0   31G   0% /dev
tmpfs                     6.3G  2.4M  6.3G   1% /run
/dev/nvme0n1p2            916G  412G  458G  48% /
tmpfs                      32G   84M   32G   1% /dev/shm
tmpfs                     5.0M     0  5.0M   0% /run/lock
/dev/nvme0n1p1            511M  6.1M  505M   2% /boot/efi
/dev/mapper/data-volumes  1.8T  1.1T  641G  64% /var/lib/docker/volumes
/dev/mapper/data-pgdata   932G  388G  497G  44% /var/lib/postgresql
overlay                   916G  412G  458G  48% /var/lib/docker/overlay2/8f41c2/merged
overlay                   916G  412G  458G  48% /var/lib/docker/overlay2/a91d04/merged
tmpfs                     6.3G  2.3M  6.3G   1% /run/user/1000
`

// ── systemctl ────────────────────────────────────────────────────────────────
const SYSTEMCTL_STATUS = `● checkout-api.service - Checkout API (node)
     Loaded: loaded (/etc/systemd/system/checkout-api.service; enabled; vendor preset: enabled)
     Active: active (running) since Wed 2026-07-22 10:02:41 UTC; 5h 38min ago
       Docs: https://internal.example.com/runbooks/checkout-api
    Process: 3180 ExecStartPre=/usr/bin/node /srv/checkout-api/dist/preflight.js (code=exited, status=0/SUCCESS)
   Main PID: 3187 (node)
      Tasks: 41 (limit: 38254)
     Memory: 497.1M
        CPU: 1h 11min 4.812s
     CGroup: /system.slice/checkout-api.service
             ├─3187 /usr/bin/node /srv/checkout-api/dist/server.js --port 8080
             ├─3204 /usr/bin/node /srv/checkout-api/dist/worker.js --queue payments
             ├─3211 /usr/bin/node /srv/checkout-api/dist/scheduler.js
             ├─3218 /usr/bin/node /srv/checkout-api/dist/worker.js --queue emails
             └─3224 /usr/bin/node /srv/checkout-api/dist/worker.js --queue webhooks

Jul 22 15:41:02 web-01 checkout-api[3187]: reloading pricing rules from /etc/checkout/pricing.yaml
Jul 22 15:41:02 web-01 checkout-api[3187]: pricing rules loaded: 184 rules, 12 overrides
Jul 22 15:41:19 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:24 web-01 checkout-api[3187]: upstream payments-svc recovered
Jul 22 15:41:31 web-01 checkout-api[3187]: listening on 0.0.0.0:8080
`

// ── journalctl ───────────────────────────────────────────────────────────────
// `-u` pins one unit, so "web-01 checkout-api[3187]: " is on every single line -
// the repetition the header hoist exists for.
const JOURNALCTL_U = `Jul 22 15:40:58 web-01 checkout-api[3187]: GET /api/v1/orders 200 in 18ms
Jul 22 15:40:59 web-01 checkout-api[3187]: GET /api/v1/orders/8814 200 in 9ms
Jul 22 15:41:00 web-01 checkout-api[3187]: POST /api/v1/checkout 201 in 214ms
Jul 22 15:41:01 web-01 checkout-api[3187]: cart 7f21 converted to order 8901
Jul 22 15:41:02 web-01 checkout-api[3187]: reloading pricing rules from /etc/checkout/pricing.yaml
Jul 22 15:41:02 web-01 checkout-api[3187]: pricing rules loaded: 184 rules, 12 overrides
Jul 22 15:41:03 web-01 checkout-api[3187]: GET /api/v1/catalog 200 in 41ms
Jul 22 15:41:05 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:10 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:15 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:20 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:25 web-01 checkout-api[3187]: upstream payments-svc timeout after 5000ms
Jul 22 15:41:26 web-01 checkout-api[3187]: circuit breaker open for payments-svc
Jul 22 15:41:26 web-01 checkout-api[3187]: POST /api/v1/payments 503 in 5001ms
Jul 22 15:41:27 web-01 checkout-api[3187]: POST /api/v1/payments 503 in 5001ms
Jul 22 15:41:29 web-01 checkout-api[3187]: retrying webhook delivery 4412 attempt 2
Jul 22 15:41:29 web-01 checkout-api[3187]: retrying webhook delivery 4412 attempt 2
Jul 22 15:41:30 web-01 checkout-api[3187]: retrying webhook delivery 4412 attempt 2
Jul 22 15:41:31 web-01 checkout-api[3187]: circuit breaker half-open for payments-svc
Jul 22 15:41:33 web-01 checkout-api[3187]: upstream payments-svc recovered
Jul 22 15:41:33 web-01 checkout-api[3187]: POST /api/v1/payments 200 in 188ms
Jul 22 15:41:34 web-01 checkout-api[3187]: GET /api/v1/orders 200 in 21ms
Jul 22 15:41:35 web-01 checkout-api[3187]: GET /api/v1/customers/4471 200 in 12ms
Jul 22 15:41:36 web-01 checkout-api[3187]: scheduler tick: 3 jobs due, 0 overdue
Jul 22 15:41:38 web-01 checkout-api[3187]: POST /api/v1/checkout 201 in 197ms
Jul 22 15:41:39 web-01 checkout-api[3187]: cart 8c04 converted to order 8902
`

export const UNIX_MATRIX: MatrixEntry[] = [
  {
    cmd: 'cat',
    args: ['src/server/rate-limit.ts'],
    what: 'a commented TypeScript module - doc block, inline rationale, function bodies',
    input: CAT_TS,
    minReduction: 70,
  },
  {
    cmd: 'head',
    args: ['-50', 'src/ingest/normalize.py'],
    what: 'the head of a Python module; the file is args[1], not args[0]',
    input: HEAD_PY,
    minReduction: 45,
  },
  {
    cmd: 'tail',
    args: ['-n', '60', '/var/log/nginx/access.log'],
    what: 'the tail of an access log - no comment grammar, so this measures the backstop cap',
    input: TAIL_ACCESS_LOG,
    minReduction: 24,
  },
  {
    cmd: 'grep',
    args: ['-rn', 'getUserById', 'src', 'test'],
    what: 'a recursive search with many hits per file, so the repeated path prefix dominates',
    input: GREP_RN,
    minReduction: 14,
  },
  {
    cmd: 'rg',
    args: ['-l', 'getUserById'],
    what: 'a bare path list - the canonical `| xargs` producer',
    input: RG_L,
    minReduction: 0,
    passthroughReason:
      'a pipe hazard: `rg -l pat | xargs sed -i` is the canonical use, so every ' +
      'surviving line has to stay a path the shell can consume. Under the 60-path ' +
      'cap that means byte-for-byte relay; past it the overflow is elided and the ' +
      'elision is disclosed on stderr, never inline. The wrapper is here to make ' +
      'sure nothing - not a header, not a marker - is ever added to this stream.',
  },
  {
    cmd: 'ls',
    args: ['-la'],
    // The saving is the mode/link-count/owner/group/date columns, which are the
    // same width on every row and answer nothing. It is NOT the noise-dir
    // filter that used to sit here: `.git`, `dist` and `node_modules` were
    // dropped from the listing AND from the `N dirs` tally, so this fixture -
    // eight directories - was reported as five, with no `dist/` in the body.
    // Every row ls printed is now relayed and counted, which costs 2 points.
    what: 'a project root in long format; all 20 entries relayed (12 files, 8 dirs), columns stripped (measured 73%)',
    input: LS_LA,
    minReduction: 65,
  },
  {
    cmd: 'find',
    args: ['.', '-name', '*.ts', '-not', '-path', './node_modules/*'],
    what: 'a long path list from a monorepo, past the cap',
    input: FIND_TS,
    minReduction: 30,
  },
  {
    cmd: 'tree',
    args: ['-L', '4', 'src'],
    what: 'a source tree four levels deep',
    input: TREE_SRC,
    minReduction: 24,
  },
  {
    cmd: 'ps',
    args: ['aux'],
    what: 'the process table of an application host',
    input: PS_AUX,
    minReduction: 34,
  },
  {
    cmd: 'du',
    args: ['-h', '--max-depth=2', '.'],
    // A SMALL TRUE NUMBER. du output is "<size>\t<path>" and both fields are
    // relayed byte-identically (`du | sort -n`, `| awk '{print $1}'`), so the
    // condenser's only saving is the 40-row cap: 51 rows in, the 11 smallest
    // directories elided with a marker that says how many. The previous 26%
    // was measured on a listing containing 18 rows three levels below `.`,
    // which `--max-depth=2` cannot print; on a listing this argv can really
    // produce, 19% is what the cap is worth. test/handlers/unix.cases.test.ts
    // pins the fixture's depth so the number cannot drift back up that way.
    what: 'per-directory sizes across a monorepo, 51 rows past the 40-row cap (measured 19%)',
    input: DU_H,
    minReduction: 12,
  },
  {
    cmd: 'df',
    args: ['-h'],
    // This entry has been through both mistakes and landed on the truth.
    //
    // It began as a passthrough hiding a BUG: condenseDiskUsage read every row
    // with du's size-first pattern, so a df row starting with the device failed
    // to match and the function returned its input. Then the parser was fixed
    // and the device column dropped, for a measured 42% - which broke
    // `df -h /var | awk 'NR==2 {print $5}'`, the canonical way a script asks how
    // full a disk is: dropping a column shifts every field index, and sorting by
    // size moves the row NR==2 names. The du branch in the same file has always
    // carried that protection for `awk '{print $1}'`; df was not getting it.
    //
    // So this is a passthrough again - but now for a true reason, and with a
    // working parser behind it. The only saving that costs nothing is the row
    // cap, which a normal host is nowhere near.
    what: 'mounted filesystems on an application host - relayed as printed',
    input: DF_H,
    minReduction: 0,
    passthroughReason:
      'df output is a positional table read with awk by field index and row ' +
      'number; dropping the source column or sorting by size breaks that ' +
      'consumer, and a host has a handful of mounts, so there is nothing worth ' +
      'winning. Only the 40-row cap applies, disclosed out of band.',
  },
  {
    cmd: 'systemctl',
    args: ['status', 'checkout-api'],
    what: 'unit status with a five-process cgroup tree and the tail of the journal',
    input: SYSTEMCTL_STATUS,
    minReduction: 45,
  },
  {
    cmd: 'journalctl',
    args: ['-u', 'checkout-api', '-n', '50', '--no-pager'],
    what: 'one unit, so every line repeats the same host/unit/pid prefix',
    input: JOURNALCTL_U,
    minReduction: 38,
  },
]

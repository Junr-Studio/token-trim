import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ─── Wire contract ──────────────────────────────────────────────────────────
//
// The generated proxy reports byte savings to a socket as newline-delimited
// JSON, one frame per compressed command:
//
//   { "cmd": "git log", "savedBytes": <number>, "originalBytes": <number> }
//
// `parseSavingsFrame` is the canonical reader so a host and the proxy stay in
// lockstep; `createStatsReceiver` is an optional, transport-only server that
// surfaces frames to a callback (persistence/aggregation is the host's job).

export interface SavingsFrame {
  /** Command (and subcommand) that produced output, e.g. "git log". */
  cmd: string
  /** Bytes removed by compression (always > 0 for a valid frame). */
  savedBytes: number
  /** Original stdout size in bytes. */
  originalBytes: number
}

/**
 * Parse one newline-delimited JSON savings frame emitted by the proxy.
 * Returns `null` for blank/malformed lines or non-positive savings - matching
 * the proxy's own guard, which only reports when `savedBytes > 0`.
 */
export function parseSavingsFrame(line: string): SavingsFrame | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const msg = JSON.parse(trimmed) as {
      cmd?: unknown
      savedBytes?: unknown
      originalBytes?: unknown
    }
    if (typeof msg.savedBytes !== 'number' || msg.savedBytes <= 0) return null
    return {
      cmd: typeof msg.cmd === 'string' ? msg.cmd : 'unknown',
      savedBytes: msg.savedBytes,
      originalBytes: typeof msg.originalBytes === 'number' ? msg.originalBytes : msg.savedBytes,
    }
  } catch {
    return null
  }
}

export interface StatsReceiver {
  /** Socket path (or Windows named pipe) the proxy should report to. */
  socketPath: string
  /** Stop listening and remove the socket file (Unix). */
  close(): void
}

export interface StatsReceiverOptions {
  /** Explicit socket path / named pipe. Defaults to a per-process temp path. */
  socketPath?: string
  /** Called for each valid savings frame received. */
  onFrame: (frame: SavingsFrame) => void
}

/** Default per-process socket path (Unix domain socket / Windows named pipe). */
export function defaultStatsSocketPath(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\token-trim-stats-${process.pid}`
    : path.join(os.tmpdir(), `token-trim-stats-${process.pid}.sock`)
}

/**
 * Start a socket server that receives NDJSON savings frames from proxy wrappers
 * and delivers each valid frame to `onFrame`. Transport only - no persistence.
 */
export async function createStatsReceiver(options: StatsReceiverOptions): Promise<StatsReceiver> {
  const socketPath = options.socketPath ?? defaultStatsSocketPath()

  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath) } catch { /* not present */ }
  }

  const server = net.createServer((socket) => {
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const frame = parseSavingsFrame(line)
        if (frame) options.onFrame(frame)
      }
    })
    socket.on('error', () => { /* client disconnect - ignore */ })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, resolve)
    server.once('error', reject)
  })

  return {
    socketPath,
    close() {
      server.close()
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(socketPath) } catch { /* already gone */ }
      }
    },
  }
}

// ─── Savings accounting ───────────────────────────────────────────────────────
//
// Byte savings are computed inside the generated proxy (it knows the raw vs
// compressed sizes) and reported as SavingsFrames. These helpers let a host
// turn those raw byte counts into human-facing token figures and running
// totals without needing a database.

/** Approximate LLM tokens for a byte count (~4 bytes/token, the common heuristic). */
export function bytesToTokens(bytes: number): number {
  return Math.round(bytes / 4)
}

/** Format a token count compactly: 940 → "940", 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens)) return '0'
  const n = Math.max(0, Math.round(tokens))
  const trim = (x: number) => String(Math.round(x * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${trim(n / 1_000)}k`
  if (n < 1_000_000_000) return `${trim(n / 1_000_000)}M`
  return `${trim(n / 1_000_000_000)}B`
}

export interface SavingsTotals {
  /** Number of frames accounted. */
  count: number
  /** Total bytes saved. */
  savedBytes: number
  /** Total original bytes before compression. */
  originalBytes: number
  /** {@link bytesToTokens} of savedBytes. */
  savedTokens: number
}

export interface SavingsAccumulator {
  /** Fold one frame into the running totals. */
  add(frame: SavingsFrame): void
  /** Aggregate totals across every frame added. */
  totals(): SavingsTotals
  /** Per-command breakdown of totals, keyed by frame.cmd. */
  byCommand(): Record<string, SavingsTotals>
  /** Clear all accumulated state. */
  reset(): void
}

/** In-memory savings aggregator - the DB-free counterpart of a host's stats store. */
export function createSavingsAccumulator(): SavingsAccumulator {
  let count = 0
  let savedBytes = 0
  let originalBytes = 0
  const per = new Map<string, { count: number; savedBytes: number; originalBytes: number }>()

  return {
    add(frame) {
      count += 1
      savedBytes += frame.savedBytes
      originalBytes += frame.originalBytes
      const p = per.get(frame.cmd) ?? { count: 0, savedBytes: 0, originalBytes: 0 }
      p.count += 1
      p.savedBytes += frame.savedBytes
      p.originalBytes += frame.originalBytes
      per.set(frame.cmd, p)
    },
    totals() {
      return { count, savedBytes, originalBytes, savedTokens: bytesToTokens(savedBytes) }
    },
    byCommand() {
      const out: Record<string, SavingsTotals> = {}
      for (const [cmd, v] of per) {
        out[cmd] = { ...v, savedTokens: bytesToTokens(v.savedBytes) }
      }
      return out
    },
    reset() {
      count = 0
      savedBytes = 0
      originalBytes = 0
      per.clear()
    },
  }
}

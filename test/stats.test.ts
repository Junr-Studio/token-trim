import { describe, it, expect } from 'vitest'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseSavingsFrame, createStatsReceiver, type SavingsFrame } from '../src/stats.js'

describe('parseSavingsFrame', () => {
  it('parses a valid frame', () => {
    expect(parseSavingsFrame('{"cmd":"git log","savedBytes":100,"originalBytes":500}')).toEqual({
      cmd: 'git log',
      savedBytes: 100,
      originalBytes: 500,
    })
  })

  it('returns null for blank / malformed lines', () => {
    expect(parseSavingsFrame('')).toBeNull()
    expect(parseSavingsFrame('   ')).toBeNull()
    expect(parseSavingsFrame('{not json')).toBeNull()
  })

  it('returns null when savedBytes is not a positive number', () => {
    expect(parseSavingsFrame('{"cmd":"x","savedBytes":0,"originalBytes":10}')).toBeNull()
    expect(parseSavingsFrame('{"cmd":"x","savedBytes":-5,"originalBytes":10}')).toBeNull()
    expect(parseSavingsFrame('{"cmd":"x","savedBytes":"7","originalBytes":10}')).toBeNull()
  })

  it('defaults cmd to "unknown" and originalBytes to savedBytes when missing', () => {
    expect(parseSavingsFrame('{"savedBytes":30}')).toEqual({
      cmd: 'unknown',
      savedBytes: 30,
      originalBytes: 30,
    })
  })
})

describe('createStatsReceiver', () => {
  function uniqueSocketPath(): string {
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\tt-test-${randomUUID()}`
      : path.join(os.tmpdir(), `tt-${randomUUID()}.sock`)
  }

  it('receives NDJSON frames from a connecting client', async () => {
    const socketPath = uniqueSocketPath()
    const frames: SavingsFrame[] = []
    const receiver = await createStatsReceiver({ socketPath, onFrame: (f) => frames.push(f) })

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ cmd: 'git log', savedBytes: 42, originalBytes: 100 }) + '\n')
        client.write(JSON.stringify({ cmd: 'noise', savedBytes: 0 }) + '\n') // ignored
        client.end()
      })
      client.on('close', () => resolve())
      client.on('error', reject)
    })

    // give the server a tick to flush the buffered frame
    await new Promise((r) => setTimeout(r, 50))
    receiver.close()

    expect(frames).toEqual([{ cmd: 'git log', savedBytes: 42, originalBytes: 100 }])
  })
})

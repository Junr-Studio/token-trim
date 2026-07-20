import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCommandProxy, type CommandProxy } from '../src/command-proxy.js'
import type { SavingsFrame } from '../src/stats.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function makeProxy(opts: Parameters<typeof createCommandProxy>[0]): Promise<CommandProxy> {
  const proxy = await createCommandProxy(opts)
  cleanups.push(async () => {
    await proxy.close()
    await fs.rm(opts.dir, { recursive: true, force: true })
  })
  return proxy
}

describe('createCommandProxy.env', () => {
  it('prepends binDir to PATH and sets the env contract (no stats)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-cp-'))
    const proxy = await makeProxy({ dir })
    const sep = process.platform === 'win32' ? ';' : ':'

    const env = proxy.env({ PATH: '/usr/bin' })
    expect(env.PATH).toBe(`${proxy.binDir}${sep}/usr/bin`)
    expect(env.BASH_ENV).toBe(proxy.setupScript)
    expect(env.TOKEN_TRIM_BIN_DIR).toBe(proxy.binDir)
    expect(proxy.socketPath).toBeNull()
    expect(env.TOKEN_TRIM_STATS_SOCKET).toBeUndefined()
  })

  it('reuses the caller PATH key casing without duplicating it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-cp-'))
    const proxy = await makeProxy({ dir })

    const env = proxy.env({ Path: 'C:\\Windows' })
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
    expect(pathKeys).toEqual(['Path'])
    expect(env.Path?.startsWith(proxy.binDir)).toBe(true)
  })

  it('wires a stats socket that delivers frames to onSavings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-cp-'))
    const frames: SavingsFrame[] = []
    const proxy = await makeProxy({ dir, onSavings: (f) => frames.push(f) })

    expect(proxy.socketPath).not.toBeNull()
    const env = proxy.env({ PATH: '' })
    expect(env.TOKEN_TRIM_STATS_SOCKET).toBe(proxy.socketPath)

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(proxy.socketPath!, () => {
        client.end(JSON.stringify({ cmd: 'tsc', savedBytes: 12, originalBytes: 30 }) + '\n')
      })
      client.on('close', () => resolve())
      client.on('error', reject)
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(frames).toEqual([{ cmd: 'tsc', savedBytes: 12, originalBytes: 30 }])
  })
})

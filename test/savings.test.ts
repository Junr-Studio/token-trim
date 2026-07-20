import { describe, it, expect } from 'vitest'
import { bytesToTokens, formatTokens, createSavingsAccumulator } from '../src/stats.js'

describe('bytesToTokens', () => {
  it('approximates ~4 bytes per token', () => {
    expect(bytesToTokens(0)).toBe(0)
    expect(bytesToTokens(4)).toBe(1)
    expect(bytesToTokens(100)).toBe(25)
    expect(bytesToTokens(1000)).toBe(250)
  })
})

describe('formatTokens', () => {
  it('formats compactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(3_400_000)).toBe('3.4M')
    expect(formatTokens(2_000_000_000)).toBe('2B')
  })

  it('guards against negatives and NaN', () => {
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})

describe('createSavingsAccumulator', () => {
  it('accumulates totals and per-command breakdown', () => {
    const acc = createSavingsAccumulator()
    acc.add({ cmd: 'git log', savedBytes: 400, originalBytes: 1000 })
    acc.add({ cmd: 'git log', savedBytes: 200, originalBytes: 500 })
    acc.add({ cmd: 'tsc', savedBytes: 80, originalBytes: 120 })

    expect(acc.totals()).toEqual({
      count: 3,
      savedBytes: 680,
      originalBytes: 1620,
      savedTokens: bytesToTokens(680),
    })
    expect(acc.byCommand()['git log']).toEqual({
      count: 2,
      savedBytes: 600,
      originalBytes: 1500,
      savedTokens: bytesToTokens(600),
    })
    expect(acc.byCommand()['tsc']?.count).toBe(1)
  })

  it('resets', () => {
    const acc = createSavingsAccumulator()
    acc.add({ cmd: 'x', savedBytes: 10, originalBytes: 20 })
    acc.reset()
    expect(acc.totals()).toEqual({ count: 0, savedBytes: 0, originalBytes: 0, savedTokens: 0 })
    expect(acc.byCommand()).toEqual({})
  })
})

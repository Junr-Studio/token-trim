import { describe, it, expect } from 'vitest'
import { compress } from './support/harness.js'
import {
  assertNoFabricatedWords,
  findsFabricatedZero,
  isPureDataList,
  findsForeignListLines,
} from './support/invariants.js'
import type { MatrixEntry } from './support/matrix.js'
import { PROXIED_COMMANDS } from '../src/write-proxy.js'

import { VCS_MATRIX } from './matrix/vcs.matrix.js'
import { JS_MATRIX } from './matrix/js.matrix.js'
import { PYTHON_MATRIX } from './matrix/python.matrix.js'
import { SYSTEMS_MATRIX } from './matrix/systems.matrix.js'
import { INFRA_MATRIX } from './matrix/infra.matrix.js'
import { UNIX_MATRIX } from './matrix/unix.matrix.js'

// Every command token-trim installs a wrapper for, measured.
//
// PROXIED_COMMANDS is documented as public surface, and wrapping a command
// costs the agent ~40 ms of node startup on every invocation. This file is the
// evidence that the trade is worth taking: for each command, a realistic
// invocation and the reduction it really achieves - or an explicit statement
// that the wrapper is there to protect the output rather than shrink it.
//
// Two things fail here that nothing else catches:
//   - a command in PROXIED_COMMANDS with no entry at all (we ship a wrapper
//     that was never measured);
//   - a condenser that quietly stops condensing (the entry's floor is missed).

const MATRIX: MatrixEntry[] = [
  ...VCS_MATRIX,
  ...JS_MATRIX,
  ...PYTHON_MATRIX,
  ...SYSTEMS_MATRIX,
  ...INFRA_MATRIX,
  ...UNIX_MATRIX,
]

/**
 * NOT rounded. `Math.round` here meant a floor was not a floor: `git diff
 * --stat` declared `minReduction: 45` and actually removed 44.601%, which
 * rounded to 45 and passed. A floor that a value can sit below and still clear
 * is a floor the matrix cannot be read as evidence for - and this file is the
 * only evidence behind README's headline numbers.
 */
function reductionPercent(entry: MatrixEntry): number {
  const out = compress(entry.input, entry.cmd, entry.args ?? [])
  return (1 - out.length / entry.input.length) * 100
}

describe('coverage matrix - every proxied command is measured', () => {
  it('covers every command in PROXIED_COMMANDS', () => {
    const measured = new Set(MATRIX.map((e) => e.cmd))
    const missing = PROXIED_COMMANDS.filter((c) => !measured.has(c))
    expect(
      missing,
      'these commands install a PATH wrapper - costing ~40ms of node startup ' +
        'per invocation - with no entry proving it buys anything',
    ).toEqual([])
  })

  it('measures no command that is not actually proxied', () => {
    const proxied = new Set<string>(PROXIED_COMMANDS)
    const stray = [...new Set(MATRIX.map((e) => e.cmd))].filter((c) => !proxied.has(c))
    expect(stray, 'matrix entries for commands the library does not wrap').toEqual([])
  })

  it('declares a reason whenever an entry claims no reduction', () => {
    const silent = MATRIX.filter((e) => e.minReduction === 0 && !e.passthroughReason)
    expect(
      silent.map((e) => `${e.cmd} ${(e.args ?? []).join(' ')}`),
      'an entry that promises no savings must say why the wrapper exists',
    ).toEqual([])
  })
})

describe('coverage matrix - measured reductions', () => {
  for (const entry of MATRIX) {
    const label = `${entry.cmd}${entry.args?.length ? ' ' + entry.args.join(' ') : ''} - ${entry.what}`

    it(label, () => {
      const out = compress(entry.input, entry.cmd, entry.args ?? [])

      // The invariants hold here too: a matrix fixture is just another realistic
      // sample, and a condenser that hits its number by inventing content has
      // not earned it.
      expect(assertNoFabricatedWords(out, entry.input), 'fabricated words').toEqual([])
      expect(findsFabricatedZero(out, entry.input), 'fabricated zero').toBeNull()
      if (isPureDataList(entry.input)) {
        expect(findsForeignListLines(out, entry.input), 'foreign lines in a data list').toEqual([])
      }

      // Never larger, whatever else is true.
      expect(out.length, 'condenser grew the output').toBeLessThanOrEqual(entry.input.length)

      if (entry.passthroughReason) {
        expect(entry.minReduction, 'a passthrough entry cannot also promise a reduction').toBe(0)
        return
      }

      const actual = reductionPercent(entry)
      expect(
        actual,
        `expected at least ${entry.minReduction}% reduction, measured ${actual}% ` +
          `(${entry.input.length} -> ${out.length} chars)`,
      ).toBeGreaterThanOrEqual(entry.minReduction)
    })
  }
})

import { describe, it, expect } from 'vitest'
import { ALL_HANDLER_SOURCES } from './support/harness.js'

// Structural contract every handler source must satisfy.
//
// Handler strings are concatenated AFTER the frame in the generated proxy.mjs,
// but the frame calls into them from TOP-LEVEL code (arg rewriting runs before
// the command is even spawned). Only function declarations hoist across that
// boundary: a top-level `const`/`let`/`class` in a handler is still in its
// temporal dead zone when the frame reaches it and throws
//
//     ReferenceError: Cannot access 'X' before initialization
//
// at runtime, in the generated proxy only - invisible to the compress() harness,
// which evaluates every source before calling anything. This suite is the guard.

describe('handler sources - top-level bindings must be hoistable', () => {
  for (const [name, source] of Object.entries(ALL_HANDLER_SOURCES)) {
    it(`${name} declares only functions at top level`, () => {
      const offenders: string[] = []
      for (const line of source.split('\n')) {
        // Top-level = column 0. Anything indented is inside a function body.
        const m = line.match(/^(const|let|var|class)\s+([A-Za-z_$][\w$]*)/)
        if (m) offenders.push(`${m[1]} ${m[2]}`)
      }
      expect(
        offenders,
        `${name} has top-level bindings that do not hoist; move them inside a ` +
          'function (see the note in src/handlers/args.ts). Offenders',
      ).toEqual([])
    })
  }
})

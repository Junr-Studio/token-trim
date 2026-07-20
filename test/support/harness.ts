import { describe, it, expect } from 'vitest'
import { PROXY_FRAME } from '../../src/frame.js'
import { GIT_HANDLER }         from '../../src/handlers/git.js'
import { TSC_HANDLER }         from '../../src/handlers/tsc.js'
import { PKGMGR_HANDLER }      from '../../src/handlers/pkgmgr.js'
import { GREP_HANDLER }        from '../../src/handlers/grep.js'
import { CARGO_HANDLER }       from '../../src/handlers/cargo.js'
import { PYTHON_HANDLER }      from '../../src/handlers/python.js'
import { DOCKER_HANDLER }      from '../../src/handlers/docker.js'
import { HTTP_HANDLER }        from '../../src/handlers/http.js'
import { GH_HANDLER }          from '../../src/handlers/gh.js'
import { MAKE_HANDLER }        from '../../src/handlers/make.js'
import { SOURCE_HANDLER }      from '../../src/handlers/source.js'
import { SYSTEM_HANDLER }      from '../../src/handlers/system.js'
import { RUBY_HANDLER }        from '../../src/handlers/ruby.js'
import { JS_TOOLS_HANDLER }    from '../../src/handlers/js-tools.js'
import { CLOUD_EXTRA_HANDLER } from '../../src/handlers/cloud-extra.js'
import { GOLANGCI_HANDLER }    from '../../src/handlers/golangci.js'
import { JQ_HANDLER }          from '../../src/handlers/jq.js'
import { BUILD_TOOLS_HANDLER } from '../../src/handlers/build-tools.js'

const HANDLERS = [
  GIT_HANDLER, TSC_HANDLER, PKGMGR_HANDLER, GREP_HANDLER, CARGO_HANDLER,
  PYTHON_HANDLER, DOCKER_HANDLER, HTTP_HANDLER, GH_HANDLER, MAKE_HANDLER,
  SOURCE_HANDLER, SYSTEM_HANDLER, RUBY_HANDLER, JS_TOOLS_HANDLER,
  CLOUD_EXTRA_HANDLER, GOLANGCI_HANDLER, JQ_HANDLER, BUILD_TOOLS_HANDLER,
]

/**
 * Reconstruct the proxy's `compress(text, cmd, args)` dispatcher in isolation
 * so we can exercise every condenser directly - deterministic, cross-platform,
 * no subprocess spawning. We slice the compress function out of the SAME
 * PROXY_FRAME string that ships (between its two section markers) and link it
 * against the SAME handler source strings via function-declaration hoisting,
 * exactly as the generated proxy.mjs does. So this tests the shipped logic 1:1.
 */
function buildCompress(): (text: string, cmd: string, args: string[]) => string {
  const start = PROXY_FRAME.indexOf('// ── compress dispatcher')
  const end = PROXY_FRAME.indexOf('// ── stats reporting')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate the compress() section markers in PROXY_FRAME')
  }
  const compressSrc = PROXY_FRAME.slice(start, end)
  const src = [compressSrc, ...HANDLERS, 'return compress;'].join('\n')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src)() as (text: string, cmd: string, args: string[]) => string
}

/** The proxy's exact stdout-compression function, callable in-process. */
export const compress = buildCompress()

export interface CompressCase {
  /** Scenario label (becomes the test name). */
  name: string
  /** Dispatch command, e.g. "git", "tsc", "docker". */
  cmd: string
  /** Command args; args[0] is the subcommand used for dispatch (e.g. ["log"]). */
  args?: string[]
  /** Realistic raw command output to compress. */
  input: string
  /** Set when a condenser may legitimately produce output longer than input. */
  allowGrowth?: boolean
  /** Extra behavioral assertions on the compressed output (the "TDD" intent). */
  assert?: (out: string, input: string) => void
}

/**
 * Table-driven characterization harness. For every case it runs the real
 * compress() and asserts:
 *   1. output is no larger than input (unless allowGrowth) - it compresses,
 *   2. any case-specific behavioral expectations, then
 *   3. an exact snapshot locking the byte-for-byte current output.
 */
export function describeCompression(handler: string, cases: CompressCase[]): void {
  describe(`compress - ${handler}`, () => {
    for (const c of cases) {
      it(c.name, () => {
        const out = compress(c.input, c.cmd, c.args ?? [])
        if (!c.allowGrowth) {
          // Guard in CHARACTERS: the goal is token cost, and tokens track
          // characters, not bytes. Multi-byte summary glyphs (─, ×) cost extra
          // UTF-8 bytes without adding token weight, so a byte guard would
          // unfairly penalize a condenser that genuinely shrinks the text.
          expect(
            out.length,
            'compressed output should not be larger than input (characters)',
          ).toBeLessThanOrEqual(c.input.length)
        }
        c.assert?.(out, c.input)
        expect(out).toMatchSnapshot()
      })
    }
  })
}

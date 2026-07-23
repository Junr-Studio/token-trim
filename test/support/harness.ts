import { describe, it, expect } from 'vitest'
import {
  assertNoFabricatedWords,
  findsFabricatedZero,
  isPureDataList,
  findsForeignListLines,
} from './invariants.js'
import { PROXY_FRAME } from '../../src/frame.js'
import { ARGS_HANDLER }        from '../../src/handlers/args.js'
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
import { CROSSCUT_HANDLER }    from '../../src/handlers/crosscut.js'
import { HELM_HANDLER }        from '../../src/handlers/helm.js'
import { UNIX_HANDLER }        from '../../src/handlers/unix.js'

/**
 * Every handler source, keyed by its export name. Single source of truth for
 * the linker below and for the structural contract in handler-contract.test.ts.
 */
export const ALL_HANDLER_SOURCES: Record<string, string> = {
  ARGS_HANDLER,
  GIT_HANDLER,
  TSC_HANDLER,
  PKGMGR_HANDLER,
  GREP_HANDLER,
  CARGO_HANDLER,
  PYTHON_HANDLER,
  DOCKER_HANDLER,
  HTTP_HANDLER,
  GH_HANDLER,
  MAKE_HANDLER,
  SOURCE_HANDLER,
  SYSTEM_HANDLER,
  RUBY_HANDLER,
  JS_TOOLS_HANDLER,
  CLOUD_EXTRA_HANDLER,
  GOLANGCI_HANDLER,
  JQ_HANDLER,
  BUILD_TOOLS_HANDLER,
  CROSSCUT_HANDLER,
  HELM_HANDLER,
  UNIX_HANDLER,
}

const HANDLERS = Object.values(ALL_HANDLER_SOURCES)

/**
 * Reconstruct the proxy's `compress(text, cmd, args)` dispatcher in isolation
 * so we can exercise every condenser directly - deterministic, cross-platform,
 * no subprocess spawning. We slice the compress function out of the SAME
 * PROXY_FRAME string that ships (between its two section markers) and link it
 * against the SAME handler source strings via function-declaration hoisting,
 * exactly as the generated proxy.mjs does. So this tests the shipped logic 1:1.
 */
/**
 * The same placeholder substitution `writeProxyScripts` performs, with the same
 * defaults. Handler sources may reference `__TT_FULL_FLAG__` (e.g. in a "re-run
 * with --full" overflow marker); without this the harness would exercise text
 * the shipped proxy never contains, breaking the 1:1 guarantee below.
 */
function substitutePlaceholders(src: string): string {
  return src
    .replaceAll('__TT_BIN_DIR_ENV__', 'TOKEN_TRIM_BIN_DIR')
    .replaceAll('__TT_STATS_SOCKET_ENV__', 'TOKEN_TRIM_STATS_SOCKET')
    .replaceAll('__TT_FULL_FLAG__', '--full')
    .replaceAll('__TT_HINT_LABEL__', 'token-trim')
    .replaceAll('__TT_HINT_MIN__', '500')
}

function buildCompress(): (text: string, cmd: string, args: string[]) => string {
  const start = PROXY_FRAME.indexOf('// ── compress dispatcher')
  const end = PROXY_FRAME.indexOf('// ── stats reporting')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate the compress() section markers in PROXY_FRAME')
  }
  const compressSrc = PROXY_FRAME.slice(start, end)
  const src = substitutePlaceholders([compressSrc, ...HANDLERS, 'return compress;'].join('\n'))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src)() as (text: string, cmd: string, args: string[]) => string
}

/** The proxy's exact stdout-compression function, callable in-process. */
export const compress = buildCompress()

/**
 * Link one function out of handler sources and return it, callable in-process.
 *
 * The pre-spawn predicates (`resolveSub`, `rewriteArgs`, `isFollowInvocation`,
 * `isMachineOutput`) run BEFORE the command executes, so they are invisible to
 * `compress()` and cannot be reached through {@link describeCompression}. They
 * are plain functions of argv, so linking them the same way the harness links
 * compress() exercises the shipped source without spawning a process.
 *
 * @param name    the function to return, e.g. 'rewriteArgs'
 * @param sources handler source strings to concatenate (hoisting resolves
 *                cross-references between them, exactly as in proxy.mjs)
 */
export function linkHandlerFunction<T>(name: string, ...sources: string[]): T {
  const src = substitutePlaceholders([...sources, `return ${name};`].join('\n'))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src)() as T
}

/**
 * What a passthrough looks like coming out of `compress()`: the command's own
 * bytes with blank lines removed from both ends, and nothing else.
 *
 * Deliberately not `.trim()`. The indentation of the first CONTENT line is not
 * chrome - in a column format it is the payload. `git status --short` prints
 * " M src/a.ts" for a file modified in the worktree and "M  src/a.ts" for one
 * already staged, and `ps`, `psql` and `df` all right-align their first column,
 * so eating one leading space changes what the output says. Assertions written
 * as `toBe(input.trim())` were asserting that corruption.
 */
export function passedThrough(input: string): string {
  return input.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
}

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

        // ── invariants, applied to EVERY case in the suite ──────────────────
        // A condenser may delete; it may not invent. See test/support/invariants.ts.
        const invented = assertNoFabricatedWords(out, c.input)
        expect(
          invented,
          'condenser emitted words that are neither in the input nor in ' +
            'CONDENSER_VOCABULARY - it is fabricating, not compressing',
        ).toEqual([])

        const zero = findsFabricatedZero(out, c.input)
        expect(
          zero,
          'condenser claimed a zero count for input that was not empty - this ' +
            'is the "diff: 0 file(s)" / "0 matches" class of bug',
        ).toBeNull()

        if (isPureDataList(c.input)) {
          expect(
            findsForeignListLines(out, c.input),
            'input is a pure data list (the shape piped into xargs), so every ' +
              'output line must be a line the command actually printed',
          ).toEqual([])
        }

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

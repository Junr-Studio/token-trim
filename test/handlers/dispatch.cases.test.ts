import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Dispatcher-level behaviour in compress() itself, independent of any one
// condenser: content sniffing, machine-output passthrough, and the last-resort
// size cap.

// ── content sniff hijack ─────────────────────────────────────────────────────
// `/TS\d{4}:/` is tested BEFORE any command-name branch, so a text search whose
// HITS mention a TypeScript error code gets rendered as a compiler report -
// a diagnostic table manufactured out of a grep result.
const RG_HITS_MENTIONING_TS = [
  'docs/errors.md:12:TS2304: Cannot find name - see the troubleshooting table',
  'docs/errors.md:48:TS2345: Argument type mismatch is the most common one',
  'src/lint/rules.ts:31:// suppress TS2304: generated code references globals',
  'src/lint/rules.ts:77:const IGNORED = new Set(["TS2304:", "TS2345:"])',
  'test/fixtures/tsc-output.txt:1:app.ts(1,1): error TS2304: Cannot find name x',
  'CHANGELOG.md:90:- handle TS2304: unresolved identifiers in generated files',
  'docs/errors.md:120:TS7006: Parameter implicitly has an any type',
  'docs/errors.md:121:TS2532: Object is possibly undefined',
  'docs/errors.md:122:TS2339: Property does not exist on type',
  'docs/errors.md:123:TS18048: Value is possibly undefined',
  'src/lint/rules.ts:90:// TS2339: property access on a narrowed union',
  'README.md:44:Common codes: TS2304, TS2345, TS7006 - see docs/errors.md',
].join('\n') + '\n'

// ── machine output ───────────────────────────────────────────────────────────
const KUBECTL_JSON = JSON.stringify(
  {
    apiVersion: 'v1',
    kind: 'List',
    items: Array.from({ length: 8 }, (_, i) => ({
      metadata: { name: `api-pod-${i}`, namespace: 'production' },
      status: { phase: 'Running', podIP: `10.1.2.${i}` },
    })),
  },
  null,
  2,
) + '\n'

// ── oversized output ─────────────────────────────────────────────────────────
// No condenser matches `unknowncmd`, so today this reaches the model whole.
const HUGE = Array.from(
  { length: 4000 },
  (_, i) => `line ${i}: some moderately long payload describing record number ${i} in detail`,
).join('\n') + '\n'

describeCompression('dispatch', [
  {
    name: 'content sniff - rg hits that merely MENTION a TS code are not rendered as a tsc report',
    cmd: 'rg',
    args: ['-n', 'TS2304', '.'],
    input: RG_HITS_MENTIONING_TS,
    assert: (out) => {
      // the tsc condenser's signature summary must not appear
      expect(out).not.toMatch(/^TypeScript: \d+ errors in \d+ files/m)
      expect(out).not.toContain('─────')
      // the grep grouping (or a faithful passthrough) is what we want
      expect(out).toContain('docs/errors.md')
      expect(out).toContain('README.md')
    },
  },
  {
    name: 'machine output - kubectl -o json stays parseable JSON',
    cmd: 'kubectl',
    args: ['get', 'pods', '-o', 'json'],
    input: KUBECTL_JSON,
    assert: (out) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).items).toHaveLength(8)
    },
  },
  {
    name: 'machine output - git status --porcelain is not reshaped',
    cmd: 'git',
    args: ['status', '--porcelain'],
    input: ' M src/app.ts\n M README.md\n?? src/new.ts\nA  src/added.ts\n',
    assert: (out) => {
      expect(out.split('\n')).toEqual([
        ' M src/app.ts',
        ' M README.md',
        '?? src/new.ts',
        'A  src/added.ts',
      ])
    },
  },
  {
    name: 'backstop cap - output with no dedicated condenser is still bounded',
    cmd: 'unknowncmd',
    args: [],
    input: HUGE,
    assert: (out, input) => {
      // ~4000 lines of prose must not reach the model whole
      expect(out.length).toBeLessThan(input.length / 4)
      // the elision is disclosed, and says how to recover the rest
      expect(out).toMatch(/elided|truncated/i)
      expect(out).toContain('--full')
      // head AND tail are kept: the end of a log is often where the error is
      expect(out).toContain('line 0:')
      expect(out).toContain('line 3999:')
    },
  },
  {
    name: 'ANSI - full CSI and OSC escape sequences are stripped, not just cursor moves',
    cmd: 'unknowncmd',
    args: [],
    input:
      '[1m[31mERROR[0m build failed\n' +
      ']0;window title[38;2;255;100;0mwarning[39m in module\n' +
      '[?25lhidden cursor[?25h done\n',
    assert: (out) => {
      // no escape byte survives anywhere
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(//)
      // the human-readable text does
      expect(out).toContain('ERROR build failed')
      expect(out).toContain('warning in module')
      expect(out).toContain('hidden cursor done')
      expect(out).not.toContain('window title')
    },
  },
  {
    // The backstop splits on newlines and fills a head and a tail budget. When
    // the content is ONE very long line - a compacted JSON document, a minified
    // bundle, a single-line log - neither loop can fit it, so both came back
    // empty and the output was the elision marker ALONE: a 22 KB API response
    // reduced to 73 characters of "1 lines elided". Total annihilation, wearing
    // the costume of compression.
    name: 'backstop cap - one enormous line is truncated by characters, never replaced by the marker alone',
    cmd: 'unknowncmd',
    args: [],
    input: 'x'.repeat(300) + Array.from({ length: 400 }, (_, i) => `payload-segment-${i}`).join('|') + '\n',
    assert: (out, input) => {
      expect(out.length).toBeLessThan(input.length)
      // real content survives at both ends
      expect(out).toContain('payload-segment-0')
      expect(out).toContain('payload-segment-399')
      // and it is not just a notice
      expect(out.replace(/\.\.\..*\.\.\./s, '').trim().length).toBeGreaterThan(2000)
    },
  },
  {
    name: 'backstop cap - a large valid JSON document is never cut, because a cut JSON is worthless',
    cmd: 'aws',
    args: ['ec2', 'describe-instances'],
    input: JSON.stringify(
      {
        Reservations: Array.from({ length: 40 }, (_, r) => ({
          ReservationId: `r-0abc${r}`,
          Instances: [
            {
              InstanceId: `i-0abcdef${r}`,
              InstanceType: 't3.large',
              State: { Name: 'running' },
              PrivateIpAddress: `10.0.${r}.15`,
              LaunchTime: '2026-03-15T12:34:56.000Z',
              Tags: [{ Key: 'Name', Value: `worker-${r}` }],
            },
          ],
        })),
      },
      null,
      2,
    ),
    assert: (out, input) => {
      // `aws … | jq` is the normal way to read this, and the aws CLI emits JSON
      // by DEFAULT with no flag for isMachineOutput to see. Truncating it does
      // not make it cheaper, it makes it unparseable.
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).Reservations).toHaveLength(40)
      // still compressed - the whitespace is gone
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'backstop cap - normal-sized output is untouched by it',
    cmd: 'unknowncmd',
    args: [],
    input: 'a short result\nwith three\nlines\n',
    assert: (out) => {
      expect(out).toBe('a short result\nwith three\nlines')
    },
  },
])

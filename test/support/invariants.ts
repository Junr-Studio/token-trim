/**
 * Invariants every condenser must satisfy, on every input.
 *
 * These are wired into {@link describeCompression}, so they run against every
 * case in the suite - each one a realistic sample of a real tool's output - and
 * against any case added later. They encode the one property that matters for a
 * tool that rewrites what an agent reads:
 *
 *   **A condenser may DELETE. It may not INVENT.**
 *
 * Everything the library is allowed to say that did not come from the command's
 * own output is listed in {@link CONDENSER_VOCABULARY} below. That list is the
 * review surface: if a change needs a new word in it, that is the moment to ask
 * whether the condenser is summarising or fabricating.
 */

/**
 * Every word a condenser is permitted to introduce.
 *
 * Kept deliberately small and deliberately boring. A word belongs here only if
 * it is *structural* - a label, a unit, a marker - never if it is a claim about
 * the input that the input did not make.
 */
export const CONDENSER_VOCABULARY: readonly string[] = [
  // elision and recovery markers
  'more', 'elided', 'omitted', 'truncated', 'skipped', 'hidden', 'total', 'full',
  'lines', 'line', 'entries', 'entry', 'rows', 'row', 'items', 'item', 'characters',
  'files', 'file', 'paths', 'path', 'chars', 'bytes', 'KB', 'MB', 'GB', 'and',
  'the', 'this', 'from', 'middle', 'list', 'all', 'them', 'for', 'with', 'run',
  'implementation', 'here', 'schema', 'keys', 'cols', 'base', 'frames',
  // command labels the condensers prefix their summaries with
  'git', 'docker', 'helm', 'npm', 'pnpm', 'yarn', 'pip', 'ruff', 'mypy',
  'Vitest', 'Jest', 'Playwright', 'Pytest', 'ESLint', 'Prettier', 'TypeScript',
  'Cargo', 'Bun', 'terraform', 'tofu', 'dotnet', 'audit', 'test', 'format',
  'ninja', 'Trivy', 'pylint', 'bundle',
  // roll-up nouns and states the condensers count
  'passed', 'failed', 'errors', 'error', 'warnings', 'warning', 'problems',
  'problem', 'issue', 'issues', 'vulnerabilities', 'reformatted', 'unchanged',
  'running', 'pending', 'containers', 'images', 'pods', 'releases', 'revisions',
  'charts', 'matches', 'file(s)', 'dirs', 'directories', 'directory', 'nested',
  'direct', 'processes', 'commits', 'changed', 'insertions', 'deletions',
  'documents', 'document', 'none', 'add', 'change', 'destroy', 'changes',
  'reused', 'cached', 'suite(s)', 'routes', 'gems', 'resolved', 'installed',
  'vulns', 'msgs', 'rated', 'edges', 'compiled', 'linked', 'packages', 'tests',
  // punctuation-adjacent tokens that survive tokenisation
  'FAIL', 'WARN', 'ERR', 'Top', 'rules', 'Found',
  // structural labels introduced by a specific condenser's summary line
  'branches', 'checks', 'sections', 'versions', 'results', 'suite', 'dir',
  'local', 'remote', 'showing', 'shown', 'folded', 'packed', 'outdated',
  'doctor', 'plan', 'use', 'through', 'first', 'longer', 'need', 'index',
  'toml', 'offense', 'uncommitted', 'svc', 'rev', 'formatted', 'reflog',
  // tool names a condenser prefixes its own rollup with
  'RSpec', 'rake', 'rubocop', 'golangci', 'lint',
] as const

const VOCAB = new Set(CONDENSER_VOCABULARY.map((w) => w.toLowerCase()))

/**
 * Purely alphabetic runs of three or more letters.
 *
 * Deliberately excludes digits, which makes the check strict about WORDS while
 * staying blind to three legitimate transforms that are not inventions:
 *   - shortening an identifier (`4788fef0d69…` -> `4788fef`): no alpha run of
 *     three survives either side, so neither is judged;
 *   - composing a label with a number the input supplied (`rev12`, `L118-123`):
 *     tokenises to `rev` / nothing, and `rev` is declared vocabulary;
 *   - reformatting a count (`(x4)`, `+37`).
 * A fabricated *word* - a filename, a package, a status, an error code - has no
 * such excuse and is caught.
 */
function words(text: string): string[] {
  return text.match(/[A-Za-z]{3,}/g) ?? []
}

/**
 * The input as the condenser sees it: compress() strips ANSI before dispatching,
 * so comparing raw input against stripped output would flag `DONE` as invented
 * when the input held `\x1b[32mDONE`. Same regexes as src/frame.ts.
 */
function asCondenserSeesIt(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

/**
 * I1 - NO FABRICATED WORDS.
 *
 * Every word in the output either appeared in the input or is declared
 * vocabulary. This is what makes "the condenser only compresses" checkable
 * rather than a claim: a condenser that invents a filename, a package name, an
 * error code or a status it did not read cannot pass.
 */
export function assertNoFabricatedWords(out: string, input: string): string[] {
  const inputWords = words(asCondenserSeesIt(input)).map((w) => w.toLowerCase())
  const seen = new Set(inputWords)
  const invented: string[] = []
  for (const w of words(out)) {
    const lower = w.toLowerCase()
    if (seen.has(lower) || VOCAB.has(lower)) continue
    // Truncating a long line at a fixed width cuts mid-word, so the tail token
    // is a PREFIX of a word the input really contained ("experimental" ->
    // "experime"). A prefix reproduces the input, it does not invent - whereas
    // a fabricated word has no such ancestor.
    if (inputWords.some((iw) => iw.startsWith(lower))) continue
    if (!invented.includes(w)) invented.push(w)
  }
  return invented
}

/**
 * I2 - NO FABRICATED ZERO.
 *
 * The single worst bug this library has shipped, twice: `git diff --stat`
 * answering `diff: 0 file(s)` for a real diff, and `rg -l` answering
 * `0 matches in 0 file(s)` for a hundred hits. Reporting nothing found, for
 * input that plainly found something, is worse than not compressing at all -
 * the agent acts on it.
 *
 * So: if the input carried at least one non-blank line, the output may not
 * claim a zero count of anything.
 */
// Two subtleties, both learned by getting them wrong:
//   - longest alternative first, or `files?` matches the "file" inside
//     "file(s)" and the reported violation names a token the condenser never
//     printed;
//   - the word boundary lives INSIDE each alternative, because a trailing `\b`
//     can never match after the ")" of "file(s)".
const ZERO_CLAIM =
  /\b0\s+(file\(s\)|files\b|file\b|matches\b|match\b|items?\b|results?\b|paths?\b|entries\b|releases?\b|revisions?\b|charts?\b|containers?\b|images?\b|pods?\b|processes\b|commits?\b|documents?\b|problems?\b|errors?\b|tests?\b|vulnerabilities\b|directories\b|dirs\b)/i

export function findsFabricatedZero(out: string, input: string): string | null {
  const m = out.match(ZERO_CLAIM)
  if (!m) return null

  // "3 files, 0 dirs" is not a claim that nothing is there - one dimension is
  // legitimately empty while another is not. Only an output whose every count
  // is zero is asserting emptiness.
  const counts = out.match(/\b\d+\b/g) ?? []
  if (counts.some((n) => n !== '0')) return null

  // A command that printed only a header, or a "No resources found" sentinel,
  // really did report nothing: relaying that is not fabrication.
  const inputLines = input.split('\n').filter((l) => l.trim())
  if (inputLines.length <= 1) return null

  // Nor is repeating a zero the command itself printed.
  if (input.includes(m[0])) return null

  return m[0]
}

/**
 * Characters a single datum may be built from.
 *
 * Wider than an identifier on purpose. The class used to be `[\w.@/\\:+-]`,
 * which excluded `[`, `]`, `"`, `=` and the space - and a classifier that says
 * "not a list" does not fail loudly, it just silently stops guarding a stream.
 * `terraform state list`, which src/handlers/args.ts names in the same breath
 * as `git ls-files` and `docker ps -q` as one that must stay pipeable, prints
 * `module.vpc.aws_subnet.private[0]` for `count` and
 * `aws_route53_record.this["api-1.acme.example"]` for `for_each`: the bracket
 * form alone already failed the class, so I3 never ran on it. A path containing
 * a space (`Program Files`, `My Documents`) failed too, which blinded the
 * invariant to most real `find` / `rg -l` output on a developer machine.
 */
const DATUM_CHARS = /^[\w.@/\\:+=~'"[\]-]+(?: [\w.@/\\:+=~'"[\]-]+)*$/

/**
 * Three alphabetic words in a row - the signature of a sentence rather than a
 * datum. Real addresses, ids and paths do not contain "for all of" or "this
 * value is never read"; the frame's own elision markers and every condenser
 * summary do. This is what lets the character class above be wide without
 * letting prose in behind it.
 */
const PROSE_RUN = /(?:^| )[A-Za-z]{2,}(?: [A-Za-z]{2,}){2}(?: |$)/

/**
 * I3 - DATA LISTS STAY DATA.
 *
 * When the input is a pure list - one datum per line, the shape that gets piped
 * into `xargs` - every line of the output must be a line that was in the input.
 * No header, no marker, no indent, no reordering into groups. A truncation is
 * disclosed out of band instead (see ttNotice in src/handlers/args.ts).
 */
export function isPureDataList(input: string): boolean {
  const lines = input.split('\n').filter((l) => l.trim())
  if (lines.length < 8) return false
  return lines.every((l) => {
    // An indent is structure - a grouping header's children, a YAML nesting -
    // not a datum.
    if (l !== l.trimStart()) return false
    const t = l.trim()
    // A tab, or a run of two or more spaces, is column padding: a table, not a
    // list. This is what still separates `NAME   STATUS   AGE` from a path that
    // merely happens to contain one space.
    if (/\t/.test(t) || / {2}/.test(t)) return false
    if (!DATUM_CHARS.test(t)) return false
    if (PROSE_RUN.test(t)) return false
    return true
  })
}

export function findsForeignListLines(out: string, input: string): string[] {
  const source = new Set(input.split('\n').map((l) => l.trim()).filter(Boolean))
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !source.has(l))
}

export const JS_TOOLS_HANDLER = `
// ── shared: the lines of a failure block worth keeping ────────────────────────
// A test-runner rollup that names the failing test and drops everything else
// answers "which" but not "why", so the agent has to re-run with the full
// output and pay the raw cost anyway. These are the lines that carry the
// diagnosis: the assertion, the expected/received pair, and the source
// location. The echoed source lines and the caret art are dropped - the agent
// can open the file.
function jsFailureDetail(block, max) {
  const keep = [];
  for (const raw of block) {
    const t = raw.trim();
    if (!t) continue;
    if (/^(AssertionError|Error|TypeError|ReferenceError|SyntaxError|RangeError)\\b/.test(t) ||
        /^(Expected|Received|expected|received)\\b/.test(t) ||
        /^(\\+|-)\\s*\\S/.test(t) && keep.length > 0 ||
        /^(at|❯)\\s+\\S+[:(]/.test(t)) {
      keep.push('    ' + t.slice(0, 160));
      if (keep.length >= (max ?? 6)) break;
    }
  }
  return keep;
}

// ── vitest ────────────────────────────────────────────────────────────────────
function condenseVitest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pM = line.match(/(\\d+)\\s+passed/);
    const fM = line.match(/(\\d+)\\s+failed/);
    const sM = line.match(/(\\d+)\\s+skipped/);
    if (pM) passed = +pM[1];
    if (fM) failed = +fM[1];
    if (sM) skipped = +sM[1];

    // The "FAIL <file> > <suite> > <test>" header opens the detail block that
    // holds the assertion; the bare "× <name>" line in the summary list does not.
    const failBlock = line.match(/^\\s*FAIL\\s+(.+)$/);
    if (failBlock) {
      failures.push({ name: failBlock[1].trim(), detail: jsFailureDetail(lines.slice(i + 1, i + 30)) });
      continue;
    }
    const failH = line.match(/^\\s*(×|●)\\s+(.+)/);
    if (failH) failures.push({ name: failH[2].trim(), detail: [] });
  }

  if (passed === 0 && failed === 0) return text;

  // vitest names each failure twice: once in the per-file summary list ("× name
  // 8ms") and again as the header of the detail block ("FAIL file > suite >
  // name"). Keep the detailed one and drop the bare duplicate, matching on the
  // test name with vitest's trailing duration stripped.
  const detailed = failures.filter(f => f.detail.length > 0);
  const deduped = failures.filter(f => {
    if (f.detail.length > 0) return true;
    const bare = f.name.replace(/\\s+\\d+ms$/, '');
    return !detailed.some(d => d.name.indexOf(bare) !== -1);
  });

  const parts = [passed + ' passed'];
  if (failed  > 0) parts.push(failed  + ' failed');
  if (skipped > 0) parts.push(skipped + ' skipped');
  const out = ['Vitest: ' + parts.join(', ')];
  for (const f of deduped.slice(0, 10)) {
    out.push('  FAIL: ' + f.name);
    for (const d of f.detail) out.push(d);
  }
  if (deduped.length > 10) out.push('  ... +' + (deduped.length - 10) + ' more');
  return out.join('\\n');
}

// ── jest ──────────────────────────────────────────────────────────────────────
function condenseJest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, suites = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Tests: 3 failed, 12 passed, 15 total"
    const testM = line.match(/Tests:\\s*(.*)/);
    if (testM) {
      const fM = testM[1].match(/(\\d+) failed/);
      const pM = testM[1].match(/(\\d+) passed/);
      if (fM) failed = +fM[1];
      if (pM) passed = +pM[1];
    }
    // "Test Suites: 1 failed, 4 passed"
    const suiteM = line.match(/Test Suites:.*?(\\d+) failed/);
    if (suiteM) suites = +suiteM[1];
    // "● test name" opens the failure block that carries the assertion.
    const failH = line.match(/^\\s+●\\s+(.+)/);
    if (failH && !line.includes('●●')) {
      failures.push({ name: failH[1].trim(), detail: jsFailureDetail(lines.slice(i + 1, i + 30)) });
    }
  }

  if (passed === 0 && failed === 0) return text;
  const parts = [passed + ' passed'];
  if (failed > 0) parts.push(failed + ' failed' + (suites > 0 ? ' (' + suites + ' suite(s))' : ''));
  const out = ['Jest: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) {
    out.push('  FAIL: ' + f.name);
    for (const d of f.detail) out.push(d);
  }
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── playwright ────────────────────────────────────────────────────────────────
// One test can print several rows: with retries on, the FIRST attempt of a
// flaky test is printed with ✘ and its successful retry as a separate
// "(retry #1)" row. Strip the parts that differ between those rows - the list
// reporter's ordinal, the retry suffix, the duration - so the two can be
// recognised as the same test. What is left is the identity playwright itself
// prints in the tally block.
function pwTestKey(name) {
  return name
    .replace(/^\\d+\\s+/, '')
    .replace(/\\s*\\(retry\\s*#\\d+\\)/gi, '')
    .replace(/\\s*\\([\\d.]+\\s*(ms|s|m)\\)\\s*$/, '')
    .trim();
}

function condensePlaywright(text) {
  const lines = text.split('\\n');
  const failures = [];
  // Tests whose ✘ row is a first attempt that a retry recovered: playwright
  // says so twice, with the "(retry #N)" pass row and with the names it lists
  // under "N flaky" in the tally.
  const recovered = new Set();
  let passed = 0, failed = 0, flaky = 0, skipped = 0;
  let duration = '';
  let tally = '';

  for (const line of lines) {
    // "  12 passed (8.3s)" or "  3 failed"
    const pM = line.match(/(\\d+) passed(?:\\s+\\(([^)]+)\\))?/);
    const fM = line.match(/(\\d+) failed/);
    const flM = line.match(/(\\d+) flaky/);
    const sM = line.match(/(\\d+) skipped/);
    if (pM) { passed = +pM[1]; if (pM[2]) duration = pM[2]; }
    if (fM) failed  = +fM[1];
    if (flM) flaky  = +flM[1];
    if (sM) skipped = +sM[1];

    // The tally block opens a section per outcome and names its tests under it.
    const tallyM = line.match(/^\\s*\\d+\\s+(passed|failed|flaky|skipped|interrupted)\\b/);
    if (tallyM) { tally = tallyM[1]; continue; }
    if (tally === 'flaky' && /^\\s+\\S/.test(line)) { recovered.add(pwTestKey(line.trim())); continue; }

    // A pass on a retry: "  ✓  8 [chromium] › spec › name (retry #1) (2.9s)"
    const passH = line.match(/^\\s+[✓✔]\\s+(.+)/u);
    if (passH && /\\(retry\\s*#\\d+\\)/i.test(line)) recovered.add(pwTestKey(passH[1].trim()));

    // Failure line: "  ✘  test name › spec"
    const failH = line.match(/^\\s+[✘✗×]\\s+(.+)/u);
    if (failH) failures.push(failH[1].trim());
  }

  if (passed === 0 && failed === 0) return text;
  // A flaky test is not a broken one, and reporting it as FAIL contradicted the
  // very count printed above it - "2 failed" over three FAIL lines. The run's
  // own tally is the authority: when it reports no failures and does report
  // flaky ones, every ✘ row is a first attempt some retry recovered, whether or
  // not that retry's row survived into this output.
  let real = failures.filter(f => !recovered.has(pwTestKey(f)));
  if (failed === 0 && flaky > 0) real = [];

  // A test that failed its first attempt AND every retry prints one ✘ row per
  // attempt, so the rollup said "1 failed" over three identical FAIL lines - the
  // same self-contradiction as the flaky case, reached from the other side.
  // pwTestKey already strips the "(retry #N)" suffix and the duration, so the
  // identity needed to collapse them was being computed and then only used for
  // the \`recovered\` set. Keep the first attempt of each distinct test.
  const seenKey = new Set();
  real = real.filter(f => {
    const k = pwTestKey(f);
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });

  const parts = [passed + ' passed'];
  if (failed  > 0) parts.push(failed  + ' failed');
  if (flaky   > 0) parts.push(flaky   + ' flaky');
  if (skipped > 0) parts.push(skipped + ' skipped');
  const summary = 'Playwright: ' + parts.join(', ') + (duration ? ' (' + duration + ')' : '');
  const out = [summary];
  for (const f of real.slice(0, 10)) out.push('  FAIL: ' + f);
  if (real.length > 10) out.push('  ... +' + (real.length - 10) + ' more');
  return out.join('\\n');
}

// ── prettier ──────────────────────────────────────────────────────────────────

// What the invocation WAS. prettier's mode is chosen on the command line, so it
// is knowable before a byte of output exists; sniffing it back out of stdout is
// what let a single diagnostic line invert the report (see condensePrettier).
// The dispatcher does not forward argv today, so \`args\` arrives undefined and
// the shape fallback below carries the decision - but when it is passed, argv
// wins, because argv is the fact and the output is only evidence about it.
function prettierArgMode(args) {
  for (const a of (args || [])) {
    if (a === '--write' || a === '-w') return 'write';
    if (a === '-l' || a === '--list-different') return 'list';
    if (a === '--check' || a === '-c') return 'check';
  }
  return '';
}

// "<path> 21ms" / "<path> 14ms (unchanged)" - the row --write prints for each
// file it PROCESSED. Neither --check nor -l ever prints a duration, so a timed
// row is the output's own evidence of a write run.
function isPrettierTimedRow(line) {
  return /\\s\\d+(?:\\.\\d+)?ms(?:\\s+\\(unchanged\\))?$/.test(line);
}

// A diagnostic prettier emits about one file: "[error] a.ts: SyntaxError...",
// "[warn] Ignored unknown option". It is a fact ABOUT the run, never the thing
// that decides which run this was.
function isPrettierDiagnostic(line) {
  return /^\\[(?:error|warn)\\]/i.test(line.trim());
}

function condensePrettier(text, args) {
  const lines = text.split('\\n').filter(l => l.trim());
  const mode = prettierArgMode(args);
  const allGood = lines.find(l => /All matched files use Prettier/i.test(l));
  if (allGood) return 'Prettier: all files formatted';

  // \`prettier --write\` prints one row per file it PROCESSED - "<path> 21ms" for
  // the ones it rewrote, "<path> 14ms (unchanged)" for the ones it left alone.
  // Those rows survived the --check filter below and were relabelled
  // "N file(s) need formatting", which is the exact opposite of what had just
  // happened; and because the (unchanged) rows were dropped, four processed
  // files were reported as two, so the tally did not add up against the input
  // either. An agent reading that re-runs prettier, or reports failure.
  //
  // The gate on that branch used to be "EVERY line is a timed row", so one
  // \`[error]\` line anywhere in the stream took the whole run out of write mode
  // and into check mode - and the rewritten files were relabelled "need
  // formatting" with their "21ms" suffix still hanging off them. A diagnostic
  // must not be able to change what the invocation was. So the branch now
  // tolerates diagnostic lines beside the timed rows, and argv - when the caller
  // supplies it - decides outright.
  const timed = lines.filter(isPrettierTimedRow);
  const diags = lines.filter(isPrettierDiagnostic);
  if (mode !== 'check' && mode !== 'list' && timed.length > 0 &&
      (mode === 'write' || timed.length + diags.length === lines.length)) {
    const rewritten = timed.filter(l => !/\\(unchanged\\)$/.test(l.trim()));
    const kept = rewritten.map(l => l.trim().replace(/\\s+\\d+(?:\\.\\d+)?ms$/, ''));
    const parts = [rewritten.length + ' file(s) formatted'];
    if (timed.length > rewritten.length) parts.push((timed.length - rewritten.length) + ' unchanged');
    const out = ['Prettier: ' + parts.join(', ')];
    for (const f of kept.slice(0, 10)) out.push('  ' + f);
    if (kept.length > 10) out.push('  ... +' + (kept.length - 10) + ' more');
    // In a list of near-identical successes the diagnostic is the only line
    // worth reading, so it survives - bounded the way jsFailureDetail bounds a
    // failure block, so a stream full of them cannot outgrow what it replaces.
    for (const d of diags.slice(0, 3)) out.push('  ' + d.trim().slice(0, 200));
    if (diags.length > 3) out.push('  ... +' + (diags.length - 3) + ' more');
    return out.join('\\n');
  }
  // argv said --write and there is no processed-file row to roll up, so whatever
  // is here is diagnostics. Reading it as a --check report would relabel them
  // "need formatting" - the same inversion by another door.
  if (mode === 'write') return text;
  // A bare path list is the shape that gets piped into xargs; there is nothing
  // in it to condense and anything added to it breaks the pipe.
  if (mode === 'list') return text;

  // Everything below reads --check output, and --check is recognisable: it opens
  // with "Checking formatting..." and prefixes every offending path with
  // "[warn]". Without that gate this branch also swallowed \`prettier -l\` /
  // \`--list-different\`, whose output is a bare newline-separated path list whose
  // documented purpose is \`| xargs prettier --write\` - so the injected header and
  // two-space indent broke the pipe, and on a short list made the output LARGER
  // than the input. A list of paths has nothing in it to condense: hand it back.
  const isCheck = mode === 'check' ||
    lines.some(l => /^\\[(?:warn|error)\\]/i.test(l.trim()) || /^Checking formatting/i.test(l.trim()));
  if (!isCheck) return text;

  // prettier closes --check with a sentence ABOUT the list it just printed:
  //   3.x  "[warn] Code style issues found in 14 files. Run Prettier with --write to fix."
  //   2.x  "[warn] Code style issues found in the above file(s). Forgot to run Prettier?"
  // It carries the same "[warn] " prefix as the paths, so counting every
  // surviving line made the header claim one file more than prettier found and
  // printed the sentence in the list where a path belongs - a count that came
  // from this code rather than from the input.
  const unformatted = lines.filter(l =>
    !l.startsWith('Checking') && !l.startsWith('All') && !/unchanged/i.test(l) &&
    !/^\\[(?:warn|error)\\]\\s+Code style issues found\\b/i.test(l.trim()));
  if (unformatted.length > 0) {
    return 'Prettier: ' + unformatted.length + ' file(s) need formatting\\n' +
      unformatted.slice(0, 10).map(f => '  ' + f.trim()).join('\\n') +
      (unformatted.length > 10 ? '\\n  ... +' + (unformatted.length - 10) + ' more' : '');
  }
  return text;
}

// ── eslint ────────────────────────────────────────────────────────────────────

// eslint's stylish formatter prints the resolved path of each file unindented on
// a line of its own, and indents every diagnostic beneath it. Deciding "is this a
// header?" from an ALLOWLIST - of extensions (js|ts|jsx|tsx|mjs|cjs) and of path
// characters ([\\w.\\\\/-]) - is what kept reproducing this project's worst bug class,
// the fabricated zero, in this one function:
//   - .vue, .svelte, .astro, .mts and .cts are ordinary today (eslint-plugin-vue,
//     svelte-eslint-parser, typescript-eslint), and none of them was in the list;
//   - \\w holds no space, no ~, no @ and nothing non-ASCII, so a project under
//     "C:\\Users\\First Last", an 8.3 alias like BORISB~1, an @scope workspace
//     directory or "Program Files (x86)" matched no header either.
// In every one of those cases fileSet stayed empty and the rollup asserted
// "in 0 file(s)" beside a live error count - and in the mixed case (.ts plus
// .vue) it merely UNDERCOUNTED, which reads as truthful and is not.
//
// So recognise the SHAPE instead. Unindented, no run of two spaces (that is how
// the formatter separates its columns, and it is what tells a path apart from a
// sentence), ending in an extension. A header only ever becomes a counted file
// when a diagnostic follows it, so a false positive costs nothing.
//
// "ending in an extension" was still an allowlist wearing a different hat: a
// lint target with NO extension has none to end in, so it matched nothing and
// the rollup printed "in 0 file(s)" beside a live error count one last time.
// This is not exotic - a bin/cli shebang script has no suffix and is picked up
// by a flat-config \`files: ['bin/*']\` glob or by --ext. eslint's stylish
// formatter prints the RESOLVED path, so such a header always carries a
// separator; a prose line that reaches this far (unindented, no column padding)
// reads as a sentence and ends like one. That pair is the shape.
function isEslintFileHeader(line) {
  if (!line || /^\\s/.test(line)) return false;
  const t = line.trim();
  if (!t || /  /.test(t)) return false;
  if (/^[✖✗×✔✓]/u.test(t)) return false;
  if (/\\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(t)) return true;
  return /[\\/\\\\]/.test(t) && !/[.,:;!?]$/.test(t);
}

function condenseEslint(text) {
  const lines = text.split('\\n');
  let totalErrors = 0, totalWarnings = 0;
  const ruleCount = new Map();
  const fileSet = new Set();
  const fatal = [];
  let curFile = '';
  let fatalTotal = 0;

  for (const line of lines) {
    if (isEslintFileHeader(line)) { curFile = line.trim(); continue; }
    // "  10:5  error  Unexpected console statement  no-console"
    //
    // The rule id is the LAST column and the formatter pads columns apart with
    // at least two spaces. Requiring a trailing rule-id token to match at ALL
    // meant a diagnostic that carries no rule was not a diagnostic: a parse
    // error was never counted, its file was never counted ("in 0 file(s)"), and
    // the message - the entire actionable payload of that run - was deleted.
    // Worse, when the message happened to end in a bare word
    // ("Parsing error: Unexpected token") that word was captured AS the rule id
    // and the rollup announced "Top rules: token(1)", a rule that does not exist.
    // Match the diagnostic on its position and severity, which every one has,
    // and treat the trailing column as a rule only when it is separated like one
    // and shaped like one.
    const m = line.match(/^\\s+(\\d+:\\d+)\\s+(error|warning)\\s+(\\S.*?)\\s*$/);
    if (m) {
      if (curFile) fileSet.add(curFile);
      if (m[2] === 'error') totalErrors++;
      else                  totalWarnings++;
      const cols = m[3].split(/\\s{2,}/);
      const last = cols.length > 1 ? cols[cols.length - 1].trim() : '';
      if (last && /^[@\\w][\\w@/.-]*$/.test(last)) {
        ruleCount.set(last, (ruleCount.get(last) ?? 0) + 1);
      } else {
        fatalTotal++;
        // Bounded the same way jsFailureDetail bounds a failure block: three
        // entries, each clipped, so a report full of parse errors cannot grow
        // the rollup past the output it replaces.
        if (fatal.length < 3) {
          fatal.push(('  ' + (curFile ? curFile + ':' : '') + m[1] + ' ' + m[3]).slice(0, 200));
        }
      }
      continue;
    }
    // Summary line "✖ 12 problems (8 errors, 4 warnings)"
    const sumM = line.match(/✖\\s+(\\d+) problems?\\s+\\((\\d+) errors?,\\s*(\\d+) warnings?\\)/u);
    if (sumM) { totalErrors = +sumM[2]; totalWarnings = +sumM[3]; }
  }

  if (totalErrors === 0 && totalWarnings === 0) return text;
  // The last defence against the fabricated zero, and the only one that does not
  // depend on a pattern being right. Every widening above buys one more shape of
  // header; none of them can promise the NEXT shape. So make the failure mode
  // structural: if not one header was recognised, this function does not know
  // how many files offended - and "0" is not a smaller answer than "I could not
  // read it", it is a different and false one. Hand the report back whole and
  // let the agent read what eslint actually printed.
  if (fileSet.size === 0) return text;
  const topRules = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([r, n]) => r + '(' + n + ')').join(' ');
  const parts = [];
  if (totalErrors   > 0) parts.push(totalErrors   + ' errors');
  if (totalWarnings > 0) parts.push(totalWarnings + ' warnings');
  return 'ESLint: ' + parts.join(', ') + ' in ' + fileSet.size + ' file(s)' +
    (topRules ? '\\n  Top rules: ' + topRules : '') +
    (fatal.length > 0 ? '\\n' + fatal.join('\\n') : '') +
    (fatalTotal > fatal.length ? '\\n  ... +' + (fatalTotal - fatal.length) + ' more' : '');
}

// ── next build ────────────────────────────────────────────────────────────────
function condenseNext(text) {
  const lines = text.split('\\n');
  const routes = [];
  let built = false;

  for (const line of lines) {
    if (/Route \\(app\\)|Route \\(pages\\)/.test(line)) built = true;
    // Route rows. Next draws the table with box-drawing connectors at column 0
    // and has since ~9.3 ("┌ ○ /", "├ ƒ /api/checkout", "└ ○ /settings", or
    // "─ ○ /" when there is a single row), so the previous rule - leading
    // whitespace, then a marker - matched no released version and left this
    // function reporting "0 routes" for every real build. The dynamic marker is
    // λ up to 14.1 and ƒ from 14.2 on.
    //
    // Requiring the captured token to be a PATH is what keeps the rest of the
    // table out: the legend rows carry a marker but no route
    // ("ƒ  (Dynamic)  server-rendered on demand"), and the shared-chunk rows
    // carry a connector but no marker ("  ├ chunks/main-app.js").
    const rm = line.match(/^[\\s│├└┌─┬]*[○●λƒ]\\s+(\\/\\S*)/u);
    if (rm) routes.push(rm[1]);
    // Error lines
    if (/^(Error|Failed to compile|✗)/.test(line.trim())) return text;
  }

  // A table this function could not read is not a build with no routes in it.
  // Claiming a count it did not derive from the input is the one thing a
  // condenser may never do, so an unrecognised shape gets the output back
  // whole - the agent can read what Next actually printed.
  if (!built || routes.length === 0) return text;
  const out = ['Next.js build: ' + routes.length + ' routes'];
  for (const r of routes.slice(0, 20)) out.push('  ' + r);
  if (routes.length > 20) out.push('  ... +' + (routes.length - 20) + ' more');
  return out.join('\\n');
}
`

export const PYTHON_HANDLER = `
// ── pytest ────────────────────────────────────────────────────────────────────
// pytest's short summary is "FAILED <nodeid> - <reason>". Splitting on the
// first " - " truncated every parametrized id whose parameter list contains one
// (\`test_range[1 - 2]\`), leaving \`…::test_range[1\` - an unbalanced string that
// selects nothing when re-run, and identical between distinct parametrizations.
// The node id is the ONE artifact that survives the traceback being dropped, so
// it has to stay re-runnable: only a " - " outside the brackets is a separator.
function pytestNodeId(rest) {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '[') depth++;
    else if (ch === ']') { if (depth > 0) depth--; }
    else if (depth === 0 && ch === ' ' && rest.slice(i, i + 3) === ' - ') return rest.slice(0, i).trim();
  }
  return rest.trim();
}

function condensePytest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, errors = 0;

  for (const line of lines) {
    const passM = line.match(/(\\d+) passed/);
    const failM = line.match(/(\\d+) failed/);
    const errM  = line.match(/(\\d+) error/);
    if (passM) passed = +passM[1];
    if (failM) failed = +failM[1];
    if (errM)  errors = +errM[1];
    if (line.startsWith('FAILED ')) failures.push(pytestNodeId(line.slice(7)));
    if (line.startsWith('ERROR '))  failures.push('ERR:' + pytestNodeId(line.slice(6)));
  }

  if (passed === 0 && failed === 0 && errors === 0) return text;
  const parts = [passed + ' passed'];
  if (failed > 0) parts.push(failed + ' failed');
  if (errors > 0) parts.push(errors + ' error(s)');
  const out = ['Pytest: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── go test ───────────────────────────────────────────────────────────────────
function condenseGoTest(text) {
  const lines = text.split('\\n');
  const failures = [];
  const failDetail = [];
  let passed = 0, okPkgs = 0;
  const pkgLines = [];

  for (const line of lines) {
    if (line.startsWith('--- FAIL:')) failures.push(line.slice(9).trim());
    else if (/^\\s+\\S+_test\\.go:\\d+:/.test(line) && failures.length > 0) {
      failDetail.push({ owner: failures[failures.length - 1], text: line.trim() });
    }
    else if (line.startsWith('--- PASS:')) passed++;
    else if (/^(ok|FAIL)\\s/.test(line)) {
      pkgLines.push(line.trim());
      // \`go test ./...\` without -v prints NO "--- PASS:" lines at all - just one
      // "ok <pkg> <time>" per package. Counting only the -v form made every
      // non-verbose run with a failure report "0 passed" while also dropping
      // the ok lines that were the evidence to the contrary.
      if (/^ok\\s/.test(line)) okPkgs++;
    }
  }

  if (failures.length === 0) return pkgLines.join('\\n') || text;

  // Report whichever unit the run actually gave us: individual tests under -v,
  // whole packages otherwise. Saying "0 passed" because the other form was
  // absent is the fabricated-zero class.
  const unit = passed > 0 ? passed + ' tests passed' : okPkgs + ' packages ok';
  const out = ['Go test: ' + unit + ', ' + failures.length + ' failed'];
  for (const f of failures.slice(0, 10)) {
    out.push('  FAIL: ' + f);
    // The assertion line under a failure is the reason the agent is reading.
    for (const d of failDetail.filter(d => d.owner === f).slice(0, 4)) out.push('    ' + d.text);
  }
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── mypy ──────────────────────────────────────────────────────────────────────
// Groups errors by file; shows top error codes; strips note: lines
function condenseMypy(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  const byFile = new Map();
  const codeCount = new Map();
  let errors = 0, notes = 0;
  let claimed = -1;

  for (const line of lines) {
    if (line.startsWith('Success:')) continue;
    if (line.startsWith('Found ')) {
      // mypy states its own total. Keep it to check ours against below.
      const f = line.match(/^Found (\\d+) errors?\\b/);
      if (f) claimed = +f[1];
      continue;
    }
    // mypy does NOT always emit a line number: file-level diagnostics
    // ("setup.py: error: Duplicate module named ...") have none, and stub
    // errors live in .pyi files. Demanding "<file>.py:<line>:" dropped both
    // from the count, the file list AND the body, while the header went on
    // stating a total - the silent-deletion class. Line and column are both
    // optional; the extension may be .py or .pyi.
    const head = line.match(/^(.+?\\.pyi?):(?:\\d+:)*\\s*(error|note|warning):\\s*/);
    if (!head) continue;
    const file = head[1];
    const kind = head[2];
    const rest = line.slice(head[0].length);
    if (kind === 'note') { notes++; continue; }
    errors++;
    const codeM = rest.match(/\\[([\\w-]+)\\]\\s*$/);
    const entries = byFile.get(file) ?? [];
    entries.push(rest);
    byFile.set(file, entries);
    if (codeM) codeCount.set(codeM[1], (codeCount.get(codeM[1]) ?? 0) + 1);
  }

  if (byFile.size === 0) {
    const ok = lines.find(l => l.startsWith('Success:'));
    return ok ?? text;
  }

  // If mypy counted more errors than we could parse, something in this output
  // is a shape this condenser does not know. Summarising it would state a total
  // that contradicts the tool's own line - so hand back the text instead.
  if (claimed >= 0 && claimed !== errors) return text;

  const topCodes = [...codeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => c + '(' + n + ')').join(' ');
  const out = ['mypy: ' + errors + ' error(s) in ' + byFile.size + ' file(s)' + (topCodes ? '  ' + topCodes : '')];
  let shown = 0;
  for (const [file, entries] of byFile) {
    if (shown >= 30) { out.push('... +' + (errors - shown) + ' more'); break; }
    out.push(file + ' (' + entries.length + ')');
    // \`entries\` already holds the message with the "file:line: error: " prefix
    // removed at parse time - re-deriving it with a second regex is what left
    // the prefix attached on every shape the first regex did not anticipate.
    for (const e of entries.slice(0, 5)) {
      out.push('  ' + e);
      shown++;
    }
    if (entries.length > 5) out.push('  ... +' + (entries.length - 5) + ' more here');
  }
  return out.join('\\n');
}

// ── ruff ──────────────────────────────────────────────────────────────────────
// check mode: group by rule; format mode: count changed files
function condenseRuff(text, args) {
  const argv = (args ?? []).map(String);
  const isFormat = argv.indexOf('format') !== -1;

  if (isFormat) {
    // \`--diff\` prints a unified diff of what WOULD change. That diff is the
    // answer the agent asked for, and its trailing summary contains both
    // "reformatted" and "unchanged", so the line-counting branch below scored
    // one of each and replaced the whole thing with "1 reformatted,
    // 1 unchanged" - wrong counts and no diff.
    if (argv.indexOf('--diff') !== -1) return text;

    const lines = text.split('\\n').filter(l => l.trim());

    // \`--check\` lists the files it WOULD rewrite, one per line. Those paths are
    // the only actionable content a dry run has, and they were being deleted.
    const wouldPaths = [];
    for (const l of lines) {
      const w = l.match(/^Would reformat:\\s*(.+\\S)\\s*$/);
      if (w) wouldPaths.push(w[1]);
    }

    // ruff's own summary line is authoritative when present:
    // "2 files would be reformatted, 3 files left unchanged" (--check), or
    // "2 files reformatted, 3 files left unchanged" (after writing).
    // Current ruff words the second half "N files already formatted"; matching
    // only "left unchanged" reported a flat 0 for a side ruff had counted.
    const summary = lines.find(l => /\\bfiles?\\b.*\\b(reformatted|left unchanged|already formatted)\\b/.test(l));
    const sumR = summary ? summary.match(/(\\d+)\\s+files?\\s+(?:would be\\s+)?reformatted/) : null;
    const sumU = summary ? summary.match(/(\\d+)\\s+files?\\s+(left unchanged|already formatted)/) : null;

    // Prefer ruff's own counts, per field: a summary can carry one side only
    // ("3 files left unchanged" with nothing reformatted), and taking the whole
    // summary as authoritative would then report 0 for a side that has entries.
    const reformatted = sumR ? +sumR[1] : (wouldPaths.length || lines.filter(l => /^reformatted\\b/.test(l)).length);
    const unchanged   = sumU ? +sumU[1] : lines.filter(l => /^unchanged\\b/.test(l)).length;

    if (reformatted === 0 && unchanged === 0) return text;

    // Echo ruff's own noun so the second count is never relabelled.
    const restLabel = sumU && sumU[2] === 'already formatted' ? ' already formatted' : ' unchanged';

    // A dry run WROTE NOTHING. Saying "N reformatted" claims an action that did
    // not happen, in a sentence byte-identical to the one a real write produces
    // - the agent cannot tell the two apart. Say what ruff said, and keep the
    // paths (compare condensePrettier, which does the same for --check).
    if (wouldPaths.length > 0 || (summary ? /would be\\s+reformatted/.test(summary) : false)) {
      const out = ['ruff format: ' + reformatted + ' would be reformatted, ' + unchanged + restLabel];
      for (const p of wouldPaths.slice(0, 10)) out.push('  ' + p);
      if (wouldPaths.length > 10) out.push('  ... +' + (wouldPaths.length - 10) + ' more');
      return out.join('\\n');
    }
    return 'ruff format: ' + reformatted + ' reformatted, ' + unchanged + restLabel;
  }

  // check mode
  const lines = text.split('\\n').filter(l => l.trim());
  const ruleCount = new Map();
  let total = 0;
  const fileSet = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A ruff rule code is a LETTER PREFIX of one to four characters followed by
    // digits: F401, but also SIM108, PLR2004, UP035, ARG001, RUF012, ANN101,
    // PTH123, TRY300. Matching only \`[A-Z]\\d+\` dropped every multi-letter
    // prefix - which is most of the commonly enabled rule set - from the total,
    // the file set and the body at once.
    //
    // Shape 1, \`--output-format=concise\`: "path:line:col: CODE message".
    const m = line.match(/^(.+?\\.pyi?):\\d+:\\d+:\\s+([A-Z]{1,4}\\d+)\\s+/);
    if (m) {
      fileSet.add(m[1]);
      ruleCount.set(m[2], (ruleCount.get(m[2]) ?? 0) + 1);
      total++;
      continue;
    }
    // Shape 2, the CURRENT DEFAULT (\`full\`): the code leads its own line and
    // the location follows on a " --> path:line:col" line, with ~6 more lines
    // of source context and a help: hint underneath.
    //
    //   F401 [*] \`os\` imported but unused
    //    --> api/routes.py:1:8
    //
    // Understanding only shape 1 meant \`ruff check .\` - the default, on every
    // current version - fell through to raw passthrough at 0% reduction: the
    // whole ~8-lines-per-violation dump the wrapper exists to prevent.
    const head = line.match(/^([A-Z]{1,4}\\d+)(?:\\s+\\[\\*\\])?\\s+\\S/);
    const loc = head && i + 1 < lines.length ? lines[i + 1].match(/^\\s*-->\\s+(.+?):\\d+:\\d+\\s*$/) : null;
    if (head && loc) {
      fileSet.add(loc[1]);
      ruleCount.set(head[1], (ruleCount.get(head[1]) ?? 0) + 1);
      total++;
      i++;
    }
  }

  if (total === 0) {
    const ok = lines.find(l => /All checks passed/.test(l));
    return ok ?? text;
  }

  const topRules = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([r, n]) => r + '(' + n + ')').join(' ');
  return 'ruff: ' + total + ' issue(s) in ' + fileSet.size + ' file(s)  ' + topRules;
}

// ── pip ───────────────────────────────────────────────────────────────────────
// install: strip download/collecting noise; outdated: pkg (old → new)
function condensePip(text, args) {
  const sub = (args ?? [])[0] ?? '';
  if (sub === 'install') {
    const lines = text.split('\\n');
    const out = lines.filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (/^(Collecting|Downloading|Using cached|Obtaining|Building|Running setup\\.py|\\s+Preparing|\\s+Getting|Unpacking|Looking in)/.test(t)) return false;
      return true;
    });
    return out.join('\\n').trim() || text;
  }
  if (sub === 'list' && args && args.includes('--outdated')) {
    const lines = text.split('\\n');
    const out = ['pip outdated:'];
    for (const line of lines) {
      const m = line.match(/^(\\S+)\\s+(\\S+)\\s+(\\S+)/);
      if (!m || m[1] === 'Package') continue;
      // pip's default --format=columns prints a dashed separator under the
      // header whose width tracks the widest package name, so it is never
      // exactly "---". It parsed as a package and put a row for a package that
      // does not exist into the agent's context.
      if (/^-+$/.test(m[1])) continue;
      out.push('  ' + m[1] + ' (' + m[2] + ' → ' + m[3] + ')');
    }
    return out.length > 1 ? out.join('\\n') : text;
  }
  return text;
}
`

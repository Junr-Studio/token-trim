export const PYTHON_HANDLER = `
// ── pytest ────────────────────────────────────────────────────────────────────
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
    if (line.startsWith('FAILED ')) failures.push(line.slice(7).split(' - ')[0].trim());
    if (line.startsWith('ERROR '))  failures.push('ERR:' + line.slice(6).split(' - ')[0].trim());
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
  let passed = 0;
  const pkgLines = [];

  for (const line of lines) {
    if (line.startsWith('--- FAIL:')) failures.push(line.slice(9).trim());
    else if (line.startsWith('--- PASS:')) passed++;
    else if (/^(ok|FAIL)\\s/.test(line)) pkgLines.push(line.trim());
  }

  if (failures.length === 0) return pkgLines.join('\\n') || text;
  const out = ['Go test: ' + passed + ' passed, ' + failures.length + ' failed'];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
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

  for (const line of lines) {
    if (line.startsWith('Found ') || line.startsWith('Success:')) continue;
    const m = line.match(/^([^:]+\\.py):(\\d+):\\s*(error|note|warning):\\s*(.+?)(?:\\s*\\[([\\w-]+)\\])?$/);
    if (!m) continue;
    const [, file, , kind, , code] = m;
    if (kind === 'note') { notes++; continue; }
    errors++;
    const entries = byFile.get(file) ?? [];
    entries.push(line);
    byFile.set(file, entries);
    if (code) codeCount.set(code, (codeCount.get(code) ?? 0) + 1);
  }

  if (byFile.size === 0) {
    const ok = lines.find(l => l.startsWith('Success:'));
    return ok ?? text;
  }

  const topCodes = [...codeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => c + '(' + n + ')').join(' ');
  const out = ['mypy: ' + errors + ' error(s) in ' + byFile.size + ' file(s)' + (topCodes ? '  ' + topCodes : '')];
  let shown = 0;
  for (const [file, entries] of byFile) {
    if (shown >= 30) { out.push('... +' + (errors - shown) + ' more'); break; }
    out.push(file + ' (' + entries.length + ')');
    for (const e of entries.slice(0, 5)) {
      const short = e.replace(/^[^:]+:\\d+:\\s*(?:error|warning):\\s*/, '  ');
      out.push(short);
      shown++;
    }
    if (entries.length > 5) out.push('  ... +' + (entries.length - 5) + ' more here');
  }
  return out.join('\\n');
}

// ── ruff ──────────────────────────────────────────────────────────────────────
// check mode: group by rule; format mode: count changed files
function condenseRuff(text, args) {
  const isFormat = args && args.includes('format');
  if (isFormat) {
    const lines = text.split('\\n').filter(l => l.trim());
    const reformatted = lines.filter(l => /reformatted/.test(l)).length;
    const unchanged   = lines.filter(l => /unchanged/.test(l)).length;
    if (reformatted === 0 && unchanged === 0) return text;
    return 'ruff format: ' + reformatted + ' reformatted, ' + unchanged + ' unchanged';
  }

  // check mode
  const lines = text.split('\\n').filter(l => l.trim());
  const ruleCount = new Map();
  let total = 0;
  const fileSet = new Set();

  for (const line of lines) {
    const m = line.match(/^([^:]+\\.py):\\d+:\\d+:\\s+([A-Z]\\d+)\\s+/);
    if (!m) continue;
    fileSet.add(m[1]);
    ruleCount.set(m[2], (ruleCount.get(m[2]) ?? 0) + 1);
    total++;
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
      if (!m || m[1] === 'Package' || m[1] === '---') continue;
      out.push('  ' + m[1] + ' (' + m[2] + ' → ' + m[3] + ')');
    }
    return out.length > 1 ? out.join('\\n') : text;
  }
  return text;
}
`

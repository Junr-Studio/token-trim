export const JS_TOOLS_HANDLER = `
// ── vitest ────────────────────────────────────────────────────────────────────
function condenseVitest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, skipped = 0;

  for (const line of lines) {
    const pM = line.match(/(\\d+)\\s+passed/);
    const fM = line.match(/(\\d+)\\s+failed/);
    const sM = line.match(/(\\d+)\\s+skipped/);
    if (pM) passed = +pM[1];
    if (fM) failed = +fM[1];
    if (sM) skipped = +sM[1];

    // "● describe > test name" or "× test name"
    const failH = line.match(/^\\s*(×|●)\\s+(.+)/);
    if (failH) failures.push(failH[2].trim());
  }

  if (passed === 0 && failed === 0) return text;
  const parts = [passed + ' passed'];
  if (failed  > 0) parts.push(failed  + ' failed');
  if (skipped > 0) parts.push(skipped + ' skipped');
  const out = ['Vitest: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── jest ──────────────────────────────────────────────────────────────────────
function condenseJest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, suites = 0;

  for (const line of lines) {
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
    // "● test name"
    const failH = line.match(/^\\s+●\\s+(.+)/);
    if (failH && !line.includes('●●')) failures.push(failH[1].trim());
  }

  if (passed === 0 && failed === 0) return text;
  const parts = [passed + ' passed'];
  if (failed > 0) parts.push(failed + ' failed' + (suites > 0 ? ' (' + suites + ' suite(s))' : ''));
  const out = ['Jest: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── playwright ────────────────────────────────────────────────────────────────
function condensePlaywright(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, flaky = 0, skipped = 0;
  let duration = '';

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

    // Failure line: "  ✘  test name › spec"
    const failH = line.match(/^\\s+[✘✗×]\\s+(.+)/u);
    if (failH) failures.push(failH[1].trim());
  }

  if (passed === 0 && failed === 0) return text;
  const parts = [passed + ' passed'];
  if (failed  > 0) parts.push(failed  + ' failed');
  if (flaky   > 0) parts.push(flaky   + ' flaky');
  if (skipped > 0) parts.push(skipped + ' skipped');
  const summary = 'Playwright: ' + parts.join(', ') + (duration ? ' (' + duration + ')' : '');
  const out = [summary];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── prettier ──────────────────────────────────────────────────────────────────
function condensePrettier(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  const unformatted = lines.filter(l => !l.startsWith('Checking') && !l.startsWith('All') && !/unchanged/i.test(l));
  const allGood = lines.find(l => /All matched files use Prettier/i.test(l));
  if (allGood) return 'Prettier: all files formatted';
  if (unformatted.length > 0) {
    return 'Prettier: ' + unformatted.length + ' file(s) need formatting\\n' +
      unformatted.slice(0, 10).map(f => '  ' + f.trim()).join('\\n') +
      (unformatted.length > 10 ? '\\n  ... +' + (unformatted.length - 10) + ' more' : '');
  }
  return text;
}

// ── eslint ────────────────────────────────────────────────────────────────────
function condenseEslint(text) {
  const lines = text.split('\\n');
  let totalErrors = 0, totalWarnings = 0;
  const ruleCount = new Map();
  const fileSet = new Set();
  let curFile = '';

  for (const line of lines) {
    // File header line (absolute path, no leading whitespace)
    if (/^\\/?([\\w./-]+\\.(js|ts|jsx|tsx|mjs|cjs))$/.test(line.trim())) {
      curFile = line.trim();
      continue;
    }
    // "  10:5  error  rule-name" or "  10:5  warning  rule-name"
    const m = line.match(/^\\s+\\d+:\\d+\\s+(error|warning)\\s+.+?\\s+([@\\w/-]+)\\s*$/);
    if (m) {
      if (curFile) fileSet.add(curFile);
      ruleCount.set(m[2], (ruleCount.get(m[2]) ?? 0) + 1);
      if (m[1] === 'error')   totalErrors++;
      else                    totalWarnings++;
    }
    // Summary line "✖ 12 problems (8 errors, 4 warnings)"
    const sumM = line.match(/✖\\s+(\\d+) problems?\\s+\\((\\d+) errors?,\\s*(\\d+) warnings?\\)/u);
    if (sumM) { totalErrors = +sumM[2]; totalWarnings = +sumM[3]; }
  }

  if (totalErrors === 0 && totalWarnings === 0) return text;
  const topRules = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([r, n]) => r + '(' + n + ')').join(' ');
  const parts = [];
  if (totalErrors   > 0) parts.push(totalErrors   + ' errors');
  if (totalWarnings > 0) parts.push(totalWarnings + ' warnings');
  return 'ESLint: ' + parts.join(', ') + ' in ' + fileSet.size + ' file(s)' +
    (topRules ? '\\n  Top rules: ' + topRules : '');
}

// ── next build ────────────────────────────────────────────────────────────────
function condenseNext(text) {
  const lines = text.split('\\n');
  const routes = [];
  let built = false;

  for (const line of lines) {
    if (/Route \\(app\\)|Route \\(pages\\)/.test(line)) built = true;
    // Route lines: "  ○  /path  (N kB)"
    const rm = line.match(/^\\s+[○●λ]\\s+(\\S+)/u);
    if (rm) routes.push(rm[1]);
    // Error lines
    if (/^(Error|Failed to compile|✗)/.test(line.trim())) return text;
  }

  if (!built) return text;
  const out = ['Next.js build: ' + routes.length + ' routes'];
  for (const r of routes.slice(0, 20)) out.push('  ' + r);
  if (routes.length > 20) out.push('  ... +' + (routes.length - 20) + ' more');
  return out.join('\\n');
}
`

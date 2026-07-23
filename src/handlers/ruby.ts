export const RUBY_HANDLER = `
// ── rspec ─────────────────────────────────────────────────────────────────────
// Group failures; emit summary "RSpec: N examples, M failures"
function condenseRspec(text) {
  const lines = text.split('\\n');
  const failures = [];
  let examples = 0, failed = 0, pending = 0;

  for (const line of lines) {
    const exM = line.match(/(\\d+) example/);
    const faM = line.match(/(\\d+) failure/);
    const peM = line.match(/(\\d+) pending/);
    if (exM && line.includes('example')) examples = +exM[1];
    if (faM && line.includes('failure')) failed = +faM[1];
    if (peM && line.includes('pending')) pending = +peM[1];

    // Failure block header: "  1) DescriptionText"
    const failH = line.match(/^\\s{1,4}\\d+\\)\\s+(.+)/);
    if (failH && !line.includes('rspec')) failures.push(failH[1].trim());
  }

  if (examples === 0 && failed === 0) return text;
  const parts = [examples + ' examples'];
  if (failed  > 0) parts.push(failed + ' failures');
  if (pending > 0) parts.push(pending + ' pending');
  const out = ['RSpec: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}

// ── rubocop ───────────────────────────────────────────────────────────────────
// Group by severity; emit "rubocop: N offenses in M files"
function condenseRubocop(text) {
  const lines = text.split('\\n');
  const byFile = new Map();
  const sevCount = new Map();
  let total = 0;

  for (const line of lines) {
    // Format: path/to/file:10:5: C: Layout/... description
    //
    // The path is NOT anchored to ".rb". RuboCop's default AllCops/Include
    // covers **/*.rake, **/Rakefile, **/Gemfile, **/*.gemspec and **/*.ru too,
    // so a mixed offence list is the norm in a Rails repo. Requiring ".rb" here
    // dropped those rows from the body, from the severity histogram AND from
    // the total - and since this condenser replaces the whole output, RuboCop's
    // own "N offenses detected" line went with them, leaving the undercount
    // silent. An E: Lint/Syntax in a Gemfile then vanishes from the report an
    // agent uses to decide the lint is clean.
    const m = line.match(/^([^:]+):\\d+:\\d+:\\s+([CWEF]):\\s+(.+)/);
    if (!m) continue;
    total++;
    const [, file, sev] = m;
    const entries = byFile.get(file) ?? [];
    entries.push(line);
    byFile.set(file, entries);
    sevCount.set(sev, (sevCount.get(sev) ?? 0) + 1);
  }

  if (total === 0) {
    const ok = lines.find(l => /no offenses detected/i.test(l));
    return ok ?? text;
  }

  const sevStr = ['E', 'W', 'C', 'F'].filter(s => sevCount.has(s))
    .map(s => s + ':' + sevCount.get(s)).join(' ');
  const out = ['rubocop: ' + total + ' offense(s) in ' + byFile.size + ' file(s)  [' + sevStr + ']'];
  let shown = 0;
  for (const [file, entries] of byFile) {
    if (shown >= 30) { out.push('... +' + (total - shown) + ' more'); break; }
    out.push(file + ' (' + entries.length + ')');
    for (const e of entries.slice(0, 4)) {
      const short = e.replace(/^[^:]+:\\d+:\\d+:\\s+[CWEF]:\\s+/, '  ');
      out.push(short);
      shown++;
    }
    if (entries.length > 4) out.push('  ... +' + (entries.length - 4) + ' more here');
  }
  return out.join('\\n');
}

// ── rake (minitest) ───────────────────────────────────────────────────────────
// State machine: watch for Minitest summary line
function condenseRake(text) {
  const lines = text.split('\\n');
  const out = [];

  for (const line of lines) {
    // Drop rake internal progress noise but keep errors/warnings
    if (/^(rake|Rakefile|\\(in \\/)/.test(line.trim())) continue;

    // Minitest summary: "X runs, Y assertions, Z failures, W errors, V skips"
    const m = line.match(/(\\d+) runs,\\s*(\\d+) assertions,\\s*(\\d+) failures,\\s*(\\d+) errors,\\s*(\\d+) skips/);
    if (m) {
      const [, runs, , failures, errors, skips] = m;
      const parts = [runs + ' runs'];
      if (+failures > 0) parts.push(failures + ' failures');
      if (+errors   > 0) parts.push(errors   + ' errors');
      if (+skips    > 0) parts.push(skips    + ' skips');
      out.push('rake test: ' + parts.join(', '));
      continue;
    }

    if (line.trim()) out.push(line);
  }

  return ttTrimBlankEdges(out.join('\\n')) || text;
}
`

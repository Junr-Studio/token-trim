export const CARGO_HANDLER = `
// ── cargo ─────────────────────────────────────────────────────────────────────
function condenseCargo(text, sub) {
  if (sub === 'test') return condenseCargoTest(text);
  // build / check / clippy: strip compilation noise, keep errors + warnings
  const NOISE = /^\\s*(Compiling|Downloaded|Downloading|Updating|Blocking|Locking|Fetching|Resolving|Fresh)\\s/;
  const lines = text.split('\\n').filter(l => !NOISE.test(l));
  return lines.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
}

function condenseCargoTest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0;
  let inFailure = false, failName = '', failLines = [];

  for (const line of lines) {
    const resultM = line.match(/test result:.*?(\\d+) passed;\\s*(\\d+) failed/);
    if (resultM) { passed = +resultM[1]; failed = +resultM[2]; continue; }
    if (line.startsWith('---- ') && line.endsWith(' stdout ----')) {
      if (inFailure) failures.push({ name: failName, lines: failLines });
      failName = line.slice(5, -12).trim(); failLines = []; inFailure = true; continue;
    }
    if (inFailure && line.trim()) failLines.push(line);
  }
  if (inFailure) failures.push({ name: failName, lines: failLines });

  if (failures.length === 0 && passed === 0) return text;
  const out = ['Cargo test: ' + passed + ' passed, ' + failed + ' failed'];
  for (const f of failures.slice(0, 5)) {
    out.push('  FAIL: ' + f.name);
    for (const l of f.lines.filter(x => x.trim()).slice(0, 6))
      out.push('    ' + l.slice(0, 120));
  }
  if (failures.length > 5) out.push('  ... +' + (failures.length - 5) + ' more');
  return out.join('\\n');
}
`

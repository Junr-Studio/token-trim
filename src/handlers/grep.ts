export const GREP_HANDLER = `
// ── grep / rg ─────────────────────────────────────────────────────────────────
// Groups matches by file, caps at 20 per file, truncates long match lines.
function groupGrep(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  const byFile = new Map();
  for (const line of lines) {
    const m = line.match(/^([^:]+):(\\d+):(.*)$/) ?? line.match(/^([^:]+):(.*)$/);
    if (m) {
      const f = m[1];
      const e = byFile.get(f) ?? [];
      e.push(m.slice(2).join(':').trim());
      byFile.set(f, e);
    }
  }
  if (byFile.size <= 1 && lines.length < 10) return text;
  const total = [...byFile.values()].reduce((s, a) => s + a.length, 0);
  const out = [total + ' matches in ' + byFile.size + ' file(s)'];
  for (const [f, matches] of byFile) {
    out.push(f + '  (' + matches.length + ')');
    for (const m of matches.slice(0, 20)) out.push('  ' + m.slice(0, 120));
    if (matches.length > 20) out.push('  ... +' + (matches.length - 20) + ' more');
  }
  return out.join('\\n');
}
`

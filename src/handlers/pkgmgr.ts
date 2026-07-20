export const PKGMGR_HANDLER = `
// ── npm / pnpm / yarn install ─────────────────────────────────────────────────
// Keep only meaningful output; strip download progress, spinners, timing lines.
function stripPkgNoise(text) {
  const SPINNER = /[⠀-⣿]/u;
  const lines = text.split('\\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (SPINNER.test(line)) continue;
    if (/^(npm (warn |notice |info |timing|WARN )|> .+@\\d|\\s*Progress:|Downloading|Fetching|Resolving:|Packages are hard linked|\\s*packages\\/installed|node_modules\\/.pnpm)/.test(line)) continue;
    out.push(line);
  }
  return out.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
}

// ── npm / pnpm / yarn audit ───────────────────────────────────────────────────
// All severity levels, nothing else.
function condensePkgAudit(text) {
  // JSON mode (npm audit --json)
  try {
    const json = JSON.parse(text);
    const v = json.metadata?.vulnerabilities ?? json.vulnerabilities;
    if (v && typeof v === 'object') {
      const order = ['critical', 'high', 'moderate', 'low', 'info'];
      const parts = order.filter(s => (v[s] ?? 0) > 0).map(s => v[s] + ' ' + s);
      const total = order.reduce((n, s) => n + (v[s] ?? 0), 0);
      return total === 0 ? 'audit: 0 vulnerabilities'
                         : 'audit: ' + parts.join(', ') + ' (' + total + ' total)';
    }
  } catch {}

  // Plain text mode
  const lines = text.split('\\n');
  const counts = {};
  const order  = ['critical', 'high', 'moderate', 'low', 'info'];

  for (const line of lines) {
    for (const sev of order) {
      const m = line.match(new RegExp('(\\\\d+)\\\\s+' + sev, 'i'));
      if (m) counts[sev] = Math.max(counts[sev] ?? 0, +m[1]);
    }
  }

  const parts = order.filter(s => (counts[s] ?? 0) > 0).map(s => counts[s] + ' ' + s);
  if (parts.length === 0) {
    const ok = lines.find(l => /found 0 vulnerabilities|No known vulnerabilities/i.test(l));
    return ok?.trim() ?? text;
  }
  const total = order.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return 'audit: ' + parts.join(', ') + ' (' + total + ' total)';
}
`

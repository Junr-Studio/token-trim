export const SYSTEM_HANDLER = `
// ── ls ────────────────────────────────────────────────────────────────────────
// Strips permission/owner/date columns; filters noise dirs; shows ext summary.
function condenseLs(text) {
  const LS_NOISE_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '.next', '.nuxt', '__pycache__', '.cache', 'coverage', '.turbo', 'vendor', '.venv', 'venv']);
  const lines = text.split('\\n').filter(l => l.trim() && !/^total\\s/.test(l));
  if (lines.length === 0) return text;

  const out = [];
  const extCount = new Map();
  let dirs = 0, files = 0;

  for (const line of lines) {
    const isDir = line.startsWith('d');
    // Extract name: take everything after the last date/time token
    const nameM = line.match(/(?:\\d{2}:\\d{2}|\\d{4})\\s+(.+)$/);
    const name = (nameM ? nameM[1] : line.trim().split(/\\s+/).pop() ?? '').trim();
    if (!name || name === '.' || name === '..') continue;
    if (isDir && LS_NOISE_DIRS.has(name)) continue;

    if (isDir) {
      dirs++;
      out.push(name + '/');
    } else {
      files++;
      const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
      if (ext) extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
      // Extract size (bytes number before month name)
      const sizeM = line.match(/\\s(\\d+)\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
      const size = sizeM ? ' (' + lsFormatBytes(+sizeM[1]) + ')' : '';
      out.push(name + size);
    }
  }

  if (out.length === 0) return text;
  const topExt = [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([e, n]) => '.' + e + '(' + n + ')').join(' ');
  const summary = files + ' files, ' + dirs + ' dirs' + (topExt ? '  ' + topExt : '');
  const body = out.slice(0, 50);
  if (out.length > 50) body.push('... +' + (out.length - 50) + ' more');
  return [summary, ...body].join('\\n');
}

function lsFormatBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1048576) return (n / 1024).toFixed(0) + 'KB';
  return (n / 1048576).toFixed(1) + 'MB';
}

// ── find ──────────────────────────────────────────────────────────────────────
// Groups results by directory with extension summary; truncates at 50 shown.
function condenseFind(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length <= 10) return text;

  const byDir = new Map();
  const extCount = new Map();

  for (const line of lines) {
    const slash = line.lastIndexOf('/');
    const dir  = slash >= 0 ? (line.slice(0, slash) || '.') : '.';
    const name = slash >= 0 ? line.slice(slash + 1) : line;
    const entries = byDir.get(dir) ?? [];
    entries.push(name);
    byDir.set(dir, entries);
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      const ext = name.slice(dot + 1);
      extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
    }
  }

  const total = lines.length;
  const extSummary = [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([e, n]) => '.' + e + '(' + n + ')').join(' ');
  const out = [total + ' results in ' + byDir.size + ' dir(s)' + (extSummary ? '  ' + extSummary : '')];

  let shown = 0;
  for (const [dir, names] of byDir) {
    if (shown >= 50) { out.push('... +' + (total - shown) + ' more'); break; }
    out.push(dir + '/  (' + names.length + ')');
    for (const name of names.slice(0, 8)) { out.push('  ' + name); shown++; }
    if (names.length > 8) out.push('  ... +' + (names.length - 8) + ' more here');
  }
  return out.join('\\n');
}
`

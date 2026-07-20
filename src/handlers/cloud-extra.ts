export const CLOUD_EXTRA_HANDLER = `
// ── aws cli ───────────────────────────────────────────────────────────────────
// Shorten ARNs; truncate ISO timestamps; cap list output at 20 items
function condenseAws(text) {
  let out = text;

  // Shorten ARNs: arn:aws:service:region:acct:resource → arn:…:resource
  out = out.replace(/arn:aws:[\\w-]+:[\\w-]*:[\\d]*:([^\\s"',}\\]]+)/g, 'arn:…:$1');

  // Truncate ISO timestamps to date: "2024-03-15T12:34:56.789Z" → "2024-03-15"
  out = out.replace(/(\\d{4}-\\d{2}-\\d{2})T\\d{2}:\\d{2}:\\d{2}[.\\d]*Z/g, '$1');

  // Cap list output
  const lines = out.split('\\n');
  if (lines.length > 40) {
    return lines.slice(0, 40).join('\\n') + '\\n... +' + (lines.length - 40) + ' more lines (aws output truncated)';
  }
  return out.trim();
}

// ── psql ──────────────────────────────────────────────────────────────────────
// Strip separator lines; cap rows at 50; detect expanded mode
function condensePsql(text) {
  const lines = text.split('\\n');
  const out = [];
  let rowCount = 0;
  let skipping = false;
  let isExpanded = false;

  for (const line of lines) {
    // Detect expanded display
    if (line.trim() === '-[ RECORD 1 ]' || /^-\\[ RECORD \\d+ \\]/.test(line)) {
      isExpanded = true;
    }

    if (isExpanded) {
      // In expanded mode: keep record headers + non-separator lines; cap at 30 records
      if (/^-\\[ RECORD (\\d+) \\]/.test(line)) {
        const recNum = +line.match(/\\[ RECORD (\\d+) \\]/)[1];
        if (recNum > 30) { skipping = true; }
        else             { skipping = false; out.push(line); }
      } else if (!skipping && line.trim()) {
        out.push(line);
      }
      continue;
    }

    // Regular table mode: skip separator lines (dashes/plusses)
    if (/^[-+|]+$/.test(line.trim())) continue;

    // Count data rows (have leading/trailing pipes)
    if (/^\\s*\\|/.test(line) || /\\|\\s*$/.test(line)) rowCount++;

    if (rowCount > 50) {
      if (!skipping) {
        skipping = true;
        out.push('... (rows truncated, showing first 50)');
      }
      continue;
    }

    if (line.trim()) out.push(line);
  }

  return out.join('\\n').trim() || text;
}
`

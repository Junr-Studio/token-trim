export const CLOUD_EXTRA_HANDLER = `
// ── aws cli ───────────────────────────────────────────────────────────────────
// The aws CLI's DEFAULT output format is JSON, with no flag on the command line
// to say so - so \`isMachineOutput\` cannot see it and \`aws … | jq\` is the normal
// way to consume it. Detect the shape from the payload instead, and keep it
// valid: re-serialising compactly is lossless and typically halves the size,
// where a line cap leaves an unterminated document.
function condenseAws(text) {
  // Trimmed for SNIFFING (a leading space must not hide the '{'); the
  // passthrough hands back the body with only its blank edges removed.
  const t = text.trim();
  const kept = ttTrimBlankEdges(text);
  if (!t) return text;

  if (t.charAt(0) === '{' || t.charAt(0) === '[') {
    try {
      const compact = JSON.stringify(JSON.parse(t));
      return compact.length < t.length ? compact : kept;
    } catch {
      return kept; // looked like JSON but is not - do not guess
    }
  }

  // Text / table output. Only timestamps are safe to shorten: an ARN's account
  // id and region are what identify the resource, and two rows can differ ONLY
  // in the account, so collapsing "arn:aws:iam::123456789012:role/x" to
  // "arn:…:role/x" merges rows that are not the same thing.
  // Built from \`kept\`, not \`t\`: an aws table right-aligns its first column, so
  // the leading run of spaces on the header row is alignment, not chrome.
  let out = kept.replace(/(\\d{4}-\\d{2}-\\d{2})T\\d{2}:\\d{2}:\\d{2}[.\\d]*Z/g, '$1');

  const lines = out.split('\\n');
  if (lines.length > 40) {
    return lines.slice(0, 40).join('\\n') +
      '\\n... +' + (lines.length - 40) + ' more lines (truncated - re-run with __TT_FULL_FLAG__)';
  }
  return out;
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

  return ttTrimBlankEdges(out.join('\\n')) || text;
}
`

export const HTTP_HANDLER = `
// ── curl ──────────────────────────────────────────────────────────────────────
// Truncates long responses; agents rarely need > 2k chars of raw HTTP response.
function condenseCurl(text) {
  const t = text.trim();
  const MAX = 2000;
  if (t.length <= MAX) return t;
  return t.slice(0, MAX) + '\\n... (' + t.length + ' bytes total, truncated)';
}

// ── wget ──────────────────────────────────────────────────────────────────────
// Strips progress bars and verbose headers; keeps the actual downloaded content.
function condenseWget(text) {
  const NOISE = /^(\\s*[0-9]+[KMG.%]|--[0-9]{4}-[0-9]{2}-[0-9]{2}|Resolving |Connecting to|HTTP request sent|Saving to:|Length:|\\s*$)/;
  const lines = text.split('\\n').filter(l => !NOISE.test(l));
  return lines.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
}
`

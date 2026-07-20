export const JQ_HANDLER = `
// ── jq ────────────────────────────────────────────────────────────────────────
// Compresses large JSON output; passes through small/scalar results intact.
function condenseJq(text) {
  const lines = text.split('\\n');
  if (lines.length <= 20) return text;

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed) && parsed.length > 5) {
      const schema  = jsonSchema(parsed[0]);
      const preview = JSON.stringify(parsed.slice(0, 5), null, 2);
      return '[' + parsed.length + ' items' + (schema ? '  schema: ' + schema : '') + ']\\n' +
        preview + '\\n... +' + (parsed.length - 5) + ' more items';
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length > 20) {
        const preview = {};
        for (const k of keys.slice(0, 20)) preview[k] = parsed[k];
        return '{' + keys.length + ' keys}\\n' + JSON.stringify(preview, null, 2) +
          '\\n... +' + (keys.length - 20) + ' more keys';
      }
    }
  } catch {}

  // Non-JSON or already-compact output longer than 50 lines: truncate
  return lines.slice(0, 50).join('\\n') +
    (lines.length > 50 ? '\\n... +' + (lines.length - 50) + ' more lines' : '');
}
`

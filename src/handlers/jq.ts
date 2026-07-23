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

  // Output that is not ONE json document is one of two very different shapes:
  //
  //   \`jq -r '.[].email'\` / \`jq -c '.[]'\`  → one self-contained record per line,
  //                                          a data list headed for another
  //                                          program, safe to cap;
  //   \`jq '.[] file.json'\`                 → jq's DEFAULT multi-document stream:
  //                                          a sequence of pretty-printed values
  //                                          spanning several lines each.
  //
  // ttCapDataList cuts whole LINES out of the middle, and its own contract is a
  // list whose every line is an independent record. On a pretty-printed stream
  // that precondition does not hold: the cut lands inside an object, whole
  // documents disappear and the survivor loses its opening brace, so stdout
  // carries syntactically corrupt JSON presented as jq's answer. Deleting
  // records is compression; emitting JSON jq never produced is invention.
  //
  // So the cap applies only to the flat shape, and the stream is handed back
  // whole. Passing it through costs compression and cannot corrupt anything.
  if (!jqIsFlatValueList(lines)) return text;

  // Cap it, but disclose out of band: an inline "... +N more lines" would be
  // read as one more value.
  const capped = ttCapDataList(lines, 40, 10, 'lines');
  return capped === lines ? text : capped.join('\\n');
}

// True only when every line stands alone, so dropping any subset of lines
// leaves the rest exactly as jq printed it. Pretty-printed output fails on the
// indentation of its inner fields and on its bare closing brace - both of which
// mean the line belongs to a record that continues above or below it. Compact
// \`-c\` documents ("{"id":1,...}") and \`-r\` raw values start at column 0 and
// carry their whole record, so they pass.
function jqIsFlatValueList(lines) {
  for (const raw of lines) {
    if (raw === '') continue;
    if (/^[ \\t]/.test(raw)) return false;
    if (/^[}\\]],?$/.test(raw)) return false;
  }
  return true;
}
`

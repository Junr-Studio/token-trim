export const SYSTEM_HANDLER = `
// Parses ONE \`ls -l\` row into { isDir, name, size }, or null if the line is not
// long format. Anchoring on the mode string (type flag + 9 permission chars) is
// what makes the distinction reliable: without it, plain \`ls\` output was read
// as long format and every name starting with "d" became a directory.
//
// The name is taken as everything after the timestamp field, so names
// containing spaces survive. Both the classic ("Jul 22 10:00" / "Jul 22 2025")
// and the ISO ("2026-07-22 10:00") time styles are recognised - matching the
// timestamp explicitly is what stops a 4-digit SIZE from being mistaken for a
// year, which used to leave the whole date glued to the front of the name. The
// ISO form is tried FIRST so its leading "2026-07-22" can never be consumed as
// a month token by the classic alternative.
//
// SIZE accepts the human-readable forms too ("1.2K", "12K", "2.4M", BSD's
// "340B"). It used to be a bare \\d+, which \`ls -lh\`/\`ls -lah\` - arguably the
// most common long-format invocation there is - cannot satisfy. Real -h output
// is MIXED, because sub-1K files still print bare digits, so some rows parsed
// and some did not and the "unparsed > 0" bail below then returned the whole
// listing untouched: all of the cost of the wrapper and none of the saving.
//
// MONTH is a token rather than \\w{3}: \\w is ASCII-only, so every non-English
// locale ("janv. 22 10:00") failed the same way. It still has to be followed by
// a day and a clock-or-year, which is what keeps it from swallowing a name.
function lsParseLongRow(line) {
  const m = line.match(
    /^([-dlbcpsD])[rwxsStT-]{9}[+@.]?\\s+\\d+\\s+\\S+\\s+(?:\\S+\\s+)?(\\d+(?:[.,]\\d+)?[KMGTPEZ]?i?B?)\\s+(?:\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?(?:\\s+[+-]\\d{4})?|\\S{1,12}\\s+\\d{1,2}\\s+(?:\\d{2}:\\d{2}|\\d{4}))\\s+(.+)$/
  );
  if (!m) return null;
  return { isDir: m[1] === 'd', size: m[2], name: m[3].trim() };
}

// ── ls ────────────────────────────────────────────────────────────────────────
// Strips permission/owner/date columns and shows an ext summary. Only engages
// for genuine \`ls -l\` output: a bare name list carries no type or size
// information, so there is nothing to strip and inventing a rollup for it would
// report directories and counts that do not exist.
//
// NOTHING IS FILTERED. There used to be a noise-dir list (node_modules, .git,
// dist, target, coverage, vendor, ...) whose entries were dropped from the body
// AND from the \`dirs\` tally, so a listing that contained eight directories
// announced five and showed none of the three it had deleted. \`ls -la\` is run
// to find out WHAT IS THERE - "did the build write a dist/", "is node_modules
// installed" - and a deletion is read as an answer, so this filter did not
// compress the output, it changed it. Every row \`ls\` printed is relayed and
// counted; the per-row saving from a shorter listing is a handful of characters
// and the 50-entry cap already bounds the total.
function condenseLs(text) {
  const lines = text.split('\\n').filter(l => l.trim() && !/^total\\s/.test(l));
  if (lines.length === 0) return text;

  const rows = [];
  let unparsed = 0;
  for (const line of lines) {
    const row = lsParseLongRow(line);
    if (row) rows.push(row);
    else unparsed++;
  }

  // Not long format (plain \`ls\`, \`ls -1\`, a "==> dir <==" banner, an error):
  // pass it through. It is already one short name per line.
  if (rows.length === 0) return text;

  // \`ls -la dist src\` prints a "dist:" / "src:" banner before each listing.
  // Those lines do not parse as rows, and dropping them merges two directories
  // into one flat list - so "is index.ts in src or in dist?", the question the
  // agent ran \`ls\` to answer, becomes unanswerable from the output. Rather than
  // track which banner owns which run, hand the whole thing back: a multi-target
  // listing is a shape this condenser does not model.
  if (unparsed > 0) return text;

  const out = [];
  const extCount = new Map();
  let dirs = 0, files = 0;

  for (const row of rows) {
    const name = row.name;
    if (!name || name === '.' || name === '..') continue;

    if (row.isDir) {
      dirs++;
      out.push(name + '/');
    } else {
      files++;
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1) : '';
      if (ext) extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
      out.push(name + ' (' + lsFormatSize(row.size) + ')');
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

// A raw byte count is humanised; a size \`ls -h\` already humanised is relayed
// exactly as ls printed it. Re-deriving one from the other would either invent
// precision ls did not have ("1.2K" is not 1228 bytes) or restate the same
// value in a different unit, and neither is this condenser's business.
function lsFormatSize(s) {
  return /^\\d+$/.test(String(s)) ? lsFormatBytes(+s) : String(s);
}

function lsFormatBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1048576) return (n / 1024).toFixed(0) + 'KB';
  return (n / 1048576).toFixed(1) + 'MB';
}

// ── find ──────────────────────────────────────────────────────────────────────
// \`find\` emits a PATH LIST, and \`find . -name '*.ts' | xargs prettier --write\`
// is the reason anyone runs it. It used to be regrouped under per-directory
// headers with the basenames indented beneath - which reads beautifully and is
// unusable: every line of that output is either a header, an indented fragment,
// or a marker, and not one of them is a path the pipe can consume.
//
// So it is capped, never reshaped: the paths that survive are byte-identical
// lines that \`find\` really printed, and the elision is disclosed out of band.
function condenseFind(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length <= 10) return text;
  const capped = ttCapDataList(lines, 40, 20, 'paths');
  return capped === lines ? text : capped.join('\\n');
}
`

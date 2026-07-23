export const TSC_HANDLER = `
// ── TSC ───────────────────────────────────────────────────────────────────────
// Groups errors by file, aggregates top-5 error codes in the summary line.
// Preserves indented continuation lines (the squiggly-line context).
function condenseTsc(text) {
  const ERROR_RE = /^(.+?)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+(TS\\d+):\\s+(.+)$/;
  // Real Windows tsc writes CRLF (TypeScript takes sys.newLine from os.EOL),
  // and splitting on '\\n' alone leaves a trailing \\r on every line. In JS \`.\`
  // never matches \\r (it is a line terminator) and \`$\` without /m only matches
  // end of input, so ERROR_RE's \`(.+)$\` could not match a single diagnostic:
  // on an entire advertised platform this condenser silently did nothing, and
  // the frame's generic backstop then elided error lines from the middle that
  // the grouped form would have kept. Only the PARSING copy is normalised -
  // every passthrough below still returns the caller's original bytes.
  const lines = text.split('\\n').map(l => l.replace(/\\r$/, ''));
  const errors = [];
  let i = 0;
  while (i < lines.length) {
    const m = ERROR_RE.exec(lines[i]);
    if (m) {
      const err = { file: m[1], line: +m[2], code: m[5], message: m[6], ctx: [] };
      i++;
      while (i < lines.length && /^\\s+/.test(lines[i]) && !ERROR_RE.test(lines[i])) {
        err.ctx.push(lines[i].trim()); i++;
      }
      errors.push(err);
    } else { i++; }
  }
  if (!errors.length) return /Found 0 errors/.test(text) ? 'TypeScript: no errors' : text;

  const byFile = new Map();
  for (const e of errors) { const l = byFile.get(e.file) ?? []; l.push(e); byFile.set(e.file, l); }
  const byCodes = new Map();
  for (const e of errors) byCodes.set(e.code, (byCodes.get(e.code) ?? 0) + 1);
  const topCodes = [...byCodes.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => \`\${c}(\${n}×)\`).join(' ');

  const out = [\`TypeScript: \${errors.length} errors in \${byFile.size} files  \${topCodes}\`, '─'.repeat(50)];
  for (const [file, errs] of byFile) {
    out.push(\`\${file}  (\${errs.length})\`);
    for (const e of errs) {
      out.push(\`  L\${e.line}: \${e.code} \${e.message.slice(0, 120)}\`);
      for (const c of e.ctx) out.push(\`    \${c.slice(0, 120)}\`);
    }
  }
  // Applied to the GROUPED output, where each file appears exactly once: tsc
  // prints absolute paths whenever it is not run from the project root, and on
  // Windows that checkout prefix is 40-80 characters on every group header.
  // Elision no-ops on the relative paths a root-level run produces.
  //
  // Then the shorter-of guard the sibling condensers all carry (gh, git,
  // pkgmgr, source). The summary line, the 50-character rule and one group
  // header per file are a fixed overhead of roughly 90 characters, so a run
  // with a handful of diagnostics - the normal state of an edit/typecheck
  // loop - came back 50-160% LARGER than the bare \`tsc --noEmit\` it wrapped.
  // Nothing is lost by declining: the diagnostics the rollup groups are
  // exactly the diagnostics tsc already printed, in its own format.
  return ttShorterOf(elideCommonPathPrefix(out.join('\\n')), text);
}
`

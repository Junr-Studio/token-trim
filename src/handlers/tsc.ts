export const TSC_HANDLER = `
// ── TSC ───────────────────────────────────────────────────────────────────────
// Groups errors by file, aggregates top-5 error codes in the summary line.
// Preserves indented continuation lines (the squiggly-line context).
function condenseTsc(text) {
  const ERROR_RE = /^(.+?)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+(TS\\d+):\\s+(.+)$/;
  const lines = text.split('\\n');
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
  return out.join('\\n');
}
`

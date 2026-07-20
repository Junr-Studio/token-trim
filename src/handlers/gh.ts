export const GH_HANDLER = `
// ── gh ────────────────────────────────────────────────────────────────────────
// Filters markdown noise from PR/issue bodies: HTML comments, badge lines,
// image-only lines, and horizontal rules. Preserves code blocks intact.
function condenseGh(text) {
  const lines = text.split('\\n');
  const out   = [];
  let blanks = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^\\s*\`\`\`/.test(line)) { inCodeBlock = !inCodeBlock; out.push(line); continue; }
    if (inCodeBlock) { out.push(line); continue; }
    if (/^\\s*<!--.*-->\\s*$/.test(line))                 continue; // HTML comment
    if (/^\\s*\\[!\\[.*\\]\\(.*\\)\\]\\(.*\\)\\s*$/.test(line)) continue; // badge
    if (/^\\s*!\\[.*\\]\\(.*\\)\\s*$/.test(line))         continue; // image-only
    if (/^\\s*(?:---+|\\*\\*\\*+|___+)\\s*$/.test(line))  continue; // horizontal rule
    if (!line.trim()) { if (++blanks > 1) continue; } else { blanks = 0; }
    out.push(line);
  }
  return out.join('\\n').trim() || text;
}
`

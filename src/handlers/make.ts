export const MAKE_HANDLER = `
// ── make ──────────────────────────────────────────────────────────────────────
// Strips "make[N]: Entering/Leaving directory" and bare echo recipe lines.
function condenseMake(text) {
  const NOISE = /^(make\\[\\d+\\]:.*(?:Entering|Leaving) directory|echo )/;
  const lines = text.split('\\n').filter(l => !NOISE.test(l));
  return ttTrimBlankEdges(lines.join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
}
`

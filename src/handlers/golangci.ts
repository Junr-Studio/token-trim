export const GOLANGCI_HANDLER = `
// ── golangci-lint ─────────────────────────────────────────────────────────────
// Groups issues by linter; emits "golangci-lint: N issues in M files  linter(Nx)"
function condenseGolangci(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  const linterCount = new Map();
  const fileSet = new Set();
  let total = 0;

  for (const line of lines) {
    // Format: "path/to/file.go:10:5: linter-name: message"
    const m = line.match(/^([^:]+\\.go):\\d+:\\d+:\\s+([\\w-]+):/);
    if (!m) continue;
    fileSet.add(m[1]);
    linterCount.set(m[2], (linterCount.get(m[2]) ?? 0) + 1);
    total++;
  }

  if (total === 0) {
    const ok = lines.find(l => /no issues found/i.test(l));
    return ok ?? text;
  }

  const topLinters = [...linterCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([l, n]) => l + '(' + n + 'x)').join('  ');
  return 'golangci-lint: ' + total + ' issue(s) in ' + fileSet.size + ' file(s)  ' + topLinters;
}
`

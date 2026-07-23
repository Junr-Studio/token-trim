export const GOLANGCI_HANDLER = `
// ── golangci-lint ─────────────────────────────────────────────────────────────
// Groups issues by linter; emits "golangci-lint: N issues in M files  linter(Nx)"
function condenseGolangci(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  const linterCount = new Map();
  const fileSet = new Set();
  let total = 0;

  for (const line of lines) {
    // golangci-lint's DEFAULT text format is
    //   path/to/file.go:10:5: <message> (<linter>)
    // - the linter name is a trailing parenthetical, not a prefix. Requiring a
    // \`linter:\` prefix meant the second capture picked up whatever word of the
    // MESSAGE happened to be followed by a colon ("S1000", "undefined"), and
    // every issue whose message had no such word failed to match at all and
    // vanished from the total, the file set and the histogram together.
    //
    // So: recognise the issue by its position prefix, which every format has,
    // and read the linter from the trailing "(name)" when it is there.
    const m = line.match(/^([^:]+\\.go):\\d+:\\d+:\\s+(.*\\S)\\s*$/);
    if (!m) continue;
    fileSet.add(m[1]);
    // The trailing "(name)" is the ONLY place golangci-lint prints the linter.
    // A "\`word\`:"-prefix fallback used to fill in when it was absent - but the
    // renderings that omit the parenthetical (--print-linter-name=false, the
    // \`line-number\`/\`tab\` formats, a typecheck failure) do not move the name
    // anywhere else, they just don't print it. So the fallback was reading the
    // first colon-terminated word of the MESSAGE and reporting it as the rule
    // that fired: "undefined(1x)", "S1000(1x)", "SA4006(1x)". Those are message
    // fragments. Omitting the histogram entry deletes information; naming a
    // fragment invents it, so when the name is not on the line there is none.
    // ...and only when that parenthetical has the SHAPE of a linter name. Every
    // linter golangci-lint can run is lower-case ascii (errcheck, gosimple,
    // staticcheck, gocritic, nolintlint, err113). Accepting any word there put
    // message fragments back in the histogram the moment a message ended in a
    // parenthetical, which real ones do: gosimple S1012 prints "should use
    // time.Since instead of time.Now().Sub(tStart)" and S1028 prints "...
    // instead of errors.New(fmt.Sprintf(...))" - reported as \`tStart(1x)\` and
    // \`...(1x)\`. Upper case, dots and slashes cannot be a linter, so they are
    // not one; the entry is omitted instead.
    const trailing = m[2].match(/\\(([a-z][a-z0-9_-]*)\\)$/);
    // An issue with no printed linter still COUNTS - dropping it from the
    // total to keep the histogram tidy is the silent-deletion bug.
    if (trailing) linterCount.set(trailing[1], (linterCount.get(trailing[1]) ?? 0) + 1);
    total++;
  }

  if (total === 0) {
    const ok = lines.find(l => /no issues found/i.test(l));
    return ok ?? text;
  }

  const topLinters = [...linterCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([l, n]) => l + '(' + n + 'x)').join('  ');
  return 'golangci-lint: ' + total + ' issue(s) in ' + fileSet.size + ' file(s)' + (topLinters ? '  ' + topLinters : '');
}
`

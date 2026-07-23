export const GREP_HANDLER = `
// ── grep / rg ─────────────────────────────────────────────────────────────────
// \`grep\`/\`rg\` emit four unrelated shapes depending on their flags, and only one
// of them is a match list. Dispatch on the flags before parsing anything:
//
//   --json / --vimgrep / -o / -0   → machine output, verbatim
//   -l / -L / --files              → bare path list (canonical \`| xargs\` input)
//   -c / --count                   → \`file:N\` count rows
//   otherwise                      → \`file:line:content\` match list, grouped
//
// Every branch falls back to the input when it cannot recognise the shape.
// Fabricating "0 matches in 0 file(s)" from an unparsed list deletes the result.

function grepHasFlag(args, names) {
  return args.some(a => names.indexOf(String(a)) !== -1);
}

// Matches a short flag inside a cluster: -rl, -rn, -ric ... (case-sensitive, so
// -c/--count never collides with -C/--context).
function grepHasShort(args, ch) {
  return args.some(a => {
    const s = String(a);
    return /^-[A-Za-z]+$/.test(s) && s.slice(1).indexOf(ch) !== -1;
  });
}

// The elision is disclosed OUT OF BAND: \`rg -l pat | xargs sed -i\` is the
// canonical use, so an inline marker would be handed to sed as a filename.
function grepCapList(lines, cap, noun) {
  return ttCapDataList(lines, cap, 0, noun).join('\\n');
}

// -A/-B/-C (and grep's -NUM shorthand) ask for the lines AROUND each hit, and
// grep marks a CONTEXT row with a dash instead of a colon ("file-9-content"),
// separating non-adjacent groups with a bare "--". Neither shape is
// \`file:line:content\`, so the match-list parser skipped both - deleting from
// the body, from the count, and without any marker, exactly the lines the flag
// was typed to obtain. The result was indistinguishable from a plain \`grep -n\`
// run, so the agent could not even tell to ask again.
//
// Value-taking short flags must be last in a cluster, so -C/-A/-B appear as
// "-C", "-C1", "-rC1" or "-rnA3". The test is case-sensitive: lowercase -c is
// --count and lowercase -l is --files-with-matches, both handled above.
function grepHasContextFlag(args) {
  return args.some(a => {
    const s = String(a);
    return /^--(after-context|before-context|context)(=|$)/.test(s) ||
      /^-[A-Za-z]*[ABC]\\d*$/.test(s) ||
      /^-\\d+$/.test(s);
  });
}

// \`rg --heading\` - and -p/--pretty, which implies it, and any
// RIPGREP_CONFIG_PATH that enables it - puts the filename on a LINE OF ITS OWN
// and reduces each row to "line:content". The heading has no colon, so it
// matched neither path pattern and was deleted; the rows then keyed the group
// map by LINE NUMBER, turning line numbers into file headings and the file
// count into the number of distinct line numbers. Every filename the search
// existed to produce was lost and the count was invented.
function grepHasHeadingFlag(args) {
  if (args.some(a => String(a) === '--no-heading')) return false;
  return args.some(a => {
    const s = String(a);
    return s === '--heading' || s === '--pretty' || s === '-p';
  });
}

function groupGrep(text, cmdArgs) {
  const args = cmdArgs ?? [];

  // Machine-readable output is consumed by another program: never reshape it.
  if (grepHasFlag(args, ['--json', '--vimgrep', '--null', '-0', '--only-matching', '--stats']) ||
      grepHasShort(args, 'o')) return text;

  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length === 0) return text;

  // ── bare path list (-l / -L / --files) ──────────────────────────────────────
  // One path per line, no indent, no header: a truncated list must stay valid
  // input to \`xargs\`. Only the overflow is elided, and it says so.
  if (grepHasFlag(args, ['-l', '-L', '--files', '--files-with-matches', '--files-without-match']) ||
      grepHasShort(args, 'l') || grepHasShort(args, 'L')) {
    return grepCapList(lines, 60, 'paths');
  }

  // ── count rows (file:N) ─────────────────────────────────────────────────────
  if (grepHasFlag(args, ['-c', '--count', '--count-matches']) || grepHasShort(args, 'c')) {
    const rows = [];
    for (const line of lines) {
      const m = line.match(/^(.*):(\\d+)$/);
      if (m) rows.push({ path: m[1], n: +m[2] });
    }
    if (rows.length === 0) return text;
    rows.sort((a, b) => b.n - a.n);
    return grepCapList(rows.map(r => r.path + ':' + r.n), 40, 'files');
  }

  // ── match list (file:line:content) ──────────────────────────────────────────
  // Two grammars this branch does NOT model, both of which it used to misparse
  // into a confident summary rather than fall back on. The header comment above
  // promises that every branch falls back when it cannot recognise the shape;
  // these are the two places that promise was not kept.
  if (grepHasContextFlag(args) || grepHasHeadingFlag(args)) return text;

  // The path alternative accepts a Windows drive prefix FIRST, otherwise
  // "C:/repo/f.ts:10:hit" splits at the drive letter and every hit collapses
  // under a file literally named "C".
  const PATH = '([A-Za-z]:[\\\\\\\\/][^:]*|[^:]+)';
  const withLine = new RegExp('^' + PATH + ':(\\\\d+):(.*)$');
  const noLine   = new RegExp('^' + PATH + ':(.*)$');

  const byFile = new Map();
  const skipped = [];
  let parsed = 0;
  for (const line of lines) {
    const m = withLine.exec(line) ?? noLine.exec(line);
    if (!m) { skipped.push(line); continue; }
    parsed++;
    const f = m[1];
    const e = byFile.get(f) ?? [];
    e.push(m.slice(2).join(':').trim());
    byFile.set(f, e);
  }

  // Unrecognised shape: fall back rather than report a fabricated zero.
  if (parsed === 0 || byFile.size === 0) return text;

  // A group key that is nothing but digits is not a file - it is a LINE NUMBER
  // promoted to a heading, which is what heading mode (and \`... | grep -n\`,
  // where there is no filename to print at all) produces. Both would be
  // reported as N matches in "file" 10, 11, 12.
  for (const f of byFile.keys()) if (/^\\d+$/.test(f)) return text;

  // Context rows can also be switched on by a config file with nothing in
  // argv (GREP_OPTIONS, RIPGREP_CONFIG_PATH), so the SHAPE is checked too: a
  // bare "--" separator, or an unparsed line that is one of the files we DID
  // parse followed by the dash form. Both lazy and greedy prefixes are tried
  // so a hyphenated path is still recognised.
  for (const line of skipped) {
    if (line.trim() === '--') return text;
    const lazy = line.match(/^(.+?)-\\d+-/);
    if (lazy && byFile.has(lazy[1])) return text;
    const greedy = line.match(/^(.+)-\\d+-/);
    if (greedy && byFile.has(greedy[1])) return text;
  }
  if (byFile.size <= 1 && lines.length < 10) return text;

  const total = [...byFile.values()].reduce((s, a) => s + a.length, 0);

  // Grouping only pays when files hold several matches each; at ~1 match per
  // file the repeated heading costs more than the stripped prefix saves.
  if (total / byFile.size < 1.5) return grepCapList(lines, 60, 'matches');

  const out = [total + ' matches in ' + byFile.size + ' file(s)'];
  for (const [f, matches] of byFile) {
    out.push(f + '  (' + matches.length + ')');
    for (const m of matches.slice(0, 20)) out.push('  ' + m.slice(0, 120));
    if (matches.length > 20) out.push('  ... +' + (matches.length - 20) + ' more');
  }
  return out.join('\\n');
}
`

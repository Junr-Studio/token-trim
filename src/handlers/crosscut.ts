// Cross-cutting condensers: transforms that are not tied to one command and are
// reused by many. Built once, inherited by every condenser that opts in.
//
// Every one of them returns its input unchanged when it does not recognise the
// shape - a caller can always pipe text through unconditionally.

export const CROSSCUT_HANDLER = `
// ── common path-prefix elision ────────────────────────────────────────────────
// Diagnostic tools print an absolute path on every line. On Windows that prefix
// is routinely 60-80 characters repeated hundreds of times. Hoist it into one
// header line and make the rest relative.
function elideCommonPathPrefix(text) {
  if (!text) return text;
  // First path-like token per line. Stops at ':' so a Windows drive letter is
  // only ever consumed by the drive-letter branch and a trailing "file.ts:12:4"
  // location suffix stays out of the path.
  const PATH_RE = /(?:[A-Za-z]:[\\\\/]|\\/)[^\\s:"'()<>|*?]*/;
  const lines = text.split('\\n');
  const dirs = [];
  for (const line of lines) {
    const m = PATH_RE.exec(line);
    if (!m) continue;
    // A line that is ONLY a path is an entry in a bare path list - canonical
    // \`| xargs\` input. Rewriting those to relative paths against a header the
    // pipe never sees breaks the consumer, so one is enough to call the whole
    // text off.
    if (line.trim() === m[0]) return text;
    const cut = Math.max(m[0].lastIndexOf('/'), m[0].lastIndexOf('\\\\'));
    if (cut < 0) continue;
    dirs.push(m[0].slice(0, cut + 1));
  }
  if (dirs.length < 3) return text;

  let base = dirs[0];
  for (const d of dirs) {
    let n = 0;
    while (n < base.length && n < d.length && base[n] === d[n]) n++;
    base = base.slice(0, n);
  }
  // Trim back to a separator: a raw character-wise prefix happily stops
  // mid-segment ("src/hand") which would leave the remainder unusable as a
  // path. This is also what keeps a Windows path from being split at the
  // drive-letter colon - the earliest separator is the one after it.
  const cut = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\\\'));
  base = cut < 0 ? '' : base.slice(0, cut + 1);
  // A drive root or a bare '/' is shared by everything and hoisting it saves
  // nothing, so the length floor doubles as the "not worth it" test.
  if (base.length < 12) return text;

  return 'base: ' + base + '\\n' + lines.map(l => l.split(base).join('')).join('\\n');
}

// ── stack-trace folding ───────────────────────────────────────────────────────
// Keeps the project frames, folds contiguous runs of dependency/runtime frames
// into "... +N frames in node_modules ...".

// Where a frame lives, or '' for a frame the project owns. The label doubles as
// the fold marker's noun, so it has to name the place a reader would look.
function vendorFrameLabel(frame) {
  // site-packages is checked before .venv because a virtualenv path contains
  // both and the inner one names the package, which is what a reader wants.
  if (/node_modules/.test(frame))    return 'node_modules';
  if (/site-packages/.test(frame))   return 'site-packages';
  if (/[\\\\/]\\.venv[\\\\/]/.test(frame)) return '.venv';
  if (/node:internal/.test(frame))   return 'node:internal';
  // dist/ is deliberately NOT a vendor marker. A compiled or bundled service
  // ("node dist/server.js") keeps its ENTIRE project under dist/, so folding it
  // deletes the throwing frame itself and leaves a marker where the only frames
  // that mattered used to be. A dependency's own dist/ is already covered by
  // the node_modules test above.
  if (/\\/usr\\/lib\\//.test(frame))       return '/usr/lib';
  // Java frames carry no path, so the package IS the location. All three of
  // these live in the java.base module, which is what the marker names.
  if (/\\bjava\\.base\\/|\\bjdk\\.internal\\.|\\bsun\\.reflect\\./.test(frame)) return 'java.base';
  return '';
}

// Python's "  File ..." header; its source line follows, indented deeper.
function isPyFrameHead(line) {
  return /^\\s*File ".+", line \\d+/.test(line);
}

function indentOf(line) {
  return /^\\s*/.exec(line)[0];
}

function foldStackTraces(text) {
  if (!text) return text;
  const lines = text.split('\\n');
  const out = [];
  let run = [];

  // A single vendor frame still names a file the reader may need; only a RUN of
  // them is pure noise, so anything shorter than 3 is emitted verbatim.
  function flush() {
    if (run.length >= 3) {
      const counts = {};
      let label = run[0].label;
      let best = 0;
      for (const f of run) {
        counts[f.label] = (counts[f.label] ?? 0) + 1;
        if (counts[f.label] > best) { best = counts[f.label]; label = f.label; }
      }
      out.push(run[0].indent + '... +' + run.length + ' frames in ' + label + ' ...');
    } else {
      for (const f of run) for (const l of f.lines) out.push(l);
    }
    run = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // JS "    at fn (/p/f.js:1:2)" and Java "\\tat com.foo.Bar.baz(Bar.java:42)"
    // share this shape; both are one line.
    const isAt = /^\\s+at\\s\\S/.test(line);
    const isPy = isPyFrameHead(line);
    if (!isAt && !isPy) { flush(); out.push(line); i++; continue; }

    const frame = [line];
    i++;
    if (isPy) {
      // Absorb the frame's source line and any caret/marker lines under it, so
      // folding the frame does not strand its body.
      while (i < lines.length && lines[i].trim() &&
             indentOf(lines[i]).length > indentOf(line).length &&
             !isPyFrameHead(lines[i])) {
        frame.push(lines[i]); i++;
      }
    }

    const label = vendorFrameLabel(frame.join('\\n'));
    if (label) run.push({ lines: frame, label: label, indent: indentOf(line) });
    else { flush(); for (const l of frame) out.push(l); }
  }
  flush();
  return out.join('\\n');
}

// ── header-driven table projection ────────────────────────────────────────────
// Generic projector for whitespace-aligned tables with a header row
// (docker ps, kubectl get, helm list, pip list, npm outdated, trivy ...).
// \`keep\` lists the header names worth showing, in order.

// Whether \`want\` appears in the header line as a standalone whitespace-delimited
// word. Tells "this table simply has no such column" (fine - skip it) apart from
// "this header could not be tokenized" (refuse: see the caller).
function headerHasWord(header, want) {
  let at = header.indexOf(want);
  while (at >= 0) {
    const end = at + want.length;
    if ((at === 0 || /\\s/.test(header[at - 1])) &&
        (end >= header.length || /\\s/.test(header[end]))) return true;
    at = header.indexOf(want, at + 1);
  }
  return false;
}

// Which column run holds \`want\` as a whole word, or -1. Runs are the maximal
// header tokens, so a header word belongs to exactly one of them and the first
// hit is the only hit.
function runContainingWord(names, want) {
  for (let j = 0; j < names.length; j++) if (headerHasWord(names[j], want)) return j;
  return -1;
}

// Whether the run at index \`j\` is really ONE column. A run only exists because
// its words are separated by a single space, and from the header alone a
// two-word column name ("CONTAINER ID") is indistinguishable from two columns
// the command separated by one space ("PID %CPU"). The DATA settles it: one
// cell is one unbroken stretch of text.
//
// The test is "no whitespace at all in the slice", not "no 2+ space gap in it".
// Column padding is a function of the widest VALUE, so glued columns carrying
// narrow values are separated by a SINGLE space on every row ("1 0.0",
// "242 1.2") - a gap test reads that as one cell, and the caller then treats
// the wanted column as absent and projects the table without it, silently
// dropping the column it was asked for. Whitespace inside a slice cannot prove
// the run is one column, so it is not allowed to: the cost is refusing a
// genuine one-column run whose values contain spaces, which loses compression
// and nothing else.
function runIsOneColumn(lines, from, starts, j) {
  const to = j + 1 < starts.length ? starts[j + 1] : -1;
  let seen = false;
  for (let r = from; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    const cell = (to < 0 ? lines[r].slice(starts[j]) : lines[r].slice(starts[j], to)).trim();
    // An empty slice says nothing about the run's shape, so it is not counted
    // as the evidence the return below requires.
    if (!cell) continue;
    seen = true;
    if (/\\s/.test(cell)) return false;
  }
  // No data row is no evidence, and guessing is the thing this exists to avoid.
  return seen;
}

// A row agrees with the header's columns only when no token straddles a start
// offset - i.e. the character just before every offset is whitespace. That is
// exactly the condition under which slicing the row at those offsets returns
// whole cells instead of fragments.
function rowFitsColumns(row, starts) {
  for (let k = 1; k < starts.length; k++) {
    // A row that stops before this column start is missing cells, and nothing
    // in it says WHICH: an empty trailing column and a collapsed middle one -
    // which shifts every later value LEFT, under the wrong header - produce the
    // same characters. Slicing then reports one column's value under another
    // column's name, so a short row calls the table off exactly like a spilled
    // one does.
    if (row.length <= starts[k]) return false;
    if (!/\\s/.test(row[starts[k] - 1])) return false;
  }
  return true;
}

function projectTable(text, keep) {
  if (!text || !keep || !keep.length) return text;
  const lines = text.split('\\n');
  let h = 0;
  while (h < lines.length && !lines[h].trim()) h++;
  if (h >= lines.length) return text;
  const header = lines[h];

  // A column name may contain a SINGLE space ("CONTAINER ID"); two or more
  // separate columns. So the token runs, and the offsets they start at, come
  // from the header - values are then sliced at those offsets rather than
  // whitespace-split, because values contain single spaces too ("2 days ago").
  const names = [];
  const starts = [];
  const CELL = /[^\\s](?:[^\\s]| (?! ))*/g;
  let m = CELL.exec(header);
  while (m) { names.push(m[0]); starts.push(m.index); m = CELL.exec(header); }
  if (names.length < 2) return text;

  const idx = [];
  for (const want of keep) {
    const at = names.indexOf(want);
    if (at >= 0) { idx.push(at); continue; }
    // The name is in the header line but did not come out as a column of its
    // own, so the single-space rule above swallowed it into a run. Two shapes
    // do that and only the data tells them apart. A two-word column name asked
    // for by one of its words ("ID" of "CONTAINER ID") means this table has no
    // such column - the same as a name that is simply absent, so skip it and
    // project the columns that did parse. A header that separates columns by
    // ONE space ("USER PID %CPU", \`ps aux\`) means the run hides real column
    // boundaries the header never showed, and projecting the rest would drop
    // the wanted column in silence.
    const run = runContainingWord(names, want);
    if (run >= 0) { if (!runIsOneColumn(lines, h + 1, starts, run)) return text; continue; }
    if (headerHasWord(header, want)) return text;
  }
  // No wanted column present means this is not the table we were told to
  // project - guessing at its columns would invent a summary.
  if (!idx.length) return text;

  const rows = [];
  for (let r = h + 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    // The header is padded to the width of the header NAMES, not of the data.
    // A value wider than its column runs past the next start offset, and
    // slicing there hands back fragments of two different columns - a table of
    // garbage that reads as authoritative. No single row recovers the real
    // boundaries, so one row that does not line up calls the whole table off.
    if (!rowFitsColumns(lines[r], starts)) return text;
    const cells = [];
    for (const at of idx) {
      const to = at + 1 < starts.length ? starts[at + 1] : lines[r].length;
      cells.push(lines[r].slice(starts[at], to).trim());
    }
    rows.push(cells.join('  '));
  }
  if (!rows.length) return text;

  const kept = [];
  for (const at of idx) kept.push(names[at]);
  // Re-emitted unpadded: the alignment was the point of the original columns,
  // and padding is pure token cost once the noise columns are gone.
  return [kept.join('  ')].concat(rows).join('\\n');
}

// ── help text ─────────────────────────────────────────────────────────────────
// "<tool> --help" is a wall of aligned option descriptions. Keep the usage line
// and the command/option names with a one-line gloss.

// A flag ("-x", "--exitfirst", "-k EXPRESSION", "--fixtures, --funcargs") or a
// bare subcommand word ("clone"). Anything else in the name column is prose.
function isHelpEntryName(s) {
  return /^-{1,2}[A-Za-z0-9?]/.test(s) || /^[A-Za-z][A-Za-z0-9_:.-]*$/.test(s);
}

function firstSentence(s) {
  const at = s.search(/[.!?](\\s|$)/);
  const cut = at >= 0 ? s.slice(0, at + 1) : s;
  return cut.length > 120 ? cut.slice(0, 120) : cut;
}

function condenseHelp(text) {
  if (!text) return text;
  const lines = text.split('\\n');

  // No usage line means this is not help output; anything else we did to it
  // would be a guess.
  let u = 0;
  while (u < lines.length && !/^\\s*usage:/i.test(lines[u])) u++;
  if (u >= lines.length) return text;
  const usage = [];
  for (let i = u; i < lines.length && lines[i].trim(); i++) usage.push(lines[i]);

  const entries = [];
  let cur = null;
  for (let i = u + usage.length; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line).length;
    // Column 0 is a section heading or trailing prose - it also closes whatever
    // entry was open, so a heading can never be glued onto a description.
    if (ind === 0) { cur = null; continue; }

    const m = /^\\s+(\\S(?:[^\\s]| (?! ))*)\\s{2,}(\\S.*)$/.exec(line);
    if (m && isHelpEntryName(m[1])) {
      cur = { name: m[1], desc: m[2].trim(), indent: ind };
      entries.push(cur);
    } else if (cur && ind > cur.indent) {
      // Wrapped description. Rejoin before cutting: the first sentence often
      // straddles the wrap, so cutting per physical line truncates mid-clause.
      cur.desc = cur.desc ? cur.desc + ' ' + line.trim() : line.trim();
    } else if (isHelpEntryName(line.trim())) {
      // Names too wide for the column take their description from below.
      cur = { name: line.trim(), desc: '', indent: ind };
      entries.push(cur);
    } else {
      cur = null;
    }
  }
  if (entries.length < 3) return text;

  const CAP = 15;
  const out = usage.slice();
  for (const e of entries.slice(0, CAP)) {
    out.push('  ' + e.name + (e.desc ? '  ' + firstSentence(e.desc) : ''));
  }
  if (entries.length > CAP) {
    out.push('  ... +' + (entries.length - CAP) + ' more (__TT_FULL_FLAG__)');
  }
  return out.join('\\n');
}
`

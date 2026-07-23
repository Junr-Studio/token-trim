export const PKGMGR_HANDLER = `
// ── npm / pnpm / yarn install ─────────────────────────────────────────────────
// Keep only meaningful output; strip download progress, spinners, timing lines.
function stripPkgNoise(text) {
  const SPINNER = /[⠀-⣿]/u;
  const lines = text.split('\\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (SPINNER.test(line)) continue;
    if (/^(npm (warn |notice |info |timing|WARN )|> .+@\\d|\\s*Progress:|Downloading|Fetching|Resolving:|Packages are hard linked|\\s*packages\\/installed|node_modules\\/.pnpm)/.test(line)) continue;
    out.push(line);
  }
  return ttTrimBlankEdges(out.join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
}

// ── npm / pnpm / yarn ls ──────────────────────────────────────────────────────
// "npm ls --all" is thousands of lines of transitive resolution. The direct
// dependencies with their resolved versions are the answer; everything deeper
// is derivable - unless npm flagged it, which is the only reason anyone reads
// this output at all.

// One row of the ASCII dependency tree, or null when the line is not one.
// Only the box-drawing forms npm / pnpm / yarn actually emit are recognised
// ("|-- " ASCII fallback trees pass through untouched rather than be guessed
// at). \`nested\` is all we need: depth beyond the first level is uniformly
// noise, so the per-format indent width (npm 2, yarn 3) never has to be known.
function ttPkgTreeRow(line) {
  const m = line.match(/^([│ ]*)[├└]─(?:─|┬)? ?(.*)$/);
  // Box-drawing carrying no package label is a table border, not a tree row.
  if (!m || !/[A-Za-z0-9@]/.test(m[2])) return null;
  return { nested: m[1].length > 0, label: m[2].trim() };
}

// The long forms (\`npm ll\`, \`npm la\`, \`npm ls --long\`) print description /
// repo / homepage CONTINUATION lines under each entry: indented inside the tree
// but carrying no ├└ connector, so ttPkgTreeRow cannot say which package owns
// them. Folding the nested rows away therefore re-attaches their descriptions
// to the nearest surviving direct dependency above - a summary of a shape we
// did not parse. Recognising one means this is long form, which we do not
// parse, so the whole tree must come back untouched.
//
// A continuation belongs to the row DIRECTLY above it - that adjacency is the
// entire reason it is dangerous - so the indent only means "long form" when
// \`attached\` says a tree row (or another continuation) was the line before.
// Indentation on its own is not long form: an indented note printed after the
// tree ("npm ls output truncated", a warning, a wrapped hint) is ordinary
// output that owns no package, and reading it as a description surrendered the
// compression of the entire tree above it.
function ttPkgTreeContinuation(line, attached) {
  return !!attached && /^[│ ]+\\S/.test(line);
}

// A bare "deduped" is npm's normal resolution bookkeeping (the package was
// satisfied higher up), not a conflict - only a deduped entry npm ALSO marked
// invalid is one, and the "invalid" branch already catches it.
//
// npm emits these markers in a fixed POSITION, never inside a package name:
// "UNMET DEPENDENCY x" / "missing: x, required by y" as a prefix, and
// 'pkg@1.0.0 invalid: "^5.0.0" from ...' / 'pkg@1.0.0 extraneous' as a suffix.
// So the marker must start at a word the label actually has - \\b is not enough,
// because '-' is a non-word character and \`is-invalid-path\` is a real, healthy
// npm package. Word-matching anywhere hoists it into a confident "1 problem:"
// list for a tree npm reported as clean.
function ttPkgTreeProblem(label) {
  return /(?:^|\\s)UNMET(?: [A-Z]+)? DEPENDENCY\\b/.test(label) ||
         /(?:^|\\s)(?:invalid|extraneous|missing)(?::|\\s|\$)/.test(label);
}

function condensePkgLs(text) {
  const kept = [];
  const problems = [];
  let entries = 0, direct = 0, hidden = 0;
  // Whether the previous line was part of the tree, so an indented line can be
  // told apart from a note that merely follows one.
  let attached = false;

  for (const line of text.split('\\n')) {
    const row = ttPkgTreeRow(line);
    if (!row) {
      if (ttPkgTreeContinuation(line, attached)) return text;
      attached = false;
      if (line.trim()) kept.push(line);
      continue;
    }
    attached = true;
    entries++;
    if (!row.nested) { direct++; kept.push(line); continue; }
    if (ttPkgTreeProblem(row.label)) problems.push(row.label);
    else hidden++;
  }

  // No tree found: pnpm's flat section list, an error message, "npm ls" in an
  // empty project. Summarising a shape we did not parse is how a confident
  // "0 dependencies" gets shipped for output that had plenty.
  if (entries === 0) return text;
  // Nothing to drop - the tree already IS the direct-dependency list.
  //
  // \`hidden\` is what this condenser FOLDS AWAY, and a flagged row is not folded
  // away: it is reprinted in the list below. So hidden === 0 means the whole
  // transform is a no-op that costs a summary line reading "0 nested entries
  // hidden" - a zero asserted about a tree that plainly had nested rows - plus
  // a problem list restating rows npm already printed in place, with their
  // tree context, for MORE characters than the input. A tree whose every
  // nested row is flagged hits exactly that, and grows.
  if (hidden === 0) return text;

  const out = kept.slice();
  out.push('... ' + hidden + ' nested entries hidden - ' + direct + ' direct of ' + entries + ' total');
  if (problems.length) {
    out.push(problems.length + (problems.length === 1 ? ' problem:' : ' problems:'));
    for (const p of problems.slice(0, 20)) out.push('  [x] ' + p);
    if (problems.length > 20) out.push('  ... +' + (problems.length - 20) + ' more');
  }

  const joined = out.join('\\n');
  // A flagged entry is the only reason anyone reads this output, and a shallow
  // tree can spell one out for more characters than the nested rows it replaced.
  // Falling back to the raw tree there buys a handful of characters by burying
  // the defect somewhere in it, so the problem list wins over the size guard.
  // A shallow tree with a couple of flagged rows still spells the problem list
  // out for more characters than the nested rows it folded away, so this bought
  // a defect report at the price of GROWING the output - and the harness's
  // "never larger than the input" invariant is not a style rule, it is the one
  // promise a compressor makes. When the condensed form is not smaller, hand
  // back the tree: npm printed each flagged row in place, with its own context,
  // so nothing is lost - only the convenience of the summary.
  return joined.length < text.length ? joined : text;
}

// ── npm / pnpm / yarn outdated ────────────────────────────────────────────────
// The table is mostly padding plus a Location column that restates the package
// name. One line per package - "pkg current → wanted/latest" - carries the same
// answer. Anchored on npm's / yarn v1's column header: without it we have not
// recognised the shape and must not invent a count.
function ttPkgVersionish(v) {
  return /^(?:\\d[\\w.+-]*|MISSING|exotic|linked|git)$/.test(String(v));
}

function condensePkgOutdated(text) {
  const lines = text.split('\\n');
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\\s*Package\\s+Current\\s+Wanted\\s+Latest\\b/.test(lines[i])) { header = i; break; }
  }
  if (header === -1) return text;

  const rows = [];
  const extra = [];
  for (const line of lines.slice(header + 1)) {
    const t = line.trim();
    if (!t) continue;
    // Every value in this table is a single token, so \\s+ splits it safely
    // whatever the column padding turned out to be.
    const c = t.split(/\\s+/);
    if (c.length >= 4 && ttPkgVersionish(c[1]) && ttPkgVersionish(c[2]) && ttPkgVersionish(c[3])) {
      const target = c[3] === c[2] ? c[2] : c[2] + '/' + c[3];
      rows.push(c[0] + ' ' + c[1] + ' → ' + target);
    } else {
      // Not a package row (yarn's "Done in 1.2s.", a wrapped line): keep it
      // rather than lose output we did not understand.
      extra.push(t);
    }
  }
  // A header with nothing under it is not something to summarise as "0".
  if (rows.length === 0) return text;

  // Lines above the header are decoration (yarn's banner and colour legend);
  // the header itself is replaced by the count, which states the units.
  const out = [rows.length + ' outdated (current → wanted/latest):'].concat(rows, extra);
  return out.join('\\n');
}

// ── npm / pnpm / yarn why / explain ───────────────────────────────────────────
// "Who pulled this in?" is answered by the DIRECT requirers. npm then explains
// how each of those was itself installed, which is a longer path to the same
// root; those get folded behind a count rather than dropped invisibly.
function condensePkgWhy(text) {
  const out = [];
  const seen = {};
  let noise = 0, folded = 0;

  for (const raw of text.split('\\n')) {
    const line = raw.replace(/\\s+$/, '');
    const t = line.trim();
    if (!t) continue;

    // yarn's step counter and its four disk-size measurements, none of which
    // bear on which package pulled the dependency in.
    if (/^\\[\\d+\\/\\d+\\]/.test(t)) { noise++; continue; }
    if (/^info (?:Disk size|Number of shared)/.test(t)) { noise++; continue; }

    // npm repeats the install location under every requirer; the "from <pkg>"
    // clause directly above it already names the package.
    if (/^node_modules\\//.test(t)) { noise++; continue; }

    // A requirer of a requirer. Gated on npm's chain shape so it cannot swallow
    // yarn's indented "- <reason>" bullets, which are the answer there.
    const indent = line.length - line.replace(/^\\s+/, '').length;
    if (indent > 2 && /@"[^"]*" from /.test(t)) { folded++; continue; }

    if (Object.prototype.hasOwnProperty.call(seen, t)) { folded++; continue; }
    seen[t] = 1;
    out.push(line);
  }

  // Nothing recognised as removable - the shape is not one we parse.
  if (noise === 0 && folded === 0) return text;
  if (folded) out.push('... ' + folded + ' longer paths folded');

  const joined = out.join('\\n');
  return joined.length < text.length ? joined : text;
}

// ── npm / pnpm / yarn view / info ─────────────────────────────────────────────
// The packument's version history is the whole cost of this command (express
// has 280 entries, lodash 114) and answers a question nobody asked - the
// name / version / licence / dependency summary around it is the point. The
// count plus the endpoints preserve everything the array was being read for.

// Summarising "N (first … last)" throws the middle away, so recognition has to
// be certain: the body must be nothing but quoted strings, commas and space,
// AND every one of those strings must be semver-shaped. Brackets alone are not
// recognition - "npm view <pkg> maintainers" has the identical shape, and
// collapsing it relabels the maintainers as versions.
function ttPkgVersionRange(body) {
  const vs = body.match(/'[^']*'|"[^"]*"/g);
  if (!vs || vs.length < 3) return '';
  if (body.replace(/'[^']*'|"[^"]*"/g, '').replace(/[,\\s]/g, '') !== '') return '';
  const bare = (q) => q.slice(1, -1);
  for (const v of vs) if (!/^\\d+\\.\\d+\\.\\d/.test(bare(v))) return '';
  return vs.length + ' (' + bare(vs[0]) + ' … ' + bare(vs[vs.length - 1]) + ')';
}

function condensePkgView(text) {
  // "npm view <pkg> versions" prints the array on its own, with no key.
  const bare = text.trim();
  if (bare.charAt(0) === '[' && bare.charAt(bare.length - 1) === ']') {
    const range = ttPkgVersionRange(bare.slice(1, -1));
    if (range) return 'versions: ' + range;
    return stripPkgNoise(text);
  }

  // Version strings never contain ']', so [^\\]]* reliably stops at the close.
  let hits = 0;
  const collapsed = text.replace(/versions:\\s*\\[([^\\]]*)\\]/g, function (all, body) {
    const range = ttPkgVersionRange(body);
    if (!range) return all;
    hits++;
    return 'versions: ' + range;
  });

  return stripPkgNoise(hits ? collapsed : text);
}

// ── npm / pnpm / yarn pack / publish --dry-run ────────────────────────────────
// A full tarball inventory, one line per file. What anyone checks before
// publishing is: how many files, how big, and did anything unexpected get in -
// which the per-directory counts answer without the inventory. Returns null
// when no file listing was found, so the caller can fall back rather than
// invent a summary.
function condensePkgPack(text) {
  const files = [];
  const detail = {};
  const extra = [];

  for (const raw of text.split('\\n')) {
    const line = raw.replace(/^npm notice\\s?/, '').trim();
    if (!line) continue;
    if (/^={0,3}\\s*Tarball (Contents|Details)\\s*={0,3}$/.test(line)) continue;
    // The emoji header restates the name/version detail below it.
    if (/^📦/.test(line)) continue;
    // Hashes: unreadable, unactionable, and long.
    if (/^(filename|shasum|integrity):/.test(line)) continue;

    const f = line.match(/^\\d+(?:\\.\\d+)?\\s*[kKMGT]?B\\s+(\\S.*)$/);
    if (f) { files.push(f[1]); continue; }

    const d = line.match(/^(name|version|package size|unpacked size):\\s*(.+)$/);
    if (d) { detail[d[1]] = d[2]; continue; }

    // "total files" is recomputed from what we actually parsed, so the count
    // can never disagree with the directory breakdown beneath it.
    if (/^total files:/.test(line)) continue;

    extra.push(line);
  }

  if (files.length < 3) return null;

  const dirs = {};
  const order = [];
  for (const p of files) {
    const slash = p.indexOf('/');
    const dir = slash === -1 ? './' : p.slice(0, slash) + '/';
    if (!Object.prototype.hasOwnProperty.call(dirs, dir)) { dirs[dir] = 0; order.push(dir); }
    dirs[dir]++;
  }
  order.sort((a, b) => (dirs[b] - dirs[a]) || (a < b ? -1 : 1));

  let head = detail.name && detail.version ? detail.name + '@' + detail.version + ': ' : '';
  head += files.length + ' files';
  if (detail['package size'])  head += ', ' + detail['package size'] + ' packed';
  if (detail['unpacked size']) head += ', ' + detail['unpacked size'] + ' unpacked';

  const out = [head];
  for (const dir of order.slice(0, 8)) out.push('  ' + dir + ' ' + dirs[dir] + ' files');
  if (order.length > 8) out.push('  ... +' + (order.length - 8) + ' more directories');
  return out.concat(extra).join('\\n');
}

// ── npm doctor ────────────────────────────────────────────────────────────────
// Eleven rows that mostly say "ok". Only the failures are actionable, and the
// tally proves the rest were read rather than lost. Anchored on the column
// header: npm 10 prints a different, prose-shaped report, which falls through
// to the noise stripper instead of being parsed on a guess.
function condensePkgDoctor(text) {
  const lines = text.split('\\n');
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^Check\\s+Value\\s+Recommendation/.test(lines[i])) { header = i; break; }
  }
  if (header === -1) return stripPkgNoise(text);

  const failures = [];
  let checks = 0;
  for (const line of lines.slice(header + 1)) {
    const m = line.match(/^(.+?)\\s{2,}(ok|not ok)(?:\\s{2,}(.*))?$/);
    if (!m) continue;
    checks++;
    if (m[2] === 'not ok') failures.push(m[1].trim() + (m[3] ? ': ' + m[3].trim() : ''));
  }
  if (checks === 0) return stripPkgNoise(text);

  const ok = checks - failures.length;
  const out = [failures.length === 0
    ? 'doctor: ' + checks + ' checks ok'
    : 'doctor: ' + ok + ' of ' + checks + ' checks ok'];
  for (const f of failures) out.push('  [x] ' + f);
  return out.join('\\n');
}

// ── npm / pnpm / yarn subcommand routing ──────────────────────────────────────
// ls / list / outdated / why / view / publish --dry-run / pack / fund / doctor.
// Falls back to the install-noise stripper, which is the historical behaviour.
function condensePkgSub(text, sub, cmdArgs) {
  const s = String(sub ?? '');
  const argv = (cmdArgs ?? []).map(String);

  // npm's OWN machine flag, which isMachineOutput does not know: --parseable
  // (-p) turns ls and outdated into path / colon-separated records, one per
  // line, meant for \`| cut\` and \`| xargs\`. Reshaping those corrupts the
  // consumer exactly as reshaping --json would. Applied only to the two
  // subcommands that accept it: everywhere else "-p" belongs to something being
  // run, and "npm run build -- -p production" must keep its noise stripping.
  const parseable = argv.indexOf('--parseable') !== -1 || argv.indexOf('-p') !== -1;

  // npm aliases: ls / list / la / ll all print the same tree.
  if (s === 'ls' || s === 'list' || s === 'la' || s === 'll') return parseable ? text : condensePkgLs(text);
  if (s === 'outdated')                                       return parseable ? text : condensePkgOutdated(text);
  if (s === 'why' || s === 'explain')                         return condensePkgWhy(text);
  // npm aliases: view / v / info / show all print the packument.
  if (s === 'view' || s === 'v' || s === 'info' || s === 'show') return condensePkgView(text);
  if (s === 'pack' || s === 'publish')                        return condensePkgPack(text) ?? stripPkgNoise(text);
  if (s === 'doctor')                                         return condensePkgDoctor(text);

  return stripPkgNoise(text);
}

// ── npm / pnpm / yarn audit ───────────────────────────────────────────────────
// All severity levels, nothing else.
function condensePkgAudit(text) {
  // JSON mode (npm audit --json)
  try {
    const json = JSON.parse(text);
    const v = json.metadata?.vulnerabilities ?? json.vulnerabilities;
    if (v && typeof v === 'object') {
      const order = ['critical', 'high', 'moderate', 'low', 'info'];
      const parts = order.filter(s => (v[s] ?? 0) > 0).map(s => v[s] + ' ' + s);
      const total = order.reduce((n, s) => n + (v[s] ?? 0), 0);
      return total === 0 ? 'audit: 0 vulnerabilities'
                         : 'audit: ' + parts.join(', ') + ' (' + total + ' total)';
    }
  } catch {}

  // Plain text mode
  const lines = text.split('\\n');
  const counts = {};
  const order  = ['critical', 'high', 'moderate', 'low', 'info'];

  for (const line of lines) {
    for (const sev of order) {
      const m = line.match(new RegExp('(\\\\d+)\\\\s+' + sev, 'i'));
      if (m) counts[sev] = Math.max(counts[sev] ?? 0, +m[1]);
    }
  }

  const parts = order.filter(s => (counts[s] ?? 0) > 0).map(s => counts[s] + ' ' + s);
  if (parts.length === 0) {
    const ok = lines.find(l => /found 0 vulnerabilities|No known vulnerabilities/i.test(l));
    return ok?.trim() ?? text;
  }
  const total = order.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return 'audit: ' + parts.join(', ') + ' (' + total + ' total)';
}
`

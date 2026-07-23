// Git command handler source (injected into proxy.mjs at startup)

export const GIT_HANDLER = `
// ── git arg rewriting ─────────────────────────────────────────────────────────
// Rewrites git log / status args before running to produce compact output
// directly rather than post-processing verbose output.
// Returns { args, injected }. \`injected\` lists only the flags this function
// added, so the caller can disclose an injection that changed the ANSWER rather
// than merely the format - "-20" drops commits, and an agent that is not told
// cannot know it saw 20 of 400.
function rewriteGitArgs(args) {
  const { sub, subIndex } = resolveSub('git', args);

  if (sub === 'log') {
    const hasFormat = args.some(a =>
      a.startsWith('--pretty') || a.startsWith('--format') ||
      a === '--oneline' || a === '--no-walk' || a === '--graph');
    const hasLimit = args.some(a =>
      /^-\\d+$/.test(a) || a === '-n' || a === '--max-count' || /^--max-count=/.test(a));
    const injected = [];
    let limit = 0;
    if (!hasFormat) injected.push('--pretty=format:%h %s (%ar) <%an>');
    if (!hasLimit) { injected.push('-20'); limit = 20; }
    return { args: ttSpliceBeforePathspec(args, subIndex, injected), injected, limit };
  }

  if (sub === 'status') {
    const fmt = ttStatusFormat(args);

    // -v/-vv exists to APPEND the staged diff, and short mode prints no diff at
    // all - so injecting --short here deletes exactly the thing the flag was
    // typed to get, and deletes it silently (\`injected\` is only surfaced when
    // a limit was set, and status sets none). A caller who asked for short mode
    // as well has already given the patch up, so only the -v-alone case is
    // exempt.
    if (fmt.verbose && !fmt.short) return { args, injected: [], limit: 0 };

    // --porcelain is a machine format the frame hands back untouched. A "##"
    // record it did not ask for is one more line for whatever is parsing it.
    //
    // -z says the same thing in one character. git-status(1): "-z ... implies
    // the --porcelain=v1 output format if no other format is given" - and on
    // top of that it terminates every entry with NUL instead of LF, which is
    // the whole reason to type it: \`git status -z | xargs -0\` is how a consumer
    // reads paths containing spaces or newlines. Splicing --branch in there
    // prepends a "## main\\0" record, so the FIRST item that consumer receives
    // is a branch name where it expects a path. rewriteArgs runs BEFORE the
    // spawn, so nothing downstream can observe the fabricated record, let alone
    // undo it. -z is read off the cluster scan below, because "git status -sz"
    // is real argv and an exact-token match would miss it.
    if (fmt.porcelain || fmt.z) return { args, injected: [], limit: 0 };

    // In git's XY short format the first column is the INDEX state, so a
    // LEADING BLANK is data: " M f" is modified-but-not-staged, "M  f" is
    // staged. compress() ends in .trim(), which eats the first row's blank and
    // leaves an unstaged file reading as a staged one - a one-character lie
    // about the thing \`git status -s\` is run to find out. --branch puts git's
    // own "## <branch>" line in front of the rows, which is the only reason
    // bare \`git status\` never had this bug.
    const injected = [];
    if (!fmt.short) injected.push('--short');
    if (!fmt.branch) injected.push('--branch');
    if (!injected.length) return { args, injected: [], limit: 0 };

    const copy = args.slice();
    // Splice after the subcommand, which is not necessarily at index 0
    // ("git -C /repo status").
    copy.splice(subIndex + 1, 0, ...injected);
    // Format-only: --short/--branch reshape the output, they drop no rows.
    return { args: copy, injected, limit: 0 };
  }

  return { args, injected: [], limit: 0 };
}

// Everything after a "--" is a PATHSPEC, not a flag. Appending the injected
// flags to the end of argv hands them to git as two more paths: no format is
// applied, no limit is applied, every commit is printed - and the frame then
// tells the agent its output was "capped at the 20 most recent entries", a
// false statement about the text it just read. Splice in front of the
// separator; with no separator this is still a plain append.
function ttSpliceBeforePathspec(args, subIndex, injected) {
  if (!injected.length) return args;
  let at = args.length;
  for (let i = Math.max(subIndex, 0); i < args.length; i++) {
    if (String(args[i]) === '--') { at = i; break; }
  }
  const copy = args.slice();
  copy.splice(at, 0, ...injected);
  return copy;
}

// Which output-shape flags a \`git status\` invocation already carries. Clustered
// short flags are real ("git status -sb"), and -u takes an ATTACHED value
// ("-uno", "-uall"), so a cluster scan stops at the first flag that swallows
// the rest of the token rather than reading "-uno" as -u -n -o.
//
// \`z\` rides the same scan as \`s\` and \`b\`, so "-sz" and "-zs" report it as
// surely as a bare "-z" does. It is a FORMAT declaration, not a decoration:
// git's own docs make it imply --porcelain=v1, and it is what turns the output
// into the NUL-delimited stream \`xargs -0\` reads.
function ttStatusFormat(args) {
  const fmt = { short: false, branch: false, porcelain: false, verbose: false, z: false };
  for (const raw of args ?? []) {
    const a = String(raw);
    // Past "--" every token is a pathspec, and a file may be named "-s".
    if (a === '--') break;
    if (a === '--porcelain' || /^--porcelain=/.test(a)) { fmt.porcelain = true; continue; }
    // \`-z\` has a long spelling. builtin/commit.c registers the option as
    // OPT_BOOL('z', "null", &s.null_termination, ...), so "git status --null"
    // is the SAME flag and prints the SAME NUL-delimited stream - verified
    // against git 2.52: \`git status --null\` and \`git status -z\` are byte
    // identical, and \`git status --short --branch --null\` prepends
    // "## <branch>\\0" to it exactly as the -z form did. parse-options also
    // auto-generates the negation, so "--no-null" turns it back off.
    if (a === '--null')    { fmt.z = true; continue; }
    if (a === '--no-null') { fmt.z = false; continue; }
    if (a === '--short')   { fmt.short = true; continue; }
    if (a === '--branch')  { fmt.branch = true; continue; }
    if (a === '--verbose') { fmt.verbose = true; continue; }
    if (!/^-[A-Za-z]+$/.test(a)) continue;
    for (let i = 1; i < a.length; i++) {
      const c = a.charAt(i);
      if (c === 'u') break;
      if (c === 's') fmt.short = true;
      else if (c === 'b') fmt.branch = true;
      else if (c === 'v') fmt.verbose = true;
      else if (c === 'z') fmt.z = true;
    }
  }
  return fmt;
}

// ── diff-family dispatch ──────────────────────────────────────────────────────
// \`git diff\` covers three unrelated output shapes and only ONE of them is a
// unified diff. Routing everything through the +/- body condenser annihilates
// the other two, so decide here before touching the text.
//
//   machine formats (--name-only/--name-status/--numstat/--raw/-z)  → verbatim
//   --stat / --shortstat / --dirstat                                → condenseStat
//   a real unified diff (with an optional commit header, i.e. show) → condenseDiffBody
//   anything unrecognised                                           → verbatim
//
// The verbatim fallback is the rule every other condenser in this file already
// follows: never fabricate a summary from a shape you did not recognise.
function condenseDiff(text, cmdArgs) {
  const args = cmdArgs ?? [];
  const has = (re) => args.some(a => re.test(String(a)));

  // Machine-readable formats exist to be piped (\`git diff --name-only | xargs\`).
  // Reshaping them breaks the consumer, so they pass through untouched.
  if (has(/^(--name-only|--name-status|--numstat|--raw|--porcelain|-z)$/)) return text;

  // \`git show --stat\` / \`git log --stat\` carry a commit header with no
  // "diff --git" marker anywhere, so the header must be split off here too -
  // otherwise the 40-char hash, the Author/Date labels and the email land in
  // the stat rows verbatim, which is the opposite of condensing.
  if (has(/^--(stat|shortstat|dirstat|stat=)/)) return splitCommitHeader(text, condenseStat);

  // Split an optional commit header (git show / git log -p) from the patch.
  const patchAt = text.search(/^diff --git /m);
  if (patchAt > 0) {
    const header = condenseCommitHeader(text.slice(0, patchAt));
    const body = condenseDiffBody(text.slice(patchAt));
    return header ? header + '\\n\\n' + body : body;
  }

  // No unified-diff marker anywhere: not something this condenser understands.
  if (!/^(diff --git |@@ )/m.test(text)) return text;

  return condenseDiffBody(text);
}

// Applies \`rest\` to everything after an optional leading commit header, and
// prepends the condensed header. Used by both the --stat and the patch paths.
function splitCommitHeader(text, rest) {
  if (!/^commit [0-9a-f]{7,40}/m.test(text)) return rest(text);
  const lines = text.split('\\n');
  // The header ends at the first line that is neither a "Field: value" line,
  // a 4-space-indented message line, nor blank.
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/^(commit|Author|AuthorDate|Commit|CommitDate|Date|Merge|Reflog)\\b/.test(l)) continue;
    if (/^ {4}/.test(l)) continue;
    break;
  }
  const header = condenseCommitHeader(lines.slice(0, i).join('\\n'));
  const body   = rest(lines.slice(i).join('\\n'));
  return header ? header + '\\n' + body : body;
}

// ── commit header (git show / git log -p) ─────────────────────────────────────
// Keeps the short hash, author name, date and the full message - the reason the
// agent ran \`git show\` in the first place. Drops the 40-char hash tail, the
// email, the time and the timezone.
function condenseCommitHeader(head) {
  const hash   = (head.match(/^commit ([0-9a-f]{7,40})/m)?.[1] ?? '').slice(0, 7);
  const author = head.match(/^Author:\\s+(.+?)\\s*</m)?.[1]?.trim() ?? '';
  const dateM  = head.match(/^Date:\\s+\\w+\\s+(\\w+\\s+\\d+)\\s+[\\d:]+\\s+(\\d{4})/m);
  const date   = dateM ? dateM[1] + ' ' + dateM[2] : '';

  const msg = head.split('\\n').filter(l => /^ {4}/.test(l)).map(l => l.slice(4).trimEnd());
  while (msg.length && !msg[msg.length - 1]) msg.pop();

  const first = [hash, author ? '<' + author + '>' : '', date ? '(' + date + ')' : '']
    .filter(Boolean).join(' ');
  return [first, ...msg].filter((l, i) => i === 0 ? l : true).join('\\n').trim();
}

// ── --stat / --shortstat ──────────────────────────────────────────────────────
// Keeps every path and its churn count plus the totals line; drops only the
// +++--- histogram bar, which carries no information the count does not.
function condenseStat(text) {
  const CAP = 40;
  const rows = [];
  let totals = '';

  for (const raw of text.split('\\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^\\d+ files? changed/.test(t)) { totals = t; continue; }
    // " path | 12 ++++----"  or  " logo.png | Bin 0 -> 4523 bytes"
    const m = raw.match(/^\\s+(.+?)\\s+\\|\\s+(Bin\\b.*|\\d+.*)$/);
    if (m) { rows.push(m[1].trim() + '  ' + m[2].replace(/\\s*[+-]+\\s*$/, '').trim()); continue; }
    rows.push(t);
  }

  if (!totals && rows.length === 0) return text;
  const out = [];
  if (totals) out.push('[git] ' + totals);
  for (const r of rows.slice(0, CAP)) out.push('  ' + r);
  // The flag is whatever the host configured (README documents
  // \`fullFlag: '--raw'\`), so it has to come from the placeholder like every
  // other marker in this file. Hard-coding "--full" tells the agent to re-run
  // with a flag that does not exist on that host: the frame forwards it to git
  // verbatim, which exits 129 with a usage dump.
  if (rows.length > CAP) out.push('  ... +' + (rows.length - CAP) + ' more files (__TT_FULL_FLAG__)');
  return out.join('\\n');
}

// ── unified diff body ─────────────────────────────────────────────────────────
// Strips context + hunk headers; caps each hunk at MAX_PER_HUNK changed lines.
//
// Two rules here are load-bearing, and both were learned by getting them wrong:
//
//   A "--- " / "+++ " line names a file only inside an entry's HEADER block,
//   i.e. before that entry's first "@@". After it they are ordinary CONTENT:
//   "--" opens a comment in SQL, Haskell, Lua and Ada, so a removed comment
//   line renders as "--- <text>", and any file that quotes a patch (a
//   CHANGELOG, a .patch, this file's own fixtures) has added lines that render
//   as "+++ <text>". Classified as headers, the removed line was deleted from
//   the body AND from the -N count, and the added line was printed as a changed
//   PATH - a file name that appears nowhere in the diff.
//
//   The path line is written once per ENTRY, from whichever line git used to
//   name the file, never from "+++ " alone. A rename, a mode change and a
//   binary change have no "+++ " line at all, and a deletion's says
//   "/dev/null" - so those entries were counted in "N file(s)" and then named
//   nowhere, and a deleted file's removed lines were printed under a heading
//   that read "/dev/null".
function condenseDiffBody(text) {
  const MAX_PER_HUNK = 80;
  const lines = text.split('\\n');
  const out = [];
  let added = 0, removed = 0, files = 0;
  let hunkCount = 0, hunkSkipped = 0;
  // Header lines exist only before this entry's first "@@".
  let inHunk = false;
  // Per-entry facts, collected until the path line is written.
  let open = false, named = false, gitLine = '';
  let oldPath = '', newPath = '', renameFrom = '', renameTo = '';
  let state = '', oldMode = '', newMode = '', binary = '';

  function flushSkipped() {
    if (hunkSkipped > 0) { out.push('... (' + hunkSkipped + ' lines skipped)'); hunkSkipped = 0; }
  }

  // One "── path" line per entry, written as soon as its header block is over
  // (at the first hunk, or when the entry ends). Every word in it came off a
  // line git printed.
  function writePath() {
    if (!open || named) return;
    named = true;

    const notes = [];
    let label = '';
    if (renameFrom && renameTo) { label = renameFrom + ' -> ' + renameTo; notes.push('rename'); }
    else label = newPath || oldPath || ttDiffGitPath(gitLine);
    if (state) notes.push(state);
    if (oldMode && newMode && oldMode !== newMode) notes.push('mode ' + oldMode + ' -> ' + newMode);
    const suffix = notes.length ? ' (' + notes.join(', ') + ')' : '';

    // No line named the file and git's own "diff --git" line cannot be split
    // into two paths without guessing where one ends and the other begins (a
    // path may contain spaces). Hand that line back rather than guess.
    out.push(label ? '\\n── ' + label + suffix : '\\n' + gitLine + suffix);
    // "Binary files a/x and b/x differ" is the entire content of a binary
    // entry: dropped, the change reads as "+0 -0", i.e. as nothing at all.
    if (binary) out.push(binary);
  }

  function endEntry() {
    flushSkipped();
    writePath();
    open = false; named = false; inHunk = false; gitLine = '';
    oldPath = ''; newPath = ''; renameFrom = ''; renameTo = '';
    state = ''; oldMode = ''; newMode = ''; binary = '';
  }

  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      endEntry();
      hunkCount = 0; files++; open = true; gitLine = raw.replace(/\\s+$/, '');
      continue;
    }
    if (raw.startsWith('@@')) {
      flushSkipped(); hunkCount = 0; inHunk = true; writePath(); continue;
    }
    if (!inHunk) {
      if (raw.startsWith('--- ')) { oldPath = ttDiffPath(raw.slice(4)); continue; }
      if (raw.startsWith('+++ ')) { newPath = ttDiffPath(raw.slice(4)); continue; }
      if (raw.startsWith('rename from ')) { renameFrom = raw.slice(12).trim(); continue; }
      if (raw.startsWith('rename to '))   { renameTo   = raw.slice(10).trim(); continue; }
      if (raw.startsWith('deleted file')) { state = 'deleted'; continue; }
      if (raw.startsWith('new file'))     { state = 'new'; continue; }
      if (raw.startsWith('old mode '))    { oldMode = raw.slice(9).trim(); continue; }
      if (raw.startsWith('new mode '))    { newMode = raw.slice(9).trim(); continue; }
      if (/^Binary files? /.test(raw))    { binary = raw.replace(/\\s+$/, ''); continue; }
      // Bookkeeping with nothing in it the path line does not already say. A
      // copy names two paths on lines this does not read, so it falls through
      // to the "diff --git" line, which is exactly the "do not guess" case.
      if (/^(index |similarity index |dissimilarity index |copy from |copy to |GIT binary patch)/.test(raw)) continue;
    }
    if (raw.startsWith('+')) {
      added++;
      if (hunkCount < MAX_PER_HUNK) { out.push('+ ' + raw.slice(1)); hunkCount++; }
      else hunkSkipped++;
    } else if (raw.startsWith('-')) {
      removed++;
      if (hunkCount < MAX_PER_HUNK) { out.push('- ' + raw.slice(1)); hunkCount++; }
      else hunkSkipped++;
    }
  }
  endEntry();
  return 'diff: ' + files + ' file(s)  +' + added + ' -' + removed + '\\n' + out.join('\\n');
}

// The path off a "--- a/<path>" / "+++ b/<path>" line. "/dev/null" is not a
// file: it is git saying the file does not exist on that side, and printing it
// as a path names a file the diff never touched.
function ttDiffPath(s) {
  const t = String(s).trim();
  if (t === '/dev/null' || t === '"/dev/null"') return '';
  // git quotes a path with unusual characters; the quotes are part of how git
  // printed the name, so they stay.
  return t.replace(/^("?)[ab]\\//, '$1');
}

// The path off a "diff --git a/<path> b/<path>" line - the only line every
// entry has, and the last resort for one that named itself nowhere else (a
// mode change, an empty new file). Read ONLY when the two halves are the same
// string: a path may contain spaces, so anything else cannot be split without
// guessing, and the caller falls back to echoing git's line whole.
function ttDiffGitPath(line) {
  const m = String(line).trim().match(/^diff --git a\\/(.+) b\\/\\1$/);
  return m ? m[1] : '';
}

// ── git log (fallback post-processor for verbose format) ─────────────────────
function condenseGitLog(text, cmdArgs) {
  const args = (cmdArgs ?? []).map(String);

  // --graph draws an ASCII gutter down the left of EVERY line. Flattened into a
  // context window the topology is decoration, and while it is there it also
  // hides the "commit "/"diff --git " markers every condenser here keys on -
  // including the frame's own diff sniff, which is why "log --graph -p" arrives
  // in this function rather than in condenseDiff.
  const body = args.indexOf('--graph') !== -1 ? ttStripGraphGutter(text) : text;

  // --oneline, --pretty=..., or a graph of one-liners: no commit header to
  // strip. Never invent a summary here - but --stat still prints its rows under
  // each subject line, and rewriteGitArgs injects a --pretty format into every
  // unformatted \`git log\`, so this is the shape "git log --stat" really arrives
  // in. Left alone it delivers a 700-character +++--- histogram per file.
  if (!/^commit [0-9a-f]{7,40}/m.test(body)) return ttCondenseInlineStats(body);

  const blocks = body.split(/(?=^commit [0-9a-f]{7,40})/m).filter(b => b.trim());
  return blocks.map(b => ttCondenseLogBlock(b)).join('\\n');
}

// One commit: the subject line, plus whatever the caller asked to be printed
// underneath it (--stat rows, or a patch from -p).
function ttCondenseLogBlock(block) {
  const lines = block.split('\\n');
  const hash   = (lines[0].match(/^commit ([0-9a-f]{7,40})/)?.[1] ?? '').slice(0, 7);
  const author = block.match(/^Author:\\s+(.+?)\\s*</m)?.[1]?.trim() ?? '';

  const msg = [];
  const rest = [];
  let inRest = false;
  for (const l of lines) {
    if (inRest) { rest.push(l); continue; }
    if (/^(commit|Author|AuthorDate|Commit|CommitDate|Date|Merge|Reflog)\\b/.test(l)) continue;
    // git indents the message by exactly 4 spaces; --stat rows and diff lines
    // do not, which is what ends the header.
    if (/^ {4}/.test(l)) { msg.push(l.slice(4).trimEnd()); continue; }
    if (!l.trim()) continue;
    inRest = true; rest.push(l);
  }

  const subject = msg.find(m => m) ?? '';
  const head = (hash + ' ' + subject + (author ? ' <' + author + '>' : '')).trim();
  // Trailing blanks only: a --stat row's LEADING space is part of the format
  // condenseStat parses, so trimming the front would strand the first file.
  const tail = rest.join('\\n').replace(/\\s+$/, '');
  return tail.trim() ? head + '\\n' + ttCondenseLogTail(tail) : head;
}

// What follows a commit message is one of the two shapes git can print there.
// Both already have a condenser; a third shape we do not recognise is returned
// exactly as it came.
//
// The patch test runs FIRST because it is the unambiguous one: a context line
// inside a diff can easily read like a stat row (" foo | 3"), and mistaking a
// patch for a stat block would summarise a diff that was never counted.
function ttCondenseLogTail(tail) {
  if (/^(diff --git |@@ )/m.test(tail)) return condenseDiff(tail, []);
  if (/^\\s*\\d+ files? changed/m.test(tail) || /^\\s+\\S.*\\s\\|\\s+(Bin\\b|\\d)/m.test(tail)) {
    return condenseStat(tail);
  }
  return tail;
}

// Condenses each RUN of --stat rows in place and leaves every other line
// exactly as it was. A run is unmistakable: a leading space, a path, "|", and a
// count. The totals line only counts as part of a run when rows precede it, so
// a commit subject that happens to read "3 files changed in the build" is not
// mistaken for a stat block.
function ttCondenseInlineStats(text) {
  const lines = text.split('\\n');
  const out = [];
  let run = [];

  function flush() {
    if (!run.length) return;
    out.push(condenseStat(run.join('\\n')));
    run = [];
  }

  for (const l of lines) {
    if (/^\\s+\\S.*\\s\\|\\s+(Bin\\b|\\d)/.test(l) || (run.length && /^\\s*\\d+ files? changed/.test(l))) {
      run.push(l);
      continue;
    }
    flush();
    out.push(l);
  }
  flush();
  return out.join('\\n');
}

// ── log --graph gutter ────────────────────────────────────────────────────────
// The gutter is a run of "<glyph><space>" columns, and its width is set by the
// commit line of the block it belongs to (a merge widens it to two columns and
// the next root narrows it again). Taking the width from the commit line is what
// keeps the message's own 4-space indent, which sits BEHIND the gutter.
function ttStripGraphGutter(text) {
  const out = [];
  let width = 0;

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) { out.push(''); continue; }

    const m = raw.match(/^(.*?)(commit [0-9a-f]{7,40}\\b.*)$/);
    if (m && (m[1] === '' || ttIsGraphGlyphs(m[1]))) {
      width = m[1].length;
      out.push(m[2]);
      continue;
    }
    // Anything wider than the gutter has content behind it - tested before the
    // structural test below, so a code line that happens to be drawn out of
    // "|/_ " characters is kept rather than mistaken for topology.
    if (width > 0 && raw.length > width && ttIsGraphGlyphs(raw.slice(0, width))) {
      out.push(raw.slice(width));
      continue;
    }
    // A row of pure glyphs ("|\\", "| |", "|/") carries topology and nothing else.
    if (ttIsGraphGlyphs(raw)) continue;
    // No block context (--oneline and friends): strip the columns and the
    // padding a merge row adds, since there is no indent to preserve.
    const n = ttGraphPrefixLen(raw);
    out.push(n ? raw.slice(n).replace(/^ +/, '') : raw);
  }
  return out.join('\\n');
}

function ttIsGraphGlyphs(s) {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if ('*|/\\\\_ '.indexOf(s.charAt(i)) === -1) return false;
  }
  return true;
}

// Length of the leading "<glyph> " column run. Spaces only count as part of a
// column, never as the start of one, so a merge row's extra padding is left for
// the caller to decide about.
function ttGraphPrefixLen(line) {
  let i = 0;
  while (i < line.length) {
    if ('*|/\\\\_'.indexOf(line.charAt(i)) === -1) break;
    i++;
    if (line.charAt(i) === ' ') i++;
  }
  return i;
}

// ── other git subcommands ─────────────────────────────────────────────────────
// blame, branch, tag, reflog, shortlog, stash list, ls-files, remote, describe.
// Anything not listed here is a shape this file does not understand, and the
// only honest thing to do with a shape you cannot parse is hand it back.
function condenseGitOther(text, sub, cmdArgs) {
  const args = (cmdArgs ?? []).map(String);

  if (sub === 'blame') {
    // git's own machine formats for blame. \`--porcelain\` is caught globally by
    // isMachineOutput; these two are not, and both are parsed by tooling.
    if (args.indexOf('--line-porcelain') !== -1 || args.indexOf('--incremental') !== -1) return text;
    return ttShorterOf(condenseGitBlame(text), text);
  }

  if (sub === 'remote') return ttShorterOf(condenseGitRemote(text), text);

  if (sub === 'reflog') return ttShorterOf(condenseGitReflog(text), text);

  if (sub === 'shortlog') return ttShorterOf(condenseGitShortlog(text, args), text);

  // A worktree table is aligned to its longest path, so most of every line is
  // padding. Nothing else here is compressible: the paths are the answer.
  // (--porcelain is already handled globally by isMachineOutput.)
  //
  // The split is anchored on the trailing "<hash> [branch]" column rather than
  // on "two or more spaces", because a directory name may itself contain a
  // double space and a path that has been rewritten is a path that will not cd.
  if (sub === 'worktree' && args.indexOf('list') !== -1) {
    const rows = text.split('\\n').map(function (l) {
      const m = l.match(/^(.*?)\\s{2,}([0-9a-f]{7,40} (?:\\[[^\\]]*\\]|\\(detached HEAD\\))(?: .*)?|\\(bare\\)(?: .*)?)$/);
      return m ? m[1] + ' ' + m[2] : l;
    });
    return ttShorterOf(rows.join('\\n'), text);
  }

  if (sub === 'stash' && args.indexOf('list') !== -1) {
    return ttShorterOf(condenseGitStashList(text), text);
  }

  if (sub === 'ls-files') {
    // -z packs every path into one NUL-delimited line for \`xargs -0\`.
    if (args.indexOf('-z') !== -1) return text;
    return ttCapList(text, 40, 20, 'paths');
  }

  if (sub === 'tag') {
    if (args.some(a => a === '--format' || /^--format=/.test(a))) return text;
    // Tags are printed in ascending order, so the tail is the current state of
    // the project and the head shows how the naming scheme started.
    return ttCapList(text, 5, 35, 'tags');
  }

  if (sub === 'branch') {
    // A caller-supplied --format is a shape only the caller knows how to read.
    if (args.some(a => a === '--format' || /^--format=/.test(a))) return text;
    return ttShorterOf(condenseGitBranch(text, args), text);
  }

  return text;
}

// Condensing must never cost tokens. Several git listings are already terse
// when the repo is small - a summary header would then be pure overhead - so
// the condensed form only wins when it is actually smaller.
function ttShorterOf(out, text) {
  return out && out.length < text.length ? out : text;
}

// A plain one-per-line listing (tags, tracked paths) is canonical \`| xargs\`
// input: the only safe transform is to drop entries from the middle and say so.
// Nothing is indented, grouped, reordered or rewritten.
// Caps a list of DATA lines. The elision is disclosed OUT OF BAND (see
// ttCapDataList in args.ts): these lists exist to be piped, and
// \`git ls-files | xargs prettier --write\` would take an inline
// "... N elided ..." marker as six filenames that do not exist.
function ttCapList(text, head, tail, noun) {
  const lines = text.split('\\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const capped = ttCapDataList(lines, head, tail, noun);
  return capped === lines ? text : capped.join('\\n');
}

// ── blame ─────────────────────────────────────────────────────────────────────
// Every line carries "^<hash> (<Author> <date> <time> <tz> <lineno>) <code>",
// roughly 50 bytes of prefix per line of code. Lines that are next to each other
// almost always come from the same commit, so one header per contiguous run and
// bare code underneath keeps the whole answer at a fraction of the cost.
function condenseGitBlame(text) {
  const lines = text.split('\\n');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return text;

  const out = [];
  const buf = [];
  let hash = '', author = '', date = '', first = 0, last = 0, open = false;

  // The run's header can only be written once its last line is known, so the
  // code is buffered and emitted underneath the header the run turned out to need.
  function flush() {
    if (!open) return;
    // All-zero is git's sentinel for "still in the working tree". Rendered as a
    // hash it reads like a real commit the agent could \`git show\`.
    const id = /^0+$/.test(hash) ? 'uncommitted' : hash.slice(0, 7);
    const range = first === last ? 'L' + first : 'L' + first + '-' + last;
    out.push(id + ' <' + author + '> ' + date + '  ' + range);
    for (const c of buf) out.push(c);
    buf.length = 0;
    open = false;
  }

  for (const raw of lines) {
    const m = raw.match(
      /^(\\^?[0-9a-f]{7,40})(?:\\s+[^\\s(]\\S*)?\\s+\\((.+?)\\s+(\\d{4}-\\d{2}-\\d{2})\\s+[\\d:]+\\s+[+-]\\d{4}\\s+(\\d+)\\)(?: (.*))?$/,
    );
    // One unparsed line means this is not the shape we think it is. Bail out
    // whole rather than emit a half-collapsed file.
    if (!m) return text;

    const id = m[1].replace(/^\\^/, '');
    const lineNo = Number(m[4]);
    const code = m[5] ?? '';
    // A blank source line cannot be emitted as a blank OUTPUT line: the frame
    // collapses every run of blank lines to one and trims the tail, so five
    // blank lines would come out as one - and the header above them would go on
    // claiming "L1-11" over seven printed lines. \`git blame\` is the command run
    // to answer "who wrote line N", so an agent counting down from the range
    // would land on the wrong line.
    //
    // It cannot be stood in for either. A placeholder glyph is a character the
    // file does not contain, and it collides with a line whose content really
    // IS that glyph. So a blank line is DROPPED - deleting is always allowed -
    // and it ENDS the run, so the next header states the line the code under it
    // really starts at. Every header then covers exactly what is printed
    // beneath it, and nothing was invented to make that true.
    if (!code.trim()) { flush(); continue; }
    // A run is contiguous in the SOURCE, not just in the hash. \`git blame\`
    // accepts several \`-L\` ranges and prints them back to back with nothing
    // between them, so line 2 can be followed by line 40 - and a run keyed on
    // the hash alone spans that gap, leaving a header that claims L2-40 over
    // the two lines it printed. The line number is read off every row anyway,
    // so a gap ENDS the run exactly the way a blank line does: the next header
    // states the line its code really starts at, and nothing is invented to
    // bridge the ranges git chose not to print.
    if (!open || id !== hash || lineNo !== last + 1) {
      flush();
      hash = id; author = m[2].trim(); date = m[3]; first = lineNo; open = true;
    }
    last = lineNo;
    buf.push(code);
  }
  flush();
  return out.join('\\n');
}

// ── shortlog ──────────────────────────────────────────────────────────────────
// Two shapes: "-s" summary rows ("  142\\tAlice"), and the default grouping of
// subjects under "Author (n):" at a 6-space indent with a blank line between
// groups. Both are mostly whitespace; every author, count and subject is kept.
function condenseGitShortlog(text, cmdArgs) {
  const PER_AUTHOR = 10;
  const lines = text.split('\\n').filter(l => l.trim());
  if (!lines.length) return text;

  if (/^\\s*\\d+\\t/.test(lines[0])) {
    const out = [];
    for (const raw of lines) {
      const m = raw.match(/^\\s*(\\d+)\\t(.*)$/);
      if (!m) return text;
      out.push(m[1] + ' ' + m[2].trim());
    }
    return out.join('\\n');
  }

  const wrap = ttShortlogWrap((cmdArgs ?? []).map(String));
  const out = [];
  // \`seen\` counts SUBJECTS, never physical lines: with -w git wraps a long
  // subject across several lines, and a continuation is not another commit.
  let seen = 0, indent = 0, prev = '', declared = -1, unsure = false;

  // The overflow marker is written when the group ends, so it reports what was
  // actually elided. Deriving it from the header's declared total printed a
  // NEGATIVE count the moment the two disagreed - and they disagree whenever a
  // subject wraps.
  function endGroup() {
    // When the two indents are the same, nothing on a line says whether it
    // opens a commit or continues one, so the split below is a RECONSTRUCTION
    // of git's wrapper rather than something read off the text. git already
    // printed the answer in the group header, so check against it: a
    // reconstruction that disagrees is regrouping subjects wrongly, and wrong
    // grouping is worse than no compression at all.
    if (wrap.i2 <= wrap.i1 && declared >= 0 && seen !== declared) unsure = true;
    if (seen > PER_AUTHOR) {
      out.push('  ... +' + (seen - PER_AUTHOR) + ' more (__TT_FULL_FLAG__)');
    }
    seen = 0; indent = 0; prev = ''; declared = -1;
  }

  for (const raw of lines) {
    const head = raw.match(/^(\\S.*) \\((\\d+)\\):$/);
    if (head) { endGroup(); declared = Number(head[2]); out.push(raw.trim()); continue; }
    const subject = raw.match(/^( {4,})(.*)$/);
    if (!subject) return text;

    // Counting a continuation as a commit overshoots the group, cuts a subject
    // in half at the cap, and re-indents the remainder into something that
    // reads like a commit of its own. Rejoin it with the subject it belongs to.
    //
    // By default git indents a continuation DEEPER than the subject (6 and 9),
    // which settles it outright - but \`-w<width>,<i1>,<i2>\` lets the caller set
    // i2 <= i1, and then the indent says nothing. What is still true is that
    // git wraps greedily, so fall back on that.
    const cont = seen > 0 && (wrap.i2 > wrap.i1
      ? subject[1].length > indent
      : ttShortlogWrapped(prev, subject[2], wrap.width));
    prev = raw.replace(/\\s+$/, '');
    if (cont) {
      if (seen <= PER_AUTHOR) out[out.length - 1] += ' ' + subject[2].trim();
      continue;
    }
    if (!indent) indent = subject[1].length;
    seen++;
    if (seen <= PER_AUTHOR) out.push('  ' + subject[2].trim());
  }
  endGroup();
  if (unsure) return text;
  return out.length ? out.join('\\n') : text;
}

// git wraps greedily: it fills a line and breaks before the first word that no
// longer fits. So a line continues the one above it exactly when the line above
// could not have taken this line's first word - a test that needs no indent,
// which is all that is left when the caller flattens indent2 onto indent1.
function ttShortlogWrapped(prev, rest, width) {
  if (!prev || !(width > 0)) return false;
  const word = rest.trim().split(/\\s+/)[0];
  return prev.length + 1 + word.length > width;
}

// git shortlog wraps by DEFAULT at 76 columns, indenting the subject by 6 and a
// continuation by 9; \`-w<width>,<indent1>,<indent2>\` overrides any prefix of
// that. Only the attached form exists - -w takes an OPTIONAL argument, so
// "-w 60" would be a revision range rather than a width. A width of 0 (which is
// also what git's strtoul reads out of "-w,6,6") indents without wrapping, so
// no line there can be a continuation.
function ttShortlogWrap(args) {
  const spec = { width: 76, i1: 6, i2: 9 };
  for (const a of args) {
    if (a === '-w') continue;
    const m = a.match(/^-w(\\d*)(?:,(\\d*)(?:,(\\d*))?)?$/);
    if (!m) continue;
    spec.width = m[1] ? Number(m[1]) : 0;
    if (m[2]) spec.i1 = Number(m[2]);
    if (m[3]) spec.i2 = Number(m[3]);
  }
  return spec;
}

// ── stash list ────────────────────────────────────────────────────────────────
// "stash@{0}: WIP on main: <hash> <subject>" - "WIP on"/"On" is boilerplate the
// branch name already implies. The stash@{n} handle stays exactly as printed:
// it is the argument \`git stash pop/drop/show\` takes.
function condenseGitStashList(text) {
  const out = [];
  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(stash@\\{\\d+\\}): (?:WIP on|On) ([^:]+): (.*)$/);
    if (!m) return text;
    out.push(m[1] + ' ' + m[2] + ' ' + m[3]);
  }
  return out.length ? out.join('\\n') : text;
}

// ── reflog ────────────────────────────────────────────────────────────────────
// Every entry repeats the ref it belongs to ("HEAD@{7}: "), which is the same
// string on every line. State it once in a header and keep the index, which is
// the part the agent needs to address the entry. Entries are newest first, so
// the cap drops the oldest - and the header says how many.
function condenseGitReflog(text) {
  const CAP = 40;
  const rows = [];
  let ref = '';

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(/^([0-9a-f]{7,40})\\s+(\\S+)@\\{(\\d+)\\}:\\s*(.*)$/);
    // \`--date=\` replaces the index with a timestamp, and a caller format can be
    // anything at all. Neither is this shape.
    if (!m) return text;
    if (!ref) ref = m[2];
    // A mixed-ref listing cannot be summarised by a single header.
    if (m[2] !== ref) return text;
    rows.push('@{' + m[3] + '} ' + m[1].slice(0, 7) + ' ' + m[4]);
  }
  if (!rows.length) return text;

  // The header spells the index syntax out: a bare "@{3}" is the CURRENT
  // BRANCH's reflog, a different ref from HEAD@{3}, and an agent that pastes
  // the short form back into a command gets a different entry than it read.
  const head = '[git] ' + rows.length + ' reflog entries, index n is ' + ref + '@{n}' +
    (rows.length > CAP ? ' (' + CAP + ' shown, __TT_FULL_FLAG__ for all)' : '');
  return [head].concat(rows.slice(0, CAP)).join('\\n');
}

// ── remote -v ─────────────────────────────────────────────────────────────────
// \`git remote -v\` prints every URL twice, and for almost every repo the two are
// the same string. Collapse the identical pair; keep both when they differ,
// because a push URL that is not the fetch URL is the reason -v was run.
function condenseGitRemote(text) {
  const order = [];
  // Null prototype: a remote may legitimately be named "constructor".
  const urls = Object.create(null);

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\\S+)\\s+(\\S+)\\s+\\((fetch|push)\\)$/);
    // \`git remote\` (names only) and \`git remote show\` land here: not this shape.
    if (!m) return text;
    if (!urls[m[1]]) { urls[m[1]] = {}; order.push(m[1]); }
    urls[m[1]][m[3]] = m[2];
  }
  if (!order.length) return text;

  const out = [];
  for (const name of order) {
    const e = urls[name];
    if (e.fetch && e.fetch === e.push) { out.push(name + ' ' + e.fetch); continue; }
    if (e.fetch) out.push(name + ' ' + e.fetch + ' (fetch)');
    if (e.push)  out.push(name + ' ' + e.push + ' (push)');
  }
  return out.join('\\n');
}

// ── branch ────────────────────────────────────────────────────────────────────
// A busy repo lists a handful of local branches and dozens of remote ones, each
// on its own indented line. Locals are what the agent acts on, so they stay one
// per line (marker, ahead/behind and subject intact); remotes are inventory, so
// they collapse onto one line.
function condenseGitBranch(text, args) {
  const CAP_LOCAL = 25;
  const CAP_REMOTE = 40;
  // With -r every entry is remote and git drops the "remotes/" prefix, so the
  // prefix alone cannot decide which list a name belongs to.
  const allRemote = args.some(a => a === '-r' || a === '--remotes');
  const locals = [];
  const remotes = [];

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(/^([*+ ]) +(\\S+)(?: +(.*))?$/);
    // A detached HEAD reads "* (HEAD detached at 4788fef)" and anything else is
    // a shape we have not seen. Either way, do not guess.
    if (!m || m[2].charAt(0) === '(') return text;

    const name = m[2];
    const rest = (m[3] ?? '').replace(/\\s+/g, ' ').trim();
    if (allRemote || /^remotes\\//.test(name)) {
      const short = name.replace(/^remotes\\//, '');
      remotes.push(rest ? short + ' ' + rest : short);
    } else {
      const tail = ttSimplifyTracking(rest, name);
      locals.push(m[1] + ' ' + name + (tail ? ' ' + tail : ''));
    }
  }

  if (!locals.length && !remotes.length) return text;

  const parts = [];
  if (locals.length) parts.push(locals.length + ' local');
  if (remotes.length) parts.push(remotes.length + ' remote');
  const out = ['[git] ' + parts.join(', ') + ' branches'];

  for (const l of locals.slice(0, CAP_LOCAL)) out.push(l);
  if (locals.length > CAP_LOCAL) {
    out.push('  ... +' + (locals.length - CAP_LOCAL) + ' more local (__TT_FULL_FLAG__)');
  }
  if (remotes.length) {
    const shown = remotes.slice(0, CAP_REMOTE).join(', ');
    out.push('remote: ' + shown +
      (remotes.length > CAP_REMOTE ? ', ... +' + (remotes.length - CAP_REMOTE) + ' more (__TT_FULL_FLAG__)' : ''));
  }
  return out.join('\\n');
}

// "[origin/main: ahead 2]" says the same thing as "[ahead 2]" when the upstream
// merely repeats the branch name - which is the overwhelmingly common case. An
// upstream named differently is real information and is left alone, as is a
// bracket in a commit subject ("[WIP] ...").
function ttSimplifyTracking(rest, name) {
  return rest.replace(/^(\\S+) \\[([^\\]]+)\\]/, function (whole, lead, inner) {
    const colon = inner.indexOf(': ');
    if (colon === -1) return ttSameRef(inner, name) ? lead : whole;
    return ttSameRef(inner.slice(0, colon), name)
      ? lead + ' [' + inner.slice(colon + 2) + ']'
      : whole;
  }).replace(/\\s+/g, ' ').trim();
}

function ttSameRef(upstream, name) {
  return upstream === name || upstream.slice(-(name.length + 1)) === '/' + name;
}

// ── git status (fallback post-processor) ─────────────────────────────────────
function condenseGitStatus(text) {
  // A NUL byte can only have come from \`git status -z\`: it is the entry
  // terminator, and no path may contain one. That output exists to be piped
  // (\`git status -z | xargs -0\`), and the .trim() at the end of this function
  // ate the leading blank of the FIRST record - which in git's XY code is data:
  // " M f" is modified-but-not-staged, "M  f" is staged. Trimmed, a consumer
  // reading columns 1-2 as the XY code sees a STAGED file and then takes the
  // path from column 3, i.e. "rc/app.ts" for " M src/app.ts" - a file that
  // exists nowhere in the repo. Hand the stream back exactly as it came.
  if (text.indexOf('\\0') !== -1) return text;

  const NOISE = /^(nothing to commit|no changes added|use "git|nothing added to commit)/;
  const kept = text.split('\\n').filter(l => !NOISE.test(l));
  return kept.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
}
`

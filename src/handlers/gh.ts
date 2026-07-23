export const GH_HANDLER = `
// ── gh ────────────────────────────────────────────────────────────────────────
// \`gh\` is a dozen unrelated tools behind one binary, so the first job is to
// find out which one ran. Every fixture this file is written against is gh's
// NON-TTY shape: the proxy always captures gh through a pipe, and gh switches
// to tab-separated / raw output whenever stdout is not a terminal.
//
// Anything with no dedicated condenser falls through to ghStripMarkdown, which
// is what this handler did for every invocation before subcommands existed.
function condenseGh(text, cmdArgs) {
  const args  = (cmdArgs ?? []).map(String);
  const first = resolveSub('gh', args);
  const sub   = first.sub;
  // Second positional token: gh's command path is always "gh <noun> <verb>",
  // and cobra rejects flags placed before the noun, so re-running resolveSub on
  // the remainder yields the verb without a second flag table.
  const verb  = first.subIndex >= 0
    ? resolveSub('gh', args.slice(first.subIndex + 1)).sub
    : '';

  if (sub === 'run' && verb === 'view' && args.some(a => /^--log(-failed)?$/.test(a))) {
    return condenseGhRunLog(text);
  }

  if (sub === 'pr' && (verb === 'checks' || verb === 'status')) {
    return condenseGhChecks(text);
  }

  // A PR diff is a plain unified diff, so it belongs to the git condenser
  // rather than a second implementation that would drift from it. Passing the
  // real argv through also gets \`--name-only\` right for free: condenseDiff
  // already knows that a bare path list is xargs input and must not be touched.
  if (sub === 'pr' && verb === 'diff') return condenseDiff(text, args);

  // argv goes in too: the comment section exists only when it was asked for,
  // and that is the one signal a PR BODY cannot forge (see ghCommentStarts).
  if ((sub === 'pr' || sub === 'issue') && verb === 'view') return condenseGhView(text, args);

  // Ahead of the generic "list" rule below, which would otherwise claim an
  // endpoint path that happens to end in "list".
  //
  // \`--jq\`/\`--template\` mean the caller already chose the fields. Filtering that
  // result deletes exactly what was asked for ("gh api repo --jq '{html_url}'"
  // came back as "{}"), so an explicit projection is left alone.
  //
  // \`gh api graphql\` is the same situation by construction: a GraphQL response
  // has no fixed schema, every key in it is one the caller's own query named or
  // aliased ("node_id: id" is the usual port of a REST call), and the endpoint
  // returns exactly the selection set and nothing else. There is no noise to
  // recognise, only fields that were asked for.
  if (sub === 'api') {
    const projected = verb === 'graphql'
      || args.some(a => /^(-q|--jq|-t|--template)(=|$)/.test(a));
    return projected ? text : condenseGhApi(text);
  }

  // Deliberately not restricted to pr/issue/run/release: every gh "list" prints
  // the same headerless TSV, and condenseGhList refuses anything that is not
  // one, so the breadth costs nothing.
  if (verb === 'list') return condenseGhList(text);

  return ghStripMarkdown(text);
}

// ── gh pr checks ─────────────────────────────────────────────────────────────
// Non-TTY rows are "<name>\\t<bucket>\\t<elapsed>\\t<url>\\t<description>" with no
// header and no rollup, so the counts are computed here. A green check costs an
// agent nothing to know individually - the count is the whole message - while a
// red one needs its name and the URL to go read.
//
// The red ones are therefore relayed as ROWS, byte-for-byte, tabs included.
// This table is gh's machine format - it is tab-separated precisely because
// stdout is not a tty - and \`gh pr checks | grep -P '\\tfail\\t' | cut -f4\` is
// the pipeline it exists for. Rejoining the kept fields with two spaces (what
// this function used to do) leaves that pipeline reading a description as a
// URL, and since names and descriptions both contain spaces the boundaries are
// unrecoverable. Dropping the green rows is a deletion; re-delimiting the red
// ones would be a corruption.
//
// \`gh pr status\` routes here too and falls out through the guard below: its
// human summary is not this table, and inventing a rollup from it would be the
// exact failure mode this codebase already shipped twice.
function condenseGhChecks(text) {
  const BUCKETS = { pass: 'passed', fail: 'failed', pending: 'pending', skipping: 'skipped', cancel: 'cancelled' };
  const rows = [];

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const f = raw.split('\\t');
    // Anything that is not this exact table means we are looking at some other
    // gh output; bail on the whole text rather than summarise part of it.
    if (f.length < 4 || !Object.prototype.hasOwnProperty.call(BUCKETS, f[1])) return text;
    rows.push(f);
  }
  if (rows.length === 0) return text;

  const counts = {};
  const failed = [];
  for (const f of rows) {
    counts[f[1]] = (counts[f[1]] ?? 0) + 1;
    // f.join('\\t') is the row exactly as it arrived - the split above is the
    // only thing that touched it.
    if (f[1] === 'fail') failed.push(f.join('\\t'));
  }

  const parts = [];
  for (const b of ['pass', 'fail', 'pending', 'skipping', 'cancel']) {
    if (counts[b]) parts.push(counts[b] + ' ' + BUCKETS[b]);
  }

  const out = ['[gh] ' + rows.length + ' checks: ' + parts.join(', '), ...failed].join('\\n');

  // Failing rows are relayed byte-for-byte (they are TSV a caller may cut), so
  // a run where everything failed relays every row AND prepends a rollup - more
  // characters than it received. Never growing is the one promise a compressor
  // makes, and nothing is lost by declining: the rows the rollup counts are
  // exactly the rows gh already printed.
  return out.length < text.length ? out : text;
}

// ── gh run view --log / --log-failed ─────────────────────────────────────────
// Every line is "<job>\\t<step>\\t<ISO-8601 with 7 fractional digits> <message>".
// On a real run that prefix repeats across six-figure line counts and is where
// essentially all of the token cost sits, while carrying no information the
// step header does not. Emit the header once per (job, step) transition and
// keep the message verbatim.
function condenseGhRunLog(text) {
  const ROW = /^([^\\t]*)\\t([^\\t]*)\\t\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z ?(.*)$/;
  const out = [];
  let job = null, step = null, matched = 0;

  for (const raw of text.split('\\n')) {
    const m = raw.match(ROW);
    // A line that is not in the log grammar (gh's own diagnostics, a blank
    // trailer) is kept as-is; reshaping what we did not parse is how a
    // condenser starts inventing.
    if (!m) { out.push(raw); continue; }
    matched++;
    if (m[1] !== job || m[2] !== step) {
      job = m[1]; step = m[2];
      out.push('── ' + job + ' / ' + step);
    }
    // ##[group]/##[endgroup] are fold markers for the Actions web view. The
    // closing one carries nothing at all; the opening one carries only its
    // label. ##[error]/##[warning] are left alone - they are the point.
    if (/^##\\[endgroup\\]\\s*$/.test(m[3])) continue;
    out.push(m[3].replace(/^##\\[group\\]/, ''));
  }

  if (matched === 0) return text;
  return out.join('\\n');
}

// ── gh pr view / gh issue view ───────────────────────────────────────────────
// Non-TTY view output is "<field>:\\t<value>" lines, a "--" separator, then the
// body. gh prints every field whether or not it has a value, so half the header
// is routinely "projects:" / "milestone:" / "assignees:" with nothing after the
// tab. Anything that is not that shape - a bare body piped in from elsewhere -
// falls back to plain markdown stripping.
function condenseGhView(text, args) {
  const lines = text.split('\\n');
  const sep = lines.indexOf('--');
  if (sep <= 0 || !/^[a-z][\\w-]*:\\t/.test(lines[0])) return ghStripMarkdown(text);

  const header = [];
  for (const l of lines.slice(0, sep)) {
    const m = l.match(/^([a-z][\\w-]*):\\t(.*)$/);
    if (m && !m[2].trim()) continue;
    header.push(l);
  }

  // With --comments gh appends one raw block per comment after the body. The
  // first few carry the discussion; a 40-comment thread is mostly restatement,
  // and dropping it silently would leave the agent believing it read the whole
  // thread - so say how many went. Everything that decides whether those blocks
  // are really there lives in ghCommentStarts.
  const MAX_COMMENTS = 3;
  const rest = lines.slice(sep + 1);
  const at = ghCommentStarts(rest, args);

  const body = at.length ? rest.slice(0, at[0]) : rest;
  let tail = '';
  if (at.length) {
    const end = at.length > MAX_COMMENTS ? at[MAX_COMMENTS] : rest.length;
    // "edited" never changes what an agent would do with a comment, and
    // "status: none" is gh's way of saying "a plain comment, not a review" -
    // which the block already conveys. A real verdict (approved / changes
    // requested) is kept: on a PR thread it is the most useful field there is.
    const kept = rest.slice(at[0], end)
      .filter(l => !/^edited:\\t/.test(l) && l !== 'status:\\tnone');
    tail = '\\n' + ghStripMarkdown(kept.join('\\n'));
    if (at.length > MAX_COMMENTS) {
      tail += '\\n... +' + (at.length - MAX_COMMENTS) + ' more comments (__TT_FULL_FLAG__)';
    }
  }

  return header.join('\\n') + '\\n--\\n' + ghStripMarkdown(body.join('\\n')) + tail;
}

// Where gh's comment section starts inside the post-header text, as one index
// per comment - or [] when there is no comment section, which is the answer for
// every body that merely LOOKS like a thread.
//
// Getting this wrong is not a lost saving: the tail of a real BODY gets deleted
// and a count of comments that do not exist is appended, pointing at a --full
// escape hatch that would not bring the text back. A count nobody can check is
// the one thing this file must never emit. So two independent signals have to
// agree, and neither is "a line beginning with author:".
//
//  1. argv. gh appends the comment section if and only if -c/--comments was
//     asked for. This is the signal a body cannot forge, because it is not in
//     the text at all.
//  2. gh's own grammar. Per comment it prints, unconditionally and in this
//     order, "author:", "association:", "edited:", "status:", a "--", the
//     content, and a closing "--". The section is therefore a SUFFIX built
//     entirely of those blocks, so parsing starts at a candidate and must reach
//     the end of the text with every block intact.
//
// A quoted thread fails on the three fields it does not carry, on a block it
// leaves unterminated, or on the prose that follows it - and is left alone.
function ghCommentStarts(rest, args) {
  const argv = (args ?? []).map(String);
  if (argv.indexOf('--comments') === -1 && argv.indexOf('-c') === -1) return [];
  for (let i = 1; i < rest.length; i++) {
    // The section always opens after the "--" that closes the body.
    if (rest[i - 1] !== '--' || !ghIsCommentHead(rest, i)) continue;
    const at = ghParseComments(rest, i);
    if (at) return at;
  }
  return [];
}

function ghIsCommentHead(rest, i) {
  return /^author:\\t/.test(rest[i] ?? '')
    && /^association:\\t/.test(rest[i + 1] ?? '')
    && /^edited:\\t/.test(rest[i + 2] ?? '')
    && /^status:\\t/.test(rest[i + 3] ?? '')
    && rest[i + 4] === '--';
}

// Every comment block from \`start\` to the end of the text, or null if any part
// of that run is not one: a block left unterminated, or anything other than the
// text's own trailing newline after the last block's closing "--". Bailing
// costs a compression; guessing costs the agent a body it will never see again.
function ghParseComments(rest, start) {
  const at = [];
  let i = start;
  while (i < rest.length) {
    if (!ghIsCommentHead(rest, i)) return null;
    at.push(i);
    // Content runs from the "--" that closes the field block to the "--" that
    // closes the comment. A content line that is ITSELF "--" is indistinguish-
    // able from that terminator; it ends this block early, the next head check
    // then fails, and the whole run is rejected rather than guessed at.
    let j = i + 5;
    while (j < rest.length && rest[j] !== '--') j++;
    if (j >= rest.length) return null;
    i = j + 1;
    if (rest.slice(i).every(l => !l)) break;
  }
  return at.length ? at : null;
}

// ── gh <noun> list ───────────────────────────────────────────────────────────
// Non-TTY list output is a headerless TSV. It is tab-separated BECAUSE stdout
// is not a tty: this is gh's machine format, the one
// \`gh pr list | cut -f1 | xargs -n1 gh pr view\` consumes. So two properties of
// the input are data, not layout, and neither may change here:
//
//  1. the TAB. Rejoining the kept fields with two spaces (what this function
//     used to do) turned \`cut -f2\` into "the whole line", and since titles
//     contain spaces the boundaries could not be recovered. Same argument that
//     earned \`git diff --name-only\` its passthrough.
//  2. the INDEX of every field that survives. The column ORDER differs per noun
//     (\`pr list\` is number/title/branch/state/createdAt, \`issue list\` is
//     number/state/title/labels/createdAt) and gh has changed both across
//     releases, so nothing is dropped by position - but dropping a column by
//     CONTENT renumbers every field behind it just as badly. Only TRAILING
//     columns come off; an empty interior column is kept exactly as gh emitted
//     it, so \`cut -f7\` still returns field 7.
//
// Two kinds of trailing column carry nothing: one that holds a timestamp in
// every row (the created-at/published-at column, ~21 chars a row), and one that
// is empty in every row (gh emits the labels/description column even when
// unset). Both are safe to drop because nothing is left behind them to shift.
function condenseGhList(text) {
  const CAP = 50;
  const TIME = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z?$/;
  const rows = [];

  for (const raw of text.split('\\n')) {
    if (!raw.trim()) continue;
    const f = raw.split('\\t');
    // No tab, or a ragged row: this is not the TSV table, and summarising a
    // shape we did not parse is how "0 items" gets reported for real output.
    if (f.length < 2) return text;
    if (rows.length && f.length !== rows[0].length) return text;
    rows.push(f);
  }
  if (rows.length === 0) return text;

  let keep = rows[0].length;
  while (keep > 0) {
    const c = keep - 1;
    let allTime = true, allEmpty = true;
    for (const f of rows) {
      const v = f[c].trim();
      if (v) allEmpty = false;
      if (!TIME.test(v)) allTime = false;
    }
    if (!allEmpty && !allTime) break;
    keep--;
  }
  // Every column looked like noise, which means the shape was misread.
  if (keep === 0) return text;

  const kept = rows.map(f => f.slice(0, keep).join('\\t'));
  // The cap discloses itself OUT OF BAND (ttCapDataList -> stderr). An inline
  // "... +70 more rows" marker inside a stream of TSV rows is handed to the
  // next process as a row, and its words as an id.
  return ttCapDataList(kept, CAP, 0, 'rows').join('\\n');
}

// ── gh api ───────────────────────────────────────────────────────────────────
// A bare \`gh api\` names no format flag, so isMachineOutput cannot tell that the
// payload is JSON - this is the one command in this handler that has to guard
// itself. Most of the saving is the API's own pretty-printing, which compact
// re-serialisation drops for free; on top of that only \`_links\` and \`node_id\`
// are removed (see ghStripApiNoise). Everything else is preserved and the
// result is VALID JSON, because something downstream may still parse it.
function condenseGhApi(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return text; }
  // Scalars (\`gh api --jq '.name'\`) carry no keys to strip and round-tripping
  // them only risks changing them.
  if (data === null || typeof data !== 'object') return text;
  return JSON.stringify(ghStripApiNoise(data));
}

// Only two keys are safe to drop by name. \`_links\` is a pure hypermedia
// envelope duplicating links the payload already carries, and \`node_id\` is the
// GraphQL relay handle for a REST resource - neither is ever the answer to a
// question someone typed \`gh api\` to ask.
//
// \`*_url\` is NOT in that set, however much of a payload it is by volume.
// \`gh api repos/x\` is run to get clone_url / ssh_url / html_url, and
// \`gh api .../releases/latest\` to get browser_download_url; deleting them
// leaves valid JSON with no marker, so neither the agent nor a downstream
// parser can tell the field was ever there. A whole-payload rule cannot
// distinguish those from \`keys_url\`, so the only honest answer is to keep them.
function ghStripApiNoise(v) {
  if (Array.isArray(v)) return v.map(ghStripApiNoise);
  if (v === null || typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === '_links' || k === 'node_id') continue;
    out[k] = ghStripApiNoise(v[k]);
  }
  return out;
}

// ── PR / issue body markdown ─────────────────────────────────────────────────
// Filters markdown noise from PR/issue bodies: HTML comments, badge lines,
// image-only lines, and horizontal rules. Preserves code blocks intact.
function ghStripMarkdown(text) {
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
  return ttTrimBlankEdges(out.join('\\n')) || text;
}
`

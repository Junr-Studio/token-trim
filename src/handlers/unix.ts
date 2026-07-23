// Unix inspection utilities: tree, ps, du, df, systemctl, journalctl.
//
// These are READ-ONLY inspection commands, deliberately excluding every classic
// filter (sort/awk/sed/cut/tr/tee/xargs/wc) whose stdout is machine-consumed by
// definition and which must never be wrapped.
//
export const UNIX_HANDLER = `
// ── tree ──────────────────────────────────────────────────────────────────────
// No depth flag is ever injected: an agent runs \`tree\` to find out WHETHER a
// path exists and what is under it, so a depth limit changes the answer rather
// than the format. Only the presentation is condensed - the 4-char box-drawing
// gutter per level becomes 2 spaces, and the entry set stays complete.
function condenseTree(text, cmdArgs) {
  const parsed = parseTreeEntries(text);
  if (!parsed) return text;

  const nodes = parsed.nodes;
  const hasChild = [];
  let inferred = 0;
  for (let i = 0; i < nodes.length; i++) {
    const isDir = !!nodes[i + 1] && nodes[i + 1].depth > nodes[i].depth;
    hasChild.push(isDir);
    if (isDir) inferred++;
  }

  // Directory-ness has two possible sources, and neither may be invented.
  //
  // \`tree -F\` (and -p) MARKS directories itself, so when the input carries
  // markers they are the answer and they are relayed - stripping them, which is
  // what the name pattern used to do unconditionally, deletes information the
  // input actually had.
  //
  // Otherwise it is INFERRED from "this node has children", and that inference
  // is incomplete: it never marks a file, but it cannot see a directory that
  // printed no children - an empty one, or under \`tree -L n\` every directory at
  // the depth limit. Marking some directories and not others reads as "no slash
  // means file", a distinction plain \`tree\` never made, and it contradicts the
  // "N directories" footer sitting three lines below it.
  //
  // So the inferred marker is emitted only when tree's own footer confirms it is
  // complete. When the footer counts more directories than have children the
  // markers are dropped entirely: the output then carries exactly the
  // information the input did, and the footer still answers "how many dirs".
  const marked = nodes.some(n => n.marked);
  const summaryDirs = treeSummaryDirs(parsed.summary);
  const useInferred = summaryDirs < 0 || summaryDirs === inferred;

  const out = [];
  if (parsed.root !== null) out.push(parsed.root);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isDir = marked ? n.marked : (useInferred && hasChild[i]);
    out.push('  '.repeat(n.depth - 1) + n.name + (isDir ? '/' : ''));
  }
  if (parsed.summary) out.push('', parsed.summary);
  return out.join('\\n');
}

// The directory count from tree's own footer, or -1 when it printed none
// (\`--noreport\`), in which case there is nothing to cross-check against. tree
// does not count the root, so this is directly comparable to the node tally.
function treeSummaryDirs(summary) {
  const m = String(summary ?? '').match(/^(\\d+) director/);
  return m ? +m[1] : -1;
}

// Returns null for anything that is not recognisably \`tree\` output - a bare
// listing (tree -i), an "[error opening dir]" report, or a machine format. A
// summary invented from an unparsed shape would answer the agent's existence
// question with a confident lie, so passthrough is the only safe fallback.
function parseTreeEntries(text) {
  const nodes = [];
  let root = null;
  let summary = '';

  for (const raw of text.split('\\n')) {
    const line = raw.replace(/\\s+$/, '');
    if (!line) continue;
    if (/^\\d+ director(?:y|ies), \\d+ files?$/.test(line)) { summary = line; continue; }

    // Each level is exactly 4 columns: "│   " when the ancestor has more
    // siblings below, "    " when it does not.
    const m = line.match(/^((?:(?:│|\\|)   |    )*)(?:├── |└── |\\|-- |\`-- )(.+)$/);
    if (m) {
      // \`marked\` records whether TREE said this was a directory (-F and -p
      // print a trailing slash). The slash is stripped from the name so the
      // renderer decides once, in one place, whether to put one back.
      nodes.push({
        depth: m[1].length / 4 + 1,
        name: m[2].replace(/\\/$/, ''),
        marked: /\\/$/.test(m[2]),
      });
      continue;
    }

    if (root === null && !/^\\s/.test(line)) { root = line; continue; }
    return null;
  }

  if (nodes.length === 0) return null;
  return { root: root, nodes: nodes, summary: summary };
}

// ── ps ────────────────────────────────────────────────────────────────────────
// \`ps aux\` is a wide table whose last column is a full command line. The agent
// wants to know what is running and what is eating the machine, so keep
// PID/%CPU/%MEM/COMMAND, sort by CPU descending and cap.
//
// The COMMAND column contains spaces, so it can only be found positionally: it
// is the LAST header, and everything from its offset to end-of-line belongs to
// it. Every other column is whitespace-delimited and read by splitting, never
// by slicing at header offsets - a value wider than its header would otherwise
// shift every cell after it.
function condensePs(text, cmdArgs) {
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length < 2) return text;

  const header = lines[0];
  const cmdAt = header.search(/\\bCOMMAND\\b|\\bCMD\\b/);
  const idx = {
    pid:  header.split(/\\s+/).indexOf('PID'),
    cpu:  header.split(/\\s+/).indexOf('%CPU'),
    mem:  header.split(/\\s+/).indexOf('%MEM'),
  };
  // Not the wide form: 'ps' with no flags prints PID/TTY/TIME/CMD and is
  // already four short columns. Nothing to project.
  if (cmdAt < 0 || idx.cpu < 0 || idx.pid < 0) return text;

  const rows = [];
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\\s+/);
    const pid = fields[idx.pid];
    const cpu = parseFloat(fields[idx.cpu]);
    const mem = fields[idx.mem];
    const command = line.length > cmdAt ? line.slice(cmdAt).trim() : (fields[fields.length - 1] ?? '');
    if (!pid || !command || !isFinite(cpu)) continue;
    rows.push({ pid: pid, cpu: cpu, mem: mem, command: command });
  }
  if (rows.length === 0) return text;

  rows.sort((a, b) => b.cpu - a.cpu);
  const CAP = 25;
  const out = [];
  for (const r of rows.slice(0, CAP)) {
    out.push(r.pid + '  ' + r.cpu + '%cpu ' + (r.mem ?? '') + '%mem  ' + r.command.slice(0, 120));
  }
  if (rows.length > CAP) out.push('... +' + (rows.length - CAP) + ' more processes (__TT_FULL_FLAG__)');
  return out.join('\\n');
}

// ── du / df ───────────────────────────────────────────────────────────────────
// Two different grammars that used to share one parser, which is why df did not
// work at all: every row was read with du's SIZE-FIRST pattern, and a df row
// starts with the device ("/dev/nvme0n1p2  916G ..."), so the first row failed
// to match and the whole function returned its input. The "drop the device
// column" branch that followed was unreachable for real \`df\` output. They are
// dispatched apart now - df on its header, du on everything else.
//
// Common rule in both: the numeric fields are left byte-for-byte as the tool
// printed them - \`du -s dir | awk '{print $1}'\` and \`| sort -n\` both depend on
// it - so no humanisation is applied and no -h is ever injected.
function condenseDiskUsage(text, cmdArgs) {
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length === 0) return text;

  // df prints a header; du does not.
  if (/^Filesystem\\b/.test(lines[0])) return condenseDf(lines, text);

  const rows = [];
  for (const line of lines) {
    // du: "<size>\\t<path>"
    const duM = line.match(/^\\s*(\\d+(?:[.,]\\d+)?[KMGTPE]?)\\s+(.+)$/);
    if (!duM) return text; // unrecognised shape: never reorder what we cannot read
    rows.push({ raw: line, key: duSizeKey(duM[1]), rest: duM[2] });
  }
  if (rows.length === 0) return text;

  // The only transform du gets is ORDERING: biggest first, which is the
  // question being asked, and it makes the cap drop the smallest directories
  // rather than whichever ones the traversal happened to reach last.
  rows.sort((a, b) => b.key - a.key);
  const CAP = 40;
  const out = [];
  for (const r of rows.slice(0, CAP)) out.push(r.raw.trim());
  if (rows.length > CAP) out.push('... +' + (rows.length - CAP) + ' more (__TT_FULL_FLAG__)');
  return out.join('\\n');
}

// df is left ALONE apart from a row cap.
//
// Its output is a POSITIONAL table that scripts read with awk:
// "df -h /var | awk 'NR==2 {print \\$5}'" is the canonical way to ask how full a
// disk is. Dropping the source column shifts every field index by one, and
// sorting by size moves the row NR==2 refers to - so both transforms that used
// to be applied here broke that consumer. The sibling du branch above carries
// exactly this protection for "awk '{print \\$1}'"; this is the same argument,
// and it was not being applied consistently.
//
// There was never much to win either way: df prints one row per mount and a
// machine has a handful. The only saving that costs nothing is refusing to
// relay a hundred-mount container listing whole, so the cap stays - and it
// discloses itself out of band rather than putting a marker in the table.
// The cap applies to the MOUNT ROWS, never to the header. Passing the whole
// \`lines\` array counted the "Filesystem ..." header as a filesystem, so a
// 60-mount container host was disclosed as 61 and the nominal 40-row cap kept
// only 39 mounts. The notice is the sole disclosure this condenser gets -
// stdout stays a byte-exact positional table so \`awk 'NR==2 {print $5}'\` keeps
// working - so a population it states wrongly is simply wrong information.
function condenseDf(lines, text) {
  const header = lines[0];
  const rows = lines.slice(1);
  const capped = ttCapDataList(rows, 40, 0, 'filesystems');
  return capped === rows ? text : [header].concat(capped).join('\\n');
}

// Orders a size for sorting only - the printed value is never rewritten.
function duSizeKey(s) {
  const n = parseFloat(String(s).replace(',', '.'));
  if (!isFinite(n)) return 0;
  const unit = String(s).slice(-1).toUpperCase();
  const mult = { K: 1024, M: 1048576, G: 1073741824, T: 1099511627776, P: 1125899906842624 }[unit];
  return mult ? n * mult : n;
}

// ── systemctl ─────────────────────────────────────────────────────────────────
// \`systemctl status\` is read for two things: whether the unit is up, and the
// tail of its log. The CGroup process tree in between is the bulk of the output
// and carries nothing \`ps\` could not give.
function condenseSystemctl(text, cmdArgs) {
  const lines = text.split('\\n');
  if (!lines.some(l => /^\\s*(Loaded|Active):/.test(l))) return text;

  const out = [];
  let inCGroup = false;
  for (const raw of lines) {
    const line = raw.replace(/\\s+$/, '');
    if (!line) continue;
    if (/^\\s*CGroup:/.test(line)) { inCGroup = true; continue; }
    // The tree is indented continuation; the log lines that follow are not.
    if (inCGroup) {
      if (/^\\s{5,}[├└│]/.test(line) || /^\\s{13,}\\S/.test(line)) continue;
      inCGroup = false;
    }
    if (/^\\s*(Tasks|Memory|CPU|Docs|Process|Main PID):/.test(line)) continue;
    out.push(line.trim());
  }
  return out.length > 0 ? out.join('\\n') : text;
}

// ── journalctl ────────────────────────────────────────────────────────────────
// Every line repeats "<Mon DD HH:MM:SS> <host> <unit>[<pid>]: ". The host/unit
// prefix is constant for a \`-u\` query and is hoisted into one header; the clock
// is kept because log timing is usually the point. Runs of identical messages
// collapse to "msg (xN)" rather than being deduplicated silently.
//
// A \`-f\` invocation never reaches here: the frame execs follow invocations
// straight through.
function condenseJournalctl(text, cmdArgs) {
  const ROW = /^(\\w{3} \\d{1,2} [\\d:]{8}) (\\S+) (\\S+?): (.*)$/;
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length === 0) return text;

  const rows = [];
  for (const line of lines) {
    const m = line.match(ROW);
    if (!m) return text; // not the syslog grammar - keep it verbatim
    rows.push({ time: m[1], host: m[2], unit: m[3], msg: m[4] });
  }

  const hosts = new Set(rows.map(r => r.host + ' ' + r.unit));
  const out = [];
  if (hosts.size === 1) out.push('[' + rows[0].host + ' ' + rows[0].unit + ']');

  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].msg === rows[i].msg) j++;
    const n = j - i + 1;
    const prefix = hosts.size === 1 ? rows[i].time : rows[i].time + ' ' + rows[i].host + ' ' + rows[i].unit + ':';
    out.push(prefix + ' ' + rows[i].msg + (n > 1 ? '  (x' + n + ', through ' + rows[j].time + ')' : ''));
    i = j + 1;
  }
  return out.join('\\n');
}
`

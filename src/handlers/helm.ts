// helm - list / status / history / search, plus the install/upgrade release
// report. `template` and `get` are deliberately left alone; see condenseHelm.

export const HELM_HANDLER = `
// ── helm ──────────────────────────────────────────────────────────────────────

// helm renders tables with uitable, which pads every cell to the column width
// and THEN separates cells with a tab. The tab is the only reliable boundary:
// a cell may contain a run of spaces of its own - \`helm history\` dates the
// single-digit days as "Mon Jul  6 09:12:41 2026" - which splitting on
// whitespace tears in two and shifts every column after it. Fall back to a
// space run only when the tabs are gone (re-flowed or hand-pasted output).
function helmCols(line) {
  if (line.indexOf('\\t') !== -1) return line.split('\\t').map(s => s.trim());
  return line.split(/\\s{2,}/).map(s => s.trim());
}

function condenseHelm(text, cmdArgs) {
  const argv = (cmdArgs ?? []).map(String);
  const sub  = resolveSub('helm', argv).sub;

  // \`helm template\` renders every manifest in the chart - routinely hundreds of
  // KB - and the canonical thing to do with it is
  // \`helm template ./chart | kubectl apply -f -\`. A pipe is precisely the case
  // the frame decides to compress, and nothing in argv distinguishes "an agent
  // is reading this" from "kubectl is applying this", so ANY reshaping here
  // breaks a working apply. An inventory would break it for every chart, where
  // today the small ones pass through intact; the frame's backstop still bounds
  // the huge ones, and it says so in the output it leaves behind.
  //
  // \`helm get manifest/values/hooks/notes/all\` is the same bargain: YAML for
  // \`kubectl diff -f -\` or for a values file. Guarded here rather than left to
  // the default branch so that adding a branch below cannot quietly claim it -
  // \`get values\` even opens with "USER-SUPPLIED VALUES:", which the status
  // condenser would recognise as a dump section and delete.
  if (sub === 'template' || sub === 'get') return text;

  if (sub === 'list' || sub === 'ls')   return condenseHelmList(text);
  // install/upgrade print the same release report as \`status\`, and under
  // --dry-run --debug they carry the whole rendered manifest with it. Unlike
  // \`helm template\` this shape is NOT pipeable YAML - it opens with a prose
  // line and KEY: value header - so summarising it breaks nothing downstream.
  if (sub === 'status' || sub === 'install' || sub === 'upgrade')
    return condenseHelmStatus(text);
  if (sub === 'history' || sub === 'hist')
    return condenseHelmHistory(text);
  if (sub === 'search')
    return condenseHelmSearch(text);

  return text;
}

// \`helm search repo\` with no term lists every chart in every added repo -
// thousands of rows whose DESCRIPTION is the chart author's prose, usually
// identical across a chart family. Truncate it rather than drop it: the
// convention for a dead chart is to open the description with "DEPRECATED".
function condenseHelmSearch(text) {
  const lines = text.split('\\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return text;

  // No header means this is not a result table - "No results found" says so in
  // prose, and summarising that as "0 charts" would only restate it worse.
  const header = helmCols(lines[0]);
  if (header[0] !== 'NAME' || header.indexOf('CHART VERSION') === -1) return text;

  const rows = lines.slice(1);
  const out = ['[helm] ' + rows.length + ' charts:'];
  for (const line of rows.slice(0, 25)) {
    const c = helmCols(line);
    if (c.length < 3) { out.push('  ' + line.trim()); continue; }
    const desc = c[3] ? ' ' + helmClip(c[3], 48) : '';
    out.push('  ' + c[0] + ' ' + c[1] + ' (app ' + c[2] + ')' + desc);
  }
  if (rows.length > 25) out.push('  ... +' + (rows.length - 25) + ' more charts (__TT_FULL_FLAG__)');
  return out.join('\\n');
}

function helmClip(s, max) {
  return s.length > max ? s.slice(0, max).replace(/\\s+\$/, '') + '...' : s;
}

// \`helm history\` - the padded UPDATED column costs a quarter of every row and
// the DESCRIPTION already says what happened; the revision number is what a
// rollback needs.
function condenseHelmHistory(text) {
  const lines = text.split('\\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return text;

  const header = helmCols(lines[0]);
  if (header[0] !== 'REVISION' || header.indexOf('STATUS') === -1) return text;

  const rows = lines.slice(1);
  const out = ['[helm] ' + rows.length + ' revisions:'];
  for (const line of rows.slice(0, 25)) {
    const c = helmCols(line);
    if (c.length < 5) { out.push('  ' + line.trim()); continue; }
    out.push('  rev' + c[0] + ' ' + c[2] + ' ' + c[3] + ' ' + c[4] + (c[5] ? ' ' + c[5] : ''));
  }
  if (rows.length > 25) out.push('  ... +' + (rows.length - 25) + ' more revisions (__TT_FULL_FLAG__)');
  return out.join('\\n');
}

// \`helm status\` (and the report install/upgrade print) is a short KEY: value
// header plus NOTES, optionally followed by whole-file YAML dumps under
// --debug. The header and NOTES are the answer; the dumps are the chart's
// source, which the agent can ask for by name.
function condenseHelmStatus(text) {
  // Every one of these reports opens with "NAME: <release>". Without it this is
  // some other shape and there is nothing to recognise - eliding sections out of
  // unparsed output would silently delete whatever it really was.
  if (!/^NAME:\\s+\\S/m.test(text)) return text;

  const out  = [];
  const lines = text.split('\\n');
  let dump = '';
  let body = [];
  let notes = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A section header is a bare uppercase key on its own line ("MANIFEST:"),
    // never a value line ("NAME: myapp") and never YAML, whose keys are indented
    // or lower-case.
    const header = line.match(/^([A-Z][A-Z0-9 \\-]*):\\s*$/);
    // NOTES is the last section helm prints, and its body is the chart author's
    // prose - free text in which a column-0 "WARNING:" or "MANIFEST:" is a
    // sentence, not a section header. So past NOTES a header is prose by
    // default: the NOTES are what \`helm status\` is read for, and reading a
    // sentence in them as a header is where they were being truncated.
    //
    // Past NOTES a dump section is only believed when the lines under it parse
    // as an actual inventory of Kubernetes objects - which is also the only
    // case where eliding it saves anything, since that inventory is what the
    // marker would say. helm prints NOTES last, so nothing real reaches this
    // branch; it costs one lookahead and stops a whole rendered manifest
    // passing through on position alone.
    //
    // A column-0 \`---\` is NOT the evidence: chart NOTES.txt use it as a visual
    // divider between paragraphs all the time, so prose carrying both a
    // dump-shaped word and a divider below it would be read as a document
    // stream and everything after the word deleted - destroying exactly the
    // NOTES this branch's guard exists to protect. A separator with no object
    // under it inventories to nothing, and nothing is not a manifest.
    const structural = !!header && (!notes ||
      (helmIsDumpSection(header[1]) && helmDocInventory(helmSectionBody(lines, i)).length > 0));
    if (structural) {
      if (dump) { out.push(helmDumpMarker(dump, body)); dump = ''; body = []; }
      if (header[1] === 'NOTES') { notes = true; out.push(line); continue; }
      if (helmIsDumpSection(header[1])) { dump = header[1]; continue; }
      out.push(line);
      continue;
    }
    if (dump) body.push(line);
    else      out.push(line);
  }
  if (dump) out.push(helmDumpMarker(dump, body));
  return out.join('\\n');
}

function helmIsDumpSection(name) {
  return ['USER-SUPPLIED VALUES', 'COMPUTED VALUES', 'HOOKS', 'MANIFEST'].indexOf(name) !== -1;
}

// What a dropped section CONTAINED, so the drop is never silent. A manifest is
// a stream of k8s objects, and "which objects" is the question it answers; a
// values dump has no such structure, so it only gets its size.
function helmDumpMarker(name, lines) {
  const docs = helmDocInventory(lines);
  if (docs.length > 0) {
    const shown = docs.slice(0, 20).join(', ');
    const extra = docs.length > 20 ? ', +' + (docs.length - 20) + ' more' : '';
    const noun  = docs.length === 1 ? ' document: ' : ' documents: ';
    // MANIFEST is the largest elision the handler makes, so it is the last one
    // that may leave out the way to get it back: an inventory is a summary, and
    // every summarising marker here ends with the flag.
    return name + ': ' + docs.length + noun + shown + extra + ' (__TT_FULL_FLAG__)';
  }
  const n = lines.filter(l => l.trim() !== '').length;
  // A section helm printed empty has nothing behind it: offering __TT_FULL_FLAG__
  // would send the agent to re-run the command for zero extra lines.
  if (n === 0) return name + ': (none)';
  return name + ': ' + n + ' lines elided (__TT_FULL_FLAG__)';
}

// kind/name per YAML document. Returns [] when nothing parses, so the caller
// falls back to a line count rather than announcing "0 documents".
function helmDocInventory(lines) {
  // Only a multi-document stream gets inventoried, and helm opens every one of
  // them with a \`---\` separator. A values dump is a single YAML map that helm
  // marshals without one - and its keys are the chart author's, so a column-0
  // \`kind:\` in it (fluent-bit, datadog and external-dns all ship one) is a
  // value, not a Kubernetes object. Without this gate that map is deleted and
  // announced as an object inventory nothing ever parsed it as.
  if (!helmIsDocStream(lines)) return [];

  const docs = [];
  let kind = '';
  let name = '';
  let inMeta = false;
  for (const line of lines) {
    if (/^---\\s*$/.test(line)) {
      if (kind) docs.push(kind + (name ? '/' + name : ''));
      kind = ''; name = ''; inMeta = false;
      continue;
    }
    const k = line.match(/^kind:\\s*(\\S+)/);
    if (k) { kind = k[1]; continue; }
    if (/^metadata:\\s*$/.test(line)) { inMeta = true; continue; }
    // Any other column-0 key ends the metadata block, so "spec: ... name:" and
    // container names below it are never mistaken for the object's name.
    if (/^\\S/.test(line)) inMeta = false;
    if (inMeta && !name) {
      const n = line.match(/^  name:\\s*(\\S+)/);
      if (n) name = n[1].replace(/^["']|["']\$/g, '');
    }
  }
  if (kind) docs.push(kind + (name ? '/' + name : ''));
  return docs;
}

// A column-0 document separator is what makes the section a YAML stream. It has
// to be looked for throughout, not just at the top: the separator before the
// FIRST document is the one helm may not have written - a section that opens
// with its \`# Source:\` comment is still a stream, and demanding the separator
// come first reduced it to a line count.
//
// A values dump stays excluded either way, which is the property that matters:
// helm marshals it as a single YAML map, so it carries no separator anywhere,
// and its column-0 \`kind:\` (fluent-bit, datadog and external-dns all ship one)
// is a value rather than a Kubernetes object.
function helmIsDocStream(lines) {
  for (const line of lines) {
    if (/^---\\s*\$/.test(line)) return true;
  }
  return false;
}

// The lines belonging to the section that opens at index \`i\`, up to the next
// column-0 header. Used to ask what a section actually contains before deciding
// it is one.
function helmSectionBody(lines, i) {
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Z][A-Z0-9 \\-]*:\\s*\$/.test(lines[j])) break;
    body.push(lines[j]);
  }
  return body;
}

// \`helm list\` - the UPDATED column is a 37-char timestamp per row and the
// widest thing in the table; everything else on the row is the answer.
function condenseHelmList(text) {
  const lines = text.split('\\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return text;

  // helm always prints the header, so its absence means this is not a release
  // table and there is nothing to recognise. Summarising it anyway would report
  // a release count for output we never parsed.
  const header = helmCols(lines[0]);
  if (header[0] !== 'NAME' || header.indexOf('REVISION') === -1) return text;

  const rows = lines.slice(1);
  if (rows.length === 0) return '[helm] 0 releases';

  const out = ['[helm] ' + rows.length + ' releases:'];
  for (const line of rows.slice(0, 25)) {
    const c = helmCols(line);
    if (c.length < 6) { out.push('  ' + line.trim()); continue; }
    const appVer = c[6] ? ' ' + c[6] : '';
    out.push('  ' + c[0] + ' (' + c[1] + ') ' + c[4] + ' ' + c[5] + appVer + ' rev' + c[2]);
  }
  if (rows.length > 25) out.push('  ... +' + (rows.length - 25) + ' more releases (__TT_FULL_FLAG__)');
  return out.join('\\n');
}
`

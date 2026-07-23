export const HTTP_HANDLER = `
// ── curl ──────────────────────────────────────────────────────────────────────
// curl's stdout is whatever the server returned, so the condenser cannot assume
// prose. The body is routinely piped straight into another program:
//   curl -s https://api/... | jq          - a cut string is a parse error
//   curl -sL https://.../install.sh | sh  - a cut script HALF-EXECUTES
// A blind character truncation corrupts both, so dispatch on the body's shape
// and only cap the shapes nobody parses.
function condenseCurl(text) {
  // \`t\` is the SNIFFING view: fully trimmed, so a leading space cannot hide the
  // \`{\` that says "this is JSON". \`kept\` is what a passthrough hands back -
  // the same bytes minus blank edges, because a response body's first-line
  // indentation is part of the document, not chrome.
  const t = text.trim();
  const kept = ttTrimBlankEdges(text);
  const MAX = 2000;
  if (t.length <= MAX) return kept;

  // Executable payloads: a shebang, or a body that reads like a shell script.
  // Never touched - truncating something that is about to be run is strictly
  // worse than spending the tokens.
  if (/^#!/.test(t) || curlLooksExecutable(t)) return kept;

  // Structured data: re-serialise COMPACTLY. That is lossless, still parses,
  // and drops every byte of indentation and alignment - typically 30-50% of a
  // pretty-printed API response. Deliberately NOT condenseDataJson: that one
  // emits "[N items schema: ...]" preludes and "... +N more" markers, which are
  // not JSON at all, so \`curl … | jq\` would fail to parse.
  if (/^[\\[{]/.test(t)) {
    try {
      const compact = JSON.stringify(JSON.parse(t));
      return compact.length < t.length ? compact : kept;
    } catch {
      return kept;
    }
  }

  // Prose / markup: safe to cap, with the elision disclosed.
  return t.slice(0, MAX) + '\\n... (' + t.length + ' bytes total, truncated - re-run with __TT_FULL_FLAG__)';
}

function curlLooksExecutable(t) {
  const head = t.slice(0, 4000);
  let score = 0;
  if (/^set -[eux]/m.test(head))                       score += 2;
  if (/^(export|local|readonly)\\s+\\w+=/m.test(head))    score += 1;
  if (/^\\s*(if|case|while|for)\\b.*\\b(then|in|do)\\b/m.test(head)) score += 1;
  if (/^\\s*\\w+\\s*\\(\\)\\s*\\{/m.test(head))              score += 1;
  if (/\\b(curl|wget)\\b.*\\|\\s*(sh|bash)\\b/.test(head)) score += 2;
  return score >= 2;
}

// ── wget ──────────────────────────────────────────────────────────────────────
// Strips wget's own transfer log; keeps the downloaded content byte-for-byte.
//
// The log is identified BY POSITION, never by the shape of a line. It used to
// be a shape test - any line starting with "Length:", "Resolving ",
// "Connecting to", "Saving to:" or a size like "19M" was deleted wherever it
// appeared - and wget's stdout under \`-O -\` IS THE PAYLOAD: a fetched CSV whose
// header row happened to read "Length: 42 (unspecified)" lost that row, with no
// marker and no notice. A condenser may delete what it recognises; it may not
// guess.
//
// So a chatter run only ever opens on wget's own request header
// ("--2026-07-20 12:34:56--  https://..."), which wget prints once per URL at
// the start of that URL's block and which nothing on stdout can produce, and it
// closes on the first line that is not chatter. Everything after that - the
// body, and the "saved [4096/4096]" confirmation an agent reads to know the
// transfer finished - is relayed untouched.
//
// Note that in the normal \`wget -qO - URL\` invocation none of this runs at all:
// wget writes the log to STDERR and the frame hands compress() only stdout, so
// the text below is the payload and the banner check returns it unchanged. That
// is what makes the wget entry in the coverage matrix a genuine passthrough.
function condenseWget(text) {
  const lines = text.split('\\n');
  const first = lines.find(l => l.trim() !== '');
  if (first === undefined || !wgetIsRequestHeader(first)) return text;

  const out = [];
  let inLog = true;
  for (const line of lines) {
    if (inLog) {
      if (wgetIsChatter(line)) continue;
      inLog = false;
    } else if (wgetIsRequestHeader(line)) {
      // The next URL of a multi-target run opens a fresh log block.
      inLog = true;
      continue;
    }
    out.push(line);
  }
  return ttTrimBlankEdges(out.join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
}

// wget's per-URL banner: "--2026-07-20 12:34:56--  https://example.com/x".
function wgetIsRequestHeader(line) {
  return /^--[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}--\\s/.test(line);
}

// Only consulted INSIDE a run already opened by the banner above - which is why
// it can afford to list shapes as ordinary as "Length:" and a bare size. A
// second URL that reuses the connection opens its block with "Reusing existing
// connection" instead of "Resolving", and a redirect closes its block with
// "Location: ... [following]"; both are wget's, and leaving them out would end
// the run early and leak the rest of that block's chatter into the output.
function wgetIsChatter(line) {
  return wgetIsRequestHeader(line) ||
    /^(\\s*[0-9]+[KMG.%]|Resolving |Connecting to|Reusing existing connection|Proxy request sent|HTTP request sent|Location: |Saving to:|Length:|\\s*$)/.test(line);
}
`

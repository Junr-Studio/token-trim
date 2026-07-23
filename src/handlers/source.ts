export const SOURCE_HANDLER = `
// ── source-code / data file handler (cat / head / tail) ──────────────────────

// Which argument is the FILE? For \`cat\` it is args[0], but \`head -50 app.ts\`
// and \`head -n 50 app.ts\` are the modal head/tail forms, and reading args[0]
// there resolves the language from "-50" or "-n" - so the most common
// invocation got no handling at all.
//
// Returns '' when the file cannot be determined (multiple files, stdin), which
// detectLang maps to 'unknown' - i.e. passthrough, the safe default.
function resolveFileArg(cmd, cmdArgs) {
  const args = (cmdArgs ?? []).map(String);
  const takesValue = ['-n', '-c', '--lines', '--bytes'];
  const files = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { for (let j = i + 1; j < args.length; j++) files.push(args[j]); break; }
    if (a.charAt(0) === '-' && a.length > 1) {
      // "-n 50" consumes the next token; "-n50", "-50" and "--lines=50" do not.
      if (a.indexOf('=') === -1 && takesValue.indexOf(a) !== -1) i++;
      continue;
    }
    files.push(a);
  }

  // Multiple files make head/tail emit "==> name <==" banners, which the
  // single-language model cannot represent. Passthrough instead.
  return files.length === 1 ? files[0] : '';
}

function detectLang(filePath) {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  const map = {
    rs: 'rust', py: 'python', pyw: 'python',
    js: 'js', mjs: 'js', cjs: 'js',
    ts: 'ts', tsx: 'ts', jsx: 'ts',
    go: 'go', rb: 'ruby',
    sh: 'shell', bash: 'shell',
    json: 'json', jsonc: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    csv: 'csv', tsv: 'csv',
    xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml',
  };
  return map[ext] ?? 'unknown';
}

function stripComments(text, lang) {
  // Data formats - structural compression
  if (lang === 'json')  return condenseDataJson(text);
  if (lang === 'yaml')  return condenseDataYaml(text);
  if (lang === 'toml')  return condenseDataToml(text);
  if (lang === 'csv')   return condenseDataCsv(text);
  if (lang === 'xml')   return condenseDataXml(text);

  // Source code - comment stripping
  if (!lang || lang === 'unknown') return text;
  const pat = {
    rust:   { line: '//', block: ['/*', '*/'], doc: '///' },
    js:     { line: '//', block: ['/*', '*/'], doc: null },
    ts:     { line: '//', block: ['/*', '*/'], doc: null },
    go:     { line: '//', block: ['/*', '*/'], doc: null },
    python: { line: '#',  block: null, doc: null },
    ruby:   { line: '#',  block: ['=begin', '=end'], doc: null },
    shell:  { line: '#',  block: null, doc: null },
  }[lang];
  if (!pat) return text;

  // A removed line is BLANKED, never dropped. Deleting it shifts every line
  // below it, and two readers take that shift as fact: \`cat app.py | wc -l\`
  // reports a count that is not the file's and \`sed -n '42p'\` prints the wrong
  // line; and the agent itself, which reads this output, sees a function at
  // line 10 and then edits line 10 of a file where it lives at line 25.
  // A blank line costs one token - measured at one point of overall reduction -
  // and buys every line number in the output the right to mean what it says.
  const lines = text.split('\\n');
  if (lang === 'python') pyBlankModuleDocstring(lines);
  const out = [];
  let inBlock = false;

  for (const raw of lines) {
    const line = raw.replace(/[ \\t]+$/, '');
    const t    = line.trimStart();
    // Only a line that BEGINS a block comment opens one. This used to be
    // \`t.includes(pat.block[0])\`, which fired on any line that merely CONTAINED
    // the opener - a \`//\` comment mentioning \`/*\`, a glob in a string
    // ('src/*.ts', './node_modules/*'), a regex - and then blanked every line
    // down to the next \`*/\`, in practice the rest of the file. Nothing marked
    // the loss: the agent read a file whose second half was empty and concluded
    // the declarations below the trigger did not exist. A block comment that
    // starts mid-line is left alone instead; keeping a comment costs tokens,
    // deleting executable code costs correctness.
    if (pat.block && !inBlock && t.startsWith(pat.block[0])) { inBlock = true; }
    if (inBlock) { if (t.includes(pat.block[1])) inBlock = false; out.push(''); continue; }
    if (pat.line && t.startsWith(pat.line)) {
      out.push(pat.doc && t.startsWith(pat.doc) ? line : '');
      continue;
    }
    out.push(line);
  }
  return out.join('\\n');
}

// Python has NO block comment. \`"""..."""\` is a string expression, and the only
// thing that makes one a docstring is its position in the file. Treating the
// delimiter as a comment marker - which the block: ['"""', '"""'] entry did -
// cannot work when the opener and the closer are the same token: the line that
// opened a run also closed it, so BOTH delimiters were blanked and the prose
// between them was emitted as code. Two real shapes broke:
//
//   SQL = """          ->  the closing """ was blanked, leaving an unterminated
//   SELECT 1               string - the file no longer parses, and \`cat q.py\`
//   """                    is how an agent reads it;
//
//   """                ->  both delimiters blanked and "Module docs." emitted at
//   Module docs.           statement position - also unparseable, and now the
//   """                    agent reads prose as code.
//
// So the delimiter is not a comment marker here. Exactly one construct is
// recognised, the module docstring - the first statement in the file, which is
// the bulky one at module level - and only its INTERIOR is blanked, with both
// delimiter lines left in place so the string still terminates. Function and
// class docstrings need no rule of their own: they sit inside a body, and
// _aggressivePython already elides those.
//
// Mutates \`lines\` in place; blanks nothing at all unless it finds the closer,
// because a docstring left open by a \`head -50\` cut would otherwise take the
// rest of the file with it.
function pyBlankModuleDocstring(lines) {
  let i = 0;
  // A shebang and any leading \`#\` comments come before the first statement.
  while (i < lines.length && (!lines[i].trim() || lines[i].trim().charAt(0) === '#')) i++;
  if (i >= lines.length) return;

  const open = lines[i].trim();
  const q = open.slice(0, 3);
  if (q !== '"""' && q !== "'''") return;
  // \`"""One line."""\` is already minimal and has no interior to blank.
  if (open.length > 3 && open.slice(-3) === q) return;

  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim().slice(-3) === q) {
      for (let k = i + 1; k < j; k++) lines[k] = '';
      return;
    }
  }
}

// ── data format helpers ───────────────────────────────────────────────────────

// A JSON document is read by a program far more often than by an eye:
// \`cat data.json | jq '.[].name'\` is how an agent reads one. This used to emit
// "[12 items  schema: {id, name, active}]" over a five-item preview and a
// "... +7 more items" tail - a readable summary that is not JSON, so jq exits
// with a parse error and the seven remaining items are gone for good.
//
// Compacting instead still parses and removes every byte of indentation and
// alignment: typically 30-50% of a pretty-printed document.
//
// It must NOT be done by re-serialising, i.e. JSON.stringify(JSON.parse(text)).
// That round-trip is not lossless for numbers, and a number is the one thing
// this library may never rewrite. A 19-digit snowflake id - the normal case in
// an API dump - is past 2^53, so 1234567890123456789 came back as
// 1234567890123456800; three distinct ids in one document collapsed into the
// same value and the rows lost their identity. \`1e5\` came back as \`100000\`,
// \`1e400\` as \`null\`, \`-0\` as \`0\`, \`1.0\` as \`1\`. Those digits were never in the
// file: that is inventing, not condensing, and the word-level invariants cannot
// see it because they deliberately ignore digits.
//
// Deleting the whitespace BETWEEN tokens buys the same reduction and leaves
// every literal byte-for-byte as the file wrote it.
//
// Content that only LOOKS like JSON falls through to line truncation, because a
// summary derived from something we could not parse is a guess.
function condenseDataJson(text) {
  const lines = text.split('\\n');
  if (lines.length <= 20) return text;
  let isJson = false;
  try { JSON.parse(text); isJson = true; } catch {}
  if (isJson) {
    // Parsed once to prove it is JSON, and once more to prove the compaction
    // did not break it. If either doubts it, the document goes back whole -
    // never through the truncating branch below, which would drop rows from a
    // document we know is valid.
    try {
      const compact = jsonMinify(text);
      JSON.parse(compact);
      return compact.length < text.length ? compact : text;
    } catch {}
    return text;
  }
  return lines.slice(0, 40).join('\\n') + (lines.length > 40 ? '\\n... +' + (lines.length - 40) + ' more lines' : '');
}

// Whitespace outside string literals carries no information in JSON, and
// whitespace inside one is content. Everything else - number literals, key
// order, escape sequences, the exact spelling of every token - is passed
// through untouched.
function jsonMinify(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"') {
      let j = i + 1;
      while (j < text.length) {
        const d = text.charAt(j);
        if (d === '\\\\') { j += 2; continue; }
        j++;
        if (d === '"') break;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === ' ' || c === '\\t' || c === '\\n' || c === '\\r') { i++; continue; }
    out += c;
    i++;
  }
  return out;
}

function jsonSchema(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const keys = Object.keys(obj);
  return '{' + keys.slice(0, 8).join(', ') + (keys.length > 8 ? ', ...' : '') + '}';
}

function condenseDataYaml(text) {
  const lines = text.split('\\n');
  if (lines.length <= 30) return text;
  const topKeys = lines.filter(l => /^[\\w-]+:/.test(l)).map(l => l.split(':')[0].trim());
  const header  = topKeys.length > 0 ? '[yaml - top keys: ' + topKeys.join(', ') + ']\\n' : '';
  return header + lines.slice(0, 30).join('\\n') + '\\n... +' + (lines.length - 30) + ' more lines';
}

function condenseDataToml(text) {
  const lines = text.split('\\n');
  if (lines.length <= 30) return text;
  const sections = lines.filter(l => /^\\[/.test(l.trim())).map(l => l.trim());
  const header   = sections.length > 0 ? '[toml - sections: ' + sections.join(', ') + ']\\n' : '';
  return header + lines.slice(0, 30).join('\\n') + '\\n... +' + (lines.length - 30) + ' more lines';
}

function condenseDataCsv(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  if (lines.length <= 6) return text;
  const sep  = lines[0].includes('\\t') ? '\\t' : ',';
  const cols = lines[0].split(sep).length;
  return lines[0] + '\\n[' + (lines.length - 1) + ' rows, ' + cols + ' cols]\\n' +
    lines.slice(1, 6).join('\\n') +
    (lines.length > 6 ? '\\n... +' + (lines.length - 6) + ' more rows' : '');
}

function condenseDataXml(text) {
  const lines = text.split('\\n');
  if (lines.length <= 20) return text;
  return lines.slice(0, 20).join('\\n') + '\\n... +' + (lines.length - 20) + ' more lines';
}

// ── aggressive body stripping (AggressiveFilter equivalent) ──────────────────

function aggressiveStrip(text, lang) {
  if (lang === 'json')  return condenseDataJson(text);
  if (lang === 'yaml')  return condenseDataYaml(text);
  if (lang === 'toml')  return condenseDataToml(text);
  if (lang === 'csv')   return condenseDataCsv(text);
  if (lang === 'xml')   return condenseDataXml(text);
  if (!lang || lang === 'unknown' || lang === 'shell') return stripComments(text, lang);
  const minimal = stripComments(text, lang);
  return lang === 'python' ? _aggressivePython(minimal) : _aggressiveBraces(minimal, lang);
}

// Brace depth is what decides which lines are a function body worth folding
// away, so a brace that is not code must not be counted and a body that never
// closes must not be folded. Both used to happen:
//
//   - the counter matched \`{\` and \`}\` anywhere on the line, including inside a
//     string ("const OpenBrace = \\"{\\"") or a regex (/\\{+/). One of those took
//     depth to 1 permanently and every line to EOF became a single
//     "... implementation" marker plus blanks - a file's exports, its remaining
//     functions and its module.exports simply gone, with no marker to say so and
//     no way to tell the result from a genuinely short file;
//   - and once depth was stuck above zero there was no way back, because only a
//     literal \`}\` could bring it down.
//
// So: strip the literals before counting (_codeOnly), and fold a span only once
// its closing brace has actually been seen. A span still open at EOF - a real
// \`head -50\` cut, or a miscount this stripper did not anticipate - is emitted
// verbatim. Passthrough is the answer when the shape cannot be recognised.
function _aggressiveBraces(text, lang) {
  const lines = text.split('\\n');
  const out = lines.slice();
  let depth = 0;
  let opener = -1;
  for (let i = 0; i < lines.length; i++) {
    const code   = _codeOnly(lines[i], lang);
    const opens  = (code.match(/[{]/g) || []).length;
    const closes = (code.match(/[}]/g) || []).length;
    const before = depth;
    depth += opens - closes;
    if (depth < 0) depth = 0;
    if (before === 0 && depth > 0) { opener = i; continue; }
    if (before > 0 && depth === 0 && opener >= 0) {
      // Same rule as stripComments: the elided body keeps its line count, so
      // the closing brace below it stays on its real line number.
      for (let j = opener + 1; j < i; j++) {
        out[j] = j === opener + 1 ? '  // ... implementation' : '';
      }
      opener = -1;
    }
  }
  return out.join('\\n');
}

// The part of a line that is code: string, template and regex literals removed,
// and anything from a line-comment marker onwards dropped. Only used to COUNT
// braces - the line itself is emitted verbatim - so a heuristic that gives up
// early (an unterminated quote swallows the rest of the line) costs at most some
// compression, never content: an uncounted \`{\` leaves a body unfolded, and an
// unclosed span is emitted whole by the caller.
//
// Rust is the one language whose \`'\` is usually not a quote at all but a
// lifetime (\`&'a str\`), so single quotes are left in place there.
function _codeOnly(line, lang) {
  const quote   = lang === 'rust' ? /["\\u0060]/ : /["'\\u0060]/;
  const operand = /[-(,=:[!&|?;+*%^~<>{}]/;
  let out  = '';
  let prev = '';
  let i    = 0;
  while (i < line.length) {
    const c = line.charAt(i);
    if (quote.test(c)) {
      i++;
      while (i < line.length) {
        const d = line.charAt(i);
        if (d === '\\\\') { i += 2; continue; }
        i++;
        if (d === c) break;
      }
      prev = 'x';
      continue;
    }
    if (c === '#' && lang === 'ruby') break;
    if (c === '/' && lang !== 'ruby') {
      const next = line.charAt(i + 1);
      if (next === '/' || next === '*') break;
      // A \`/\` where a value is expected opens a regex; after one it is division.
      if (prev === '' || operand.test(prev)) {
        i++;
        let inClass = false;
        while (i < line.length) {
          const d = line.charAt(i);
          if (d === '\\\\') { i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { i++; break; }
          i++;
        }
        prev = 'x';
        continue;
      }
    }
    out += c;
    if (c !== ' ' && c !== '\\t') prev = c;
    i++;
  }
  return out;
}

function _aggressivePython(text) {
  const lines = text.split('\\n');
  const out = [];
  let inBody = false;
  let bodyMarked = false;
  for (const line of lines) {
    const t = line.trimStart();
    // A blank line inside an elided body was dropped, which shifted every line
    // below it - the very thing this pass now exists to avoid. It is emitted as
    // a blank instead, exactly like the body lines around it.
    if (!t) { out.push(line); continue; }
    const topLevel = line[0] !== ' ' && line[0] !== '\\t';
    if (topLevel) {
      inBody = false; bodyMarked = false;
      out.push(line);
      if (/^(def |async def |class )/.test(t)) inBody = true;
    } else if (inBody) {
      // Blank, not dropped - the line numbers below must stay the file's own.
      out.push(bodyMarked ? '' : '    # ... implementation');
      bodyMarked = true;
    } else {
      out.push(line);
    }
  }
  return out.join('\\n');
}
`

export const SOURCE_HANDLER = `
// ── source-code / data file handler (cat / head / tail) ──────────────────────
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
    python: { line: '#',  block: ['"""', '"""'], doc: null },
    ruby:   { line: '#',  block: ['=begin', '=end'], doc: null },
    shell:  { line: '#',  block: null, doc: null },
  }[lang];
  if (!pat) return text;

  const lines = text.split('\\n');
  const out = [];
  let inBlock = false;
  let blanks  = 0;

  for (const raw of lines) {
    const line = raw.replace(/[ \\t]+$/, '');
    const t    = line.trimStart();
    if (pat.block && !inBlock && t.includes(pat.block[0])) { inBlock = true; }
    if (inBlock) { if (t.includes(pat.block[1])) inBlock = false; continue; }
    if (pat.line && t.startsWith(pat.line)) {
      if (pat.doc && t.startsWith(pat.doc)) { out.push(line); }
      continue;
    }
    if (!t) { if (++blanks > 2) continue; } else { blanks = 0; }
    out.push(line);
  }
  return out.join('\\n').trim();
}

// ── data format helpers ───────────────────────────────────────────────────────

function condenseDataJson(text) {
  const lines = text.split('\\n');
  if (lines.length <= 20) return text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 5) {
      const schema = jsonSchema(parsed[0]);
      const preview = JSON.stringify(parsed.slice(0, 5), null, 2);
      return '[' + parsed.length + ' items' + (schema ? '  schema: ' + schema : '') + ']\\n' +
        preview + '\\n... +' + (parsed.length - 5) + ' more items';
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length > 20) {
        const preview = {};
        for (const k of keys.slice(0, 20)) preview[k] = parsed[k];
        return '{' + keys.length + ' keys}\\n' + JSON.stringify(preview, null, 2) +
          '\\n... +' + (keys.length - 20) + ' more keys';
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {}
  return lines.slice(0, 40).join('\\n') + (lines.length > 40 ? '\\n... +' + (lines.length - 40) + ' more lines' : '');
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
  return lang === 'python' ? _aggressivePython(minimal) : _aggressiveBraces(minimal);
}

function _aggressiveBraces(text) {
  const lines = text.split('\\n');
  const out = [];
  let depth = 0;
  let bodyMarked = false;
  for (const line of lines) {
    const opens  = (line.match(/[{]/g) || []).length;
    const closes = (line.match(/[}]/g) || []).length;
    if (depth === 0) {
      out.push(line);
      depth += opens - closes;
      if (depth < 0) depth = 0;
      bodyMarked = false;
    } else {
      if (!bodyMarked) { out.push('  // ... implementation'); bodyMarked = true; }
      depth += opens - closes;
      if (depth <= 0) {
        depth = 0;
        out.push(line.trimStart());
        bodyMarked = false;
      }
    }
  }
  return out.join('\\n').trim();
}

function _aggressivePython(text) {
  const lines = text.split('\\n');
  const out = [];
  let inBody = false;
  let bodyMarked = false;
  for (const line of lines) {
    const t = line.trimStart();
    if (!t) { if (!inBody) out.push(line); continue; }
    const topLevel = line[0] !== ' ' && line[0] !== '\\t';
    if (topLevel) {
      inBody = false; bodyMarked = false;
      out.push(line);
      if (/^(def |async def |class )/.test(t)) inBody = true;
    } else if (inBody) {
      if (!bodyMarked) { out.push('    # ... implementation'); bodyMarked = true; }
    } else {
      out.push(line);
    }
  }
  return out.join('\\n').trim();
}
`

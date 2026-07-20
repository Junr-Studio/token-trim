// Git command handler source (injected into proxy.mjs at startup)

export const GIT_HANDLER = `
// ── git arg rewriting ─────────────────────────────────────────────────────────
// Rewrites git log / status args before running to produce compact output
// directly rather than post-processing verbose output.
function rewriteGitArgs(args) {
  const sub = args[0] ?? '';
  if (sub === 'log') {
    const hasFormat = args.some(a =>
      a.startsWith('--pretty') || a.startsWith('--format') ||
      a === '--oneline' || a === '--no-walk' || a === '--graph');
    const hasLimit = args.some(a =>
      /^-\\d+$/.test(a) || a === '-n' || a === '--max-count' || /^--max-count=/.test(a));
    const extra = [];
    if (!hasFormat) extra.push('--pretty=format:%h %s (%ar) <%an>');
    if (!hasLimit)  extra.push('-20');
    return [...args, ...extra];
  }
  if (sub === 'status') {
    const hasFmt = args.some(a => a === '--porcelain' || a === '--short' || a === '-s');
    if (!hasFmt) return [args[0], '--short', '--branch', ...args.slice(1)];
  }
  return args;
}

// ── diff ──────────────────────────────────────────────────────────────────────
// Strips context + hunk headers; caps each hunk at MAX_PER_HUNK changed lines.
function condenseDiff(text) {
  const MAX_PER_HUNK = 80;
  const lines = text.split('\\n');
  const out = [];
  let added = 0, removed = 0, files = 0;
  let hunkCount = 0, hunkSkipped = 0;

  function flushSkipped() {
    if (hunkSkipped > 0) { out.push('... (' + hunkSkipped + ' lines skipped)'); hunkSkipped = 0; }
  }

  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      flushSkipped(); hunkCount = 0; files++; continue;
    }
    if (raw.startsWith('@@')) {
      flushSkipped(); hunkCount = 0; continue;
    }
    if (/^(index |old mode|new mode|deleted file|new file|--- |Binary)/.test(raw)) continue;
    if (raw.startsWith('+++ ')) {
      flushSkipped();
      out.push('\\n── ' + raw.slice(4).replace(/^b\\//, '').trim());
      continue;
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
  flushSkipped();
  return 'diff: ' + files + ' file(s)  +' + added + ' -' + removed + '\\n' + out.join('\\n');
}

// ── git log (fallback post-processor for verbose format) ─────────────────────
function condenseGitLog(text) {
  if (!/^commit [0-9a-f]{7,40}/m.test(text)) return text;
  const blocks = text.split(/(?=^commit [0-9a-f]{7,40})/m).filter(b => b.trim());
  return blocks.map(block => {
    const hash   = (block.match(/^commit ([0-9a-f]{7,40})/)?.[1] ?? '').slice(0, 7);
    const author = block.match(/^Author:\\s+(.+?)\\s*</m)?.[1]?.trim() ?? '';
    const msg    = block.match(/\\n\\n\\s+(.+)/)?.[1]?.trim() ?? '';
    return (hash + ' ' + msg + (author ? ' <' + author + '>' : '')).trim();
  }).join('\\n');
}

// ── git status (fallback post-processor) ─────────────────────────────────────
function condenseGitStatus(text) {
  const NOISE = /^(nothing to commit|no changes added|use "git|nothing added to commit)/;
  const kept = text.split('\\n').filter(l => !NOISE.test(l));
  return kept.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
}
`

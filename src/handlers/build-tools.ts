export const BUILD_TOOLS_HANDLER = `
// ── terraform / tofu ──────────────────────────────────────────────────────────
function condenseTerraform(text, sub) {
  const lines = text.split('\\n');

  // \`init\` is mostly provider-resolution chatter wrapped around two facts worth
  // keeping: which provider versions got locked, and whether it worked. The
  // closing paragraphs are a tutorial, identical on every run.
  if (sub === 'init') {
    const out = [];
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      const installed = t.match(/^- Installed (\\S+) (v\\S+)/);
      if (installed) { out.push(installed[1] + ' ' + installed[2]); continue; }
      if (/successfully initialized/i.test(t)) { out.push(t); continue; }
      // Errors always survive - they are the only reason to read this at all.
      if (/^(Error|╷|│|╵)/.test(t) || /error/i.test(t)) { out.push(t); continue; }
    }
    return out.length > 0 ? out.join('\\n') : text;
  }

  if (sub !== 'plan' && sub !== 'apply') {
    return ttTrimBlankEdges(lines.filter(l => {
      const t = l.trim();
      return t && !/^(Refreshing state|Reading |Read complete|Acquiring state lock|Releasing state lock|Initializing the backend|Initializing provider)/.test(t);
    }).join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
  }

  const changes = [];
  let toAdd = 0, toChange = 0, toDestroy = 0;
  let hasResult = false;

  for (const line of lines) {
    const planM = line.match(/Plan:\\s*(\\d+) to add,\\s*(\\d+) to change,\\s*(\\d+) to destroy/);
    if (planM) { toAdd = +planM[1]; toChange = +planM[2]; toDestroy = +planM[3]; hasResult = true; }

    const applyM = line.match(/Apply complete.*?(\\d+) added,\\s*(\\d+) changed,\\s*(\\d+) destroyed/);
    if (applyM) { toAdd = +applyM[1]; toChange = +applyM[2]; toDestroy = +applyM[3]; hasResult = true; }

    const noChangeM = line.match(/No changes\\.|nothing to do/i);
    if (noChangeM) hasResult = true;

    // "  # aws_s3_bucket.data will be created"
    const changeM = line.match(/^\\s+#\\s+(\\S+)\\s+will be (created|destroyed|updated|replaced|read)/);
    if (changeM) changes.push(changeM[2][0].toUpperCase() + ' ' + changeM[1]);
  }

  if (!hasResult && changes.length === 0) return text;

  const parts = [];
  if (toAdd     > 0) parts.push(toAdd     + ' to add');
  if (toChange  > 0) parts.push(toChange  + ' to change');
  if (toDestroy > 0) parts.push(toDestroy + ' to destroy');

  const out = ['terraform ' + sub + ': ' + (parts.join(', ') || 'no changes')];
  for (const c of changes.slice(0, 20)) out.push('  ' + c);
  if (changes.length > 20) out.push('  ... +' + (changes.length - 20) + ' more');
  return out.join('\\n');
}

// Drops repeats and blanks, keeping first-seen order. A build log is not a
// data list - the same diagnostic appearing twice is the LOGGER repeating
// itself, not two things going wrong.
function btDedupeTrimmed(lines) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const t = String(raw).trim();
    if (t === '' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Maven prefixes its ENTIRE failure epilogue with [ERROR]: the blank
// separators, "-> [Help 1]", the -e/-X hints, the "For more information"
// sentence and the Help article links. None of it is a diagnostic; it is the
// same fixed chrome on every failed build.
function mvnIsErrorChrome(t) {
  return /^-> \\[Help \\d+\\]$/.test(t) ||
    /^\\[Help \\d+\\]\\s/.test(t) ||
    /^To see the full stack trace/i.test(t) ||
    /^Re-run Maven (using|with)/i.test(t) ||
    /^For more information about the errors/i.test(t);
}

// ── mvn ───────────────────────────────────────────────────────────────────────
// The headline count is DIAGNOSTICS, not decorated log lines.
//
// Maven repeats every compiler diagnostic twice - once where javac emitted it
// and once inside the epilogue above - and wraps that epilogue in [ERROR] too,
// so counting [ERROR] lines reported 16 "errors" for a build with one while
// Maven's own authoritative "[INFO] 1 error" was discarded by the [INFO]
// filter. An agent reads that number to judge progress across build
// iterations, and "... +N more" told it there were hidden diagnostics that did
// not exist. So: chrome is dropped, repeats are folded, and when javac
// produced real "file:[line,col] message" rows the count is the number of
// those. A failure with no compiler diagnostics at all (a plugin or surefire
// failure) counts the distinct error messages that remain, which is the only
// honest number available for that shape.
function condenseMvn(text) {
  const lines = text.split('\\n');
  const NOISE = /^\\[INFO\\]\\s*(Building jar|--- maven-|Scanning for|\\s*$|Downloading|Downloaded|Progress|\\[builder\\])/i;
  const errors = btDedupeTrimmed(
    lines.filter(l => /^\\[ERROR\\]/.test(l)).map(l => l.replace(/^\\[ERROR\\]\\s*/, ''))
  ).filter(t => !mvnIsErrorChrome(t));
  const diagnostics = errors.filter(t => /:\\[\\d+,\\d+\\]/.test(t));
  const errorCount = diagnostics.length > 0 ? diagnostics.length : errors.length;
  const warnings = lines.filter(l => /^\\[WARNING\\]/.test(l));
  const result   = lines.find(l => /BUILD (SUCCESS|FAILURE)/.test(l));

  if (!result) {
    return ttTrimBlankEdges(lines.filter(l => l.trim() && !NOISE.test(l))
      .join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
  }

  const out = [result.replace(/^\\[INFO\\]\\s*/, '').trim()];
  if (errors.length > 0) {
    out.push(errorCount + ' error(s):');
    for (const e of errors.slice(0, 10)) out.push('  ' + e.slice(0, 120));
    if (errors.length > 10) out.push('  ... +' + (errors.length - 10) + ' more lines');
  }
  if (warnings.length > 0 && warnings.length <= 5) {
    for (const w of warnings) out.push('  WARN: ' + w.replace(/^\\[WARNING\\]\\s*/, '').trim().slice(0, 100));
  } else if (warnings.length > 5) {
    out.push(warnings.length + ' warning(s)');
  }
  return out.join('\\n');
}

// ── gradle ────────────────────────────────────────────────────────────────────
function condenseGradle(text) {
  const lines = text.split('\\n');
  const NOISE = /^(Download |\\s*> (Task |Configure |Executing |root project)|To honour the JVM|Starting a Gradle Daemon|\\+---)/i;
  const result   = lines.find(l => /BUILD (SUCCESSFUL|FAILED)/.test(l));
  const errors   = lines.filter(l => /^(> Task :.+ FAILED|e: |error: )/i.test(l.trim()));
  const warnings = lines.filter(l => /^w: /i.test(l.trim()));

  if (!result) {
    return ttTrimBlankEdges(lines.filter(l => l.trim() && !NOISE.test(l))
      .join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
  }

  const out = [result.trim()];
  if (errors.length > 0) {
    for (const e of errors.slice(0, 10)) out.push('  ' + e.trim().slice(0, 120));
    if (errors.length > 10) out.push('  ... +' + (errors.length - 10) + ' more errors');
  }
  if (warnings.length > 0 && warnings.length <= 5) {
    for (const w of warnings) out.push('  WARN: ' + w.trim().slice(0, 100));
  } else if (warnings.length > 5) {
    out.push(warnings.length + ' warning(s)');
  }
  return out.join('\\n');
}

// ── dotnet ────────────────────────────────────────────────────────────────────
function condenseDotnet(text, sub) {
  const lines = text.split('\\n');

  if (sub === 'test') {
    const failures = [];
    let passed = 0, failed = 0, skipped = 0;
    for (const line of lines) {
      const pM = line.match(/Passed!\\s*-\\s*Failed:\\s*\\d+,\\s*Passed:\\s*(\\d+)/) ??
                 line.match(/Passed:\\s*(\\d+)/);
      const fM = line.match(/Failed:\\s*(\\d+)/);
      const sM = line.match(/Skipped:\\s*(\\d+)/);
      if (pM) passed  = +pM[1];
      if (fM) failed  = +fM[1];
      if (sM) skipped = +sM[1];
      const failH = line.match(/^\\s+X\\s+(.+)/);
      if (failH) failures.push(failH[1].trim());
    }
    if (passed === 0 && failed === 0) return text;
    const parts = [passed + ' passed'];
    if (failed  > 0) parts.push(failed  + ' failed');
    if (skipped > 0) parts.push(skipped + ' skipped');
    const out = ['dotnet test: ' + parts.join(', ')];
    for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
    if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
    return out.join('\\n');
  }

  // build / restore
  //
  // MSBuild's console logger prints every diagnostic TWICE - once inline where
  // the compiler emitted it and once again in the trailing error/warning
  // summary - so counting matching lines reported "2 error(s):" for a build
  // with one, and listed the identical line twice underneath. MSBuild's own
  // "1 Error(s)" tally is in the same output, so the inflated number
  // contradicted the tool it was summarising. Fold the repeats.
  const errors   = btDedupeTrimmed(lines.filter(l => /\\berror (CS|MSB)\\d+/i.test(l)));
  const warnings = btDedupeTrimmed(lines.filter(l => /\\bwarning (CS|MSB)\\d+/i.test(l)));
  const result   = lines.find(l => /Build succeeded|FAILED|Error/.test(l));

  if (!result) return text;
  const out = [result.trim()];
  if (errors.length > 0) {
    out.push(errors.length + ' error(s):');
    for (const e of errors.slice(0, 10)) out.push('  ' + e.slice(0, 120));
    if (errors.length > 10) out.push('  ... +' + (errors.length - 10) + ' more');
  }
  if (warnings.length > 0 && warnings.length <= 5) {
    for (const w of warnings) out.push('  WARN: ' + w.slice(0, 100));
  } else if (warnings.length > 5) {
    out.push(warnings.length + ' warning(s)');
  }
  return out.join('\\n');
}

// ── bun ───────────────────────────────────────────────────────────────────────
function condenseBunInstall(text) {
  const lines = text.split('\\n');
  const out = lines.filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (/^\\[.*\\]\\s*(Resolving|Downloading|Fetching|Extracting)/.test(t)) return false;
    if (/^(Saved lockfile)$/.test(t)) return false;
    return true;
  });
  return ttTrimBlankEdges(out.join('\\n').replace(/\\n{3,}/g, '\\n\\n')) || text;
}

function condenseBunTest(text) {
  const lines = text.split('\\n');
  const failures = [];
  let passed = 0, failed = 0, skipped = 0;

  for (const line of lines) {
    const pM = line.match(/(\\d+) pass/);
    const fM = line.match(/(\\d+) fail/);
    const sM = line.match(/(\\d+) skip/);
    if (pM) passed  = +pM[1];
    if (fM) failed  = +fM[1];
    if (sM) skipped = +sM[1];
    const failH = line.match(/^\\s*[✗✕×]\\s+(.+)/u);
    if (failH) failures.push(failH[1].trim());
  }

  if (passed === 0 && failed === 0) return text;
  const parts = [passed + ' passed'];
  if (failed  > 0) parts.push(failed  + ' failed');
  if (skipped > 0) parts.push(skipped + ' skipped');
  const out = ['Bun test: ' + parts.join(', ')];
  for (const f of failures.slice(0, 10)) out.push('  FAIL: ' + f);
  if (failures.length > 10) out.push('  ... +' + (failures.length - 10) + ' more');
  return out.join('\\n');
}
`

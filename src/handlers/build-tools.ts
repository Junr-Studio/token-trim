export const BUILD_TOOLS_HANDLER = `
// ── terraform / tofu ──────────────────────────────────────────────────────────
function condenseTerraform(text, sub) {
  const lines = text.split('\\n');

  if (sub !== 'plan' && sub !== 'apply') {
    return lines.filter(l => {
      const t = l.trim();
      return t && !/^(Refreshing state|Reading |Read complete|Acquiring state lock|Releasing state lock|Initializing the backend|Initializing provider)/.test(t);
    }).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
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

// ── mvn ───────────────────────────────────────────────────────────────────────
function condenseMvn(text) {
  const lines = text.split('\\n');
  const NOISE = /^\\[INFO\\]\\s*(Building jar|--- maven-|Scanning for|\\s*$|Downloading|Downloaded|Progress|\\[builder\\])/i;
  const errors   = lines.filter(l => /^\\[ERROR\\]/.test(l));
  const warnings = lines.filter(l => /^\\[WARNING\\]/.test(l));
  const result   = lines.find(l => /BUILD (SUCCESS|FAILURE)/.test(l));

  if (!result) {
    return lines.filter(l => l.trim() && !NOISE.test(l))
      .join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
  }

  const out = [result.replace(/^\\[INFO\\]\\s*/, '').trim()];
  if (errors.length > 0) {
    out.push(errors.length + ' error(s):');
    for (const e of errors.slice(0, 10)) out.push('  ' + e.replace(/^\\[ERROR\\]\\s*/, '').trim().slice(0, 120));
    if (errors.length > 10) out.push('  ... +' + (errors.length - 10) + ' more');
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
    return lines.filter(l => l.trim() && !NOISE.test(l))
      .join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
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
  const errors   = lines.filter(l => /\\berror (CS|MSB)\\d+/i.test(l));
  const warnings = lines.filter(l => /\\bwarning (CS|MSB)\\d+/i.test(l));
  const result   = lines.find(l => /Build succeeded|FAILED|Error/.test(l));

  if (!result) return text;
  const out = [result.trim()];
  if (errors.length > 0) {
    out.push(errors.length + ' error(s):');
    for (const e of errors.slice(0, 10)) out.push('  ' + e.trim().slice(0, 120));
    if (errors.length > 10) out.push('  ... +' + (errors.length - 10) + ' more');
  }
  if (warnings.length > 0 && warnings.length <= 5) {
    for (const w of warnings) out.push('  WARN: ' + w.trim().slice(0, 100));
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
  return out.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || text;
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

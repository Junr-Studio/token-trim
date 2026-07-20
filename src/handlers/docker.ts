export const DOCKER_HANDLER = `
// ── docker ────────────────────────────────────────────────────────────────────
function condenseDocker(text, cmdArgs) {
  const sub = cmdArgs[0] ?? '';

  // Strip layer-transfer noise common to pull / push / build
  const LAYER_NOISE = /^(Pull complete|Already exists|Waiting|Preparing|Layer already exists|Pulling fs layer|Verifying Checksum|Download complete|Extracting|Pushed|Mounted from)/;
  const stripped = text.split('\\n')
    .filter(l => !LAYER_NOISE.test(l.trim()))
    .join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();

  if (sub === 'build' || sub === 'buildx') {
    return stripped.split('\\n').filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (/^--->\\s*(Using cache|[a-f0-9]{8,})$/.test(t)) return false;
      if (/^Sending build context/.test(t)) return false;
      if (/^sha256:[a-f0-9]{12,}/.test(t)) return false;
      return true;
    }).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim() || stripped;
  }

  if (sub === 'ps') {
    const dataLines = stripped.split('\\n').filter(l => l.trim() && !/^CONTAINER ID/.test(l));
    if (dataLines.length === 0) return '[docker] 0 containers running';
    const out = ['[docker] ' + dataLines.length + ' containers:'];
    for (const line of dataLines.slice(0, 15)) {
      const cols = line.replace(/\\s{2,}/g, '\\t').split('\\t');
      if (cols.length >= 5) {
        const id     = cols[0].slice(0, 12);
        const img    = (cols[1] ?? '').split('/').pop() ?? '';
        const status = cols[4] ?? '';
        const name   = cols[cols.length - 1] ?? '';
        out.push('  ' + id + ' ' + name + ' (' + img + ') ' + status);
      } else {
        out.push('  ' + line.slice(0, 100));
      }
    }
    if (dataLines.length > 15) out.push('  ... +' + (dataLines.length - 15) + ' more');
    return out.join('\\n');
  }

  if (sub === 'images') {
    const dataLines = stripped.split('\\n').filter(l => l.trim() && !/^REPOSITORY/.test(l));
    if (dataLines.length === 0) return '[docker] 0 images';
    const out = ['[docker] ' + dataLines.length + ' images:'];
    for (const line of dataLines.slice(0, 15)) {
      const cols = line.replace(/\\s{2,}/g, '\\t').split('\\t');
      if (cols.length >= 4) {
        const repo = cols[0] ?? '';
        const tag  = cols[1] ?? '';
        const size = cols[cols.length - 1] ?? '';
        out.push('  ' + repo + ':' + tag + '  [' + size + ']');
      } else {
        out.push('  ' + line.slice(0, 100));
      }
    }
    if (dataLines.length > 15) out.push('  ... +' + (dataLines.length - 15) + ' more');
    return out.join('\\n');
  }

  return stripped || text;
}

// ── kubectl ───────────────────────────────────────────────────────────────────
function condenseKubectl(text, cmdArgs) {
  const sub     = cmdArgs[0] ?? '';
  const rawKind = (cmdArgs[1] ?? '').toLowerCase();
  const kind    = rawKind === 'svc' ? 'service' : rawKind.replace(/s$/, '');

  if (sub === 'get' && (kind === 'pod' || kind === 'po')) {
    const dataLines = text.split('\\n').filter(l => l.trim() && !/^NAME/.test(l));
    let running = 0, pending = 0, failed = 0;
    const issues = [];
    for (const line of dataLines) {
      const parts  = line.split(/\\s+/);
      const status = parts[2] ?? '';
      if (status === 'Running') running++;
      else if (/^(Pending|ContainerCreating|Init|PodInitializing)/.test(status)) pending++;
      else if (/^(Error|CrashLoopBackOff|Failed|OOMKilled|Terminating|ImagePullBackOff)/.test(status)) {
        failed++;
        issues.push(parts[0] + ' [' + status + ']');
      }
    }
    const total = running + pending + failed;
    let out = total + ' pods: ' + running + ' running';
    if (pending) out += ', ' + pending + ' pending';
    if (failed)  out += ', ' + failed + ' failed';
    for (const issue of issues.slice(0, 5)) out += '\\n  [x] ' + issue;
    return out;
  }

  if (sub === 'get' && (kind === 'service' || kind === 'ingres')) {
    const dataLines = text.split('\\n').filter(l => l.trim() && !/^NAME/.test(l));
    if (dataLines.length === 0) return 'No ' + rawKind + ' found';
    const out = [dataLines.length + ' ' + rawKind + ':'];
    for (const line of dataLines.slice(0, 20)) {
      const cols = line.split(/\\s+/);
      out.push('  ' + (cols[0] ?? '') + ' ' + (cols[1] ?? '') + ' [' + (cols[4] ?? '') + ']');
    }
    if (dataLines.length > 20) out.push('  ... +' + (dataLines.length - 20) + ' more');
    return out.join('\\n');
  }

  return text;
}
`

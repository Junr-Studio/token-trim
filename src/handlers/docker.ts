export const DOCKER_HANDLER = `
// ── docker ────────────────────────────────────────────────────────────────────
// \`-q\`/\`--quiet\` emits a bare id list and \`--format\` a caller-defined template.
// Both are consumed by something other than the agent's eyes -
// \`docker rm $(docker ps -aq)\` is the canonical idiom - so the only safe
// transform is none. \`-q\` also arrives clustered as \`-aq\`, which a plain
// equality check on the flag would miss.
function dockerIsMachineForm(args) {
  return args.some(a => {
    const s = String(a);
    if (s === '--quiet' || s === '--format' || /^--format=/.test(s)) return true;
    return /^-[A-Za-z]+$/.test(s) && s.indexOf('q') !== -1;
  });
}

// ── docker build: BuildKit ────────────────────────────────────────────────────
// BuildKit is the default builder from Docker 23 on, so this - not the legacy
// "Step k/n" transcript - is what \`docker build\` prints today. Its shape is one
// "#<step> <event>" line per event, and three things repeat on every one of
// them:
//
//   - the "#<step> " prefix itself, on all several-thousand lines;
//   - an elapsed clock in front of every line a RUN step printed
//     ("#8 13.02 + fastify 4.28.1"), which is a fixed cost per line;
//   - a "DONE <dur>" sign-off per step, plus the resolve/transferring/exporting
//     echoes BuildKit prints while it moves bytes around - the direct
//     equivalent of the legacy builder's bare "---> <hash>" lines.
//
// Steps INTERLEAVE in a parallel build, so the prefix cannot simply be deleted:
// it is kept on the first line of every contiguous run of one step and dropped
// inside the run. That is the same shape condenseGhRunLog uses for a job/step
// transition, and it is why every surviving line is still attributable to the
// step that printed it.
//
// A step's own name line is never touched, whatever it says - the drop rules
// apply only to the lines that follow it - and text that is not this grammar
// (the "------" trailer BuildKit appends after a failure, a daemon warning) is
// kept exactly as it came. Reshaping what we did not parse is how a condenser
// starts inventing.
//
// WHICH STREAM: measured on docker 29.4.1, the CLI writes this transcript to
// STDERR and leaves stdout empty, and this proxy compresses stdout only - so
// today a plain \`docker build\` reaches here with nothing, and \`docker build -q\`
// is routed away by dockerIsMachineForm above. What still arrives on stdout is
// the legacy transcript below (DOCKER_BUILDKIT=0, which the engine continues to
// honour). This branch is here so that BuildKit text is CONDENSED rather than
// run through a legacy filter that matches none of its markers on the day it
// does arrive on stdout; it is not a saving the wrapper banks for \`docker build\`
// as the CLI stands. See the note on the matrix entry in
// test/matrix/infra.matrix.ts.
function condenseDockerBuildKit(text) {
  const ROW = /^#(\\d+)\\s+(.*)$/;
  // \`DONE 1.2s\` is timing for a step whose name is already printed. The rest is
  // BuildKit restating the digest or the context size the name line carried,
  // plus the per-chunk download meter ("sha256:b05… 1.05MB / 2.23MB 0.8s").
  // ERROR, WARN, CACHED and "naming to <tag> done" are deliberately NOT here.
  const NOISE = /^(DONE\\s+[\\d.]+s|transferring\\s|resolve\\s|extracting\\s|unpacking\\s|preparing\\s|sending\\s|sha256:|exporting layers|exporting manifest|exporting config|exporting attestation)/;
  // The per-line elapsed clock: "13.02 " in "#8 13.02 + fastify 4.28.1". Always
  // two or three decimals, so a line of output that merely starts with a number
  // ("42 packages installed") is not mistaken for one.
  const CLOCK = /^\\d+\\.\\d{2,3}(?:\\s|$)/;

  const named = {};
  const out = [];
  let cur = null, matched = 0;

  for (const raw of text.split('\\n')) {
    const line = raw.replace(/\\s+$/, '');
    const m = line.match(ROW);
    if (!m) {
      // Blank lines separate BuildKit's stanzas and carry nothing; anything
      // else that is not a step line is content and is kept verbatim.
      if (line) { out.push(line); cur = null; }
      continue;
    }
    matched++;
    const id = m[1];
    let rest = m[2];
    const isName = !Object.prototype.hasOwnProperty.call(named, id);

    if (isName) {
      named[id] = rest;
    } else {
      if (NOISE.test(rest)) continue;
      // BuildKit re-prints a step's name line every time that step resumes;
      // the repeat says nothing the first one did not.
      if (rest === named[id]) continue;
      rest = rest.replace(CLOCK, '');
      // A clock with nothing behind it is a blank line the RUN command printed.
      if (!rest) continue;
    }
    // Re-label whenever the step changes: in a parallel build the previous line
    // belonged to another step, and a bare message under the wrong header is
    // worse than the prefix it saved.
    out.push(id === cur ? rest : '#' + id + ' ' + rest);
    cur = id;
  }

  if (matched === 0) return text;
  return out.join('\\n');
}

// ── docker's subcommand is not args[0] ────────────────────────────────────────
// Two things move it, and both used to defeat every docker condenser:
//
//   - a GLOBAL FLAG before the verb. \`docker --context prod ps\` read the
//     subcommand as "--context"; ttGlobalFlags already tables docker's
//     value-taking flags, and resolveSub skips them and their values. This is
//     the same bug condenseKubectl's comment below records fixing for
//     \`kubectl -n prod get pods\`.
//   - the MANAGEMENT-COMMAND spelling. \`docker container ls\` and \`docker ps\`
//     print the identical table, as do \`docker image ls\` and \`docker images\`;
//     docker has documented both spellings since 1.13 and the newer one is what
//     its own help now shows.
//
// Only aliases whose output is byte-identical are folded, so nothing is routed
// to a condenser built for a different table.
// Compose's OWN value-taking global flags. \`resolveSub\` tables docker's
// (--context, --host, --log-level, tls*) and knows none of these, so it skipped
// the flag without consuming its value and returned the VALUE as the verb:
// \`docker compose -f docker-compose.prod.yml build\` resolved to
// "docker-compose.prod.yml", missed the \`verb === 'build'\` test below, and fell
// back into the passthrough branch at 0% saved - the same hole that branch was
// added to close, one flag away. \`--progress plain\` is the sharpest case, since
// it is the flag that FORCES the transcript being condensed.
//
// A function rather than a const: handler sources are concatenated after the
// frame and only declarations hoist. \`--compatibility\`, \`--dry-run\` and
// \`--all-resources\` are booleans and are deliberately absent.
function ttComposeValueFlags() {
  return ['-f', '--file', '-p', '--project-name', '--project-directory',
          '--env-file', '--profile', '--progress', '--parallel', '--ansi'];
}

function ttComposeVerb(rest) {
  const takesValue = ttComposeValueFlags();
  for (let i = 0; i < rest.length; i++) {
    const a = String(rest[i]);
    if (a === '--') return String(rest[i + 1] ?? '');
    if (a.charAt(0) !== '-') return a;
    // \`--file=x.yml\` carries its value in the same token.
    if (a.indexOf('=') !== -1) continue;
    if (takesValue.indexOf(a) !== -1) i++;
  }
  return '';
}

function dockerSub(args) {
  const first = resolveSub('docker', args);
  if (first.subIndex < 0) return '';
  const sub = first.sub;
  const rest = args.slice(first.subIndex + 1);
  const verb = sub === 'compose' ? ttComposeVerb(rest) : resolveSub('docker', rest).sub;
  if (sub === 'buildx') return 'build';
  if (sub === 'container' && (verb === 'ls' || verb === 'ps' || verb === 'list')) return 'ps';
  if (sub === 'image' && (verb === 'ls' || verb === 'list')) return 'images';
  if (sub === 'image' && (verb === 'build' || verb === 'pull' || verb === 'push')) return verb;
  // \`docker compose\` is the compose v2 spelling, and three of its subcommands
  // put DOCKER's OWN output on stdout rather than a contained program's:
  // \`build\` prints the BuildKit (or legacy "Step k/n") transcript, \`pull\` and
  // \`push\` the daemon's layer-transfer report. Byte-identical to the top-level
  // commands, because it is the same builder and the same daemon printing them.
  //
  // WHICH STREAM: measured on Docker Compose v5.1.3 / docker 29.4.1,
  // \`docker compose build --no-cache >out 2>err\` put the whole 2228-byte
  // BuildKit transcript on STDOUT and left only compose's own 63-byte
  // " Image <svc> Building/Built" chatter on stderr - the exact INVERSE of plain
  // \`docker build\`, whose transcript goes to stderr (see condenseDockerBuildKit
  // above). So this, not \`docker build\`, is the build invocation whose
  // transcript an agent actually pays for, and it was reaching no condenser at
  // all: dockerSub answered "compose" and compose fell into the passthrough
  // branch below, at 0% saved.
  //
  // Nothing else compose does is folded. \`up\`, \`logs\`, \`run\` and \`exec\` stream
  // the CONTAINED PROGRAM's stdout - measured: a real \`docker compose up\` put
  // "Waiting for postgres at app-db:5432" on stdout and its own lifecycle
  // chatter on stderr - and \`compose ps\` prints its own table, with a SERVICE
  // column \`docker ps\` has never had. Those stay "compose" and stay passthrough,
  // which is what that branch was put there to protect.
  if (sub === 'compose' && (verb === 'build' || verb === 'pull' || verb === 'push')) return verb;
  return sub;
}

// ── layer-transfer chatter ────────────────────────────────────────────────────
// One line per layer, printed by the DAEMON while it moves bytes around, and
// only ever by pull / push / build.
//
// The scope is the whole point. This filter used to run on \`text\` at the top of
// condenseDocker, before any dispatch, so it also ran on \`docker logs\`,
// \`docker run\` and \`docker exec\` - whose stdout is the CONTAINED PROGRAM's
// output. "Waiting for postgres..." is the canonical compose entrypoint wait
// loop, "Extracting templates from packages" is apt inside a \`docker run\`, and
// both were deleted by line shape with no marker and no notice - so the agent
// diagnosing a hung container lost the very line saying what it was waiting on.
// src/handlers/http.ts records the same class as fixed for wget: a condenser may
// delete what it RECOGNISES, never what merely looks alike.
function ttDockerStripLayerNoise(text) {
  // The layer ID comes FIRST. Captured from docker 29.4.1, \`docker pull
  // alpine:3.19\`, byte for byte:
  //
  //   3.19: Pulling from library/alpine
  //   17a39c0ba978: Pulling fs layer
  //   ef1614f30685: Download complete
  //   17a39c0ba978: Pull complete
  //   Digest: sha256:6baf4358...
  //   Status: Downloaded newer image for alpine:3.19
  //
  // Anchored at \`^\` with no room for that prefix, this list matched not one
  // line of it - so the filter had never fired on real \`docker pull\` output,
  // and the fixture backing it had been written to the regex rather than to the
  // tool. The prefix is optional because \`docker build\`'s legacy transcript
  // does print some of these bare.
  const LAYER_NOISE = /^(?:[0-9a-f]{6,}: )?(Pull complete|Already exists|Waiting|Preparing|Layer already exists|Pulling fs layer|Verifying Checksum|Download complete|Downloading|Extracting|Pushing|Pushed|Mounted from|Retrying)/;
  return text.split('\\n')
    .filter(l => !LAYER_NOISE.test(l.trim()))
    .join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
}

function condenseDocker(text, cmdArgs) {
  const args = (cmdArgs ?? []).map(String);
  const sub = dockerSub(args);

  if (dockerIsMachineForm(args)) return text;

  if (sub === 'pull' || sub === 'push') return ttDockerStripLayerNoise(text);

  if (sub === 'build') {
    const stripped = ttDockerStripLayerNoise(text);
    // Which builder printed this? BuildKit has been the default since Docker
    // 23, and it prefixes every line it emits with "#<step> ". The legacy
    // transcript below ("Step k/n", "---> Using cache") never contains one.
    if (/^#\\d+\\s/m.test(stripped)) return condenseDockerBuildKit(stripped);

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
    const dataLines = text.split('\\n').filter(l => l.trim() && !/^CONTAINER ID/.test(l));
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
    const dataLines = text.split('\\n').filter(l => l.trim() && !/^REPOSITORY/.test(l));
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

  // Every other subcommand - logs, run, exec, cp, top, compose - puts something
  // this file has not parsed on stdout, most often the application's own
  // output. Passthrough is the contract, not the fallback.
  return text;
}

// ── kubectl describe ──────────────────────────────────────────────────────────
// 200-400 lines per object, of which the agent wants: what it is, what state it
// is in, which conditions are NOT satisfied, and the Events table. The rest is
// scheduling and plumbing detail - and the Annotations block routinely inlines
// an entire last-applied-configuration JSON document, which is the single
// largest thing in the output and never what was asked for.
//
// Falls back to the input whenever the "Field:  value" shape is absent, so an
// error message from the API server is never reshaped into a fake object report.
function condenseKubectlDescribe(text) {
  const lines = text.split('\\n');
  if (!/^Name:\\s+\\S/m.test(text)) return text;

  const DROP_BLOCKS = /^(Labels|Annotations|Tolerations|Volumes|Mounts|Node-Selectors|IPs|Environment|Image ID|Container ID|Priority|Service Account|Start Time|QoS Class):/;
  const KEEP_FIELDS = /^(Name|Namespace|Node|Status|Reason|Message|Controlled By|IP):\\s/;

  const out = [];
  let skipping = false;
  let inConditions = false;
  let inEvents = false;

  for (const raw of lines) {
    const line = raw.replace(/\\s+$/, '');
    if (!line) continue;

    const isContinuation = /^\\s/.test(line);

    if (!isContinuation) {
      skipping = DROP_BLOCKS.test(line);
      inConditions = /^Conditions:/.test(line);
      inEvents = /^Events:/.test(line);
      if (skipping) continue;
      if (KEEP_FIELDS.test(line) || inConditions || inEvents) { out.push(line); continue; }
      // An unrecognised top-level field is kept: better a spare line than a
      // silently dropped one.
      if (/^[A-Z][\\w .-]*:/.test(line)) { out.push(line); continue; }
      continue;
    }

    if (skipping) continue;

    if (inConditions) {
      // Only the conditions that are NOT satisfied say anything.
      if (/\\bFalse\\b|\\bUnknown\\b/.test(line)) out.push(line);
      continue;
    }
    if (inEvents) { out.push(line); continue; }

    // Container sub-blocks: keep state and image, drop ids, digests, limits.
    //
    // Reason is the field the agent ran \`describe\` FOR. "State: Waiting" with
    // its Reason deleted says the container is stuck and refuses to say why,
    // and "Last State: Terminated / Exit Code: 137" without "Reason: OOMKilled"
    // leaves a bare number where the cause was - kubelet emits no OOMKilled
    // EVENT, so the Events table this condenser does keep carries no second
    // copy. KEEP_FIELDS above already declares Reason worth keeping; kubectl
    // only ever prints it indented, under State / Last State, so that regex
    // never saw it.
    if (/^\\s+(Image|State|Ready|Restart Count|Last State|Exit Code|Started|Finished|Reason):/.test(line)) {
      out.push(line);
      continue;
    }

    // The container's own name line ("  app:", "  sidecar:"): a bare label at
    // the block's own indent, with no value after the colon. Without it the
    // per-container blocks run together with nothing saying which container is
    // which - and \`kubectl logs -c <name>\`, the obvious next command, has no
    // name to take. Matched at exactly two spaces so the deeper bare labels
    // inside a container (Limits:, Environment:, Mounts:) stay dropped.
    if (/^ {2}[A-Za-z0-9][A-Za-z0-9_.-]*:\\s*$/.test(line)) out.push(line);
  }

  return out.length > 0 ? out.join('\\n') : text;
}

// ── kubectl table columns are not positional ──────────────────────────────────
// Two standard invocations change the column layout of \`kubectl get\`:
//
//   - \`-A\` / \`--all-namespaces\` PREPENDS a NAMESPACE column, shifting every
//     other one right. The old \`!/^NAME/\` header filter still dropped the
//     header (it starts "NAMESPACE"), and the rollup then read parts[2] - which
//     is now READY, "1/1" - as the STATUS. Nothing matched, so a full cluster
//     with a CrashLoopBackOff in it came back as "0 pods: 0 running".
//   - \`-o custom-columns=\` REPLACES the set outright, so there may be no STATUS
//     column at all.
//
// So the header row names the columns and every index is derived from it. A
// table whose header does not carry the column a branch needs, or that has no
// header row (\`--no-headers\`), is passed through untouched: guessing an index
// is what produced the fabricated zero.
//
// Returns null when the text is not a header-led table.
function ttKubeTable(text) {
  const lines = text.split('\\n').filter(l => l.trim());
  // The header must be the FIRST line. Anything printed ahead of it is
  // something this parser did not account for, and the caller passes through.
  if (lines.length === 0 || !/^(NAME|NAMESPACE)\\s/.test(lines[0])) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) rows.push(lines[i].trim().split(/\\s+/));
  return { cols: lines[0].trim().split(/\\s+/), rows: rows };
}

// \`-o custom-columns=...\` / \`custom-columns-file=...\` is a caller-defined
// format: the columns, their order and their names are whatever was asked for,
// and something downstream is usually cutting fields back out of it - the same
// reasoning that makes \`docker ps --format\` untouchable. isMachineOutput knows
// the json/yaml/wide family but not this spelling, so the guard lives here.
function ttKubectlCustomColumns(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (/^(?:--output=|-o=?)custom-columns/.test(a)) return true;
    if ((a === '-o' || a === '--output') &&
        /^custom-columns/.test(String(argv[i + 1] ?? ''))) return true;
  }
  return false;
}

// \`-o wide\` is the OPPOSITE of a machine format: it is the human table with two
// more columns on it (IP, NODE, NOMINATED NODE), and nothing parses it. It used
// to be listed in ttIsFormatValue anyway, which made it machine output - so it
// skipped the condenser AND the 8 KB backstop, and a 2000-pod listing arrived
// in the context window at 246 KB, roughly 60k tokens, whole.
//
// Removing it there is only half the fix: the pod rollup below answers
// "N pods: N running", and the IP and NODE columns it would drop are the entire
// reason anyone types \`-o wide\`. So the rollup steps aside for it and the table
// is relayed as printed - trailing whitespace stripped, and capped by the
// backstop like any other large output.
function ttKubectlWide(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (/^(?:--output=|-o=?)wide$/.test(a)) return true;
    if ((a === '-o' || a === '--output') && String(argv[i + 1] ?? '') === 'wide') return true;
  }
  return false;
}

// Which bucket a pod STATUS falls in, or '' for one this rollup has no bucket
// for. The failure list is checked before the pending one so that \`Init:Error\`
// and \`Init:CrashLoopBackOff\` are not filed as "still starting up".
//
// It is deliberately NOT exhaustive - kubectl synthesises the STATUS column
// from container state and new spellings appear - which is why the caller
// reports an unbucketed status under the name kubectl printed rather than
// dropping it.
function ttPodStatusClass(status) {
  if (status === 'Running') return 'running';
  // Neither a failure nor still starting. Each gets no bucket of its own, so
  // that the word in the summary is the one kubectl printed rather than one this
  // file chose for it:
  //
  //   - Completed / Succeeded: a terminal SUCCESS - the end state of every
  //     finished Job and CronJob pod.
  //   - Terminating: a pod inside its termination grace period. This is what
  //     kubectl prints for the OLD ReplicaSet's pods through every rolling
  //     update, and for every pod of a \`kubectl delete\` - the most ordinary
  //     transition there is. It was in the failure list below, so a routine
  //     rollout came back as "N failed" with the draining pod in the \`[x]\`
  //     list: a problem the input never claimed, and one the agent then goes
  //     and chases. The \`[x]\` list means something is WRONG; a lifecycle
  //     transition is not.
  if (/^(Completed|Succeeded|Terminating)$/.test(status)) return '';
  if (/(Error|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|ImageInspectError|InvalidImageName|CreateContainer|RunContainerError|StartError|OOMKilled|Evicted|Failed|Unknown|NotReady|Unschedulable|NodeLost|NodeAffinity|DeadlineExceeded)/.test(status)) return 'failed';
  if (/^(Pending|ContainerCreating|PodInitializing|Init)/.test(status)) return 'pending';
  return '';
}

// ── kubectl ───────────────────────────────────────────────────────────────────
function condenseKubectl(text, cmdArgs) {
  const argv = (cmdArgs ?? []).map(String);
  // The verb and the kind are positional, but global flags come first:
  // "kubectl -n prod get pods" put the kind at args[2], and reading args[1]
  // resolved it to "prod" - so every namespaced invocation silently lost its
  // condenser. resolveSub skips the flags and their values.
  const verbAt  = resolveSub('kubectl', argv);
  const sub     = verbAt.sub;
  const rawKind = (verbAt.subIndex >= 0
    ? resolveSub('kubectl', argv.slice(verbAt.subIndex + 1)).sub
    : '').toLowerCase();
  const kind    = rawKind === 'svc' ? 'service' : rawKind.replace(/s$/, '');

  if (sub === 'describe') return condenseKubectlDescribe(text);

  if (sub === 'get' && (kind === 'pod' || kind === 'po')) {
    if (ttKubectlCustomColumns(argv) || ttKubectlWide(argv)) return text;
    const table = ttKubeTable(text);
    if (!table) return /^No resources found/m.test(text) ? '0 pods: 0 running' : text;
    const nameAt   = table.cols.indexOf('NAME');
    const statusAt = table.cols.indexOf('STATUS');
    const nsAt     = table.cols.indexOf('NAMESPACE');
    if (nameAt < 0 || statusAt < 0) return text;

    let running = 0, pending = 0, failed = 0;
    const issues = [];
    // Statuses with no bucket, counted under the exact spelling kubectl used.
    const otherOrder = [];
    const otherCount = {};
    for (const parts of table.rows) {
      // A row too short to reach the column the header promised is not the
      // table this parser thinks it is; do not guess at the rest.
      if (parts.length <= statusAt) return text;
      const status = parts[statusAt];
      const name = (nsAt >= 0 ? (parts[nsAt] ?? '') + '/' : '') + (parts[nameAt] ?? '');
      const cls = ttPodStatusClass(status);
      if (cls === 'running') running++;
      else if (cls === 'pending') pending++;
      else if (cls === 'failed') { failed++; issues.push(name + ' [' + status + ']'); }
      else {
        // \`Completed\` is the terminal STATUS of every finished Job/CronJob pod,
        // so this is not an exotic path. The total used to be running + pending
        // + failed, which meant these rows left the body AND the count: a
        // CronJob-only namespace reported "0 pods: 0 running" for a full table.
        if (!Object.prototype.hasOwnProperty.call(otherCount, status)) {
          otherCount[status] = 0;
          otherOrder.push(status);
        }
        otherCount[status]++;
      }
    }
    // The total is the number of ROWS, so it can never disagree with the table.
    let out = table.rows.length + ' pods: ' + running + ' running';
    if (pending) out += ', ' + pending + ' pending';
    if (failed)  out += ', ' + failed + ' failed';
    for (const status of otherOrder) out += ', ' + otherCount[status] + ' ' + status;
    for (const issue of issues.slice(0, 5)) out += '\\n  [x] ' + issue;
    if (issues.length > 5) out += '\\n  ... +' + (issues.length - 5) + ' more';
    return out;
  }

  if (sub === 'get' && (kind === 'service' || kind === 'ingres')) {
    if (ttKubectlCustomColumns(argv) || ttKubectlWide(argv)) return text;
    const table = ttKubeTable(text);
    if (!table) return /^No resources found/m.test(text) ? 'No ' + rawKind + ' found' : text;
    if (table.rows.length === 0) return 'No ' + rawKind + ' found';
    // Same NAMESPACE shift as the pod branch: under -A the name/type/ports
    // columns all move right by one, and reading fixed indices relabelled a
    // service's EXTERNAL-IP as its ports.
    const off = table.cols[0] === 'NAMESPACE' ? 1 : 0;
    const out = [table.rows.length + ' ' + rawKind + ':'];
    for (const cols of table.rows.slice(0, 20)) {
      out.push('  ' + (cols[off] ?? '') + ' ' + (cols[off + 1] ?? '') + ' [' + (cols[off + 4] ?? '') + ']');
    }
    if (table.rows.length > 20) out.push('  ... +' + (table.rows.length - 20) + ' more');
    return out.join('\\n');
  }

  return text;
}
`

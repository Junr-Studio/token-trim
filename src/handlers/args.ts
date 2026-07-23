// Pre-spawn argv predicates (injected into proxy.mjs at startup).
//
// These four functions run BEFORE the command executes and decide what gets
// run and whether its output is compressed at all. They are pure functions of
// (cmd, argv) so they are unit-testable at the seam in test/arg-rewrite.test.ts
// without spawning a process.

export const ARGS_HANDLER = `
// ── out-of-band notices ───────────────────────────────────────────────────────
// A condenser that caps a SUMMARY can say so inline: the output is prose either
// way. A condenser that caps a DATA LIST cannot. \`git ls-files\`, \`rg -l\`,
// \`docker ps -q\` and \`terraform state list\` all exist to be piped -
// \`git ls-files | xargs prettier --write\` - and an inline
// "... 60 paths elided ..." line hands xargs six filenames that do not exist.
//
// So stdout stays pure data and the disclosure goes out of band: the condenser
// calls ttNotice(), the frame drains it after compress() and writes it to
// stderr, alongside every other instruction the agent already receives there.
//
// State lives on globalThis because a handler source may declare only function
// declarations at top level (see resolveSub's note): a module-level binding is
// still in its temporal dead zone when the frame calls in.
function ttNotice(message) {
  const g = globalThis;
  if (!g.__ttNotices) g.__ttNotices = [];
  g.__ttNotices.push(String(message));
}

function ttTakeNotices() {
  const g = globalThis;
  const out = g.__ttNotices ?? [];
  g.__ttNotices = [];
  return out;
}

// Caps a list of DATA lines without ever putting a foreign token in the stream.
// Keeps \`head\` from the front and \`tail\` from the back, and discloses the gap
// out of band.
//
// WHERE the gap is comes from \`tail\`, not from a fixed phrase. Most callers pass
// tail = 0 (\`rg -l\` / \`grep -rl\` path lists, gh's row lists, \`df\`), and for
// those the omitted entries are the LAST ones, not the middle. An agent told the
// middle was dropped assumes it still holds both ends of an ordered list, so on
// newest-first \`gh pr list\` rows it reads the last visible row as the oldest PR,
// and on path-sorted \`rg -l\` output it concludes the alphabetically-last paths
// were searched and matched nothing. Both are wrong negatives reachable without
// re-running with __TT_FULL_FLAG__ - and the out-of-band notice is the only
// channel that can describe a truncation stdout must not mention.
function ttCapDataList(lines, head, tail, noun) {
  if (lines.length <= head + tail) return lines;
  const elided = lines.length - head - tail;
  const where = tail > 0 ? 'the middle' : 'the end';
  ttNotice(elided + ' of ' + lines.length + ' ' + noun +
    ' omitted from ' + where + ' of this list; re-run with __TT_FULL_FLAG__ for all of them');
  return tail > 0
    ? lines.slice(0, head).concat(lines.slice(lines.length - tail))
    : lines.slice(0, head);
}

// Recognises the shape that MUST stay pipeable: one datum per line, no indent,
// no column padding, no prose. \`rg -l\`, \`grep -rl\`, \`git ls-files\`, \`find\`,
// \`docker ps -q\` and \`terraform state list\` all produce it, and every one of
// them is typed with a \`| xargs\` after it.
//
// This mirrors the I3 classifier in test/support/invariants.ts, and it exists so
// the frame's last-resort cap can tell a list from a log. Deliberately
// conservative in the safe direction: reading a list as prose costs an inline
// marker in output nobody pipes, reading prose as a list costs nothing at all -
// the disclosure simply moves to stderr, where every other one already goes.
function ttIsDataList(text) {
  const lines = String(text).split('\\n').filter(l => l.trim());
  // Under a handful of lines there is no cap to disclose and no reason to guess.
  if (lines.length < 8) return false;
  const DATUM = /^[\\w.@/\\\\:+=~'"[\\]-]+(?: [\\w.@/\\\\:+=~'"[\\]-]+)*$/;
  // Three alphabetic words in a row is a sentence, not a datum. No path, id or
  // resource address reads "re-run with full for" - every marker and summary does.
  const PROSE = /(?:^| )[A-Za-z]{2,}(?: [A-Za-z]{2,}){2}(?: |$)/;
  for (const l of lines) {
    // An indent is structure - a grouping header's children - not a datum.
    if (l !== l.replace(/^\\s+/, '')) return false;
    const t = l.trim();
    // A tab or a run of two spaces is column padding: a table, not a list.
    if (t.indexOf('\\t') !== -1 || t.indexOf('  ') !== -1) return false;
    if (!DATUM.test(t)) return false;
    if (PROSE.test(t)) return false;
  }
  return true;
}

// Drops blank lines from both ends WITHOUT touching the indentation of the
// first line that has content. \`.trim()\` cannot tell those apart, and in a
// column format the first column is the payload: \`git status --short\` prints
// " M src/a.ts" for a file modified in the worktree and "M  src/a.ts" for one
// already staged, so eating one leading space told the agent the opposite fact.
// \`terraform plan\` diffs, \`npm ls\` trees and \`psql\` tables all encode meaning in
// the same position.
//
// Trailing whitespace is still cut: on the last line the content ends before
// it, so nothing is encoded there.
function ttTrimBlankEdges(text) {
  return String(text).replace(/^(?:[ \\t]*\\n)+/, '').replace(/\\s+$/, '');
}

// ── global-flag tables ────────────────────────────────────────────────────────
// Flags that may appear BEFORE a subcommand. Value-taking ones consume the
// following token, so the value is never mistaken for the subcommand
// ("git -C /repo log" must resolve to 'log', not '/repo').
//
// NOTE: every top-level binding in a handler source MUST be a function
// declaration. Handler sources are concatenated AFTER the frame, but the frame
// calls into them from top-level code, so only hoisted declarations are
// reachable - a top-level \\\`const\\\` is still in its temporal dead zone and
// throws ReferenceError. Tables therefore live behind a function.
// A flag listed here MUST really take a following value, and a flag that takes
// one MUST be listed. Both directions are load-bearing and both have been wrong:
// an omitted value-flag returns its VALUE as the subcommand, and a BOOLEAN
// listed as value-taking eats the subcommand that follows it. Short aliases
// count - listing \`--context\` but not \`-c\` is what made \`docker --context prod
// stats\` a detected stream and \`docker -c prod stats\` an indefinite hang.
function ttGlobalFlags(cmd) {
  return ({
    git:       { value: ['-C', '--git-dir', '--work-tree', '--namespace', '-c', '--exec-path'] },
    // kubectl's connection/auth flags are all value-taking. \`--token\` is the
    // sharpest miss: it also disabled follow detection on \`kubectl logs -f\`.
    kubectl:   { value: ['-n', '--namespace', '--context', '--cluster', '--kubeconfig', '--user', '--as', '--as-uid', '--as-group', '--server', '-s', '--token', '--request-timeout', '-v', '--v', '--vmodule', '--cache-dir', '--certificate-authority', '--client-certificate', '--client-key', '--tls-server-name', '--username', '--password', '--profile', '--profile-output'] },
    // -c IS --context, -l IS --log-level. (-D/--debug, --tls, --tlsverify are
    // booleans and must stay out.)
    docker:    { value: ['--context', '-c', '--host', '-H', '--config', '--log-level', '-l', '--tlscacert', '--tlscert', '--tlskey'] },
    // gh's guards are all keyed on the resolved verb, so a missing entry here
    // does not merely lose compression - it lets condenseGhApi reshape a
    // GraphQL response, because \`gh api --hostname <ghe-host> graphql\` resolved
    // the verb to the hostname. \`--cache\`, \`--input\` and \`-p/--preview\` are
    // value-taking \`gh api\` flags and did exactly that: the verb resolved to
    // "60s" and ghStripApiNoise deleted a caller-aliased \`node_id\` from the
    // response, leaving valid JSON no parser can tell was edited.
    gh:        { value: ['--hostname', '-H', '--header', '--repo', '-R', '--method', '-X', '--field', '-F', '--raw-field', '-f', '--jq', '-q', '--template', '-t', '--cache', '--input', '--preview', '-p'] },
    // npm's -w really is --workspace <name>, and -C is --prefix.
    npm:       { value: ['--prefix', '-C', '-w', '--workspace', '--registry', '--loglevel', '--userconfig', '--globalconfig', '--cache'] },
    // pnpm's -w is --workspace-root, a BOOLEAN - the opposite of npm's, from
    // which this row was copied. Its filter short alias is -F.
    pnpm:      { value: ['--dir', '-C', '--filter', '-F', '--filter-prod', '--workspace-concurrency'] },
    yarn:      { value: ['--cwd'] },
    helm:      { value: ['-n', '--namespace', '--kube-context', '--kubeconfig', '--kube-token', '--kube-apiserver', '--kube-as-user', '--kube-as-group', '--kube-ca-file', '--kube-tls-server-name', '--registry-config', '--repository-config', '--repository-cache', '--burst-limit', '--qps'] },
    terraform: { value: ['-chdir'] },
    cargo:     { value: ['--manifest-path', '-Z', '--color', '--config', '--target-dir'] },
    go:        { value: ['-C'] },
  })[cmd] ?? {};
}

// Returns the first token that is not a global flag (nor a flag's value), plus
// its index so a rewrite can splice arguments in at the correct position.
function resolveSub(cmd, args) {
  const table = ttGlobalFlags(cmd);
  const valueFlags = table.value ?? [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') continue;
    if (a.charAt(0) === '-' || a.charAt(0) === '+') {
      // "--flag=value" carries its value inline and consumes nothing extra.
      if (a.indexOf('=') === -1 && valueFlags.indexOf(a) !== -1) i++;
      continue;
    }
    return { sub: a, subIndex: i };
  }
  return { sub: '', subIndex: -1 };
}

// ── arg rewriting ─────────────────────────────────────────────────────────────
// Injecting a compact-output flag before the command runs is exact, where
// post-processing is heuristic. It is also the only path that can change the
// ANSWER rather than the format (a limit drops rows), so every injection is
// reported back so the caller can disclose it.
//
// Two rules hold over every rewrite, and they live HERE rather than in the
// per-command rewriter because this is the only place that sees both the
// original argv and the result:
//
//   1. A declared machine format is never rewritten. compress() already refuses
//      to reshape that output - but rewriteArgs runs BEFORE the spawn, so an
//      injection here is invisible to that guard and cannot be undone by it.
//      \`git status --porcelain=v2\` missed rewriteGitArgs's exact-equality format
//      check and had \`--branch\` spliced in, which PREPENDS two \`# branch.*\`
//      records the command never printed (and \`## main\` in v1, which a parser
//      reading columns 1-2 as the XY code sees as a file named "main").
//   2. An injection that cannot take effect is never REPORTED as one, because
//      the frame turns \`limit\` into a claim about what the agent is holding.
function rewriteArgs(cmd, args) {
  if (isMachineOutput(cmd, args ?? [])) return { args, injected: [], limit: 0 };
  if (cmd === 'git') return ttGuardGitRewrite(args, rewriteGitArgs(args));
  return { args, injected: [], limit: 0 };
}

// Injected flags that change the ANSWER by dropping commits, as opposed to the
// format flags that only reshape them.
function ttIsGitLimitFlag(flag) {
  return /^-\\d+$/.test(flag) || /^-n\\d+$/.test(flag) || /^--max-count/.test(flag);
}

// True when argv already settles how many commits come back, in a spelling
// rewriteGitArgs's exact-match probe does not recognise, or in a shape where a
// cap would answer a different question than the one asked.
function ttGitCapWouldMislead(argv) {
  // \`-n100\` is idiomatic git and matched none of \`-<digits>\`, bare \`-n\`,
  // \`--max-count\`, \`--max-count=N\`. An appended -20 then WINS (git takes the
  // last max-count), so an explicit request for 100 commits came back with 20 -
  // and \`git log -n5\` came back with 20, four times MORE than asked for.
  if (argv.some(a => /^-n\\d+$/.test(a))) return true;
  // git applies the limit while SELECTING commits and reverses afterwards, so a
  // cap on \`--reverse\` does not truncate the tail - it moves the top of the
  // list off the repo's initial commit, which is the row \`--reverse\` was typed
  // to get. The disclosure says "the 20 most recent entries", pointing at the
  // end of the list, i.e. away from the row that actually changed.
  if (argv.indexOf('--reverse') !== -1) return true;
  return false;
}

// Everything after \`--\` is a PATHSPEC. \`[...args, ...injected]\` therefore handed
// git \`-20\` and \`--pretty=...\` as paths: both were silently inert, git returned
// the full history, and \`limit\` was still reported as 20 - so the frame told the
// agent "capped at the 20 most recent entries" about output that had not been
// capped at all. Splice ahead of the separator, where they are still options.
function ttPlaceGitInjections(argv, injected) {
  const sep = argv.indexOf('--');
  if (sep === -1) return argv.concat(injected);
  return argv.slice(0, sep).concat(injected, argv.slice(sep));
}

function ttGuardGitRewrite(args, rewritten) {
  const argv = (args ?? []).map(String);
  const rw = rewritten ?? { args: argv, injected: [], limit: 0 };
  const injected = (rw.injected ?? []).map(String);
  if (injected.length === 0) return rw;
  // Only the log branch appends; status splices after its subcommand already.
  if (resolveSub('git', argv).sub !== 'log') return rw;

  const capMisleads = ttGitCapWouldMislead(argv);
  const kept = [];
  let droppedCap = false;
  for (const flag of injected) {
    if (capMisleads && ttIsGitLimitFlag(flag)) { droppedCap = true; continue; }
    kept.push(flag);
  }

  return {
    args: ttPlaceGitInjections(argv, kept),
    injected: kept,
    limit: droppedCap ? 0 : rw.limit,
  };
}

// ── streaming / follow detection ──────────────────────────────────────────────
// spawnSync buffers stdout until the child exits, so capturing a follow or
// watch invocation makes the agent blind for the whole run. Detect it from argv
// alone and let the caller exec straight through instead.
//
// The follow flag is resolved PER COMMAND: "-f" means --follow for tail and
// "kubectl logs", but it means --file for "kubectl apply", "docker build",
// "grep" and "make". A global -f rule would disable compression on some of the
// hottest commands there are.
//
// \`groups\` lists tokens that are a command GROUP rather than a command: the real
// subcommand sits one token deeper. Without it the table is resolved against the
// first positional only, so \`docker compose logs -f\` resolved to "compose", the
// \`logs\` entry was structurally unreachable, and the flagship nested follow form
// for the flagship container tool was captured by spawnSync - zero bytes after a
// full-length hang. The list is explicit rather than "recurse always" because
// \`docker run <image> <command>\` puts an image name in the same position, and
// \`docker run --rm alpine stats\` must not be read as \`docker stats\`.
function ttFollowFlags(cmd) {
  return ({
    tail:       { any: ['-f', '-F', '--follow'] },
    journalctl: { any: ['-f', '--follow'] },
    // \`kubectl get -w/--watch\` streams for as long as the resource exists; it
    // was not in the table at all.
    kubectl:    { subs: { logs: ['-f', '--follow'], get: ['-w', '--watch', '--watch-only'] } },
    docker:     {
      groups: ['compose', 'container', 'service', 'stack'],
      subs: { logs: ['-f', '--follow'], stats: [], attach: [], events: [] },
    },
    vitest:     { any: ['--watch', '-w'] },
    jest:       { any: ['--watch', '--watchAll'] },
    tsc:        { any: ['--watch', '-w'] },
    cargo:      { subs: { watch: [] } },
  })[cmd];
}

// Scripts that conventionally never terminate, behind a package-manager delegate.
function ttIsStreamScript(name) {
  return /^(dev|start|serve|watch|storybook|preview|dev:.*|start:.*|watch:.*)$/.test(name);
}
function ttIsRunDelegate(cmd) {
  return ['npm', 'pnpm', 'yarn', 'bun', 'deno'].indexOf(cmd) !== -1;
}

function isFollowInvocation(cmd, args) {
  const argv = (args ?? []).map(String);
  const has = (names) => names.some(n => argv.indexOf(n) !== -1);
  const first = resolveSub(cmd, argv);
  const sub = first.sub;

  const spec = ttFollowFlags(cmd);
  if (spec) {
    if (spec.any && has(spec.any)) return true;
    if (spec.subs) {
      // Every other nested consumer in this codebase re-runs resolveSub on the
      // remainder to reach the second level (gh.ts, docker.ts, isMachineOutput
      // below); this was the one place that did not.
      const names = [sub];
      if (spec.groups && spec.groups.indexOf(sub) !== -1 && first.subIndex >= 0) {
        names.push(resolveSub(cmd, argv.slice(first.subIndex + 1)).sub);
      }
      for (const name of names) {
        if (!Object.prototype.hasOwnProperty.call(spec.subs, name)) continue;
        const flags = spec.subs[name];
        if (flags.length === 0) return true;
        if (has(flags)) return true;
      }
    }
  }

  // Bare test runners default to watch mode; an explicit "run" terminates.
  if ((cmd === 'vitest' || cmd === 'jest') && sub !== 'run' && argv.indexOf('--run') === -1) {
    if (argv.length === 0) return true;
  }

  if (ttIsRunDelegate(cmd)) {
    const script = sub === 'run' ? (resolveSub(cmd, argv.slice(argv.indexOf('run') + 1)).sub) : sub;
    if (script && ttIsStreamScript(script)) return true;
  }

  return false;
}

// Does this git invocation ask for a NUL-TERMINATED stream? \`-z\` means that on
// every git command that takes it - \`status\`, \`ls-files\`, \`diff\`, \`grep\`,
// \`config\` - and \`git status -z | xargs -0\` is the entire reason to type it.
// Reshaping that output splices English between two NULs where the consumer
// expects a path, and \`--branch\` injection prepends a \`## main\\0\` record that
// is not a path at all.
//
// Mirrors ttStatusFormat's reading of the same flag, which is where the
// grammar was worked out: short flags cluster ("-sz", "-zs"), \`-u\` swallows an
// attached value so a cluster scan stops there, parse-options auto-generates
// \`--no-null\`, and past "--" every token is a pathspec - a file really can be
// named "-z".
function ttGitNulStream(argv) {
  let z = false;
  for (const raw of argv ?? []) {
    const a = String(raw);
    if (a === '--') break;
    // git accepts any unambiguous prefix of a long option, and "null" is the
    // only \`git status\` option beginning "nu".
    if (/^--nul?l?$/.test(a))    { z = true;  continue; }
    if (/^--no-nul?l?$/.test(a)) { z = false; continue; }
    if (!/^-[A-Za-z]+$/.test(a)) continue;
    for (let i = 1; i < a.length; i++) {
      const c = a.charAt(i);
      if (c === 'u') break;
      if (c === 'z') { z = true; break; }
    }
  }
  return z;
}

// ── machine-output detection ──────────────────────────────────────────────────
// When the caller asked for a machine format, the output is going to be parsed
// by something other than the agent's eyes. Reshaping it corrupts the consumer,
// so compression must be a no-op.
function ttIsFormatValue(v) {
  const s = String(v).toLowerCase();
  // \`wide\` is deliberately NOT here. It is the human table with IP and NODE
  // columns added, and nothing parses it - listing it made \`kubectl get pods -o
  // wide\` skip the condenser AND the 8 KB backstop, so a 2000-pod listing
  // reached the agent whole at 246 KB. See ttKubectlWide in docker.ts, which is
  // the other half: the pod rollup steps aside so the columns survive.
  if (['json', 'yaml', 'yml', 'ndjson', 'jsonl', 'go-template', 'jsonpath', 'name']
    .indexOf(s) !== -1) return true;

  // kubectl's script-oriented formats never name themselves alone: the value
  // carries the spec inline, as \`custom-columns=NAME:.metadata.name,STATUS:...\`,
  // \`template={{range .items}}...\`, \`jsonpath={.items[*].metadata.name}\`. Whole-
  // string matching missed every one of them, and the cost was not lost
  // compression: condenseKubectl reads STATUS from parts[2], a column a
  // custom-columns table does not have, so it counted no pod as running,
  // pending or failed and answered "0 pods: 0 running" for five Running pods.
  // A total summed from recognised statuses only is a fabricated zero, which is
  // the worst answer this library can give.
  return /^(custom-columns|custom-columns-file|go-template|go-template-file|template|templatefile|jsonpath|jsonpath-as-json|jsonpath-file)=/.test(s);
}

// Some commands announce no format because their ENTIRE PURPOSE is to emit a
// machine artifact: \`helm template ./chart | kubectl apply -f -\` and
// \`kustomize build overlays | kubectl apply -f -\` are the canonical way to use
// them. A pipe is indistinguishable from the agent reading, so argv is the only
// signal available - and getting this wrong does not cost tokens, it breaks the
// apply, because the frame's backstop cap would otherwise truncate the manifest
// stream mid-document.
function ttIsArtifactCommand(cmd, sub, verb) {
  if (cmd === 'helm') {
    return sub === 'template' || (sub === 'get' && (verb === 'manifest' || verb === 'values' || verb === 'hooks' || verb === 'notes'));
  }
  if (cmd === 'kustomize') return sub === 'build';
  return false;
}

function isMachineOutput(cmd, args) {
  const argv = (args ?? []).map(String);

  const first = resolveSub(cmd, argv);
  const verb  = first.subIndex >= 0 ? resolveSub(cmd, argv.slice(first.subIndex + 1)).sub : '';
  if (ttIsArtifactCommand(cmd, first.sub, verb)) return true;
  if (cmd === 'git' && ttGitNulStream(argv)) return true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--json' || a === '-json' || a === '--porcelain' || a === '--format-version') return true;
    if (/^--porcelain=/.test(a)) return true;


    // --output=json / --format=json / -o=json
    const eq = a.match(/^(?:--output|--format|-o)=(.+)$/);
    if (eq && ttIsFormatValue(eq[1])) return true;

    // -o json / --output json / --format json  (a following token that is a
    // known format name - so "curl -o out.html" is correctly NOT a format)
    if (a === '-o' || a === '--output' || a === '--format') {
      const next = (argv[i + 1] ?? '').toLowerCase();
      if (ttIsFormatValue(next)) return true;
      if (/^(json|yaml|go-template|jsonpath)/.test(next)) return true;
    }
  }
  return false;
}
`

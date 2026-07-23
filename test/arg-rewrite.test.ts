import { describe, it, expect } from 'vitest'
import { compress, linkHandlerFunction } from './support/harness.js'
import { ARGS_HANDLER } from '../src/handlers/args.js'
import { GIT_HANDLER } from '../src/handlers/git.js'

// Pre-spawn seam.
//
// These four predicates decide what the proxy RUNS and whether it compresses at
// all, before any output exists. They are therefore invisible to compress() and
// unreachable through the describeCompression harness - hence this file.
//
// They are pure functions of (cmd, argv), so they are linked out of the shipped
// handler sources the same way harness.ts links compress(), and tested
// table-driven. Nothing here spawns a process.

interface SubResolution { sub: string; subIndex: number }

const resolveSub = linkHandlerFunction<(cmd: string, args: string[]) => SubResolution>(
  'resolveSub',
  ARGS_HANDLER,
)

describe('resolveSub - finds the real subcommand past global flags', () => {
  // The shipped dispatcher reads args[0] raw, so any command carrying a global
  // flag before its subcommand silently loses its condenser.
  const cases: Array<[string, string[], string]> = [
    // no flags: unchanged behaviour
    ['git', ['log'], 'log'],
    ['git', ['diff', '--stat'], 'diff'],
    ['kubectl', ['get', 'pods'], 'get'],
    ['docker', ['compose', 'ps'], 'compose'],

    // boolean global flags
    ['git', ['--no-pager', 'log'], 'log'],
    ['git', ['--paginate', 'diff'], 'diff'],
    ['cargo', ['+nightly', 'test'], 'test'],

    // value-taking global flags: the VALUE must not be mistaken for the sub
    ['git', ['-C', '/repo', 'log'], 'log'],
    ['git', ['--git-dir', '/repo/.git', 'status'], 'status'],
    ['kubectl', ['-n', 'production', 'get', 'pods'], 'get'],
    ['kubectl', ['--namespace', 'prod', 'describe', 'pod', 'api'], 'describe'],
    ['kubectl', ['--context', 'staging', '-n', 'web', 'logs', 'api'], 'logs'],
    ['npm', ['--prefix', './packages/api', 'run', 'build'], 'run'],

    // attached `--flag=value` form consumes no following token
    ['git', ['--git-dir=/repo/.git', 'log'], 'log'],
    ['kubectl', ['--namespace=prod', 'get', 'svc'], 'get'],

    // gh: without a flag table the VALUE of a value-taking flag was returned as
    // the verb, which defeats every guard keyed on it - `gh api --hostname X
    // graphql` resolved to the hostname and its GraphQL response was reshaped.
    ['gh', ['api', 'repos/acme/widget'], 'api'],
    ['gh', ['pr', 'view', '7'], 'pr'],
    ['gh', ['--repo', 'acme/widget', 'pr'], 'pr'],
    ['gh', ['api', '--hostname', 'ghe.acme.com'], 'api'],

    // Value-taking global flags that were missing from the table. Each one
    // returned its own VALUE as the subcommand, and every guard downstream -
    // the compress() dispatcher, condenseKubectl's verb/kind, ttIsArtifactCommand,
    // isFollowInvocation's sub table - is keyed on that string.
    ['kubectl', ['--token', 'abcd1234', 'get', 'pods'], 'get'],
    ['kubectl', ['-v', '6', 'get', 'pods'], 'get'],
    ['kubectl', ['--request-timeout', '30s', 'get', 'pods'], 'get'],
    ['kubectl', ['-s', 'https://api.test:6443', 'get', 'pods'], 'get'],
    // -c IS --context and -l IS --log-level; the long forms were listed and the
    // documented short aliases were not, which is what rules out "deliberate
    // partial coverage".
    ['docker', ['-c', 'remote', 'ps'], 'ps'],
    ['docker', ['-l', 'debug', 'ps'], 'ps'],
    ['docker', ['--tlscacert', '/ca.pem', 'ps'], 'ps'],
    ['npm', ['--loglevel', 'error', 'install'], 'install'],
    ['npm', ['--registry', 'https://r.test', 'install'], 'install'],
    ['npm', ['-C', '/x', 'run', 'build'], 'run'],
    ['cargo', ['--color', 'never', 'test'], 'test'],
    ['cargo', ['--target-dir', '/t', 'build'], 'build'],
    ['helm', ['--kube-token', 'tk', 'list'], 'list'],
    ['helm', ['--registry-config', '/r.json', 'list'], 'list'],
    ['gh', ['api', '--cache', '60s', 'graphql'], 'api'],

    // pnpm documents `-F` as the short alias of `--filter`; only the long form
    // was listed, so the package NAME came back as the subcommand.
    ['pnpm', ['--filter', 'api', 'dev'], 'dev'],
    ['pnpm', ['-F', 'api', 'dev'], 'dev'],
    ['pnpm', ['-C', 'packages/api', 'dev'], 'dev'],
    // ...and pnpm's `-w` is --workspace-root, a BOOLEAN. It was copied from the
    // npm row, where `-w, --workspace <name>` really does take a value.
    ['pnpm', ['-w', 'add', 'lodash'], 'add'],
    ['pnpm', ['-w', 'install'], 'install'],
    ['npm', ['-w', 'api', 'run', 'build'], 'run'],

    // nothing to resolve
    ['git', [], ''],
    ['git', ['--version'], ''],
  ]

  for (const [cmd, args, expected] of cases) {
    it(`${cmd} ${args.join(' ') || '(no args)'} → "${expected}"`, () => {
      expect(resolveSub(cmd, args).sub).toBe(expected)
    })
  }

  it('skips a value-taking flag AND its value when finding the second positional token', () => {
    // The verb is found by re-running resolveSub on the remainder, so a flag
    // between the noun and the verb has to be skipped there too.
    // `gh api --hostname <ghe-host> graphql` is the standard Enterprise form.
    const first = resolveSub('gh', ['api', '--hostname', 'ghe.acme.com', 'graphql'])
    expect(first.sub).toBe('api')
    const verb = resolveSub('gh', ['api', '--hostname', 'ghe.acme.com', 'graphql'].slice(first.subIndex + 1))
    expect(verb.sub).toBe('graphql')

    const h = resolveSub('gh', ['api', '-H', 'Accept: application/vnd.github+json', 'graphql'])
    expect(resolveSub('gh', ['api', '-H', 'Accept: application/vnd.github+json', 'graphql'].slice(h.subIndex + 1)).sub)
      .toBe('graphql')
  })

  it('does not let a `gh api` flag swallow the graphql verb', () => {
    // `--cache`, `--input` and `-p/--preview` are value-taking `gh api` flags.
    // With one of them before the endpoint the verb resolved to the flag's
    // VALUE, condenseGh's `verb === 'graphql'` guard missed, and condenseGhApi
    // stripped `node_id` - which in GraphQL is a key the caller's own selection
    // set named or aliased. The result is still valid JSON, so nothing
    // downstream can tell a field was deleted.
    const verbOf = (argv: string[]): string => {
      const first = resolveSub('gh', argv)
      return resolveSub('gh', argv.slice(first.subIndex + 1)).sub
    }
    const q = '-f'
    const body = 'query={repository(owner:"cli",name:"cli"){node_id: id, name}}'
    expect(verbOf(['api', '--cache', '60s', 'graphql', q, body])).toBe('graphql')
    expect(verbOf(['api', '-p', 'corsair', 'graphql', q, body])).toBe('graphql')
    expect(verbOf(['api', '--preview', 'corsair', 'graphql', q, body])).toBe('graphql')
    expect(verbOf(['api', '--input', 'payload.json', 'graphql'])).toBe('graphql')
  })

  it('reports the index of the subcommand so rewrites splice in the right place', () => {
    expect(resolveSub('git', ['-C', '/repo', 'log'])).toEqual({ sub: 'log', subIndex: 2 })
    expect(resolveSub('git', ['log'])).toEqual({ sub: 'log', subIndex: 0 })
    expect(resolveSub('git', [])).toEqual({ sub: '', subIndex: -1 })
  })
})

describe('rewriteArgs - injects compact-output flags before the command runs', () => {
  interface Rewrite { args: string[]; injected: string[]; limit: number }
  const rewriteArgs = linkHandlerFunction<(cmd: string, args: string[]) => Rewrite>(
    'rewriteArgs',
    ARGS_HANDLER,
    GIT_HANDLER,
  )

  it('keeps the existing git log behaviour', () => {
    const r = rewriteArgs('git', ['log'])
    expect(r.args).toEqual(['log', '--pretty=format:%h %s (%ar) <%an>', '-20'])
    expect(r.injected).toContain('-20')
  })

  it('rewrites git log even when a global flag precedes the subcommand', () => {
    // args[0] is '-C', so the shipped rewriteGitArgs sees no 'log' and does nothing.
    const r = rewriteArgs('git', ['-C', '/repo', 'log'])
    expect(r.args).toContain('--pretty=format:%h %s (%ar) <%an>')
    expect(r.args).toContain('-20')
    expect(r.args.slice(0, 3)).toEqual(['-C', '/repo', 'log'])
  })

  it('reports what it injected, so the caller can disclose a silent truncation', () => {
    // -20 changes the ANSWER, not just the format: the agent must be able to
    // learn it only saw 20 commits.
    expect(rewriteArgs('git', ['log']).injected).toEqual(
      expect.arrayContaining(['-20']),
    )
    // an explicit user limit is respected and nothing is injected
    expect(rewriteArgs('git', ['log', '-5']).injected).not.toContain('-20')
  })

  it('leaves unknown commands untouched', () => {
    const r = rewriteArgs('helm', ['list'])
    expect(r.args).toEqual(['list'])
    expect(r.injected).toEqual([])
  })

  it('reports the numeric limit it injected, separately from format-only flags', () => {
    // A limit changes the ANSWER: it drops rows. A --pretty format does not.
    // Only the former needs disclosing, so they must be distinguishable.
    expect(rewriteArgs('git', ['log']).limit).toBe(20)
    expect(rewriteArgs('git', ['log', '-5']).limit).toBe(0)
    expect(rewriteArgs('git', ['log', '-n', '100']).limit).toBe(0)
    // status injects --short --branch: format only, no limit
    expect(rewriteArgs('git', ['status']).limit).toBe(0)
    expect(rewriteArgs('git', ['status']).injected).toEqual(['--short', '--branch'])
  })

  it('injects nothing once the caller has declared a machine format', () => {
    // `--porcelain=v1` / `--porcelain=v2` are the versioned spellings git's own
    // docs tell scripts to pin to. The format guard tested `a === '--porcelain'`,
    // so they missed it and `--branch` was spliced in - which PREPENDS records
    // the command never printed: two `# branch.*` lines in v2, and `## main` in
    // v1, which a parser reading columns 1-2 as the XY code sees as a file named
    // "main". rewriteArgs runs BEFORE the spawn, so isMachineOutput's no-op
    // guard over compress() never observes it and cannot undo it.
    for (const fmt of ['--porcelain=v1', '--porcelain=v2']) {
      const r = rewriteArgs('git', ['status', fmt])
      expect(r.injected).toEqual([])
      expect(r.args).toEqual(['status', fmt])
    }
    // -z makes the fabricated records the first entries of a NUL-delimited stream
    const z = rewriteArgs('git', ['status', '--porcelain=v2', '-z'])
    expect(z.injected).toEqual([])
    expect(z.args).toEqual(['status', '--porcelain=v2', '-z'])
    // the bare form was already correct and stays correct
    expect(rewriteArgs('git', ['status', '--porcelain']).injected).toEqual([])
  })

  it('treats `-z` on git status as the machine format git documents it to be', () => {
    // git-status(1): "-z ... implies the --porcelain=v1 output format if no
    // other format is given". It also terminates every entry with NUL instead
    // of LF, which is the entire point - `git status -z | xargs -0` is how a
    // consumer reads paths that contain spaces or newlines.
    //
    // Splicing `--branch` in there prepends a `## main\0` record, so the FIRST
    // item the consumer receives is a branch name where it expects a path. And
    // rewriteArgs runs BEFORE the spawn, so no guard over compress() can
    // observe the fabricated record, let alone undo it.
    //
    // Clustered short flags are real argv (`git status -sz`), so recognising
    // `-z` cannot be an exact-token match - it has to come off the same cluster
    // scan that already reads -s and -b.
    for (const argv of [
      ['status', '-z'],
      ['status', '-s', '-z'],
      ['status', '--short', '-z'],
      ['status', '-sz'],
      ['status', '-zs'],
      ['status', '--porcelain', '-z'],
      // "-uno" attaches its value to the flag, so the cluster scan stops there;
      // the -z it follows must still count.
      ['status', '-z', '-uno'],
      // ...and the subcommand is not always argv[0]
      ['-C', '/repo', 'status', '-sz'],
    ]) {
      const label = argv.join(' ')
      const r = rewriteArgs('git', argv)
      expect(r.injected, label).toEqual([])
      expect(r.args, label).toEqual(argv)
      expect(r.args, label).not.toContain('--branch')
      expect(r.limit, label).toBe(0)
    }
  })

  it('recognises `--null`, which is the same flag as `-z`', () => {
    // builtin/commit.c: OPT_BOOL('z', "null", &s.null_termination, ...). The
    // long spelling is not a synonym in the docs only - verified against git
    // 2.52.0, `git status --null` and `git status -z` emit the identical
    // NUL-delimited stream, and `git status --short --branch --null` prepends
    //   ## No commits yet on master\0
    // to it. Recognising only the one-character form left the whole
    // finding-7 fabrication reachable by typing the flag out in full.
    for (const argv of [
      ['status', '--null'],
      ['status', '-s', '--null'],
      ['status', '--null', '-uno'],
      ['status', '--short', '--null'],
    ]) {
      const label = argv.join(' ')
      const r = rewriteArgs('git', argv)
      expect(r.injected, label).toEqual([])
      expect(r.args, label).toEqual(argv)
      expect(r.args, label).not.toContain('--branch')
    }

    // parse-options auto-negates a long boolean, so "--no-null" really does
    // turn it back off and the output is LF-delimited again.
    const off = rewriteArgs('git', ['status', '--null', '--no-null'])
    expect(off.injected).toEqual(['--short', '--branch'])
  })

  it('still reads a `-z` past "--" as the pathspec it is', () => {
    // Everything after "--" is a path, and a file may be named "-z". Reading it
    // as the flag would silently disable the `## <branch>` header that keeps
    // the first short-format row readable as unstaged.
    const r = rewriteArgs('git', ['status', '--', '-z'])
    expect(r.injected).toEqual(['--short', '--branch'])
    expect(r.args).toEqual(['status', '--short', '--branch', '--', '-z'])
  })

  it('places its injections BEFORE a `--` pathspec separator', () => {
    // Anything appended after `--` is a PATHSPEC, not an option: git ignores the
    // non-matching path and applies no cap, yet `limit` was still reported as 20
    // and the frame told the agent its output had been truncated when it had not.
    const r = rewriteArgs('git', ['log', '--oneline', '--', 'README.md'])
    expect(r.args).toEqual(['log', '--oneline', '-20', '--', 'README.md'])
    expect(r.args.indexOf('-20')).toBeLessThan(r.args.indexOf('--'))
    expect(r.limit).toBe(20)

    const p = rewriteArgs('git', ['log', '--', 'src/index.ts'])
    expect(p.args).toEqual(
      ['log', '--pretty=format:%h %s (%ar) <%an>', '-20', '--', 'src/index.ts'],
    )
    expect(p.args.indexOf('--')).toBe(p.args.length - 2)
  })

  it('treats the attached short max-count `-nN` as an explicit limit', () => {
    // `-n100` matched none of the four spellings the limit probe knew, so `-20`
    // was appended and won (last max-count wins in git): an explicit request for
    // 100 commits returned 20, and `git log -n5` returned 20 - four times MORE
    // output than asked for.
    const r = rewriteArgs('git', ['log', '-n100', '--oneline'])
    expect(r.injected).not.toContain('-20')
    expect(r.limit).toBe(0)
    expect(r.args).toEqual(['log', '-n100', '--oneline'])
    expect(rewriteArgs('git', ['log', '-n5']).limit).toBe(0)
    expect(rewriteArgs('git', ['log', '-n5']).args).not.toContain('-20')
  })

  it('never caps a --reverse log, where a limit moves the TOP of the list', () => {
    // git applies -n during commit selection and reverses afterwards, so the cap
    // takes the 20 NEWEST and prints them oldest-first: line 1 stops being the
    // repo's initial commit, which is the row `--reverse` was typed to get. The
    // disclosure says "the 20 most recent entries", which points at the tail.
    const r = rewriteArgs('git', ['log', '--reverse', '--oneline'])
    expect(r.injected).not.toContain('-20')
    expect(r.limit).toBe(0)
    expect(r.args).toEqual(['log', '--reverse', '--oneline'])

    // a format is still injected: it reshapes, it drops no commits
    const f = rewriteArgs('git', ['log', '--reverse'])
    expect(f.limit).toBe(0)
    expect(f.args).toEqual(['log', '--reverse', '--pretty=format:%h %s (%ar) <%an>'])
  })
})

describe('isFollowInvocation - never capture a stream that will not end', () => {
  const isFollowInvocation = linkHandlerFunction<(cmd: string, args: string[]) => boolean>(
    'isFollowInvocation',
    ARGS_HANDLER,
  )

  it('detects the follow flag on commands where -f MEANS follow', () => {
    expect(isFollowInvocation('tail', ['-f', 'app.log'])).toBe(true)
    expect(isFollowInvocation('tail', ['-F', 'app.log'])).toBe(true)
    expect(isFollowInvocation('tail', ['--follow', 'app.log'])).toBe(true)
    expect(isFollowInvocation('journalctl', ['-f'])).toBe(true)
    expect(isFollowInvocation('kubectl', ['logs', '-f', 'api'])).toBe(true)
    expect(isFollowInvocation('docker', ['logs', '--follow', 'web'])).toBe(true)
  })

  it('does NOT treat -f as follow where it means --file', () => {
    // The single most dangerous false positive: -f is a FILE argument here, and
    // treating it as a stream would disable compression on the hottest k8s verb.
    expect(isFollowInvocation('kubectl', ['apply', '-f', 'manifest.yaml'])).toBe(false)
    expect(isFollowInvocation('kubectl', ['delete', '-f', 'manifest.yaml'])).toBe(false)
    expect(isFollowInvocation('docker', ['build', '-f', 'Dockerfile', '.'])).toBe(false)
    expect(isFollowInvocation('grep', ['-f', 'patterns.txt', 'src/'])).toBe(false)
    expect(isFollowInvocation('make', ['-f', 'other.mk'])).toBe(false)
  })

  it('detects watch modes', () => {
    expect(isFollowInvocation('vitest', ['--watch'])).toBe(true)
    expect(isFollowInvocation('tsc', ['--watch'])).toBe(true)
    expect(isFollowInvocation('tsc', ['-w'])).toBe(true)
    expect(isFollowInvocation('jest', ['--watchAll'])).toBe(true)
  })

  it('detects long-running scripts behind a package-manager delegate', () => {
    expect(isFollowInvocation('npm', ['run', 'dev'])).toBe(true)
    expect(isFollowInvocation('pnpm', ['run', 'start'])).toBe(true)
    expect(isFollowInvocation('yarn', ['serve'])).toBe(true)
    expect(isFollowInvocation('npm', ['run', 'storybook'])).toBe(true)
    // ...but not the ones that terminate
    expect(isFollowInvocation('npm', ['run', 'build'])).toBe(false)
    expect(isFollowInvocation('npm', ['test'])).toBe(false)
    expect(isFollowInvocation('pnpm', ['run', 'lint'])).toBe(false)
  })

  it('treats bare `vitest` as a watcher and `vitest run` as terminating', () => {
    expect(isFollowInvocation('vitest', [])).toBe(true)
    expect(isFollowInvocation('vitest', ['run'])).toBe(false)
  })

  it('reaches a follow flag hidden behind a nested command group', () => {
    // The follow table was resolved against the FIRST positional token only, so
    // `resolveSub('docker', ['compose','logs','-f'])` returned "compose" and the
    // `logs` entry was structurally unreachable. `docker compose` is the compose
    // v2 spelling (standalone docker-compose is deprecated), so the nested form
    // is the one an agent in a containerised repo actually types - and capturing
    // it with spawnSync returns ZERO bytes after a full-length hang.
    expect(isFollowInvocation('docker', ['compose', 'logs', '-f'])).toBe(true)
    expect(isFollowInvocation('docker', ['compose', 'logs', '--follow', 'web'])).toBe(true)
    expect(isFollowInvocation('docker', ['container', 'logs', '-f', 'web'])).toBe(true)
    expect(isFollowInvocation('docker', ['service', 'logs', '-f', 'api'])).toBe(true)
    expect(isFollowInvocation('docker', ['compose', 'stats'])).toBe(true)
    expect(isFollowInvocation('docker', ['compose', 'events'])).toBe(true)
    // ...without turning the terminating forms into streams
    expect(isFollowInvocation('docker', ['compose', 'logs'])).toBe(false)
    expect(isFollowInvocation('docker', ['compose', 'build'])).toBe(false)
    expect(isFollowInvocation('docker', ['compose', 'ps'])).toBe(false)
    // `docker run <image> <command>`: the second token is an image, never a
    // subcommand, so it must not be looked up in the follow table.
    expect(isFollowInvocation('docker', ['run', '--rm', 'alpine', 'stats'])).toBe(false)
  })

  it('detects kubectl watch, which streams for as long as the resource exists', () => {
    expect(isFollowInvocation('kubectl', ['get', 'pods', '-w'])).toBe(true)
    expect(isFollowInvocation('kubectl', ['get', 'pods', '--watch'])).toBe(true)
    expect(isFollowInvocation('kubectl', ['get', 'pods', '--watch-only'])).toBe(true)
    expect(isFollowInvocation('kubectl', ['-n', 'prod', 'get', 'pods', '-w'])).toBe(true)
    expect(isFollowInvocation('kubectl', ['get', 'pods'])).toBe(false)
    expect(isFollowInvocation('kubectl', ['get', 'pods', '-o', 'wide'])).toBe(false)
  })

  it('is not blinded by a value-taking global flag before the subcommand', () => {
    // isFollowInvocation is keyed on the resolved subcommand, so a flag whose
    // VALUE was mistaken for the sub disables the guard whose entire purpose is
    // to stop an endless stream reaching spawnSync.
    expect(isFollowInvocation('kubectl', ['--token', 'sha256~abc', 'logs', '-f', 'api'])).toBe(true)
    expect(isFollowInvocation('docker', ['-c', 'prod', 'logs', '-f', 'api'])).toBe(true)
    expect(isFollowInvocation('docker', ['-c', 'prod', 'stats'])).toBe(true)
    expect(isFollowInvocation('npm', ['-C', './app', 'run', 'dev'])).toBe(true)
    // the long forms these are aliases of already worked, and still do
    expect(isFollowInvocation('docker', ['--context', 'prod', 'stats'])).toBe(true)
    expect(isFollowInvocation('npm', ['--prefix', './app', 'run', 'dev'])).toBe(true)
  })

  it('detects a stream script behind pnpm -F, the short form of --filter', () => {
    // `pnpm -F <pkg> dev` is the standard monorepo invocation and the spelling
    // pnpm's own docs use. With `-F` unlisted, resolveSub returned the package
    // name, the dev server went to spawnSync with piped stdio and no timeout,
    // and the agent received nothing at all until its own tool timeout.
    expect(isFollowInvocation('pnpm', ['-F', 'api', 'dev'])).toBe(true)
    expect(isFollowInvocation('pnpm', ['--filter', 'api', 'dev'])).toBe(true)
    expect(isFollowInvocation('pnpm', ['-F', 'web', 'run', 'storybook'])).toBe(true)
    expect(isFollowInvocation('pnpm', ['-F', 'api', 'build'])).toBe(false)
  })
})

describe('isMachineOutput - never reshape what another program will parse', () => {
  const isMachineOutput = linkHandlerFunction<(cmd: string, args: string[]) => boolean>(
    'isMachineOutput',
    ARGS_HANDLER,
  )

  it('detects explicit machine formats', () => {
    expect(isMachineOutput('gh', ['pr', 'list', '--json', 'number,title'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'json'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'yaml'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '--output=json'])).toBe(true)
    expect(isMachineOutput('git', ['status', '--porcelain'])).toBe(true)
    expect(isMachineOutput('terraform', ['show', '-json'])).toBe(true)
    expect(isMachineOutput('cargo', ['metadata', '--format-version', '1'])).toBe(true)
  })

  it('treats git `-z` as the NUL stream it is, in every spelling', () => {
    // `-z` means NUL-TERMINATED output on every git command that takes it, and
    // `git status -z | xargs -0` is the only reason to type it. Without this,
    // rewriteArgs injected `--branch` into the argv and the frame reshaped the
    // result, so the consumer got a `## main` record where it expected a path.
    // Short flags cluster; git also accepts any unambiguous prefix of `--null`.
    for (const args of [
      ['status', '-z'],
      ['status', '-s', '-z'],
      ['status', '-sz'],
      ['status', '-zs'],
      ['status', '--null'],
      ['status', '--nul'],
      ['ls-files', '-z'],
      ['diff', '-z', '--name-only'],
    ]) {
      expect(isMachineOutput('git', args), args.join(' ')).toBe(true)
    }
    // Not a false positive on the human forms.
    expect(isMachineOutput('git', ['status'])).toBe(false)
    expect(isMachineOutput('git', ['status', '--short'])).toBe(false)
    expect(isMachineOutput('git', ['log', '--oneline'])).toBe(false)
    // `--no-null` turns it back off, and past "--" a `-z` is a pathspec - a
    // file may be named that. Both are the same readings ttStatusFormat makes.
    expect(isMachineOutput('git', ['status', '--null', '--no-null'])).toBe(false)
    expect(isMachineOutput('git', ['status', '--', '-z'])).toBe(false)
  })

  it('does not count `-o wide` as one - it is the human table with more columns', () => {
    // `wide` used to sit in the format list beside json/yaml, which made the
    // output exempt from the condenser AND from the 8 KB backstop: a 2000-pod
    // `kubectl get pods -A -o wide` arrived whole, 246 KB of it. Nothing parses
    // `-o wide`; it is `kubectl get pods` with IP and NODE appended.
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'wide'])).toBe(false)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o=wide'])).toBe(false)
    expect(isMachineOutput('kubectl', ['get', 'pods', '--output=wide'])).toBe(false)
    expect(isMachineOutput('kubectl', ['get', 'pods', '--output', 'wide'])).toBe(false)
    // The formats that really are machine-readable are untouched by that.
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'name'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'jsonpath={.items[*].spec.nodeName}'])).toBe(true)
  })

  it('recognises commands whose OUTPUT IS the artifact, with no flag to announce it', () => {
    // `helm template ./chart | kubectl apply -f -` and `kustomize build overlays
    // | kubectl apply -f -` are canonical. Nothing in argv says "this is
    // machine-bound", and a pipe is indistinguishable from the agent reading -
    // but truncating a manifest stream mid-document breaks the apply, and the
    // frame's backstop cap does exactly that to anything over 8 KB. Routing
    // these through the machine-output path is what exempts them from it.
    expect(isMachineOutput('helm', ['template', './chart'])).toBe(true)
    expect(isMachineOutput('helm', ['get', 'manifest', 'myapp'])).toBe(true)
    expect(isMachineOutput('helm', ['get', 'values', 'myapp'])).toBe(true)
    expect(isMachineOutput('kustomize', ['build', 'overlays/prod'])).toBe(true)
    // ...but the sibling subcommands that print a human report do not qualify
    expect(isMachineOutput('helm', ['list'])).toBe(false)
    expect(isMachineOutput('helm', ['status', 'myapp'])).toBe(false)
    expect(isMachineOutput('helm', ['history', 'myapp'])).toBe(false)
  })

  it('does not fire on human output', () => {
    expect(isMachineOutput('kubectl', ['get', 'pods'])).toBe(false)
    expect(isMachineOutput('gh', ['pr', 'list'])).toBe(false)
    expect(isMachineOutput('git', ['status'])).toBe(false)
    // -o is an OUTPUT FILE here, not a format selector
    expect(isMachineOutput('curl', ['-o', 'out.html', 'https://x.test'])).toBe(false)
  })

  it("recognises kubectl's script-oriented formats, whose value carries a spec", () => {
    // These are documented kubectl output formats, and the value is never a bare
    // name - it is `custom-columns=NAME:.metadata.name,...` or `template={{...}}`.
    // Missing them did not merely lose compression: condenseKubectl reads STATUS
    // from parts[2], which a custom-columns table does not have, so a live
    // namespace was reported as "0 pods: 0 running".
    const cols = 'custom-columns=NAME:.metadata.name,STATUS:.status.phase'
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', cols])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '--output', cols])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o=' + cols])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '--output=' + cols])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'custom-columns-file=cols.txt'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'template={{range .items}}{{.metadata.name}}{{end}}'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o', 'go-template={{.items}}'])).toBe(true)
    expect(isMachineOutput('kubectl', ['get', 'pods', '-o=jsonpath={.items[*].metadata.name}'])).toBe(true)
    // a flag whose value happens to start the same way is still not a format
    expect(isMachineOutput('curl', ['-o', 'custom-columns.html', 'https://x.test'])).toBe(false)
  })

  it('keeps its exemption when a global flag precedes the artifact subcommand', () => {
    // `helm --registry-config X template ./chart` resolved the sub to the path,
    // lost the ttIsArtifactCommand exemption, and was handed to the frame's 8 KB
    // backstop - which truncates the manifest stream mid-document and breaks the
    // `| kubectl apply -f -` the exemption exists for.
    expect(isMachineOutput('helm', ['--registry-config', '/r.json', 'template', './chart'])).toBe(true)
    expect(isMachineOutput('helm', ['--kube-token', 'tk', 'get', 'manifest', 'myapp'])).toBe(true)
  })
})

describe('condenseKubectl - never a fabricated zero for a table it cannot read', () => {
  const CUSTOM_COLUMNS = [
    'NAME                           STATUS',
    'api-gateway-7d9f8b6c4d-2xk9p   Running',
    'checkout-6b8c9d0e1f-hj22m      Running',
    'payments-5a4b3c2d1e-pp01q      Running',
    'search-9f8e7d6c5b-tt31a        Running',
    'worker-1a2b3c4d5e-vv53c        Running',
    '',
  ].join('\n')

  it('passes a custom-columns table through instead of counting a column it does not have', () => {
    const out = compress(
      CUSTOM_COLUMNS,
      'kubectl',
      ['get', 'pods', '-o', 'custom-columns=NAME:.metadata.name,STATUS:.status.phase'],
    )
    expect(out).not.toMatch(/\b0 pods\b/)
    expect(out).toContain('api-gateway-7d9f8b6c4d-2xk9p')
    expect(out.split('\n').filter((l) => l.includes('Running'))).toHaveLength(5)
  })

  it('still condenses the default table it does understand', () => {
    const table = [
      'NAME                           READY   STATUS    RESTARTS   AGE',
      'api-gateway-7d9f8b6c4d-2xk9p   1/1     Running   0          4d',
      'checkout-6b8c9d0e1f-hj22m      1/1     Running   0          4d',
      '',
    ].join('\n')
    expect(compress(table, 'kubectl', ['get', 'pods'])).toBe('2 pods: 2 running')
  })
})

describe('ttCapDataList - the notice says where the gap actually is', () => {
  const ttCapDataList = linkHandlerFunction<
    (lines: string[], head: number, tail: number, noun: string) => string[]
  >('ttCapDataList', ARGS_HANDLER)
  const ttTakeNotices = linkHandlerFunction<() => string[]>('ttTakeNotices', ARGS_HANDLER)

  const paths = Array.from({ length: 120 }, (_, i) => `src/module${i}/index.ts`)

  it('says END when tail is 0, because the omitted entries are the LAST ones', () => {
    // Three of the four callers pass tail = 0 (grep.ts for `rg -l`/`grep -rl`,
    // gh.ts for its row lists, unix.ts for `df`). An agent told the MIDDLE was
    // dropped assumes it still holds both ends of an ordered list; it holds only
    // the front half - so it reads the last visible `gh pr list` row as the
    // oldest PR, and the alphabetically-last `rg -l` path as searched and clean.
    ttTakeNotices()
    const kept = ttCapDataList(paths, 60, 0, 'paths')
    expect(kept).toHaveLength(60)
    expect(kept[kept.length - 1]).toBe('src/module59/index.ts')

    const notices = ttTakeNotices()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('60 of 120 paths')
    expect(notices[0]).toContain('end of this list')
    expect(notices[0]).not.toContain('middle')
    expect(notices[0]).toContain('--full')
  })

  it('still says MIDDLE when it really does keep both ends', () => {
    ttTakeNotices()
    const kept = ttCapDataList(paths, 40, 20, 'paths')
    expect(kept).toHaveLength(60)
    expect(kept[0]).toBe('src/module0/index.ts')
    expect(kept[kept.length - 1]).toBe('src/module119/index.ts')

    const notices = ttTakeNotices()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('60 of 120 paths omitted from the middle of this list')
  })

  it('says nothing when nothing was dropped', () => {
    ttTakeNotices()
    expect(ttCapDataList(paths, 200, 0, 'paths')).toHaveLength(120)
    expect(ttTakeNotices()).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { linkHandlerFunction } from './support/harness.js'
import { CROSSCUT_HANDLER } from '../src/handlers/crosscut.js'

// Cross-cutting seam.
//
// These four helpers are not condensers for any one command - they are shared
// transforms that individual condensers opt into. Nothing dispatches to them
// directly, so they are unreachable through describeCompression; they are pure
// string functions, linked out of the shipped handler source the same way
// harness.ts links compress().

const elideCommonPathPrefix = linkHandlerFunction<(text: string) => string>(
  'elideCommonPathPrefix',
  CROSSCUT_HANDLER,
)

const foldStackTraces = linkHandlerFunction<(text: string) => string>(
  'foldStackTraces',
  CROSSCUT_HANDLER,
)

const projectTable = linkHandlerFunction<(text: string, keep: string[]) => string>(
  'projectTable',
  CROSSCUT_HANDLER,
)

const condenseHelp = linkHandlerFunction<(text: string) => string>(
  'condenseHelp',
  CROSSCUT_HANDLER,
)

describe('elideCommonPathPrefix', () => {
  it('hoists the repeated Windows directory prefix into one base line', () => {
    const input = [
      `C:\\Users\\dev\\projects\\token-trim\\src\\frame.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.`,
      `C:\\Users\\dev\\projects\\token-trim\\src\\handlers\\git.ts(45,3): error TS2304: Cannot find name 'unknownHelper'.`,
      `C:\\Users\\dev\\projects\\token-trim\\test\\support\\harness.ts(88,21): error TS2532: Object is possibly 'undefined'.`,
    ].join('\n')

    const out = elideCommonPathPrefix(input)

    expect(out.split('\n')[0]).toBe('base: C:\\Users\\dev\\projects\\token-trim\\')
    expect(out).toContain(`src\\frame.ts(12,7): error TS2322`)
    expect(out).toContain(`test\\support\\harness.ts(88,21)`)
    // The prefix survives exactly once, in the header.
    expect(out.split('C:\\Users\\dev\\projects\\token-trim\\').length - 1).toBe(1)
    expect(out.length).toBeLessThan(input.length)
  })

  it('hoists a POSIX directory prefix the same way', () => {
    const input = [
      `/home/alice/work/api-server/src/routes/users.ts:12:7 - error TS2322`,
      `/home/alice/work/api-server/src/routes/orders.ts:45:3 - error TS2304`,
      `/home/alice/work/api-server/test/routes.spec.ts:88:21 - error TS2532`,
    ].join('\n')

    const out = elideCommonPathPrefix(input)

    expect(out.split('\n')[0]).toBe('base: /home/alice/work/api-server/')
    expect(out).toContain('src/routes/users.ts:12:7 - error TS2322')
    expect(out).toContain('test/routes.spec.ts:88:21')
  })

  it('leaves text alone when fewer than three lines carry a path', () => {
    const input = [
      `/home/alice/work/api-server/src/routes/users.ts:12:7 - error TS2322`,
      `/home/alice/work/api-server/src/routes/orders.ts:45:3 - error TS2304`,
      `Found 2 errors.`,
    ].join('\n')

    expect(elideCommonPathPrefix(input)).toBe(input)
  })

  it('leaves text alone when the shared prefix is too short to be worth hoisting', () => {
    // "/etc/" is 5 chars - a header line would cost more than it saves.
    const input = ['/etc/a.conf', '/etc/b.conf', '/etc/c.conf'].join('\n')

    expect(elideCommonPathPrefix(input)).toBe(input)
  })

  it('never splits a Windows path at the drive-letter colon', () => {
    // The three files share only the drive root. Cutting anywhere inside
    // "C:\" would emit a base of "C:" and leave "\node\..." behind.
    const input = [
      `C:\\node\\a.ts(1,1): error TS1005`,
      `C:\\deno\\b.ts(2,1): error TS1005`,
      `C:\\bun\\c.ts(3,1): error TS1005`,
    ].join('\n')

    const out = elideCommonPathPrefix(input)
    expect(out).toBe(input)
    expect(out).not.toContain('base: C:')
  })

  it('leaves a bare absolute path list alone - it is canonical xargs input', () => {
    // Every line IS a path and nothing else. Hoisting the prefix here would
    // silently break `... | xargs`, which is what the list exists for.
    const input = [
      '/home/alice/work/api-server/src/routes/users.ts',
      '/home/alice/work/api-server/src/routes/orders.ts',
      '/home/alice/work/api-server/test/routes.spec.ts',
    ].join('\n')

    expect(elideCommonPathPrefix(input)).toBe(input)
  })

  it('passes empty input straight through', () => {
    expect(elideCommonPathPrefix('')).toBe('')
  })
})

// A real Express request that blew up: two project frames sandwiching the
// router's own middleware chain, plus the tick-queue frame Node always appends.
const JS_TRACE = `TypeError: Cannot read properties of undefined (reading 'id')
    at resolveUser (/home/alice/work/api-server/src/services/user.js:42:18)
    at /home/alice/work/api-server/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/home/alice/work/api-server/node_modules/express/lib/router/index.js:346:12)
    at next (/home/alice/work/api-server/node_modules/express/lib/router/index.js:280:10)
    at expressInit (/home/alice/work/api-server/node_modules/express/lib/middleware/init.js:40:5)
    at Layer.handle [as handle_request] (/home/alice/work/api-server/node_modules/express/lib/router/layer.js:95:5)
    at handleRequest (/home/alice/work/api-server/src/server.js:88:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`

// A Flask request. Each Python frame is TWO lines - the File header and the
// source line under it - so folding has to consume both.
const PY_TRACE = `Traceback (most recent call last):
  File "/home/alice/work/svc/app/main.py", line 27, in handle
    return router.dispatch(request)
  File "/home/alice/work/svc/.venv/lib/python3.12/site-packages/flask/app.py", line 1478, in dispatch_request
    return self.ensure_sync(self.view_functions[rule.endpoint])(**view_args)
  File "/home/alice/work/svc/.venv/lib/python3.12/site-packages/flask/app.py", line 1823, in full_dispatch_request
    rv = self.dispatch_request()
  File "/home/alice/work/svc/.venv/lib/python3.12/site-packages/werkzeug/serving.py", line 362, in run_wsgi
    execute(self.server.app)
  File "/home/alice/work/svc/app/orders.py", line 63, in create
    total = sum(i.price for i in items)
TypeError: unsupported operand type(s) for +: 'int' and 'NoneType'`

// JUnit re-throwing an application NPE. Java frames carry no path at all, so
// the only "vendor" signal is the package - here the JDK's own reflection stack
// between the two application frames.
const JAVA_TRACE = `java.lang.NullPointerException: Cannot invoke "com.acme.Order.getTotal()" because "order" is null
\tat com.acme.billing.InvoiceService.render(InvoiceService.java:88)
\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)
\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)
\tat com.acme.billing.InvoiceServiceTest.rendersTotal(InvoiceServiceTest.java:41)`

describe('foldStackTraces', () => {
  it('folds a run of node_modules frames and keeps the project frames around it', () => {
    const out = foldStackTraces(JS_TRACE)

    expect(out).toContain('at resolveUser (/home/alice/work/api-server/src/services/user.js:42:18)')
    expect(out).toContain('at handleRequest (/home/alice/work/api-server/src/server.js:88:5)')
    expect(out).toContain('... +5 frames in node_modules ...')
    expect(out).not.toContain('express/lib/router/layer.js')
    // The error message itself is never a frame and must survive.
    expect(out).toContain("TypeError: Cannot read properties of undefined (reading 'id')")
    expect(out.length).toBeLessThan(JS_TRACE.length)
  })

  it('folds site-packages frames and drops the source line that belongs to each', () => {
    const out = foldStackTraces(PY_TRACE)

    expect(out).toContain('... +3 frames in site-packages ...')
    // A Python frame is two lines; folding one must take its source line too.
    expect(out).not.toContain('rv = self.dispatch_request()')
    expect(out).not.toContain('werkzeug/serving.py')
    // Project frames keep both of their lines.
    expect(out).toContain('File "/home/alice/work/svc/app/orders.py", line 63, in create')
    expect(out).toContain('total = sum(i.price for i in items)')
    // Traceback banner and the exception line are not frames.
    expect(out).toContain('Traceback (most recent call last):')
    expect(out).toContain("TypeError: unsupported operand type(s) for +: 'int' and 'NoneType'")
  })

  it('folds JDK reflection frames in a tab-indented Java trace', () => {
    const out = foldStackTraces(JAVA_TRACE)

    expect(out).toContain('... +3 frames in java.base ...')
    expect(out).not.toContain('DirectMethodHandleAccessor')
    expect(out).toContain('at com.acme.billing.InvoiceService.render(InvoiceService.java:88)')
    expect(out).toContain('at com.acme.billing.InvoiceServiceTest.rendersTotal(InvoiceServiceTest.java:41)')
    expect(out).toContain('java.lang.NullPointerException')
  })

  it('keeps a run of two vendor frames verbatim - too short to be worth a marker', () => {
    const input = [
      `Error: connect ECONNREFUSED 127.0.0.1:5432`,
      `    at connect (/srv/app/src/db.js:14:11)`,
      `    at Pool.query (/srv/app/node_modules/pg/lib/pool.js:412:9)`,
      `    at Client._connect (/srv/app/node_modules/pg/lib/client.js:118:7)`,
      `    at runQuery (/srv/app/src/repo.js:31:5)`,
    ].join('\n')

    expect(foldStackTraces(input)).toBe(input)
  })

  it('keeps dist/ frames - a compiled service has its entire project under dist', () => {
    // `node dist/server.js`: every project frame lives under dist/, so treating
    // dist/ as vendor deletes the whole real stack including the throwing line
    // and replaces it with a fold marker - a confident summary of nothing.
    const input = [
      `TypeError: Cannot read properties of null (reading 'total')`,
      `    at computeInvoice (/srv/app/dist/services/billing.js:412:22)`,
      `    at handleCheckout (/srv/app/dist/routes/checkout.js:88:11)`,
      `    at runMiddleware (/srv/app/dist/http/pipeline.js:31:9)`,
      `    at Server.emit (node:events:518:28)`,
    ].join('\n')

    const out = foldStackTraces(input)

    expect(out).not.toContain('frames in dist')
    expect(out).toContain('at computeInvoice (/srv/app/dist/services/billing.js:412:22)')
    expect(out).toBe(input)
  })

  it('still folds a vendor dist/ run, because node_modules is what marks it vendor', () => {
    const input = [
      `Error: boom`,
      `    at main (/srv/app/dist/server.js:12:3)`,
      `    at run (/srv/app/node_modules/vite/dist/node/chunks/dep-1.js:41:9)`,
      `    at load (/srv/app/node_modules/vite/dist/node/chunks/dep-2.js:88:5)`,
      `    at boot (/srv/app/node_modules/vite/dist/node/cli.js:7:1)`,
      `    at start (/srv/app/dist/boot.js:4:1)`,
    ].join('\n')

    const out = foldStackTraces(input)

    expect(out).toContain('... +3 frames in node_modules ...')
    expect(out).toContain('at main (/srv/app/dist/server.js:12:3)')
    expect(out).toContain('at start (/srv/app/dist/boot.js:4:1)')
  })

  it('leaves output with no stack frames completely alone', () => {
    const input = ['Compiling 42 modules...', '  cache hit for src/index.ts', 'Done in 1.4s'].join('\n')

    expect(foldStackTraces(input)).toBe(input)
  })

  it('passes empty input straight through', () => {
    expect(foldStackTraces('')).toBe('')
  })
})

// Real `docker ps` alignment: every column padded to its widest value + 3
// spaces. Values carry single spaces ("2 days ago", "Up 2 days (healthy)") and
// the header itself does ("CONTAINER ID"), which is exactly why boundaries have
// to come from the header's offsets rather than a whitespace split.
const DOCKER_PS = `CONTAINER ID   IMAGE                           COMMAND                  CREATED       STATUS                PORTS                    NAMES
3f2a1b0c9d8e   postgres:16-alpine              "docker-entrypoint.s…"   2 days ago    Up 2 days (healthy)   0.0.0.0:5432->5432/tcp   api-db
7c6b5a4d3e2f   redis:7                         "docker-entrypoint.s…"   2 days ago    Up 2 days             0.0.0.0:6379->6379/tcp   api-cache
9e8d7c6b5a4f   ghcr.io/acme/api-server:1.4.2   "node dist/server.js"    3 hours ago   Up 3 hours            0.0.0.0:8080->8080/tcp   api-server`

describe('projectTable', () => {
  it('emits only the named columns, in the order asked for', () => {
    const out = projectTable(DOCKER_PS, ['NAMES', 'IMAGE', 'STATUS'])

    expect(out.split('\n')[0]).toBe('NAMES  IMAGE  STATUS')
    expect(out.split('\n')[1]).toBe('api-db  postgres:16-alpine  Up 2 days (healthy)')
    expect(out.split('\n')[3]).toBe('api-server  ghcr.io/acme/api-server:1.4.2  Up 3 hours')
    expect(out).not.toContain('docker-entrypoint')
    expect(out).not.toContain('5432->5432')
    expect(out.length).toBeLessThan(DOCKER_PS.length)
  })

  it('leaves text alone when none of the wanted columns are in the header', () => {
    expect(projectTable(DOCKER_PS, ['REVISION', 'CHART'])).toBe(DOCKER_PS)
  })

  it('refuses a row whose value is wider than its header column instead of slicing fragments', () => {
    // The header was padded to its own widths, not the data's: IMAGE gets 5
    // columns of space but carries a 29-char value. Slicing every row at the
    // HEADER's offsets cuts values mid-token and hands back cells belonging to
    // whichever column happened to sit at that offset - a table of garbage that
    // reads as authoritative. Refusing is the only honest answer.
    const input = [
      'CONTAINER ID   IMAGE     STATUS    NAMES',
      '3f2a1b0c9d8e   ghcr.io/acme/api-server:1.4.2   Up 2 days   api-db',
    ].join('\n')

    const out = projectTable(input, ['NAMES', 'IMAGE'])

    expect(out).toBe(input)
    // The projected header is the tell: emitting it means rows were sliced.
    expect(out).not.toContain('NAMES  IMAGE')
  })

  it('refuses a row that stops short of a column start instead of shifting cells left', () => {
    // The mirror image of the over-wide row above. The header promises four
    // columns and the last row carries three, so every cell after the missing
    // one sits under the WRONG header - AGE's value lands in STATUS's slice.
    // The row cannot say which column went missing: a genuinely empty trailing
    // AGE produces the exact same characters. Ambiguous means refuse.
    const input = [
      'NAME       NAMESPACE   STATUS     AGE',
      'api-0      default     Running    5d',
      'orphan     Running     3d',
    ].join('\n')

    const out = projectTable(input, ['NAME', 'STATUS'])

    expect(out).toBe(input)
    // The tell: 'orphan' reported with '3d' - its AGE - as its STATUS.
    expect(out).not.toContain('orphan  3d')
  })

  it('skips a name swallowed by a two-word column and still projects the rest', () => {
    // 'ID' is the second word of 'CONTAINER ID', so this table has no column
    // called 'ID' - the same situation as a name that is absent altogether.
    // NAMES parsed fine and its boundaries are not in doubt, so abandoning the
    // whole projection over ID costs breadth and buys nothing.
    const out = projectTable(DOCKER_PS, ['ID', 'NAMES'])

    expect(out.split('\n')[0]).toBe('NAMES')
    expect(out.split('\n').slice(1)).toEqual(['api-db', 'api-cache', 'api-server'])
    expect(out).not.toContain('3f2a1b0c9d8e')
    expect(out.length).toBeLessThan(DOCKER_PS.length)
  })

  it('still refuses a swallowed name when the data shows the run is several columns', () => {
    // Guards the boundary of the case above. Same header shape - a name that is
    // one word of a run - but here the run is `ps aux`-style glue: the values
    // underneath carry 2+ space gaps, which is the header's real column
    // structure showing through. Skipping PID the way ID is skipped above would
    // hand back a USER column and silently drop the column that was asked for.
    // Every row lines up with the header's offsets, so the over-wide guard
    // cannot catch this one - the header/data disagreement is the only signal.
    const input = [
      'USER       PID %CPU   COMMAND',
      'root         1  0.0   /sbin/init',
      'alice      242  1.2   node server.js',
    ].join('\n')

    const out = projectTable(input, ['USER', 'PID'])

    expect(out).toBe(input)
    expect(out).not.toContain('USER\nroot')
  })

  it('still refuses a swallowed name when the glued columns are too narrow to leave a 2-space gap', () => {
    // The narrow side of the same boundary as the case above, and the one the
    // "2+ space gap in the slice" rule got wrong. `PID %CPU` is real column
    // glue - identical in kind to the `ps aux` header below - but the padding
    // is a function of the widest VALUE, and these values are short enough that
    // one space separates them on every row. A gap test therefore reads the
    // slice as a single cell, skips PID like an absent column, and projects
    // USER and COMMAND with the column that was asked for silently gone. Every
    // row lines up with the header offsets, so the over-wide guard cannot fire
    // either - the run's own data is the only signal there is.
    const input = [
      'USER   PID %CPU  COMMAND',
      'root     1 0.0   /sbin/init',
      'alice  242 1.2   node server.js',
    ].join('\n')

    const out = projectTable(input, ['USER', 'PID', 'COMMAND'])

    expect(out).toBe(input)
    // The tell: a projected table whose PID column simply is not there.
    expect(out).not.toContain('USER  COMMAND')
    expect(out).not.toContain('root  /sbin/init')
  })

  it('refuses a header that separates columns with a single space - `ps aux`', () => {
    // "PID %CPU %MEM" is indistinguishable, from the header alone, from the
    // two-word column name "CONTAINER ID". So PID, %CPU, %MEM, COMMAND and the
    // rest are not recognisable columns here; projecting anyway silently drops
    // two of the three columns that were asked for.
    const input = [
      'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
      'alice   1234567  9.9  4.2 9876543 654321 pts/0 Rl   10:02   3:21 node /srv/app/dist/server.js',
    ].join('\n')

    const out = projectTable(input, ['USER', 'PID', 'COMMAND'])

    expect(out).toBe(input)
  })

  it('leaves a bare path list alone - it has no header to project', () => {
    // Canonical `| xargs` input. Reshaping it would break the pipeline.
    const input = ['src/app.ts', 'src/handlers/git.ts', 'test/handlers/git.cases.test.ts'].join('\n')

    expect(projectTable(input, ['NAMES', 'IMAGE'])).toBe(input)
  })

  it('leaves a header with no data rows alone rather than emitting a bare header', () => {
    const input = 'CONTAINER ID   IMAGE   STATUS   NAMES'

    expect(projectTable(input, ['NAMES', 'STATUS'])).toBe(input)
  })

  it('passes empty input straight through', () => {
    expect(projectTable('', ['NAMES'])).toBe('')
  })
})

// `pytest --help`: descriptions wrap over many lines, so the first sentence
// spans two physical lines and only shows up once they are rejoined. The
// "--fixtures, --funcargs" entry is the real shape where the names are too wide
// for the column and the description starts on the line below.
const PYTEST_HELP = `usage: pytest [options] [file_or_dir] [file_or_dir] [...]

positional arguments:
  file_or_dir

general:
  -k EXPRESSION         Only run tests which match the given substring
                        expression. An expression is a Python evaluatable
                        expression where all names are substring-matched
                        against test names and their parent classes.
                        Example: -k 'test_method or test_other' matches all
                        test functions and classes whose name contains
                        'test_method' or 'test_other'.
  -m MARKEXPR           Only run tests matching given mark expression. For
                        example: -m 'mark1 and not mark2'.
  --markers             Show markers (builtin, plugin and per-project ones).
  -x, --exitfirst       Exit instantly on first error or failed test.
  --fixtures, --funcargs
                        Show available fixtures, sorted by plugin appearance.
                        Fixtures with leading '_' are only shown with '-v'.
  --pdb                 Start the interactive Python debugger on errors or
                        KeyboardInterrupt.`

// `git --help`: a wrapped multi-line usage block, 22 commands grouped under
// prose headings, and a closing paragraph of prose.
const GIT_HELP = `usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]
           [--exec-path[=<path>]] [--html-path] [--man-path] [--info-path]
           [-p | --paginate | -P | --no-pager] [--no-replace-objects] [--bare]
           [--git-dir=<path>] [--work-tree=<path>] [--namespace=<name>]
           <command> [<args>]

These are common Git commands used in various situations:

start a working area (see also: git help tutorial)
   clone     Clone a repository into a new directory
   init      Create an empty Git repository or reinitialize an existing one

work on the current change (see also: git help everyday)
   add       Add file contents to the index
   mv        Move or rename a file, a directory, or a symlink
   restore   Restore working tree files
   rm        Remove files from the working tree and from the index

examine the history and state (see also: git help revisions)
   bisect    Use binary search to find the commit that introduced a bug
   diff      Show changes between commits, commit and working tree, etc
   grep      Print lines matching a pattern
   log       Show commit logs
   show      Show various types of objects
   status    Show the working tree status

grow, mark and tweak your common history
   branch    List, create, or delete branches
   commit    Record changes to the repository
   merge     Join two or more development histories together
   rebase    Reapply commits on top of another base tip
   reset     Reset current HEAD to the specified state
   switch    Switch branches
   tag       Create, list, delete or verify a tag object signed with GPG

collaborate (see also: git help workflows)
   fetch     Download objects and refs from another repository
   pull      Fetch from and integrate with another repository or a local branch
   push      Update remote refs along with associated objects

'git help -a' and 'git help -g' list available subcommands and some
concept guides. See 'git help <command>' or 'git help <concept>'
to read about a specific subcommand or concept.
See 'git help git' for an overview of the system.`

describe('condenseHelp', () => {
  it('keeps the usage line and reduces each option to its first sentence', () => {
    const out = condenseHelp(PYTEST_HELP)

    expect(out.split('\n')[0]).toBe('usage: pytest [options] [file_or_dir] [file_or_dir] [...]')
    // The first sentence is split across two source lines - it only reads
    // correctly if the wrapped description is rejoined before it is cut.
    expect(out).toContain('-k EXPRESSION  Only run tests which match the given substring expression.')
    expect(out).not.toContain('Python evaluatable')
    expect(out).not.toContain('test_method')
    expect(out).toContain("-m MARKEXPR  Only run tests matching given mark expression.")
    expect(out).not.toContain('mark1 and not mark2')
    // A name too wide for the column takes its description from the next line.
    expect(out).toContain('--fixtures, --funcargs  Show available fixtures, sorted by plugin appearance.')
    expect(out).not.toContain("only shown with '-v'")
    expect(out.length).toBeLessThan(PYTEST_HELP.length)
  })

  it('caps the entry list and discloses how many were dropped', () => {
    const out = condenseHelp(GIT_HELP)

    // Wrapped usage block survives whole - it is the one thing a caller needs.
    expect(out).toContain('[--exec-path[=<path>]] [--html-path] [--man-path] [--info-path]')
    expect(out).toContain('clone  Clone a repository into a new directory')
    // 22 commands, 15 kept.
    expect(out).toContain('... +7 more (--full)')
    expect(out).toContain('merge  Join two or more development histories together') // 15th, last kept
    expect(out).not.toContain('Update remote refs') // 22nd, past the cap
    // Prose headings and the trailing paragraph are not entries.
    expect(out).not.toContain('start a working area')
    expect(out).not.toContain('concept guides')
    expect(out.length).toBeLessThan(GIT_HELP.length)
  })

  it('leaves output with no usage line alone - it is not help text', () => {
    const input = [
      'Available commands:',
      '  build     Build the project',
      '  test      Run the test suite',
      '  deploy    Ship it',
    ].join('\n')

    expect(condenseHelp(input)).toBe(input)
  })

  it('leaves a usage line with too few entries alone', () => {
    // Two entries cost more to reformat than they save, and a near-empty list
    // is the shape most likely to mean "this is not an option table".
    const input = ['usage: mytool [options] <file>', '  -v    Verbose', '  -h    Help'].join('\n')

    expect(condenseHelp(input)).toBe(input)
  })

  it('passes empty input straight through', () => {
    expect(condenseHelp('')).toBe('')
  })
})

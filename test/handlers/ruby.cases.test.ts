import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `ruby` handler.
// Locks the exact current output AND asserts the intent of every condenser
// wired into the compress() dispatcher for cmd in {rspec, rubocop, rake}:
//   rspec   → condenseRspec   (examples/failures/pending summary + FAIL headers)
//   rubocop → condenseRubocop (group offenses by file, severity counts E/W/C/F)
//   rake    → condenseRake    (minitest summary, strips rake/blank noise)

// ── rspec fixtures ────────────────────────────────────────────────────────────

const RSPEC_FAILURES = `Randomized with seed 41234

User
  #full_name
    returns the concatenated name
    handles missing last name (FAILED - 1)
  #admin?
    returns true for admins
    returns false for regular users (FAILED - 2)

Failures:

  1) User#full_name handles missing last name
     Failure/Error: expect(user.full_name).to eq('John')

       expected: "John"
            got: "John "

       (compared using ==)
     # ./spec/models/user_spec.rb:15:in 'block (3 levels) in <top (required)>'

  2) User#admin? returns false for regular users
     Failure/Error: expect(user.admin?).to be false

       expected false
          got true
     # ./spec/models/user_spec.rb:28:in 'block (3 levels) in <top (required)>'

Finished in 0.04231 seconds (files took 0.83 seconds to load)
5 examples, 2 failures

Failed examples:

rspec ./spec/models/user_spec.rb:15 # User#full_name handles missing last name
rspec ./spec/models/user_spec.rb:28 # User#admin? returns false for regular users
`

const RSPEC_PASSING = `Randomized with seed 9981

User
  #full_name
    returns the concatenated name
    handles a middle name
  #admin?
    returns true for admins
    returns false for regular users
Order
  computes the total
  applies discounts

Finished in 0.02 seconds (files took 0.7 seconds to load)
7 examples, 0 failures
`

const RSPEC_PENDING = `Randomized with seed 5150

Order
  is not yet implemented (PENDING: Not yet implemented)

Pending: (Failures listed here are expected and do not affect your suite's status)

  1) Order#total is not yet implemented
     # Not yet implemented
     # ./spec/models/order_spec.rb:42

Finished in 0.011 seconds (files took 0.6 seconds to load)
3 examples, 0 failures, 1 pending
`

const RSPEC_MANY = [
  'Randomized with seed 20460',
  '',
  'Failures:',
  '',
  ...Array.from({ length: 12 }, (_, i) =>
    `  ${i + 1}) Widget number ${i + 1} behaves correctly under load`),
  '',
  'Finished in 0.19 seconds (files took 0.8 seconds to load)',
  '12 examples, 12 failures',
  '',
  'Failed examples:',
  '',
  ...Array.from({ length: 12 }, (_, i) =>
    `rspec ./spec/widgets/widget_${i + 1}_spec.rb:${(i + 1) * 3} # Widget number ${i + 1} behaves correctly under load`),
  '',
].join('\n')

const RSPEC_LOAD_ERROR = `An error occurred while loading ./spec/spec_helper.rb.
Failure/Error: require 'app'

LoadError:
  cannot load such file -- app
# ./spec/spec_helper.rb:3:in 'require'
# ./spec/spec_helper.rb:3:in '<top (required)>'
No examples found.
`

// ── rubocop fixtures ──────────────────────────────────────────────────────────

const RUBOCOP_OFFENSES = `Inspecting 3 files
CWC.E

Offenses:

app/models/user.rb:5:3: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.
app/models/user.rb:10:81: C: Layout/LineLength: Line is too long. [95/80]
app/models/user.rb:22:5: W: Lint/UselessAssignment: Useless assignment to variable - name.
app/controllers/users_controller.rb:8:1: E: Lint/Syntax: unexpected token kEND (Using Ruby 3.2 parser).
config/routes.rb:2:3: C: Style/StringLiterals: Prefer single-quoted strings when you don't need interpolation.

3 files inspected, 5 offenses detected
`

const RUBOCOP_CAP = `Inspecting 1 file
W

Offenses:

app/services/report.rb:1:1: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.
app/services/report.rb:3:5: W: Lint/UselessAssignment: Useless assignment to variable - x.
app/services/report.rb:7:81: C: Layout/LineLength: Line is too long. [88/80]
app/services/report.rb:9:1: C: Style/Documentation: Missing top-level documentation comment.
app/services/report.rb:14:3: C: Metrics/MethodLength: Method has too many lines. [12/10]
app/services/report.rb:20:7: W: Lint/ShadowingOuterLocalVariable: Shadowing outer local variable - row.

1 file inspected, 6 offenses detected
`

const RUBOCOP_CLEAN = `Inspecting 4 files
....

4 files inspected, no offenses detected
`

const RUBOCOP_CONFIG_ERROR = `Error: unrecognized cop or department Style/Frozen found in .rubocop.yml
Did you mean? Style/For

Errors are usually caused by using a version of RuboCop
that does not match the .rubocop.yml configuration.
`

// ── rake fixtures ─────────────────────────────────────────────────────────────

const RAKE_MINITEST = `(in /home/user/myproject)
Run options: --seed 34216

# Running:

.......F......E...

Finished in 0.128472s, 140.1 runs/s, 311.5 assertions/s.

  1) Failure:
UserTest#test_full_name [test/models/user_test.rb:12]:
Expected: "John Doe"
  Actual: "John"

  2) Error:
UserTest#test_save_persists:
NoMethodError: undefined method 'save' for nil:NilClass
    test/models/user_test.rb:20:in 'block in <class:UserTest>'

18 runs, 40 assertions, 1 failures, 1 errors, 0 skips
`

const RAKE_PASSING = `(in /home/user/myproject)
Run options: --seed 11002

# Running:

................

Finished in 0.051200s, 312.5 runs/s, 625.0 assertions/s.

16 runs, 32 assertions, 0 failures, 0 errors, 0 skips
`

const RAKE_MIGRATE = `(in /home/user/myproject)
== 20240115120000 CreateUsers: migrating ======================================
-- create_table(:users)
   -> 0.0231s
-- add_index(:users, :email, {:unique=>true})
   -> 0.0089s
== 20240115120000 CreateUsers: migrated (0.0325s) =============================

== 20240115120500 AddPostsTable: migrating ====================================
-- create_table(:posts)
   -> 0.0154s
== 20240115120500 AddPostsTable: migrated (0.0160s) ===========================
`

const RAKE_ALL_NOISE = `rake aborted!
Rakefile:8:in 'block in <top (required)>'
Rakefile:5:in '<main>'
(in /home/user/myproject)
`

describeCompression('ruby', [
  // ── rspec ──────────────────────────────────────────────────────────────────
  {
    name: 'rspec - summarizes examples/failures and lists FAIL headers, dropping backtraces',
    cmd: 'rspec',
    args: ['spec'],
    input: RSPEC_FAILURES,
    assert: (out) => {
      // Emits the one-line summary header.
      expect(out).toMatch(/^RSpec: 5 examples, 2 failures/)
      // Lifts each failure's description as a FAIL bullet.
      expect(out).toContain('  FAIL: User#full_name handles missing last name')
      expect(out).toContain('  FAIL: User#admin? returns false for regular users')
      // Drops verbose Failure/Error diffs and file backtraces.
      expect(out).not.toContain('Failure/Error')
      expect(out).not.toContain('compared using ==')
      expect(out).not.toContain('user_spec.rb:15')
    },
  },
  {
    name: 'rspec - clean run (0 failures) collapses to a single summary line',
    cmd: 'rspec',
    args: ['spec'],
    input: RSPEC_PASSING,
    assert: (out) => {
      expect(out).toBe('RSpec: 7 examples')
      expect(out).not.toContain('failures')
    },
  },
  {
    name: 'rspec - reports pending count in the summary',
    cmd: 'rspec',
    args: ['spec'],
    input: RSPEC_PENDING,
    assert: (out) => {
      expect(out).toMatch(/^RSpec: 3 examples, 1 pending/)
      // 0 failures is omitted from the header.
      expect(out).not.toContain('0 failures')
    },
  },
  {
    name: 'rspec - caps the FAIL list at 10 and appends a "+N more" line',
    cmd: 'rspec',
    args: ['spec'],
    input: RSPEC_MANY,
    assert: (out) => {
      expect(out).toMatch(/^RSpec: 12 examples, 12 failures/)
      const failLines = out.split('\n').filter((l) => l.includes('FAIL:'))
      expect(failLines.length).toBe(10)
      expect(out).toContain('  ... +2 more')
    },
  },
  {
    name: 'rspec - no summary present (load error) passes through untouched',
    cmd: 'rspec',
    args: ['spec'],
    input: RSPEC_LOAD_ERROR,
    assert: (out) => {
      // No examples/failures tally => condenser bails, keeps the raw error.
      expect(out).not.toMatch(/^RSpec:/m)
      expect(out).toContain('LoadError')
      expect(out).toContain('cannot load such file -- app')
    },
  },
  // ── rubocop ────────────────────────────────────────────────────────────────
  {
    name: 'rubocop - groups offenses by file with a severity breakdown header',
    cmd: 'rubocop',
    args: ['app'],
    input: RUBOCOP_OFFENSES,
    assert: (out) => {
      expect(out).toMatch(/^rubocop: 5 offense\(s\) in 3 file\(s\)/)
      // Severity counts ordered E W C F.
      expect(out).toContain('[E:1 W:1 C:3]')
      // File grouping with per-file counts.
      expect(out).toContain('app/models/user.rb (3)')
      // Offense lines are prefix-stripped (no path:line:col: SEV:).
      expect(out).not.toMatch(/\.rb:\d+:\d+:/)
      // Progress noise dropped.
      expect(out).not.toContain('Inspecting 3 files')
    },
  },
  {
    name: 'rubocop - caps each file at 4 offenses with a "+N more here" line',
    cmd: 'rubocop',
    args: ['app'],
    input: RUBOCOP_CAP,
    assert: (out) => {
      expect(out).toMatch(/^rubocop: 6 offense\(s\) in 1 file\(s\)/)
      expect(out).toContain('[W:2 C:4]')
      expect(out).toContain('app/services/report.rb (6)')
      expect(out).toContain('  ... +2 more here')
    },
  },
  {
    name: 'rubocop - clean run collapses to the single "no offenses detected" line',
    cmd: 'rubocop',
    args: ['app'],
    input: RUBOCOP_CLEAN,
    assert: (out) => {
      expect(out).toBe('4 files inspected, no offenses detected')
      expect(out).not.toContain('Inspecting 4 files')
    },
  },
  {
    name: 'rubocop - non-offense output (config error) passes through untouched',
    cmd: 'rubocop',
    args: ['app'],
    input: RUBOCOP_CONFIG_ERROR,
    assert: (out) => {
      expect(out).not.toMatch(/^rubocop: /m)
      expect(out).toContain('unrecognized cop or department Style/Frozen')
    },
  },
  // ── rake ───────────────────────────────────────────────────────────────────
  {
    name: 'rake - condenses the minitest summary and strips rake/blank noise',
    cmd: 'rake',
    args: ['test'],
    input: RAKE_MINITEST,
    assert: (out) => {
      // Summary line rewritten; assertions count dropped, zero-skips omitted.
      expect(out).toMatch(/^rake test: 18 runs, 1 failures, 1 errors$/m)
      expect(out).not.toContain('40 assertions')
      expect(out).not.toContain('0 skips')
      // Rake internal noise and blank lines removed.
      expect(out).not.toContain('(in /')
      expect(out).not.toMatch(/\n[ \t]*\n/)
      // Failure/error detail is preserved (not summarized away).
      expect(out).toContain('UserTest#test_full_name')
      expect(out).toContain('NoMethodError')
    },
  },
  {
    name: 'rake - all-passing run reduces the summary to just the run count',
    cmd: 'rake',
    args: ['test'],
    input: RAKE_PASSING,
    assert: (out) => {
      expect(out).toContain('rake test: 16 runs')
      expect(out).not.toContain('failures')
      expect(out).not.toContain('(in /')
    },
  },
  {
    name: 'rake - non-test task keeps output but still strips the "(in /...)" line',
    cmd: 'rake',
    args: ['db:migrate'],
    input: RAKE_MIGRATE,
    assert: (out) => {
      // No minitest summary => no "rake test:" header synthesized.
      expect(out).not.toMatch(/^rake test:/m)
      expect(out).not.toContain('(in /')
      // Real migration output preserved.
      expect(out).toContain('CreateUsers: migrated')
      expect(out).toContain('AddPostsTable: migrated')
      // Blank separator lines collapsed away.
      expect(out).not.toMatch(/\n[ \t]*\n/)
    },
  },
  {
    name: 'rake - output that is entirely noise falls back to raw (never empties)',
    cmd: 'rake',
    args: ['test'],
    input: RAKE_ALL_NOISE,
    assert: (out) => {
      // Every line is rake/Rakefile/(in /) noise => stripped result is empty,
      // so the condenser falls back to returning the original text.
      expect(out.length).toBeGreaterThan(0)
      expect(out).not.toMatch(/^rake test:/m)
      expect(out).toContain('rake aborted!')
      expect(out).toContain("Rakefile:8:in 'block in <top (required)>'")
    },
  },
  // ── edge ───────────────────────────────────────────────────────────────────
  {
    name: 'empty output - returns empty, no condenser runs',
    cmd: 'rspec',
    args: ['spec'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },
])

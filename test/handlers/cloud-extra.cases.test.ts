import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `cloud-extra` handler.
//
// Two condensers are dispatched from the proxy frame:
//   cmd 'aws'  → condenseAws  (shorten ARNs, truncate ISO timestamps → date, cap 40 lines)
//   cmd 'psql' → condensePsql (strip separator lines, cap 50 data rows, expanded \x mode w/ 30-record cap)
//
// The ellipsis used by condenseAws in the shortened ARN is the real U+2026
// character ('arn:…:$1'), asserted below via the … escape.
const ELLIPSIS = '…'

// ── aws fixtures ───────────────────────────────────────────────────────────────

// `aws iam list-roles` JSON: ARNs with EMPTY region segment + ISO timestamps.
const AWS_IAM_ROLES = `{
    "Roles": [
        {
            "Path": "/",
            "RoleName": "AppRole",
            "RoleId": "AROAEXAMPLEID123456",
            "Arn": "arn:aws:iam::123456789012:role/AppRole",
            "CreateDate": "2024-03-15T12:34:56.789Z",
            "MaxSessionDuration": 3600
        },
        {
            "Path": "/service-role/",
            "RoleName": "LambdaExecRole",
            "RoleId": "AROAEXAMPLEID654321",
            "Arn": "arn:aws:iam::123456789012:role/service-role/LambdaExecRole",
            "CreateDate": "2024-01-02T08:00:00Z",
            "MaxSessionDuration": 3600
        }
    ]
}`

// `aws lambda list-functions` JSON: ARNs WITH a region segment (us-east-1)
// plus role ARNs and ISO LastModified timestamps.
const AWS_LAMBDA_FUNCS = `{
    "Functions": [
        {
            "FunctionName": "process-orders",
            "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:process-orders",
            "Runtime": "nodejs20.x",
            "Role": "arn:aws:iam::123456789012:role/service-role/process-orders-role",
            "LastModified": "2024-06-01T09:15:30.123Z",
            "CodeSize": 204800
        },
        {
            "FunctionName": "resize-images",
            "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:resize-images",
            "Runtime": "python3.12",
            "Role": "arn:aws:iam::123456789012:role/lambda-basic",
            "LastModified": "2024-05-20T18:00:00Z",
            "CodeSize": 512000
        }
    ]
}`

// `aws s3 ls s3://bucket --recursive`: 50 object lines (no ARNs / no ISO
// timestamps) so this case isolates the 40-line cap behavior.
const AWS_S3_LS = Array.from(
  { length: 50 },
  (_, i) =>
    `2024-03-15 12:0${i % 6}:00       ${1000 + i} path/to/objects/file${String(i + 1).padStart(3, '0')}.txt`,
).join('\n')

// `aws s3 cp` success: no ARNs, no ISO timestamps, well under 40 lines - the
// no-trigger passthrough (condenser must not mangle already-clean output).
const AWS_S3_CP = `Completed 1.0 KiB/1.0 KiB (2.5 KiB/s) with 1 file(s) remaining
upload: ./report.txt to s3://my-bucket/reports/report.txt`

// ── psql fixtures ──────────────────────────────────────────────────────────────

// Default psql table: header + a dashed separator line + 3 data rows + count.
const PSQL_TABLE = ` id |  name  |       email
----+--------+--------------------
  1 | Alice  | alice@example.com
  2 | Bob    | bob@example.com
  3 | Carol  | carol@example.com
(3 rows)`

// Clean / zero-result table: header + separator + "(0 rows)".
const PSQL_ZERO = ` id | name
----+------
(0 rows)`

// Bordered table (\pset border 2): every row is `| ... |` so rows are counted;
// 60 data rows force the 50-row cap. Separator lines are `+---+` (all -/+).
const PSQL_BORDERED = [
  '+-----+-----------+',
  '| id  | name      |',
  '+-----+-----------+',
  ...Array.from({ length: 60 }, (_, i) => `| ${String(i + 1).padStart(3)} | user${i + 1} |`),
  '+-----+-----------+',
  '(60 rows)',
].join('\n')

// Expanded display (\x): 35 records × 4 fields. Records 1-30 are kept,
// records >30 are dropped by the expanded-mode 30-record cap.
const PSQL_EXPANDED = Array.from({ length: 35 }, (_, i) => {
  const n = i + 1
  return [
    `-[ RECORD ${n} ]---------+----------------------`,
    `id       | ${n}`,
    `username | user${n}`,
    `email    | user${n}@example.com`,
    `active   | ${n % 2 === 0 ? 'f' : 't'}`,
  ].join('\n')
}).join('\n')

describeCompression('cloud-extra', [
  // ── aws ───────────────────────────────────────────────────────────────────
  {
    name: 'aws iam list-roles - shortens region-less ARNs and truncates ISO timestamps to date',
    cmd: 'aws',
    args: ['iam', 'list-roles'],
    input: AWS_IAM_ROLES,
    assert: (out, input) => {
      // ARNs collapsed to arn:…:<resource>, account id & service dropped.
      expect(out).toContain(`arn:${ELLIPSIS}:role/AppRole`)
      expect(out).toContain(`arn:${ELLIPSIS}:role/service-role/LambdaExecRole`)
      expect(out).not.toContain('arn:aws:iam')
      expect(out).not.toContain('123456789012')
      // ISO timestamps reduced to the date component only.
      expect(out).toContain('"CreateDate": "2024-03-15"')
      expect(out).not.toMatch(/T\d{2}:\d{2}:\d{2}/)
      expect(out).not.toContain('12:34:56')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'aws lambda list-functions - shortens region-bearing ARNs (service:region:acct dropped)',
    cmd: 'aws',
    args: ['lambda', 'list-functions'],
    input: AWS_LAMBDA_FUNCS,
    assert: (out, input) => {
      expect(out).toContain(`arn:${ELLIPSIS}:function:process-orders`)
      expect(out).toContain(`arn:${ELLIPSIS}:function:resize-images`)
      expect(out).toContain(`arn:${ELLIPSIS}:role/lambda-basic`)
      expect(out).not.toContain('arn:aws:lambda')
      expect(out).not.toContain('us-east-1:123456789012')
      // Timestamps truncated to date.
      expect(out).toContain('"LastModified": "2024-06-01"')
      expect(out).not.toContain('09:15:30')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'aws s3 ls (50 lines) - caps list output at 40 lines with a "+N more" footer',
    cmd: 'aws',
    args: ['s3', 'ls'],
    input: AWS_S3_LS,
    assert: (out, input) => {
      expect(out).toContain('... +10 more lines (aws output truncated)')
      // 40 kept lines + 1 footer line.
      expect(out.split('\n').length).toBeLessThanOrEqual(41)
      expect(out).toContain('file001.txt')
      expect(out).toContain('file040.txt')
      expect(out).not.toContain('file041.txt')
      expect(out).not.toContain('file050.txt')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'aws s3 cp success - no-trigger passthrough (no ARNs/timestamps, stays intact)',
    cmd: 'aws',
    args: ['s3', 'cp'],
    input: AWS_S3_CP,
    assert: (out) => {
      expect(out).toContain('upload:')
      expect(out).toContain('s3://my-bucket/reports/report.txt')
      // Nothing to shorten - no truncation footer injected.
      expect(out).not.toContain('aws output truncated')
    },
  },
  {
    name: 'aws empty output - returns empty string unchanged',
    cmd: 'aws',
    args: ['ec2', 'describe-instances'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── psql ──────────────────────────────────────────────────────────────────
  {
    name: 'psql table - strips the dashed +/- separator line, keeps header/rows/count',
    cmd: 'psql',
    args: ['-c', 'select * from users'],
    input: PSQL_TABLE,
    assert: (out, input) => {
      // The `----+--------+---...` separator line is gone.
      expect(out).not.toMatch(/^[-+]+$/m)
      expect(out).toContain('Alice')
      expect(out).toContain('alice@example.com')
      expect(out).toContain('(3 rows)')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'psql zero rows - clean result, separator stripped, "(0 rows)" preserved',
    cmd: 'psql',
    args: ['-c', 'select * from users where false'],
    input: PSQL_ZERO,
    assert: (out, input) => {
      expect(out).not.toMatch(/^[-+]+$/m)
      expect(out).toContain('(0 rows)')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'psql bordered (60 rows) - caps data rows at 50 with a truncation notice',
    cmd: 'psql',
    args: ['-c', 'select * from big_table'],
    input: PSQL_BORDERED,
    assert: (out, input) => {
      expect(out).toContain('... (rows truncated, showing first 50)')
      // Bordered `+---+` separator lines are stripped.
      expect(out).not.toMatch(/^\+[-+]+\+$/m)
      expect(out).toContain('user1 |')
      // Later rows and the trailing count are dropped past the cap.
      expect(out).not.toContain('user60')
      expect(out).not.toContain('(60 rows)')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'psql expanded \\x (35 records) - detects expanded mode, caps at 30 records',
    cmd: 'psql',
    args: ['-x', '-c', 'select * from users'],
    input: PSQL_EXPANDED,
    assert: (out, input) => {
      expect(out).toContain('-[ RECORD 1 ]')
      expect(out).toContain('-[ RECORD 30 ]')
      // Records past 30 (header + fields) are dropped entirely.
      expect(out).not.toContain('-[ RECORD 31 ]')
      expect(out).not.toContain('-[ RECORD 35 ]')
      expect(out).toContain('user1@example.com')
      expect(out).not.toContain('user31@example.com')
      expect(out.length).toBeLessThan(input.length)
    },
  },
])

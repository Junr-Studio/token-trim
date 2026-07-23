import { expect } from 'vitest'
import { describeCompression } from '../support/harness.js'

// Characterization + behavioral suite for the `build-tools` handler.
// Covers every condenser it defines: condenseTerraform (plan/apply change
// summary + noise-strip branch), condenseMvn, condenseGradle, condenseDotnet
// (test + build), condenseBunInstall, condenseBunTest. Each case pairs a
// realistic raw tool dump with assertions that lock the current output shape.

// ── terraform ─────────────────────────────────────────────────────────────────

const TF_PLAN = `Terraform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  + create
  ~ update in-place
  - destroy

Terraform will perform the following actions:

  # aws_instance.web will be created
  + resource "aws_instance" "web" {
      + ami           = "ami-0c55b159cbfafe1f0"
      + instance_type = "t3.micro"
    }

  # aws_s3_bucket.data will be created
  + resource "aws_s3_bucket" "data" {
      + bucket = "my-data-bucket"
    }

  # aws_security_group.default will be updated in-place
  ~ resource "aws_security_group" "default" {
        id = "sg-0123456789"
    }

  # aws_instance.legacy will be destroyed
  - resource "aws_instance" "legacy" {
    }

Plan: 2 to add, 1 to change, 1 to destroy.
`

const TF_APPLY = `aws_instance.web: Creating...
aws_instance.web: Still creating... [10s elapsed]
aws_instance.web: Creation complete after 15s [id=i-0abc123]
aws_s3_bucket.data: Creating...
aws_s3_bucket.data: Creation complete after 2s [id=my-data-bucket]
aws_instance.legacy: Destroying... [id=i-0def456]
aws_instance.legacy: Destruction complete after 30s

Apply complete! Resources: 2 added, 0 changed, 1 destroyed.
`

const TF_NOCHANGES = `aws_instance.web: Refreshing state... [id=i-0abc123]
aws_s3_bucket.data: Refreshing state... [id=my-data-bucket]

No changes. Your infrastructure matches the configuration.

Terraform has compared your real infrastructure against your configuration
and found no differences, so no changes are needed.
`

const TF_INIT = `Initializing the backend...

Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.31.0...
- Installed hashicorp/aws v5.31.0 (signed by HashiCorp)

Terraform has created a lock file .terraform.lock.hcl to record the provider
selections it made above.

Terraform has been successfully initialized!

You may now begin working with Terraform. Try running "terraform plan" to see
any changes that are required for your infrastructure.
`

const TF_MANY = [
  'Terraform will perform the following actions:',
  '',
  ...Array.from({ length: 22 }, (_, i) => `  # aws_instance.node_${i} will be created`),
  '',
  'Plan: 22 to add, 0 to change, 0 to destroy.',
  '',
].join('\n')

// ── mvn ───────────────────────────────────────────────────────────────────────

const MVN_SUCCESS = `[INFO] Scanning for projects...
[INFO]
[INFO] ------------------< com.example:my-app >------------------
[INFO] Building my-app 1.0.0
[INFO] --------------------------------[ jar ]---------------------------------
[INFO]
[INFO] --- maven-resources-plugin:3.3.1:resources (default-resources) @ my-app ---
[INFO] Copying 2 resources
[INFO] --- maven-compiler-plugin:3.11.0:compile (default-compile) @ my-app ---
[INFO] Compiling 12 source files to /home/user/my-app/target/classes
[INFO] --- maven-surefire-plugin:3.1.2:test (default-test) @ my-app ---
[INFO] Tests run: 24, Failures: 0, Errors: 0, Skipped: 0
[INFO] --- maven-jar-plugin:3.4.1:jar (default-jar) @ my-app ---
[INFO] Building jar: /home/user/my-app/target/my-app-1.0.0.jar
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  8.234 s
[INFO] Finished at: 2026-07-20T10:15:32Z
[INFO] ------------------------------------------------------------------------
`

const MVN_FAILURE = `[INFO] Scanning for projects...
[INFO] Building my-app 1.0.0
[INFO] --- maven-compiler-plugin:3.11.0:compile (default-compile) @ my-app ---
[INFO] Compiling 12 source files to /home/user/my-app/target/classes
[ERROR] /home/user/my-app/src/main/java/com/example/App.java:[15,23] cannot find symbol
[ERROR]   symbol:   variable foo
[ERROR]   location: class com.example.App
[ERROR] /home/user/my-app/src/main/java/com/example/App.java:[22,10] ';' expected
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  3.102 s
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile
[ERROR] -> [Help 1]
`

// A real Maven compile failure for ONE javac error. Maven prefixes its whole
// failure epilogue with [ERROR] - the goal-failure sentence, the blank
// `[ERROR] ` separators, `-> [Help 1]`, the -e/-X hints and the Help article
// links - and it repeats every compiler diagnostic once inline and once inside
// that epilogue. Counting decorated LOG LINES therefore reported 14 "errors"
// for a build with one, while Maven's own authoritative `[INFO] 1 error` was
// thrown away by the [INFO] filter.
const MVN_ONE_ERROR = `[INFO] Scanning for projects...
[INFO] --- maven-compiler-plugin:3.11.0:compile (default-compile) @ my-app ---
[INFO] Compiling 12 source files to /repo/target/classes
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] /repo/src/main/java/App.java:[12,9] cannot find symbol
[ERROR]   symbol:   variable foo
[ERROR]   location: class App
[INFO] 1 error
[INFO] -------------------------------------------------------------
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  3.102 s
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile (default-compile) on project my-app: Compilation failure
[ERROR] /repo/src/main/java/App.java:[12,9] cannot find symbol
[ERROR]   symbol:   variable foo
[ERROR]   location: class App
[ERROR]
[ERROR] -> [Help 1]
[ERROR]
[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.
[ERROR] Re-run Maven using the -X switch to enable full debug logging.
[ERROR]
[ERROR] For more information about the errors and possible solutions, please read the following articles:
[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException
`

// MSBuild's console logger prints every diagnostic TWICE - once inline where
// the compiler emitted it and once again in the trailing error summary - so a
// build with one error was reported as "2 error(s):" with the identical line
// listed twice. MSBuild's own "1 Error(s)" tally sits right there in the output.
const DOTNET_ONE_ERROR = `MSBuild version 17.8.3+195e7f5a3 for .NET
  Determining projects to restore...
  Restored /repo/MyApp.csproj (in 480 ms).
/repo/Program.cs(7,13): error CS0103: The name 'foo' does not exist in the current context [/repo/MyApp.csproj]

Build FAILED.

/repo/Program.cs(7,13): error CS0103: The name 'foo' does not exist in the current context [/repo/MyApp.csproj]
    0 Warning(s)
    1 Error(s)

Time Elapsed 00:00:02.10
`

const MVN_NORESULT = `[INFO] Scanning for projects...
[INFO] Downloading from central: https://repo.maven.apache.org/maven2/org/springframework/spring-core/6.1.3/spring-core-6.1.3.pom
[INFO] Downloaded from central: https://repo.maven.apache.org/maven2/org/springframework/spring-core/6.1.3/spring-core-6.1.3.pom (2.5 kB at 45 kB/s)
[INFO] Progress (1): 2.5/5.0 kB
[INFO] Progress (1): 5.0 kB
[INFO] --- maven-dependency-plugin:3.6.1:resolve (default-cli) @ my-app ---
[INFO] The following files have been resolved:
[INFO]    org.springframework:spring-core:jar:6.1.3:compile
[INFO]    org.springframework:spring-context:jar:6.1.3:compile
`

// ── gradle ────────────────────────────────────────────────────────────────────

const GRADLE_SUCCESS = `Starting a Gradle Daemon (subsequent builds will be faster)
> Task :compileJava
> Task :processResources
> Task :classes
> Task :jar
> Task :assemble
> Task :compileTestJava
> Task :test
> Task :check
> Task :build

BUILD SUCCESSFUL in 4s
7 actionable tasks: 7 executed
`

const GRADLE_FAILED = `> Task :compileJava
> Task :compileKotlin FAILED

e: /home/user/app/src/main/kotlin/Main.kt:10:15 unresolved reference: foo
e: /home/user/app/src/main/kotlin/Main.kt:12:5 expecting ')'

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':compileKotlin'.

BUILD FAILED in 2s
1 actionable task: 1 executed
`

const GRADLE_NORESULT = `Starting a Gradle Daemon (subsequent builds will be faster)
Download https://repo1.maven.org/maven2/org/junit/junit-bom/5.10.1/junit-bom-5.10.1.pom
> Configure project :app
> Task :compileJava
> Task :processResources NO-SOURCE
Dependencies:
compileClasspath - Compile classpath for source set 'main'.
+--- org.junit.jupiter:junit-jupiter:5.10.1
+--- com.google.guava:guava:33.0.0-jre
`

// ── dotnet ────────────────────────────────────────────────────────────────────

const DOTNET_TEST_FAIL = `Determining projects to restore...
All projects are up-to-date for restore.
  MyApp -> /home/user/MyApp/bin/Debug/net8.0/MyApp.dll
  MyApp.Tests -> /home/user/MyApp.Tests/bin/Debug/net8.0/MyApp.Tests.dll
Test run for /home/user/MyApp.Tests/bin/Debug/net8.0/MyApp.Tests.dll (.NETCoreApp,Version=v8.0)
Microsoft (R) Test Execution Command Line Tool Version 17.8.0
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
  Failed MyApp.Tests.CalculatorTests.Divide_ByZero_Throws [12 ms]
  Error Message:
   Assert.Throws() Failure
  X MyApp.Tests.CalculatorTests.Divide_ByZero_Throws [12 ms]
  X MyApp.Tests.StringTests.Reverse_Palindrome [3 ms]
Failed!  - Failed:     2, Passed:    18, Skipped:     1, Total:    21, Duration: 145 ms
`

const DOTNET_TEST_PASS = `Determining projects to restore...
All projects are up-to-date for restore.
Test run for /home/user/MyApp.Tests/bin/Debug/net8.0/MyApp.Tests.dll (.NETCoreApp,Version=v8.0)
Microsoft (R) Test Execution Command Line Tool Version 17.8.0
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
Passed!  - Failed:     0, Passed:    42, Skipped:     0, Total:    42, Duration: 320 ms
`

const DOTNET_BUILD_OK = `MSBuild version 17.8.3+195e7f5a3 for .NET
  Determining projects to restore...
  Restored /home/user/MyApp/MyApp.csproj (in 542 ms).
  MyApp -> /home/user/MyApp/bin/Debug/net8.0/MyApp.dll
/home/user/MyApp/Program.cs(23,13): warning CS0219: The variable 'x' is assigned but its value is never used [/home/user/MyApp/MyApp.csproj]

Build succeeded.

/home/user/MyApp/Program.cs(23,13): warning CS0219: The variable 'x' is assigned but its value is never used [/home/user/MyApp/MyApp.csproj]
    1 Warning(s)
    0 Error(s)

Time Elapsed 00:00:03.42
`

const DOTNET_BUILD_FAIL = `MSBuild version 17.8.3+195e7f5a3 for .NET
  Determining projects to restore...
  Restored /home/user/MyApp/MyApp.csproj (in 480 ms).
/home/user/MyApp/Program.cs(15,9): error CS0103: The name 'foo' does not exist in the current context [/home/user/MyApp/MyApp.csproj]
/home/user/MyApp/Program.cs(18,5): error CS1002: ; expected [/home/user/MyApp/MyApp.csproj]
/home/user/MyApp/Utils.cs(7,20): warning CS8602: Dereference of a possibly null reference [/home/user/MyApp/MyApp.csproj]

Build FAILED.

    1 Warning(s)
    2 Error(s)

Time Elapsed 00:00:02.10
`

// ── bun ───────────────────────────────────────────────────────────────────────

const BUN_INSTALL = `bun install v1.1.34 (a1b2c3d4)
[0.02ms] Resolving dependencies
[45.30ms] Fetching react@18.2.0
[52.10ms] Downloading react@18.2.0
[60.00ms] Extracting react@18.2.0
Saved lockfile

+ react@18.2.0
+ react-dom@18.2.0
+ typescript@5.3.3
+ @types/node@20.11.5

15 packages installed [1.42s]
`

const BUN_TEST_FAIL = `bun test v1.1.34 (a1b2c3d4)

src/math.test.ts:
✓ add > adds two numbers [0.42ms]
✓ add > handles negatives [0.15ms]
✗ divide > throws on zero [1.20ms]

src/string.test.ts:
✓ reverse > reverses ascii [0.30ms]
✗ reverse > handles unicode [2.10ms]

 3 pass
 1 skip
 2 fail
Ran 6 tests across 2 files. [123.00ms]
`

const BUN_RUN_TEST = `$ bun test
bun test v1.1.34 (a1b2c3d4)

src/app.test.ts:
✓ boots app [5.10ms]
✓ handles request [3.20ms]
✓ returns 200 [1.05ms]

 3 pass
 0 fail
Ran 3 tests across 1 files. [45.00ms]
`

const BUN_TEST_NONE = `bun test v1.1.34 (a1b2c3d4)
error: No tests found in project
Ran 0 tests across 0 files. [12.00ms]
`

describeCompression('build-tools', [
  // ── terraform ────────────────────────────────────────────────────────────
  {
    name: 'terraform plan - summarizes counts + per-resource C/U/D actions, drops HCL body',
    cmd: 'terraform',
    args: ['plan'],
    input: TF_PLAN,
    assert: (out, input) => {
      expect(out).toMatch(/^terraform plan: 2 to add, 1 to change, 1 to destroy/)
      expect(out).toContain('C aws_instance.web')
      expect(out).toContain('C aws_s3_bucket.data')
      expect(out).toContain('U aws_security_group.default')
      expect(out).toContain('D aws_instance.legacy')
      // HCL attribute noise is gone
      expect(out).not.toContain('ami-0c55b159cbfafe1f0')
      expect(out).not.toMatch(/Terraform will perform/)
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'tofu apply - reports applied add/destroy counts (0-changed omitted)',
    cmd: 'tofu',
    args: ['apply'],
    input: TF_APPLY,
    assert: (out, input) => {
      expect(out).toBe('terraform apply: 2 to add, 1 to destroy')
      expect(out).not.toContain('changed')
      expect(out).not.toContain('Still creating')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'terraform plan - clean/zero: "No changes." collapses to a one-line summary',
    cmd: 'terraform',
    args: ['plan'],
    input: TF_NOCHANGES,
    assert: (out, input) => {
      expect(out).toBe('terraform plan: no changes')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'terraform init - non-plan branch strips backend/provider init noise, keeps result',
    cmd: 'terraform',
    args: ['init'],
    input: TF_INIT,
    assert: (out, input) => {
      expect(out).not.toContain('Initializing the backend')
      expect(out).not.toContain('Initializing provider plugins')
      expect(out).toContain('Terraform has been successfully initialized!')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'terraform plan - caps the change list at 20 with a "+N more" tail',
    cmd: 'terraform',
    args: ['plan'],
    input: TF_MANY,
    assert: (out, input) => {
      expect(out).toMatch(/^terraform plan: 22 to add/)
      expect((out.match(/^ {2}C /gm) ?? []).length).toBe(20)
      expect(out).toContain('... +2 more')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── mvn ──────────────────────────────────────────────────────────────────
  {
    name: 'mvn - clean/zero: BUILD SUCCESS reduces the whole reactor log to one line',
    cmd: 'mvn',
    args: ['package'],
    input: MVN_SUCCESS,
    assert: (out, input) => {
      expect(out).toBe('BUILD SUCCESS')
      expect(out.length).toBeLessThan(input.length / 5)
    },
  },
  {
    // CHANGED DELIBERATELY: this used to assert `6 error(s):` for a fixture
    // holding TWO javac errors. The 6 was the number of lines Maven happened to
    // decorate with [ERROR] - two diagnostics, two continuation lines, the
    // goal-failure sentence and `-> [Help 1]`. A count the tool never produced,
    // presented as a diagnostic total, is exactly the fabricated-statistic bug
    // class the project's own invariants exist to catch, so the assertion now
    // pins the real number of compiler errors.
    name: 'mvn - BUILD FAILURE keeps result header + numbered [ERROR] lines, drops [INFO]',
    cmd: 'mvn',
    args: ['install'],
    input: MVN_FAILURE,
    assert: (out, input) => {
      expect(out).toContain('BUILD FAILURE')
      expect(out).toContain('2 error(s):')
      expect(out).toContain('cannot find symbol')
      expect(out).toContain("';' expected")
      // the detail lines still ride along under the header
      expect(out).toContain('symbol:   variable foo')
      expect(out).toContain('Failed to execute goal')
      expect(out).not.toContain('[INFO]')
      expect(out).not.toContain('Scanning for projects')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'mvn - one javac error printed twice inside a standard [ERROR] epilogue is one error, not fourteen',
    cmd: 'mvn',
    args: ['package'],
    input: MVN_ONE_ERROR,
    assert: (out) => {
      expect(out).toContain('BUILD FAILURE')
      // Maven printed `[INFO] 1 error`. The header must not contradict it.
      expect(out).toMatch(/^\s*1 error\(s\):$/m)
      // The diagnostic survives, but exactly once - not once per log line.
      expect(out.split('cannot find symbol').length - 1).toBe(1)
      expect(out).toContain('/repo/src/main/java/App.java:[12,9]')
      expect(out).toContain('Failed to execute goal')
      // Maven's fixed epilogue is chrome, not diagnostics: none of it may be
      // counted, and the blank `[ERROR] ` separators must not become blank
      // bullet lines.
      expect(out).not.toContain('-> [Help 1]')
      expect(out).not.toContain('re-run Maven with the -e switch')
      expect(out).not.toContain('For more information about the errors')
      expect(out).not.toMatch(/^ +$/m)
      // And no "... +N more" implying diagnostics that do not exist.
      expect(out).not.toContain('... +')
    },
  },
  {
    name: 'mvn - no BUILD line: fallback strips download/progress noise, keeps content',
    cmd: 'mvn',
    args: ['dependency:resolve'],
    input: MVN_NORESULT,
    assert: (out, input) => {
      expect(out).not.toContain('Downloading')
      expect(out).not.toContain('Downloaded')
      expect(out).not.toContain('Progress')
      expect(out).toContain('The following files have been resolved:')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── gradle ───────────────────────────────────────────────────────────────
  {
    name: 'gradle - clean/zero: BUILD SUCCESSFUL collapses the task list to one line',
    cmd: 'gradle',
    args: ['build'],
    input: GRADLE_SUCCESS,
    assert: (out, input) => {
      expect(out).toBe('BUILD SUCCESSFUL in 4s')
      expect(out).not.toContain('> Task')
      expect(out.length).toBeLessThan(input.length / 4)
    },
  },
  {
    name: 'gradle - BUILD FAILED keeps result + failed-task and e: error lines',
    cmd: 'gradle',
    args: ['build'],
    input: GRADLE_FAILED,
    assert: (out, input) => {
      expect(out).toContain('BUILD FAILED in 2s')
      expect(out).toContain('> Task :compileKotlin FAILED')
      expect(out).toContain('unresolved reference: foo')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'gradle - no BUILD line: fallback strips daemon/download/task/tree noise',
    cmd: 'gradle',
    args: ['dependencies'],
    input: GRADLE_NORESULT,
    assert: (out, input) => {
      expect(out).not.toContain('Starting a Gradle Daemon')
      expect(out).not.toContain('> Task')
      expect(out).not.toContain('+---')
      expect(out).toContain('Dependencies:')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  // ── dotnet ───────────────────────────────────────────────────────────────
  {
    name: 'dotnet test - summarizes passed/failed/skipped and lists X failures',
    cmd: 'dotnet',
    args: ['test'],
    input: DOTNET_TEST_FAIL,
    assert: (out, input) => {
      expect(out).toMatch(/^dotnet test: 18 passed, 2 failed, 1 skipped/)
      expect(out).toContain('FAIL: MyApp.Tests.CalculatorTests.Divide_ByZero_Throws')
      expect(out).toContain('FAIL: MyApp.Tests.StringTests.Reverse_Palindrome')
      expect(out).not.toContain('Starting test execution')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'dotnet test - clean/zero: all passing reduces to a single summary line',
    cmd: 'dotnet',
    args: ['test'],
    input: DOTNET_TEST_PASS,
    assert: (out, input) => {
      expect(out).toBe('dotnet test: 42 passed')
      expect(out.length).toBeLessThan(input.length / 4)
    },
  },
  {
    name: 'dotnet build - Build succeeded keeps result + WARN lines, drops MSBuild chatter',
    cmd: 'dotnet',
    args: ['build'],
    input: DOTNET_BUILD_OK,
    assert: (out, input) => {
      expect(out).toMatch(/^Build succeeded\./)
      expect(out).toContain('WARN:')
      expect(out).toContain('warning CS0219')
      expect(out).not.toContain('MSBuild version')
      expect(out).not.toContain('Time Elapsed')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'dotnet build - Build FAILED keeps error count + CS error lines',
    cmd: 'dotnet',
    args: ['build'],
    input: DOTNET_BUILD_FAIL,
    assert: (out, input) => {
      expect(out).toMatch(/^Build FAILED\./)
      expect(out).toContain('2 error(s):')
      expect(out).toContain('error CS0103')
      expect(out).toContain('error CS1002')
      expect(out).toContain('WARN:')
      expect(out).not.toContain('MSBuild version')
      expect(out.length).toBeLessThan(input.length)
    },
  },

  {
    name: 'dotnet build - MSBuild prints each diagnostic inline AND in the summary; that is one error, not two',
    cmd: 'dotnet',
    args: ['build'],
    input: DOTNET_ONE_ERROR,
    assert: (out) => {
      expect(out).toMatch(/^Build FAILED\./)
      // MSBuild's own tally in the same output says "1 Error(s)".
      expect(out).toMatch(/^\s*1 error\(s\):$/m)
      // The error line is listed once, not echoed back twice.
      expect(out.split('error CS0103').length - 1).toBe(1)
      expect(out).toContain("The name 'foo' does not exist in the current context")
    },
  },

  // ── bun ──────────────────────────────────────────────────────────────────
  {
    name: 'bun install - strips resolving/fetching/downloading/lockfile progress noise',
    cmd: 'bun',
    args: ['install'],
    input: BUN_INSTALL,
    assert: (out, input) => {
      expect(out).not.toContain('Saved lockfile')
      expect(out).not.toContain('Resolving dependencies')
      expect(out).not.toContain('Fetching')
      expect(out).not.toContain('Downloading')
      expect(out).not.toContain('Extracting')
      expect(out).toContain('15 packages installed')
      expect(out).toContain('+ react@18.2.0')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'bun test - summarizes pass/fail/skip and lists ✗ failures',
    cmd: 'bun',
    args: ['test'],
    input: BUN_TEST_FAIL,
    assert: (out, input) => {
      expect(out).toMatch(/^Bun test: 3 passed, 2 failed, 1 skipped/)
      expect(out).toContain('FAIL: divide > throws on zero')
      expect(out).toContain('FAIL: reverse > handles unicode')
      expect(out).not.toContain('src/math.test.ts')
      expect(out.length).toBeLessThan(input.length)
    },
  },
  {
    name: 'bun run - sub "run" also routes through the Bun test condenser',
    cmd: 'bun',
    args: ['run', 'test'],
    input: BUN_RUN_TEST,
    assert: (out, input) => {
      expect(out).toBe('Bun test: 3 passed')
      expect(out.length).toBeLessThan(input.length / 3)
    },
  },
  {
    name: 'bun test - passthrough: no pass/fail counts leaves output unsummarized',
    cmd: 'bun',
    args: ['test'],
    input: BUN_TEST_NONE,
    assert: (out) => {
      expect(out).not.toMatch(/^Bun test:/)
      expect(out).toContain('error: No tests found in project')
      expect(out).toContain('Ran 0 tests across 0 files')
    },
  },

  // ── edge: empty output ───────────────────────────────────────────────────
  {
    name: 'empty output - nothing to compress, returns empty string',
    cmd: 'mvn',
    args: ['package'],
    input: '',
    assert: (out) => {
      expect(out).toBe('')
    },
  },

  // ── terraform: only plan/apply were condensed; the rest fell through ───────
  {
    name: 'state list - a bare address list is canonical xargs input and is never reshaped',
    cmd: 'terraform',
    args: ['state', 'list'],
    // `terraform state list | xargs -n1 terraform state show` is the idiom, and
    // `terraform state list | grep aws_iam` is how anyone finds anything in a
    // large state. Grouping or indenting these breaks both.
    input: Array.from({ length: 24 }, (_, i) =>
      i % 2 === 0
        ? `module.network.aws_subnet.private[${i}]`
        : `aws_iam_role_policy_attachment.app_${i}`,
    ).join('\n') + '\n',
    assert: (out) => {
      const lines = out.split('\n').filter((l) => l.includes('.'))
      expect(lines).toHaveLength(24)
      for (const l of lines) expect(l).toBe(l.trim())
      expect(out).toContain('module.network.aws_subnet.private[0]')
      expect(out).toContain('aws_iam_role_policy_attachment.app_23')
    },
  },
  {
    name: 'init - provider download chatter collapses, the version lock survives',
    cmd: 'terraform',
    args: ['init'],
    input: `Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Finding hashicorp/random versions matching "~> 3.5"...
- Installing hashicorp/aws v5.31.0...
- Installed hashicorp/aws v5.31.0 (signed by HashiCorp)
- Installing hashicorp/random v3.6.0...
- Installed hashicorp/random v3.6.0 (signed by HashiCorp)

Terraform has created a lock file .terraform.lock.hcl to record the provider
selections it made above. Include this file in your version control repository
so that Terraform can guarantee to make the same selections by default when
you run "terraform init" in the future.

Terraform has been successfully initialized!

You may now begin working with Terraform. Try running "terraform plan" to see
any changes that are required for your infrastructure. All Terraform commands
should now work.
`,
    assert: (out, input) => {
      expect(out).toContain('successfully initialized')
      // the resolved provider versions are the one durable fact here
      expect(out).toContain('aws v5.31.0')
      expect(out).toContain('random v3.6.0')
      // the boilerplate tutorial paragraphs are not
      expect(out).not.toContain('You may now begin working')
      expect(out).not.toContain('version control repository')
      expect(out.length).toBeLessThan(input.length / 2)
    },
  },
  {
    name: 'validate - a clean run collapses to one line',
    cmd: 'terraform',
    args: ['validate'],
    input: '\nSuccess! The configuration is valid.\n\n',
    assert: (out) => {
      expect(out).toBe('Success! The configuration is valid.')
    },
  },
  {
    name: 'show -json - machine output is not reshaped',
    cmd: 'terraform',
    args: ['show', '-json'],
    input: JSON.stringify(
      { format_version: '1.0', values: { root_module: { resources: Array.from({ length: 30 }, (_, i) => ({ address: `aws_s3_bucket.b${i}` })) } } },
      null,
      2,
    ) + '\n',
    assert: (out) => {
      expect(() => JSON.parse(out)).not.toThrow()
      expect(JSON.parse(out).values.root_module.resources).toHaveLength(30)
    },
  },
  {
    name: 'output - unrecognised shape passes through rather than being summarised',
    cmd: 'terraform',
    args: ['output'],
    input: 'bucket_name = "my-prod-bucket"\nregion = "eu-west-1"\n',
    assert: (out) => {
      expect(out).toBe('bucket_name = "my-prod-bucket"\nregion = "eu-west-1"')
    },
  },
])

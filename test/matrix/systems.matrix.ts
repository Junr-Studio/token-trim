import type { MatrixEntry } from '../support/matrix.js'

// Coverage matrix - "systems" group: the compiled-language build and lint
// toolchain (cargo, go, make, mvn, gradle, dotnet, golangci-lint).
//
// What these commands have in common is that almost none of their output is the
// answer. A rustc error is 8-14 lines of which 10+ are a caret block redrawing
// source the agent can already read; a Maven build is ~40 [INFO] lines of plugin
// bookkeeping wrapped around two compile errors; a Gradle build is a task list.
// Every fixture below is raw stdout in the shape the real tool prints it, and
// every floor is measured (see the notes on each entry), set a few points under
// the measurement so an unrelated tweak does not turn this file red.

// ── cargo ─────────────────────────────────────────────────────────────────────

// `cargo build` on a crate with three hard errors and two warnings. This is the
// headline case for the group: five diagnostics, each carrying a gutter of
// "   |" rules, the echoed source line, "^^^^" underlines and help/note art -
// all of it a terminal affordance whose every fact (file, line, column, code,
// message, lint name) is already on the first two lines.
const CARGO_BUILD_ERRORS = `    Updating crates.io index
 Downloading crates ...
  Downloaded thiserror v1.0.61
  Downloaded serde_json v1.0.117
   Compiling proc-macro2 v1.0.86
   Compiling unicode-ident v1.0.12
   Compiling serde v1.0.203
   Compiling serde_json v1.0.117
   Compiling thiserror v1.0.61
   Compiling order-api v0.4.0 (/home/dev/order-api)
error[E0308]: mismatched types
  --> src/config.rs:42:18
   |
42 |     let port: u16 = settings.port;
   |               ---   ^^^^^^^^^^^^^ expected \`u16\`, found \`u32\`
   |               |
   |               expected due to this
   |
help: you can convert a \`u32\` to a \`u16\` and panic if the converted value doesn't fit
   |
42 |     let port: u16 = settings.port.try_into().unwrap();
   |                                  ++++++++++++++++++++

error[E0425]: cannot find value \`retry_budget\` in this scope
   --> src/client.rs:118:9
    |
118 |         retry_budget -= 1;
    |         ^^^^^^^^^^^^ help: a local variable with a similar name exists: \`retry_budgets\`
    |

error[E0599]: no method named \`into_bytes\` found for struct \`Response\` in the current scope
   --> src/client.rs:203:26
    |
203 |         let body = resp.into_bytes();
    |                         ^^^^^^^^^^ method not found in \`Response\`
    |
note: the method \`into_bytes\` exists on \`String\`
   --> /rustc/9b00956e5b6bd2e2a4d4d34e4b4d3f0b/library/alloc/src/string.rs:1046:5

warning: unused variable: \`timeout\`
  --> src/client.rs:87:9
   |
87 |     let timeout = Duration::from_secs(30);
   |         ^^^^^^^ help: if this is intentional, prefix it with an underscore: \`_timeout\`
   |
   = note: \`#[warn(unused_variables)]\` on by default

warning: field \`legacy_mode\` is never read
  --> src/config.rs:15:5
   |
14 | pub struct Settings {
   |            -------- field in this struct
15 |     legacy_mode: bool,
   |     ^^^^^^^^^^^
   |
   = note: \`#[warn(dead_code)]\` on by default

error: aborting due to 3 previous errors; 2 warnings emitted

Some errors have detailed explanations: E0308, E0425, E0599.
For more information about an error, try \`rustc --explain E0308\`.
error: could not compile \`order-api\` (bin "order-api") due to 3 previous errors; 2 warnings emitted
`

// `cargo test` on a 31-test lib target with three failures. The 28 passing
// lines are pure ceremony once the summary line exists; the panic bodies are
// the only part an agent acts on.
const CARGO_TEST_FAILURES = `   Compiling order-api v0.4.0 (/home/dev/order-api)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 4.21s
     Running unittests src/lib.rs (target/debug/deps/order_api-3f0d1c9a4b2e77aa)

running 31 tests
test client::tests::builds_default_headers ... ok
test client::tests::honours_base_url ... ok
test client::tests::propagates_trace_id ... ok
test client::tests::retries_on_503 ... FAILED
test client::tests::times_out_after_deadline ... ok
test codec::tests::decodes_empty_body ... ok
test codec::tests::rejects_unknown_version ... ok
test codec::tests::roundtrip_envelope ... FAILED
test codec::tests::skips_padding ... ok
test config::tests::applies_env_overrides ... ok
test config::tests::parses_defaults ... ok
test config::tests::rejects_bad_port ... FAILED
test config::tests::reads_from_toml ... ok
test ledger::tests::applies_credit ... ok
test ledger::tests::applies_debit ... ok
test ledger::tests::balances_after_replay ... ok
test ledger::tests::rejects_negative_amount ... ok
test ledger::tests::snapshot_is_stable ... ok
test store::tests::inserts_row ... ok
test store::tests::migrates_from_v1 ... ok
test store::tests::reconnects_after_drop ... ok
test store::tests::rolls_back_on_error ... ok
test store::tests::selects_by_status ... ok
test util::tests::clamps_range ... ok
test util::tests::formats_duration ... ok
test util::tests::parses_iso8601 ... ok
test util::tests::rounds_half_even ... ok
test util::tests::splits_on_comma ... ok
test util::tests::trims_whitespace ... ok
test util::tests::truncates_utf8 ... ok
test util::tests::wraps_long_lines ... ok

failures:

---- client::tests::retries_on_503 stdout ----
thread 'client::tests::retries_on_503' panicked at src/client.rs:341:5:
assertion failed: attempts >= 3
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

---- codec::tests::roundtrip_envelope stdout ----
thread 'codec::tests::roundtrip_envelope' panicked at src/codec.rs:88:9:
assertion \`left == right\` failed
  left: 12
 right: 0

---- config::tests::rejects_bad_port stdout ----
thread 'config::tests::rejects_bad_port' panicked at src/config.rs:212:9:
assertion \`left == right\` failed
  left: Ok(Settings { port: 70000 })
 right: Err(PortOutOfRange)

failures:
    client::tests::retries_on_503
    codec::tests::roundtrip_envelope
    config::tests::rejects_bad_port

test result: FAILED. 28 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.84s

error: test failed, to rerun pass \`--lib\`
`

// ── go ────────────────────────────────────────────────────────────────────────

// `go test ./...` across a 20-package module with one failing package. Without
// -v the passing packages print one \`ok\` line each and the failing one prints
// its t.Errorf bodies; the bodies are what the agent needs.
//
// The two go fixtures below are the SAME module, twice: the same 20 packages in
// the same package-path order (which is the order the go command reports them
// in), 15 with tests and 5 without. A failing run does not stop the other
// packages from reporting, and it does not make the "[no test files]" rows
// disappear - so the failing fixture carries them too, and the only difference
// between the two is that internal/codec fails. The bare trailing `FAIL` is the
// go command's own; the one above `FAIL\tinternal/codec` is the test binary's.
const GO_TEST_FAILURES = `ok  \tgithub.com/acme/ledger/cmd/ledgerd\t0.183s
ok  \tgithub.com/acme/ledger/internal/auth\t0.412s
?   \tgithub.com/acme/ledger/internal/build\t[no test files]
ok  \tgithub.com/acme/ledger/internal/cache\t0.028s
--- FAIL: TestDecodeEnvelope (0.00s)
    codec_test.go:88: decode mismatch:
        expected: {ID:42 Kind:order Version:2}
        actual  : {ID:0 Kind: Version:0}
    codec_test.go:91: 12 trailing bytes remained after decode
--- FAIL: TestEncodeRoundTrip/large_payload (0.02s)
    codec_test.go:143: checksum drift after 4096 bytes: want 0x8f2a11bc, got 0x8f2a11bd
    codec_test.go:147: re-encode produced 4104 bytes, want 4096
FAIL
FAIL\tgithub.com/acme/ledger/internal/codec\t0.061s
ok  \tgithub.com/acme/ledger/internal/config\t0.019s
?   \tgithub.com/acme/ledger/internal/genmock\t[no test files]
ok  \tgithub.com/acme/ledger/internal/httpx\t0.234s
ok  \tgithub.com/acme/ledger/internal/metrics\t0.011s
?   \tgithub.com/acme/ledger/internal/pbgen\t[no test files]
ok  \tgithub.com/acme/ledger/internal/queue\t1.402s
ok  \tgithub.com/acme/ledger/internal/store\t2.881s
?   \tgithub.com/acme/ledger/internal/testutil\t[no test files]
ok  \tgithub.com/acme/ledger/pkg/account\t0.044s
ok  \tgithub.com/acme/ledger/pkg/amount\t0.009s
?   \tgithub.com/acme/ledger/pkg/apiv1\t[no test files]
ok  \tgithub.com/acme/ledger/pkg/clock\t0.005s
ok  \tgithub.com/acme/ledger/pkg/journal\t0.318s
ok  \tgithub.com/acme/ledger/pkg/posting\t0.076s
ok  \tgithub.com/acme/ledger/pkg/schema\t0.052s
FAIL
`

// The same command on a green tree. Nothing here is a failure report, so the
// only compressible material is the "[no test files]" lines - packages that
// exist but have no tests, which an agent never acts on.
const GO_TEST_GREEN = `ok  \tgithub.com/acme/ledger/cmd/ledgerd\t0.183s
ok  \tgithub.com/acme/ledger/internal/auth\t0.412s
?   \tgithub.com/acme/ledger/internal/build\t[no test files]
ok  \tgithub.com/acme/ledger/internal/cache\t(cached)
ok  \tgithub.com/acme/ledger/internal/codec\t0.061s
ok  \tgithub.com/acme/ledger/internal/config\t0.019s
?   \tgithub.com/acme/ledger/internal/genmock\t[no test files]
ok  \tgithub.com/acme/ledger/internal/httpx\t0.234s
ok  \tgithub.com/acme/ledger/internal/metrics\t(cached)
?   \tgithub.com/acme/ledger/internal/pbgen\t[no test files]
ok  \tgithub.com/acme/ledger/internal/queue\t1.402s
ok  \tgithub.com/acme/ledger/internal/store\t2.881s
?   \tgithub.com/acme/ledger/internal/testutil\t[no test files]
ok  \tgithub.com/acme/ledger/pkg/account\t0.044s
ok  \tgithub.com/acme/ledger/pkg/amount\t(cached)
?   \tgithub.com/acme/ledger/pkg/apiv1\t[no test files]
ok  \tgithub.com/acme/ledger/pkg/clock\t0.005s
ok  \tgithub.com/acme/ledger/pkg/journal\t0.318s
ok  \tgithub.com/acme/ledger/pkg/posting\t0.076s
ok  \tgithub.com/acme/ledger/pkg/schema\t0.052s
`

// ── make ──────────────────────────────────────────────────────────────────────

// A recursive `make -j8` over six subdirectories. Every sub-make brackets its
// real work with an Entering/Leaving pair, and the pretty-print recipes echo
// their own banner line before printing it.
const MAKE_RECURSIVE = `make -C src all
make[1]: Entering directory '/home/dev/hydra/src'
cc -std=c11 -O2 -g -Wall -Wextra -Iinclude -MMD -c -o obj/main.o main.c
cc -std=c11 -O2 -g -Wall -Wextra -Iinclude -MMD -c -o obj/lexer.o lexer.c
cc -std=c11 -O2 -g -Wall -Wextra -Iinclude -MMD -c -o obj/parser.o parser.c
cc -std=c11 -O2 -g -Wall -Wextra -Iinclude -MMD -c -o obj/emit.o emit.c
ar rcs libhydra.a obj/main.o obj/lexer.o obj/parser.o obj/emit.o
make[1]: Leaving directory '/home/dev/hydra/src'
make -C plugins all
make[1]: Entering directory '/home/dev/hydra/plugins'
echo "  BUILD   plugins/json"
  BUILD   plugins/json
cc -std=c11 -O2 -g -Wall -fPIC -shared -o json.so json.c
echo "  BUILD   plugins/yaml"
  BUILD   plugins/yaml
cc -std=c11 -O2 -g -Wall -fPIC -shared -o yaml.so yaml.c
echo "  BUILD   plugins/toml"
  BUILD   plugins/toml
cc -std=c11 -O2 -g -Wall -fPIC -shared -o toml.so toml.c
make[1]: Leaving directory '/home/dev/hydra/plugins'
make -C tools all
make[1]: Entering directory '/home/dev/hydra/tools'
cc -std=c11 -O2 -g -Wall -I../include -o hydrafmt hydrafmt.c ../src/libhydra.a
cc -std=c11 -O2 -g -Wall -I../include -o hydradump hydradump.c ../src/libhydra.a
make[1]: Leaving directory '/home/dev/hydra/tools'
make -C tests all
make[1]: Entering directory '/home/dev/hydra/tests'
cc -std=c11 -O2 -g -Wall -I../include -c -o test_lexer.o test_lexer.c
../include/hydra/lexer.h:88:5: warning: 'hydra_lex_reset' declared but never defined [-Wunused-function]
cc -std=c11 -O2 -g -Wall -I../include -c -o test_parser.o test_parser.c
cc -std=c11 -O2 -g -Wall -I../include -o run_tests test_lexer.o test_parser.o ../src/libhydra.a
make[1]: Leaving directory '/home/dev/hydra/tests'
make -C docs all
make[1]: Entering directory '/home/dev/hydra/docs'
echo "  DOC     manual.1"
  DOC     manual.1
pandoc -s -t man manual.md -o manual.1
make[1]: Leaving directory '/home/dev/hydra/docs'
make -C dist all
make[1]: Entering directory '/home/dev/hydra/dist'
tar czf hydra-1.8.0.tar.gz ../src/libhydra.a ../tools/hydrafmt ../tools/hydradump
make[1]: Leaving directory '/home/dev/hydra/dist'
`

// ── mvn ───────────────────────────────────────────────────────────────────────

// `mvn -B clean verify` that fails to compile. Maven narrates every plugin
// execution at [INFO]; the two facts worth carrying are the BUILD result and
// the [ERROR] block.
const MVN_BUILD_FAILURE = `[INFO] Scanning for projects...
[INFO]
[INFO] --------------------< com.acme:order-service >--------------------
[INFO] Building order-service 1.4.0
[INFO]   from pom.xml
[INFO] --------------------------------[ jar ]---------------------------------
[INFO]
[INFO] --- clean:3.2.0:clean (default-clean) @ order-service ---
[INFO] Deleting /home/dev/order-service/target
[INFO]
[INFO] --- jacoco:0.8.11:prepare-agent (default) @ order-service ---
[INFO] argLine set to -javaagent:/home/dev/.m2/repository/org/jacoco/org.jacoco.agent/0.8.11/org.jacoco.agent-0.8.11-runtime.jar
[INFO]
[INFO] --- resources:3.3.1:resources (default-resources) @ order-service ---
[INFO] Copying 3 resources from src/main/resources to target/classes
[INFO]
[INFO] --- compiler:3.13.0:compile (default-compile) @ order-service ---
[INFO] Recompiling the module because of changed source code.
[INFO] Compiling 47 source files with javac [debug release 21] to target/classes
[WARNING] /home/dev/order-service/src/main/java/com/acme/order/OrderMapper.java:[88,31] unchecked cast to type java.util.List<com.acme.order.Line>
[WARNING] /home/dev/order-service/src/main/java/com/acme/order/LegacyCodec.java:[24,9] deprecated item is not annotated with @Deprecated
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] /home/dev/order-service/src/main/java/com/acme/order/OrderService.java:[142,37] cannot find symbol
  symbol:   method findByStatus(com.acme.order.Status)
  location: variable repo of type com.acme.order.OrderRepository
[ERROR] /home/dev/order-service/src/main/java/com/acme/order/OrderService.java:[188,9] incompatible types: java.util.Optional<com.acme.order.Order> cannot be converted to com.acme.order.Order
[INFO] 2 errors
[INFO] -------------------------------------------------------------
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  12.482 s
[INFO] Finished at: 2026-03-11T09:41:07+01:00
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile (default-compile) on project order-service: Compilation failure: Compilation failure:
[ERROR] /home/dev/order-service/src/main/java/com/acme/order/OrderService.java:[142,37] cannot find symbol
[ERROR]   symbol:   method findByStatus(com.acme.order.Status)
[ERROR]   location: variable repo of type com.acme.order.OrderRepository
[ERROR] /home/dev/order-service/src/main/java/com/acme/order/OrderService.java:[188,9] incompatible types: java.util.Optional<com.acme.order.Order> cannot be converted to com.acme.order.Order
[ERROR] -> [Help 1]
[ERROR]
[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.
[ERROR] Re-run Maven using the -X switch to enable full debug logging.
[ERROR]
[ERROR] For more information about the errors and possible solutions, please read the following articles:
[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException
`

// ── gradle ────────────────────────────────────────────────────────────────────

// `gradle build` on a Kotlin multi-project that fails to compile. The task list
// is the bulk of it and carries no information once BUILD FAILED is known; the
// "* Try:" / "* Get more help" epilogue is identical on every run.
const GRADLE_BUILD_FAILED = `Starting a Gradle Daemon (subsequent builds will be faster)

> Configure project :app
Detected Kotlin Gradle Plugin 2.0.0

> Task :buildSrc:checkKotlinGradlePluginConfigurationErrors
> Task :buildSrc:compileKotlin UP-TO-DATE
> Task :buildSrc:compileJava NO-SOURCE
> Task :buildSrc:jar UP-TO-DATE
> Task :core:processResources UP-TO-DATE
> Task :core:compileKotlin
w: file:///home/dev/ledger/core/src/main/kotlin/com/acme/core/Cache.kt:31:13 Variable 'stale' is never used
> Task :core:compileJava NO-SOURCE
> Task :core:classes
> Task :core:jar
> Task :app:processResources UP-TO-DATE
> Task :app:compileKotlin FAILED
e: file:///home/dev/ledger/app/src/main/kotlin/com/acme/app/OrderRepo.kt:41:23 Unresolved reference: findByStatus
e: file:///home/dev/ledger/app/src/main/kotlin/com/acme/app/OrderRepo.kt:57:9 Type mismatch: inferred type is Optional<Order> but Order was expected
e: file:///home/dev/ledger/app/src/main/kotlin/com/acme/app/Wiring.kt:18:35 None of the following functions can be called with the arguments supplied

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:compileKotlin'.
> Compilation error. See log for more details

* Try:
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.

* Get more help at https://help.gradle.org

BUILD FAILED in 24s
9 actionable tasks: 6 executed, 3 up-to-date
`

// ── dotnet ────────────────────────────────────────────────────────────────────

// `dotnet build` on a solution where one project fails. MSBuild prints every
// diagnostic twice - once inline as it compiles, once again in the summary -
// and pads each with the absolute path of the .csproj that owns it.
const DOTNET_BUILD_FAILED = `MSBuild version 17.9.8+b34f75857 for .NET
  Determining projects to restore...
  All projects are up-to-date for restore.
  Acme.Contracts -> /home/dev/acme/src/Acme.Contracts/bin/Debug/net8.0/Acme.Contracts.dll
  Acme.Core -> /home/dev/acme/src/Acme.Core/bin/Debug/net8.0/Acme.Core.dll
/home/dev/acme/src/Acme.Api/Services/OrderService.cs(88,29): error CS1061: 'IOrderRepository' does not contain a definition for 'FindByStatus' and no accessible extension method 'FindByStatus' accepting a first argument of type 'IOrderRepository' could be found (are you missing a using directive or an assembly reference?) [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Services/OrderService.cs(142,17): error CS0029: Cannot implicitly convert type 'System.Threading.Tasks.Task<Acme.Core.Order>' to 'Acme.Core.Order' [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Program.cs(31,9): warning CS8618: Non-nullable property 'Clock' must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring the property as nullable. [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Startup.cs(12,13): warning CS0618: 'LegacyCodec.Encode(string)' is obsolete: 'Use Codec.Encode instead' [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]

Build FAILED.

/home/dev/acme/src/Acme.Api/Program.cs(31,9): warning CS8618: Non-nullable property 'Clock' must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring the property as nullable. [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Startup.cs(12,13): warning CS0618: 'LegacyCodec.Encode(string)' is obsolete: 'Use Codec.Encode instead' [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Services/OrderService.cs(88,29): error CS1061: 'IOrderRepository' does not contain a definition for 'FindByStatus' and no accessible extension method 'FindByStatus' accepting a first argument of type 'IOrderRepository' could be found (are you missing a using directive or an assembly reference?) [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
/home/dev/acme/src/Acme.Api/Services/OrderService.cs(142,17): error CS0029: Cannot implicitly convert type 'System.Threading.Tasks.Task<Acme.Core.Order>' to 'Acme.Core.Order' [/home/dev/acme/src/Acme.Api/Acme.Api.csproj]
    2 Warning(s)
    2 Error(s)

Time Elapsed 00:00:04.91
`

// ── golangci-lint ─────────────────────────────────────────────────────────────

// `golangci-lint run ./...` in its DEFAULT text format:
//   path/file.go:LINE:COL: message (linter)
// with the linter name in trailing parentheses, which is how the real tool
// prints it. 14 issues across 6 files.
const GOLANGCI_REPORT = `internal/store/postgres.go:88:2: ineffectual assignment to err (ineffassign)
internal/store/postgres.go:141:6: func \`scanRows\` is unused (unused)
internal/store/postgres.go:203:14: Error return value of \`rows.Close\` is not checked (errcheck)
internal/api/handler.go:52:2: SA4006: this value of \`ctx\` is never used (staticcheck)
internal/api/handler.go:77:11: Error return value of \`w.Write\` is not checked (errcheck)
internal/api/handler.go:118:23: printf: non-constant format string in call to fmt.Errorf (govet)
internal/api/middleware.go:29:5: G404: Use of weak random number generator (math/rand instead of crypto/rand) (gosec)
internal/api/middleware.go:63:1: exported: exported function NewLimiter should have comment or be unexported (revive)
cmd/ledgerd/main.go:34:9: Error return value of \`srv.Shutdown\` is not checked (errcheck)
cmd/ledgerd/main.go:61:2: singleCaseSwitch: should rewrite switch statement to if statement (gocritic)
pkg/codec/envelope.go:19:13: ST1003: struct field Id should be ID (stylecheck)
pkg/codec/envelope.go:88:2: S1021: should merge variable declaration with assignment on next line (gosimple)
pkg/codec/envelope.go:150:6: type \`envHeader\` is unused (unused)
pkg/ledger/account.go:44:2: cyclomatic complexity 21 of func \`Apply\` is high (> 15) (gocyclo)
`

export const SYSTEMS_MATRIX: MatrixEntry[] = [
  {
    cmd: 'cargo',
    args: ['build'],
    what: 'failed build - 5 rustc diagnostics, each an 8-14 line caret block',
    input: CARGO_BUILD_ERRORS,
    // Measured 68% (2184 -> 693 chars): the Compiling/Downloaded status lines
    // go, and every diagnostic collapses to "file:line:col: error[CODE]: msg",
    // keeping the lint name that only appears inside the block.
    minReduction: 60,
  },
  {
    cmd: 'cargo',
    args: ['test'],
    what: '31-test lib target with 3 failing tests and their panic bodies',
    input: CARGO_TEST_FAILURES,
    // Measured 71% (2507 -> 727 chars): 28 "... ok" lines and the run banner
    // collapse into one summary line plus the three panic bodies.
    minReduction: 62,
  },
  {
    cmd: 'go',
    args: ['test', './...'],
    what: '20-package module, one package failing with t.Errorf detail',
    input: GO_TEST_FAILURES,
    // Was 92% (1462 -> 112) and that number was a bug wearing a good figure:
    // only the two "--- FAIL:" headers survived, every t.Errorf body was
    // dropped, and the summary read "0 passed" because plain `go test` never
    // prints the "--- PASS:" lines the condenser counted.
    //
    // Now 75% (1462 -> 371): the passing packages are counted as packages, and
    // each failure carries the assertion under it - which is the whole reason
    // the agent is reading a failing test run. Seventeen points of compression
    // bought a correct count and a usable diagnosis.
    minReduction: 68,
  },
  {
    cmd: 'go',
    args: ['test', './...'],
    what: 'green run over 20 packages, 5 of them with no test files',
    input: GO_TEST_GREEN,
    // Measured 29% (1028 -> 732 chars) - only the "[no test files]" rows are
    // droppable; the ok/cached rows are the answer and stay verbatim.
    minReduction: 22,
  },
  {
    cmd: 'make',
    args: ['-j8'],
    what: 'recursive build over 6 subdirectories with pretty-print echo recipes',
    input: MAKE_RECURSIVE,
    // Measured 35% (2078 -> 1347 chars): 12 Entering/Leaving lines and the 4
    // self-describing "echo" recipe lines. The compiler command lines stay -
    // they are the only record of which flags a translation unit was built with.
    minReduction: 28,
  },
  {
    cmd: 'mvn',
    args: ['-B', 'clean', 'verify'],
    what: 'clean verify that fails to compile, with the full [ERROR] epilogue',
    input: MVN_BUILD_FAILURE,
    // Measured 70% (3239 -> 985 chars): ~30 [INFO] plugin-bookkeeping lines
    // vanish, BUILD FAILURE plus the first 10 [ERROR] lines survive. The
    // "15 error(s)" it prints counts [ERROR]-prefixed LINES, not errors - see
    // the group notes.
    minReduction: 62,
  },
  {
    cmd: 'gradle',
    args: ['build'],
    what: 'Kotlin multi-project build failing to compile, full task list',
    input: GRADLE_BUILD_FAILED,
    // Measured 64% (1460 -> 525 chars): the task list, the FAILURE prose and
    // the "* Try:" epilogue go; BUILD FAILED, the failed task and the e:/w:
    // compiler lines stay.
    minReduction: 56,
  },
  {
    cmd: 'dotnet',
    args: ['build'],
    what: 'solution build where one project fails, MSBuild double-reporting',
    input: DOTNET_BUILD_FAILED,
    // Measured 61% (2445 -> 953 chars). MSBuild prints each diagnostic twice
    // and the condenser keeps and counts both copies, so 2 distinct errors are
    // reported as "4 error(s)" - see the group notes.
    minReduction: 52,
  },
  {
    cmd: 'golangci-lint',
    args: ['run', './...'],
    what: 'default-format report, 14 issues across 6 files',
    input: GOLANGCI_REPORT,
    // Measured 92% (1289 -> 108 chars) - a whole report becomes one grouped
    // summary line. The floor is deliberately far below the measurement: the
    // condenser currently parses only 7 of the 14 lines (see the group notes),
    // and a fix that counts all 14 still lands around 89%.
    minReduction: 80,
  },
]

# TanStack Oracles

Oracle-based testing for TypeScript: state a law, generate the histories where
it matters, and check production against an independent model.

This package is under construction while it is extracted from TanStack DB's
oracle suite. It is not published to npm yet; previews are published from
every commit with [pkg.pr.new](https://pkg.pr.new).

## Packages

To try it, paste the prompt in
[`packages/oracles/README.md`](packages/oracles/README.md) into your coding
agent.

- `packages/oracles` (`@tanstack/oracles`): the oracle framework, its skills
  and docs, and the `oracle-gaps` CLI. The CLI lists the production behavior that a
  project's owning oracles leave unexercised or unjudged. A project runs it as
  `oracle-gaps --package <dir> --source <src/x.ts,...>`, with
  `--env-prefix` set to the prefix that the project passes to
  `configureOracles`. `--config <file>`, relative to `--package`, selects the
  Vitest config; without it, the run loads the config that Vitest discovers,
  in the package's directory or else the nearest parent directory that has
  one, and the baseline output names the config it loaded. Each run writes its report to
  a directory of its own in the OS temp directory (or to `--out`), and
  prints its path. The daemon's state and the one-file bundles of workspace
  dependencies are in the OS temp directory too, keyed by the package, which
  the OS cleans: a state that is gone is a cold start. A run leaves nothing
  in the repository. While it runs, its capture setup and Vitest configs
  are in `<dir>/.oracle-gaps-<pid>/`, which it removes when it ends, and its
  copies of the test files exist only in memory, so a Vitest run started
  during a check finds none of them. A run that is killed before it cleans
  up leaves that directory, and the next run removes it.

  While one copy of a test file runs for 30 s or more, the CLI prints
  `oracle-gaps: busy <mutant id> in <test file> for <n>s` every 30 s. A run of many fast
  copies prints none, and a check through `--daemon` prints its heartbeats
  only when the check ends. The runs that confirm a mutant's cut-off copies
  share one budget: the larger of `--mutant-limit` (30 s by default) and ten
  times the owner files' unmutated time. They run in the owner files'
  order, each with at most what its mutant's earlier confirmations left. A
  mutant whose confirmations pass the budget is a `timeout` gap. With the
  default limits one owner's confirmation always fits; the budget binds
  when several owners need long confirmations, or when `--hang-limit` is
  above it, which the run notes. To give one copy more time with
  `--hang-limit`, raise `--mutant-limit` too.

  The report, on stdout and in `summary.md`, leads with the baseline: each
  test file's result with its test counts (ordinary files too), and for a
  failing file its failing test, its error, the law and counterexample of a
  law violation, and a `replay:` command. An oracle file that fails with no
  mutant active blocks only the mutants it owns: each that no passing owner
  kills is a `blocked` gap, a `blocked` line names the file and its failing
  test, the rest are judged, and the report says it is provisional. With
  `--only <id,...>`, the baseline runs only the owners of the selected
  mutants. A `crashed` gap is not a kill: production threw where no law
  judged it, and the error is on the gap's Detail line in `summary.md` and
  in its `detail` in `results.json`. Record the error in the driver, and
  state the law that decides that input's outcome.

  A survivor that changed no observation but made a test do more work is
  `extra-work`: the mutant deleted a shortcut that exists only for speed,
  such as an early return or an assignment in place of a slower call. A
  test's work is the number of site evaluations that its instrumented
  production code makes (calls, comparisons, `if`s, and each pass of a
  loop's condition), a deterministic count, never a time. Only a test on a
  route that `oracleProperty` registers for production (a fixed seed, a
  fixed history, a case, or the random campaign) judges work, since only
  such a test can carry a bound. A test whose work varied between the two
  unmutated runs, or whose count could follow the clock, as a polling or a
  deadline loop's does, does not judge work, so a work-bound kill
  replays on an idle machine. A count can follow the clock when the test,
  its driver, or production makes a real timer or interval (through the
  globals, `node:timers`, or `node:timers/promises`), reads a clock
  (`Date.now()`, `new Date()`, `performance.now()`, `process.hrtime`), or
  holds I/O open. A wait of one turn (`setImmediate`) reads no clock. Reads
  that the test runner, fast-check, or the oracle framework makes do not
  count, and neither do reads under a fake clock. The gap's directive names the first such
  test, its work before and after, and the bound that rejects the mutant.
  Declare it on the owning property, for example
  `oracleProperty({ ..., work: { ratio: 1.1 } })`: a mutant whose work in
  one of the property's tests is more than `ratio` times the unmodified
  code's work there is killed under law `work bound`. `ratio` is a finite
  number of at least 1, read to the hundredth and compared exactly, and 1
  rejects any extra work. The bound is the property's, so it judges every
  test the property registers, though the directive names one of them. A plain Vitest run has
  no unmodified run to compare with, so there the bound judges nothing. The
  count does not see work without a site, such as a plain assignment, a
  `for...of` pass, or a builtin's own work, so a call to a builtin counts
  once, whatever it costs. Probe code is never work: a site in probe-only
  code (the probe guard, a probe statement, or a probe helper) counts
  nothing, so a mutant that only enters probe code does no extra work. Where a shortcut's cost is in such a builtin
  (`Object.defineProperty` and the like), make that cost an explicit
  observation of the driver, such as a count of those calls, and let a law
  judge it, in place of a very tight work bound. Work is counted per test, not per history: a
  test that runs many histories, such as a `generated` unit, is judged by
  their sum, so a slowdown in a few of its histories is diluted, and a
  constructed or fixed history isolates it. An authored mutant's copy is
  not instrumented, so a work bound does not judge it.

  Every line the CLI writes for a check, on stdout and stderr alike, starts
  with `oracle-gaps: ` and its kind, so an agent can act on the results as
  they stream with `grep '^oracle-gaps: '`, and filter one kind:

  | Kind                                     | Line                                                                                                                                                                                                                                                        |
  | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `config`                                 | `oracle-gaps: config vitest.config.ts`, or `oracle-gaps: config none, Vitest's default discovery`                                                                                                                                                           |
  | `baseline`                               | `oracle-gaps: baseline pass tests/a.test.ts: 3 tests`, `oracle-gaps: baseline fail tests/b.test.ts: 1 of 2 tests failed`                                                                                                                                    |
  | `baseline` (decisive, before any mutant) | `oracle-gaps: baseline all 4 oracle files pass`, or `oracle-gaps: baseline 1 of 4 oracle files failed (provisional)`                                                                                                                                        |
  | `blocked`                                | `oracle-gaps: blocked <file> fails with no mutant active at <test>, so the mutants it owns wait for it: …`                                                                                                                                                  |
  | `gap`                                    | `oracle-gaps: gap <kind> L<line> <id> <change>`                                                                                                                                                                                                             |
  | `progress`                               | `oracle-gaps: progress judged 25 of 120 mutants: 7 gaps so far, 18 not gaps`                                                                                                                                                                                |
  | `busy`                                   | `oracle-gaps: busy <mutant id or baseline> in <test file> for <n>s`                                                                                                                                                                                         |
  | `note`                                   | `oracle-gaps: note …`: the `--hang-limit` note, Vite's own messages (`note vite: …`), ordinary files left out, the provisional count, unowned counts, the results' path, and where the tests' console output went (`note test output in <path>`)            |
  | `summary`                                | `oracle-gaps: summary <run id>: 120 mutants, 98 killed, 12 gaps, 10 unowned (warnings). …`                                                                                                                                                                  |
  | `legend`                                 | `oracle-gaps: legend <class>: <what it means and what to do>`, once for each class of gap the run found                                                                                                                                                     |
  | `function`                               | `oracle-gaps: function fn <name> (<source>) (owners: <files>)`, the heading over that function's gap lines                                                                                                                                                  |
  | `error`                                  | `oracle-gaps: error <message>: a bug in oracle-gaps, not in your oracle; its stack is in <path>/error.log`, once, before the done line of an internal error                                                                                                 |
  | `done` (last)                            | `oracle-gaps: done completed, 12 gaps, report <path>/summary.md` (`(provisional)` after the count when an oracle file failed), `oracle-gaps: done refused[, report <path>]`, `oracle-gaps: done error, log <path>`, or `oracle-gaps: done stopped (SIGINT)` |

  Only these lines have no prefix: the lines indented under a failing
  baseline file (`failing:`, `law:`, `counterexample:`, `replay:`), a
  refusal's `refused:` and `fix:` block on stderr, `--help`'s usage text,
  and lines that Node, V8, esbuild, or Vite print on the CLI's streams
  (a warning, V8's out-of-memory block, esbuild's error block). The CLI
  writes no blank line of its own. A path in a line, such as the output
  directory, prints a line break or another control character as its
  `\uXXXX` escape, so it cannot end the line. The
  done line is the last line of both stdout and stderr, once each, for
  every ending, and its status matches the exit code. A test's own output
  to the process's stdout and stderr goes to `test-output.log` in the output
  directory, which a note names; `summary.md` holds the report for reading.
  A run through the daemon prints the same lines, at the end of its check.
  `--help` is not a check, so its usage text has no prefix and no done
  line. `--stop-daemon` prints nothing.

  For contributors: the `ORACLE_GAPS_TEST_` environment variables are test-only
  hooks for the CLI's own oracle, not settings for users. Each is inert unless
  set, and none changes an outcome by itself.
  - `ORACLE_GAPS_TEST_HOLD_EXIT_MS` holds the run's exit after its done line.
  - `ORACLE_GAPS_TEST_WARM_PROBE` makes the first config warm-up wait where a
    stop signal can reach it.
  - `ORACLE_GAPS_TEST_STOP` names a file whose appearance makes the CLI take a
    stop as a SIGINT would (the win32 stop, which has no signal to deliver).
  - `ORACLE_GAPS_TEST_PAUSE_AT` names one point at which the CLI blocks, with
    `ORACLE_GAPS_TEST_PAUSE_MARK` naming a file the blocked process writes its
    pid to: `daemon-reply` holds a daemon's reply after the check, and
    `daemon-read` holds its first connection unread, once `ORACLE_GAPS_TEST_PAUSE_ARM`
    names an existing file. The test kills the process by that pid, so no signal
    is needed to pause on win32. Both marks are written whole (a temp file, then
    a rename), and the test parses the pid as a positive integer before it sends
    any signal.
  - `ORACLE_GAPS_TEST_WAIT_MARK` names a file a request writes when its reply has
    not come `ORACLE_GAPS_TEST_WAIT_MS` after it was sent. A request has no
    timeout of its own: this timer starts with the request, and is cleared when
    the request settles, whether it resolves or rejects. The test acts on the
    CLI's wait, not on the clock.
  - `ORACLE_GAPS_TEST_WAIT_MS` (milliseconds, default 60000) is the CLI's wait
    for a daemon to start or to close; a test shortens it to outlast a paused
    daemon. It is a test-only knob, not a setting for users.
  - `ORACLE_GAPS_TEST_SERVED_MARK` names a file the daemon writes its pid to
    after it answers a check, so a test can tell which daemon served an
    earlier check (the warm daemon that a later check's pause must match).
  - `ORACLE_GAPS_TEST_TORN_ROWS` names a directory where each batch's watchdog
    counts its polls, and a batch's closing row is held half written until the
    watchdog has polled twice. The directory holds a `.begun` marker per batch and
    a `.reached` or `.unreached` marker per hold (`.unreached` after 60 s with no
    two polls).

  A few endings print no done line, or one more line: a SIGKILL of the CLI,
  or a signal that comes while Node is still starting the CLI, before its
  first line runs (a few tens of milliseconds), ends it with no done line.
  When the run's own process ends without its ending, by a signal sent to
  it rather than the CLI or by a crash (a V8 out-of-memory abort is a
  SIGABRT), the CLI writes `oracle-gaps: done error, the run's process
exited with <signal or code>` and exits 3; after an out-of-memory crash
  the line says to give Node more memory (`NODE_OPTIONS=--max-old-space-size=<MB>`)
  or to run fewer `--contexts`. An internal error prints one
  `oracle-gaps: error` line with its message, its line breaks escaped,
  and its stack goes to `error.log`. A config's syntax error
  is refused with its first error; a syntax error in a module the config
  imports lets esbuild print its own error block before the refusal.

  Exit codes: 0 the check completed, whatever its gaps (its last line is
  `oracle-gaps: done completed, …`); 2 the run was refused, with `refused:`
  and `fix:` on stderr; 3 an internal error of the CLI; 130 or 143 stopped
  by SIGINT or SIGTERM.

  The check runs in a process group of its own, with every Vitest worker and
  every process that a test starts, except one started detached in a session
  of its own (as some browser drivers are). On SIGINT or SIGTERM the CLI
  signals the whole group, kills what is left 2 s later, and exits 130 or 143.
  A check through the daemon (`--daemon`) runs in the daemon's process; stop
  it with `oracle-gaps --stop-daemon --package <dir>`. On Windows, which has
  no process groups, the run is not supervised.

  A check through the daemon reuses a run while its inputs are unchanged:
  the modules the run loaded, and the files in the package that its tests
  read through `fs` (`readFileSync`, `readFile`, `existsSync`, `statSync`,
  and `fs/promises` `readFile` and `stat`), each by the content that the
  run read. A run that an edit overlapped, because a file changed after the
  run read it, is not reused. A directory that a test stats or tests for is
  an input as a directory, not by its content.

  Two kinds of input are not tracked yet. A Vite plugin whose output depends
  on anything but a module's text, such as a sidecar file that it reads, can
  make the daemon serve a run that read the plugin's old output. And the
  daemon's environment is fixed when it starts, so an environment variable
  that a later check sets does not reach the daemon's runs. After such a
  change, run the check cold (without `--daemon`), or stop the daemon with
  `oracle-gaps --stop-daemon --package <dir>`. The maintainer decided on
  2026-11-13 that the daemon tracks both and restarts when they change; a
  later release does that.

  These reads are no input, so an edit to the file alone does not rerun the
  tests that read it: a read outside the package or under `node_modules`; a
  read from a worker thread or child process that the test starts; and a
  read through any `fs` or `fs/promises` function other than the six above,
  or through one of those six given a file descriptor. That catch-all
  includes, for example, `readdir`, `opendir`, `glob`, `globSync`,
  `createReadStream`, `realpath`, `lstat`, `access`, `open`, `read`,
  `readSync`, `readv`, `fstat`, `fstatSync`, `copyFile`, `copyFileSync`, `cp`,
  `cpSync`, `openAsBlob`, `statfs`, `readlink`, the callback `stat`,
  `exists`, `watch`, and `watchFile`, and the `fs/promises` `readdir`,
  `opendir`, `glob`, `lstat`, `realpath`, `readlink`, `access`, `open`,
  `copyFile`, `cp`, `statfs`, and `watch`. Run the check cold (without
  `--daemon`) after an edit to a file read that way. A later release records
  all of them except `watch` and `watchFile`, which wait for future changes
  and stay no input (maintainer decision, 2026-11-13, with `watchFile` in the
  family of `watch`).

- `packages/eslint-plugin-oracles` (`@tanstack/eslint-plugin-oracles`): the
  `oracle/*` lint rules. The rules recognize the framework by its package
  specifier and by a relative module with its file name. A project names its
  variable prefix and its replay-selection modules in `settings.oracles`.

The `recommended` and `production` configs leave out tool config files: the
configs of ESLint, Vite, and Vitest (`vite.config.ts`, `vitest.unit.config.mjs`)
and any config named for oracles (`*.oracle.config.*`, such as
`eslint.oracle.config.mjs`). A config file is never an oracle file or
production source. A companion oracle module, such as `foo-oracle.ts`, keeps
the oracle rules, and so does a source module named `src/foo.config.ts`.

A config that spreads a preset and sets its own `ignores` replaces the
preset's, so merge them:

```js
{
  ...oracles.configs.production,
  ignores: [...oracles.configs.production.ignores, 'packages/x/src/machinery/**'],
}
```

## Bind calibrations to histories

A calibration's `history` selects an existing input directly:

```ts
calibrations: [
  {
    name: 'drops the committed row',
    law: 'durable publication',
    history: { constructed: 'a committed write' },
    corrupt: dropCommittedRow,
  },
]
```

Generated sources accept `{ constructed: name }` and `{ fixed: name }`.
Enumerated sources accept `{ enumerated: index }` (zero-based) or
`{ enumerated: name }`, using `label` or the framework's default data label.
Unknown or duplicate names, invalid indices, and incompatible source kinds fail
registration before a driver runs.

The selected clean run must pass and actually enter every state the history
declares. When the property declares states, every state the clean run enters
must also be declared. The mutation must apply, and the check must reject it
under exactly the named law. A failed clean run, missing reach, inapplicable corruption,
passing mutant, wrong-law rejection, or driver setup error fails the calibration
directly. It never searches another history.

Mutant drivers use the same verdict rules as ordinary histories. A violation at
a recorded checkpoint decides before a later driver error. A controlled clock
that exceeds its timer bound reports `bounded clock`, unless an earlier recorded
violation already decides.

An optional `difference: string | RegExp` also requires the violation's
difference to contain the text or match the pattern. The law is checked first.
A bound mismatch fails directly. An unbound mutant driver can still try a later
candidate, as it can for a wrong law.

A selected construction uses one deterministic seed derived from the property
id and calibration name. Inserting or reordering other calibrations leaves this
seed unchanged. Each driver execution builds from that seed afresh and resolves
its plan once. This preserves builder-created metadata, including WeakMap
associations, and avoids reusing consumed plans. Fixed and enumerated selectors
preserve the existing history's identity and semantics. Use `resolve` to create a
fresh mutable execution plan from those histories for each driver run. Each
calibration remains on the `calibration` route, so a failed self-check is a
framework error in the gap report. Campaign units now support `UNIT` replay.
Bound calibrations still use their stable name-derived seed; fresh-seed
calibrations and their replay support remain follow-up work.

For automatic forced-probe controls, opt a state into direct selection:

```ts
probeHistories: {
  'committed write': {
    notEntered: { fixed: 'no writes' },
    // Optional: entered: { constructed: 'a committed write' }
  },
}
```

The clean-entered history detects the probe forced not entered. If `entered`
is omitted, exactly one construction must declare the state in `enters`.
The clean-not-entered history detects the probe forced entered and always needs
an explicit selection. Neither control may silently disappear.

During consumer migration, an unbound authored calibration or entirely unbound
probe state retains candidate search. Registration warns once per property per
process, naming its unbound calibrations. Collect-only runs (`ORACLE_MANIFEST`)
stay silent and do not consume that warning. Bind both probe controls together with
`probeHistories`. Search will be removed after consumers migrate, before the
first npm release.

## The `oracle/no-unit-test` rule

An oracle file registers its tests only through `oracleProperty`. Its
histories hold its fixed regressions and enumerated cases, its calibrations
show that the check rejects wrong answers, and its declared states hold its
reach. The rule reports every other test registration in an oracle file as a
unit test, whatever its body calls. Move such a test to an ordinary test file.

A registration is a call of a test function, with members such as `.each`,
`.skip`, or `.concurrent`. A call to an imported helper that registers its
caller's body is a registration too. `oracle/no-unit-test`,
`oracle/no-disabled`, and `oracle/oracle-property-only` share one account of
a test function, so they agree on every call. A callee's root is a test
function when its binding resolves to a test framework's test function or
suite, or to a fixture of one (`test.extend(fixtures)`). Where the binding
comes from decides, not its name alone: see
[Where a test function comes from](#where-a-test-function-comes-from). The
rules follow these bindings:

- a named, default, or namespace import (`vitest.it`), a member of
  `require('<specifier>')`, and an unbound name that a test environment
  declares as a global;
- a variable's initializer, a destructuring (`const { it: t } = vitest`),
  and each plain assignment (`let t; t = it`);
- a cast (`as`, `!`, `satisfies`), and either branch of a conditional or
  logical expression (`flag ? it.skip : it`), so a callee that may be a
  test function is reported;
- a fixture, a tagged-template `.each`, `oracleReplayTest(it)`, and a
  framework's factory call (`mergeTests(a, b)`, uvu's `suite('S')`,
  `jest-each`'s `each(table)`, Lab's `script()`);
- an export of a project's test module (a relative module, a `#` import,
  or a workspace package): a constant, a re-export, `export * as`, a
  default export, and a relay of an imported binding, through star
  exports. A cycle of modules or of variables resolves to nothing, and each
  export is resolved once per lint.

A binding that resolves to anything else is no test function, whatever its
name: a local function named `bench`, a namespace of an ordinary relative
module (`patterns.test(...)`), or Ramda's `test`. A member that is no
registration, such as Playwright's `test.step`, registers nothing, bound or
not. A `describe` or `suite` is exempt by the function that it resolves to,
not by its local name. In a cycle of modules, the answer does not depend on
which binding the lint reads first.

The rules do not recognize these forms:

- a test function passed as a parameter to a local helper
  (`function reg(t) { t('n', fn) }`). `oracle/no-disabled` reports the
  `reg(it)` call instead;
- a call through a package that the rules cannot classify that passes no
  string title before its function (`fixture(fn)`, `fixture(fn, 'n')`),
  because a library's `pMap(xs, fn)` and `effect(fn)` look the same (see
  [Where a test function comes from](#where-a-test-function-comes-from));
- a test function that a body receives as a parameter (`t.test(...)` in
  tap, `it.layer(L)(name, (it) => ...)` in `@effect/vitest`), QUnit's
  `test.if(name, condition, fn)`, Japa's chain after the call
  (`test('n').skip(true)`), and an options object that disables a test
  (`{ skip: true }`);
- a computed member whose name is not a string literal, and a variable that
  a destructuring assignment (not a declaration) writes;
- a modifier call, such as `.skipIf(flag)`, that another module binds and
  exports. A relayed `.skip` is counted at the call.
  A call to an imported helper that registers a test of its own is reported
  too, because that test would appear under the oracle file. An
  `oracleProperty` call whose options are not an object literal with a `check`
  is reported, because the rule cannot see its check.

A test whose body is empty, such as `it('x', () => {})`, `test('x', async
() => {})`, or a skipped placeholder `it.skip('x', () => {})`, checks
nothing. The rule reports it: remove it, or use `it.todo`.

## Where a test function comes from

The rules cannot read a package, and they never read one under
`node_modules`. They classify a binding by its source, in this order:

1. `settings.oracles.testPackages` maps a specifier, or a prefix that ends
   in `*`, to a framework's specifier (`'@playwright/test'`) or to a table
   of its exports and their roles (`{ authTest: 'test', group: 'suite' }`).
   `settings.oracles.nonTestPackages` lists specifiers, or prefixes, whose
   exports are no test functions.
2. The known test frameworks, with their default, named, and namespace
   exports, the modifiers that an export carries (Jest's `xit` is skipped,
   node:test's `only` is focused), and their factories: `vitest`,
   `@vitest/runner`, `vite-plus/test`, `@fast-check/vitest`,
   `@fast-check/jest`, `@fast-check/ava`, `@effect/vitest`,
   `@playwright/test`, `playwright/test`, `@playwright/experimental-ct-*`,
   `@jest/globals`, `jest-each`, `mocha`, `mocha-steps`, `node:test`, `test`
   (node:test as an npm package), `ava`, `tap`, `tape`, `zora`, `brittle`,
   `uvu`, `bun:test`, `@std/testing/bdd`, `jsr:@std/testing...`, `qunit`,
   `@japa/runner`, and `@hapi/lab`. The members that keep a registration
   are each framework's, such as Playwright's `.fail`, Jest's `.failing`,
   node:test's `.expectFailure`, Deno's `.ignore`, and Bun's `.if` and
   `.todoIf`.
3. The known packages that export other functions under these names:
   Ramda, Rambda, remeda, lodash, mitata, `@thi.ng/*`, benny, tinybench,
   `@tensorflow/*`, `step`, chai, `@vitest/expect`, `vitest/*`, Vitest's
   browser packages, `@testing-library/*`, Storybook, Cypress's module API,
   `@wdio/globals`, and iter-tools. Their exports are never reported.
4. A project's own modules: a relative module, a `#` import through the
   nearest package.json's `imports`, and a workspace package, whose
   `node_modules` entry resolves to a real path outside every
   `node_modules` directory (a pnpm, npm, or Yarn workspace link). The rules
   read its `exports` target for the `import` or `default` condition, never
   its `types`, so a fixtures package that re-exports Playwright's `test`,
   or exports `base.extend(...)` or `base.skip`, is followed. A published
   package's `src/` is production, which no rule reads.
5. Any other source is unknown: a package that no setting or table names,
   and that is not a project module. Every import from it, named, default,
   or namespace, under any local name, is a source the rules cannot
   classify. `settings.oracles.unknownSources` decides:
   - `'report'` (the default): a title-shaped call through it, with a
     string or template title first and a function after it as every
     framework's registration has, gets one `unknownTestSource` report from
     `oracle/no-unit-test`, at its import, and no other report. So does a
     call to a relative helper that makes such a call. A call with no title
     before its function, such as `pMap(xs, fn)`, `debounce(fn, 10)`, or
     `effect(fn)`, gets none. The report is owed in an `oracle-` machinery
     file too, where `oracle/no-disabled` alone guards the tests.
   - `'test'`: an export whose name some framework uses for a test function
     (`it`, `test`, `xit`, `skip`, `step`, and the rest) is read as that
     framework's, as the rules read any package's `it`, `test`, `describe`,
     `suite`, and `bench` before 2026-11-12. Any other export is none.

   There is no `'ignore'` mode (maintainer decision, 2026-11-12). A
   configuration that still says `'ignore'` is malformed, and the rules read
   it as `'report'`. To silence a package, list it in
   `settings.oracles.nonTestPackages`.

   A `#` import whose `imports` target is a package (`"#vitest":
"vitest"`) is classified as that package.

An unbound name is a test function when a test environment declares it as
a global: Vitest's `globals`, and Jest's, Mocha's, and Jasmine's (`it`,
`test`, `specify`, `xit`, `fit`, `describe`, `suite`, `context`,
`xdescribe`, `fdescribe`, and the rest), and `Deno.test` and `QUnit.test`.
`module`, `run`, `step`, and `fail` are left out, because other
environments declare them for other things.

A registration's body follows its first argument, a title. Only a
framework whose title is optional takes a function first as the body:
node:test (and the `test` package), tap, tape, brittle, and `Deno.test`
(`test(fn)`, `test(options, fn)`). Elsewhere a function first is no body.
Playwright's `test.skip`, `test.fixme`, `test.fail`, and `test.slow` with
no arguments, a reason only, a boolean condition, or a condition callback
(`test.skip(({ browserName }) => ..., 'reason')`) are annotations, at file,
describe, or test scope: they register nothing, so `oracle/no-unit-test`
reports nothing for them, and `oracle/no-disabled` reports the `skip` and
`fixme` ones, which switch tests off. For Playwright, `test.skip('reason')`
is such an annotation; for other frameworks, `it.skip('name')` with no body
disables nothing.

A setting that the rules cannot use is reported at line 1 as
`malformedSetting`, and it is read as unset, all of it: a
`settings.oracles` that is not an object (`null`, a string, a number, an
array), a `testPackages` that is not an object or that maps a specifier to
anything but a known framework's specifier or a table of `'test'` and
`'suite'` roles (`'constructor'` is no framework), a `nonTestPackages` that
is not an array of strings, and an `unknownSources` that is not `'report'` or
`'test'`. That includes `'ignore'`, which is no mode: its message names
`settings.oracles.nonTestPackages` as the replacement.

```js
{
  settings: {
    oracles: {
      testPackages: {
        'pw-fixtures': '@playwright/test',
        '@acme/legacy-fixtures': { authTest: 'test' },
      },
      nonTestPackages: ['@acme/regex'],
    },
  },
}
```

## Decisions

The decisions that the rules and their oracles cite:

- **2026-11-12, maintainer: recognize test functions precisely.** "agree
  with reversed decision -- false positives are annoying and we should be
  able to be precise". It reverses the coordinator decision of 2026-11-11
  that failed closed on any package's `it`, `test`, `describe`, `suite`, or
  `bench`. The rules classify a binding by its source
  ([Where a test function comes from](#where-a-test-function-comes-from)),
  and `settings.oracles.unknownSources` defaults to `'report'`.
- **2026-11-12, coordinator, under that decision: an unknown source is
  reported by the call's shape, not its name.** A title-shaped call through
  any import of an unknown source gets `unknownTestSource`, whatever its
  local name; a call with no title before its function stays silent.
- **2026-11-12, coordinator: where a registration's body may be is each
  framework's grammar.** A function first is a body only where the
  framework's title is optional (node:test, tap, tape, brittle,
  `Deno.test`). Playwright's `test.skip(condition, description)` and its
  other annotation forms register nothing: `oracle/no-disabled` reports the
  disabling ones and `oracle/no-unit-test` reports nothing, and that is how
  the rules agree on them. This replaces the same day's earlier instruction
  that every rule find a body in any argument position, which made
  `oracle/no-unit-test` report an annotation as a unit test.
- **Maintainer approval of the v21 cleanup plan, 2026-11-12: remove the
  `unknownSources: 'ignore'` mode.** A global ignore mode would let an unknown
  source pass silently. Silence for a package comes only from
  `settings.oracles.nonTestPackages`, an explicit entry that a reviewer can
  read. The modes are `'report'` (the default) and `'test'`. A configuration
  that still says `'ignore'` gets `malformedSetting`, with a message that
  names `nonTestPackages`, and the rules read the setting as unset. They never
  throw.
- **Maintainer approval of the v21 cleanup plan, 2026-11-12: one id for a
  malformed setting, `malformedSetting`.** `oracle/no-unit-test` and `oracle/oracle-property-only`
  report every malformed `settings.oracles` entry under this id, at line 1,
  and read it as unset (or as an empty list). It replaces the id
  `malformedSourceSetting`, and the two rules no longer use separate ids.

The limits that these decisions accept, which the oracles
(`lint.test-source-recognition`, `lint.test-function-agreement`) state:

- **Maintainer approval of the v21 cleanup plan, 2026-11-12: the
  identifier-title limit is accepted as a recorded limit.** An unknown source's call that passes no title before its
  function is silent, whatever it does (`fixture(fn)`). So is one whose title
  is a binding or a call (`it(name, fn)`, `it(String(n), fn)`, and a helper's
  `t(name, fn)` with a parameter `name`), because such a call cannot be told
  apart from `pMap(items, fn)`; only a string or template title makes it
  title-shaped. Name the package in `settings.oracles.testPackages` to have
  it judged. A known framework's registration counts whatever its title
  expression is.
- An unknown source's title-shaped call is reported even when it is no
  test, such as a library's `step('install', fn)`, `module('m', fn)`, or
  Pinia's `defineStore('main', () => ...)`. Name the package in
  `settings.oracles.nonTestPackages`.
- The rules never read a package under `node_modules`, a published
  package's `src/`, a TypeScript `paths` alias, a dynamic `import()`, or a
  nested `exports` condition other than `import` and `default` (such as
  `{ node: { import: ... } }`).
- A test function that a body receives as a parameter, QUnit's
  `test.if(name, condition, fn)`, Japa's chain after the call, and an
  options object that disables a test are not recognized.
- Each lint parses the project modules that an oracle file imports. A
  long-lived ESLint process reuses a parse while the module is unchanged;
  a fresh process, such as an agent's post-edit hook, parses each module
  again (about half a second for a 6000-line module). The lint selection
  helper `resolveImportedTestModule` keeps one session for its process, so
  a long-lived caller sees the paths of its first answers.

## The `oracle/no-oracle-disable` rule

An ESLint directive that would silence an `oracle/*` rule is reported: a
directive whose rule list names an oracle rule, a directive with no rule list
(it silences every rule), and an inline config comment that names an oracle
rule. Rule names may be quoted. The forms are the line, next-line, and block
forms, with or without a `-- description`. Oracle rules cannot be disabled
inline, so the directive is the report.

A report sits on the directive's own line. A directive that names this rule or
has no rule list can hide its own report, and so can a directive under an
earlier block directive. Those reports sit at line 1, column 0 instead.

Residuals the rule cannot close:

- A directive on line 1 that names this rule or has no rule list covers the
  file's start, so no report can sit there.
- In production source, a config comment that turns this rule off
  (`eslint oracle/no-oracle-disable: "off"`) switches the rule off for the file.
  ESLint then runs no rule, and none reports it.
- `noInlineConfig` in the `recommended` config makes ESLint ignore every
  directive of every rule in an oracle file, not only the oracle rules. A
  directive for another rule in an oracle file has no effect.

## The `oracle/oracle-property-only` rule

In an oracle file, a generated-history campaign must run through
`oracleProperty`, whose constructed histories make each declared state's reach
required. The rule reports:

- a raw campaign: `fc.assert` or `fc.check` on a fast-check binding, from
  `fast-check` or `@fast-check/vitest`, and a `.prop` registration of a test
  root;
- an import of `createOracleReach` or `runOracleCampaign`, from any module.

A framework implementation module is exempt.

No configuration exempts any other file.

A non-array `settings.oracles.implementationModules` or `replayWitnessModules` is
reported at line 1 as `malformedSetting`, and it is read as an empty list.

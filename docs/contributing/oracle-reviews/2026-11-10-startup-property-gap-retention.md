# Persisted startup: mutation retention after property conversion

This record supplements [the property conversion evidence](2026-11-10-startup-property-conversion.md).
It checks whether converting the existing startup campaigns to `oracleProperty`
retained their sensitivity to the same selected mutants. It does not change the
accepted law, production implementation, comparison checkpoints, or run budgets.
It is a partial mutation selection, not an exhaustive mutation campaign or a PR
readiness verdict.

## Frozen inputs and comparison

The input manifest was captured at
`29de8a92e3aae74dc4c1c2c2d2d47e6edd44dc86`. Later commits changed HEAD while the
171 recorded source, test, configuration, and installed CLI files remained
byte-identical. The manifest and every comparison are under
`.review-2367/gap-property-after/`. Mutants are compared by their stable `key`,
not their numbered IDs or mutable HEAD.

The originally resolved diff base is
`caa936d5af5332a6eca64335d291ba8e42c8cf37`. During the running PowerSync
retries, a parent-agent fetch also moved `origin/main` to
`858c8f0bf747e80f07d2fd6b10d8050bd0c84f8b`. The CLI had already selected its
mutants, and the recorded checkout inputs and four audited production files
remained unchanged. This record retains the original diff-base scope. The
latest-main merge and its verification are separate evidence.

The production source hashes are:

| Adapter | SHA-256 |
| --- | --- |
| Query | `6bbf1542e6daa38f33315445c5bb0ae3fbbf90d907cd388cb5d13f41c3b37cc5` |
| RxDB | `2dca19cff8bb602b2aa59f46c7635035e49d0f1cda0a2222e1917f6d2eb8aa62` |
| PowerSync | `d945eb99bff416fc9c7ba041a802fa842072e5cf03a71d02dd2ed214610df408` |
| TrailBase | `a0608813edaa2bc966ca6fbdbeb747b9fc6fbd8dd08a9c6edabbfe75288d2cd7` |

Every command retains campaign seed `2367` and the previous selection. Exact
arguments are in the adapter `*-command.json` files. `compare.py` checks the
49 prior operator kills and the complete frozen manifest. The six additional
Query receiving-path kills are reported separately; they cannot compensate
for a lost prior kill. A timeout, native abort, setup error, or instrument
refusal is not a kill.

## Completed results

| Adapter | Report | Prior operator kills retained | Other evidence |
| --- | --- | --- | --- |
| Query | `97f527f64b9c` | 30/30 | Six additional operator kills; two authored controls killed |
| RxDB | `f33d959d659e` | 6/6 | Adapted semantic control killed in a separate report |
| TrailBase | `5d45c4a4288b` | 7/7 | Original semantic control killed |
| PowerSync | `fb2d82759888` | 6/6 | Adapted semantic control killed in `c8444431821b`; one calibration nondeterminism remains open |

The final stable-key comparison retains all 49 prior operator kills, plus the
six additional Query operator kills. The 171 frozen files remained unchanged
through the final process exits. All audit processes have ended and the live
input freeze is released. Query, RxDB, and TrailBase have zero nondeterministic
exclusions. Both PowerSync reports retain the one explicitly open calibration
distinction diagnosed below. Every report has zero other excluded tests.
The Query report has 38 kills, four survivors, and two timeouts.
Its additional receiving-path kills are `M558`, `M559`, `M1376`, `M1377`,
`M1481`, and `M1793`. The remaining Query operator survivors are `M563`,
`M1473`, and `M1794`; `M1468` and `M1469` timed out. Its authored no-op control
survived. TrailBase `M151` survives, as before. These outcomes remain gaps
unless killed or covered by an explicit maintainer allowance for their anchored
gaps; a claim of equivalence or no observed difference does not close them.

The old broad RxDB and PowerSync authored patches no longer apply to the
current source. Their adapted semantic controls are separate inputs and
reports. `does-not-apply` for the old patch is not a kill.

## CLI and runtime failures

The installed CLI/framework is pinned to
`e1fb5048c6d33e958643360d87e168c302e03bd1`. Its installed bytes were not edited.
The first official Query baseline could not load the native SQLite binding.
The parent agent rebuilt the installed `better-sqlite3` 12.11.1 addon under
Node 24.19.0, ABI 137. This installation repair changed no committed package or
lockfile. `native-repair.json` records the native binary hash.

The official Query run then aborted with:

```text
query.ts:M1376: tests/retained-scoped-hydration-oracle.test.ts has no unit and no earlier kill
```

The earlier error reported to the maintainer was the same missing-unit check
at `check.mjs:1550`, with a different active mutant and receiver:

```text
Error: query.ts:M1468: tests/ssr-dehydration-oracle.test.ts has no unit and no earlier kill
```

The original log is `.review-2367/gap-current/original-five.log`; the diagnostic
and accounting record are `diagnostic-five.log` and
`expected-failure-accounting-bug.json` in that directory. A preceding
`test.fails` task had raw state `fail` in its `onTestFinished` callback, but
Vitest subsequently inverted it to `passed`. The capture hook incorrectly
marked that transient state as an early kill and skipped the later copies.
The runner then found no genuine earlier kill to justify their missing units.
The repair excludes `context.task.fails` from the capture hook's early-stop
condition; it does not accept the missing receiver as a product verdict.

The isolated guard copy at
`/private/tmp/tanstack-db-2394-gap-cli-e1fb-guard` excludes expected-failure
tests from the capture hook's early-stop condition and adds diagnostics to the
existing missing-unit exception. The successful Query report uses that copy.
Its clean captures ran 1,278 tests in 125.5s and 121.5s, with zero
nondeterminism. The exact patch and original failure are preserved in
`expected-failure-guard-e1fb.patch` and `query-official-abort/`. This successful
rerun does not alone establish the cause of every earlier missing-unit failure.

Official PowerSync runs reported 62 nondeterministic tests, but a baseline
worker had aborted and omitted tests. Those reports are invalid evidence.
The concrete classifier defect is that `check.mjs` checks retained-file
failures only on the first clean pass, while `baselineOf` can classify absent
second-pass rows as nondeterminism. An independent repeated capture of one
flagged fixed history produced identical observations. The preserved evidence
does not attribute every one of the 62 exclusions to a single cause.

The isolated integrity copy at
`/private/tmp/tanstack-db-2394-gap-cli-e1fb-integrity` retains both clean
captures and refuses failed, aborted, missing, extra, or duplicate capture
rows before the existing observation/hash comparison. It does not relax that
comparison. Eight calibration cases show that it accepts equal complete
captures, preserves genuine differences as nondeterminism, and refuses each
of the tested incomplete or aborted capture forms. Its patch, hashes, and
calibrations are in `baseline-integrity-e1fb.patch`,
`baseline-integrity-cli-manifest.json`, and
`baseline-integrity-calibration.json`.

This integrity guard rejected an actual explicit-forks PowerSync run under
Node 24.19.0. The first clean pass completed all 178 tests. In the second pass,
`persisted-capability-conformance-oracle.test.ts` had zero tests and zero rows
after `[vitest-pool]: Worker forks emitted error`; its first pass had 46 tests
and 47 capture rows, including the background row. The remaining second-pass
owners completed. The native stack reports
`RemoveEnvironmentCleanupHook: Assertion failed: (env) != nullptr` from
`better-sqlite3`'s `Database::~Database`. The log, command, and both captures
are preserved under `powersync-node24.19-integrity-refused*`. Explicit forks
and the addon rebuild therefore did not establish a repair of this native
failure.

The separate adapted-control run under Node 24.19.0 was refused for the same
second-pass capability-worker failure. Its captures and diagnostics are
preserved under `powersync-semantic-control-node24.19-integrity-refused*`.

The retries use the available bundled Node 24.22.1 runtime, also ABI 137, with
explicit forks. The exact executable and PATH are recorded in
`powersync-runtime.json`. Vitest's fork implementation calls
`child_process.fork` without an `execPath` override, so its children inherit
the selected runtime; PATH also starts with that runtime's directory. This
runtime variation is distinct from source equivalence, and a successful retry
would not prove which native lifetime defect caused the older runtime's abort.

Both new-runtime retries completed all 178 tests in both clean passes without
native or setup failures. The main selection took 147.5s and 167.8s; the
adapted-control selection took 167.2s and 239.6s. Both found the same one
observed-hash difference in `calibration: raw judgment rejects wrong
before-source rows`. Eight isolated captures of that exact calibration each
executed one test and produced digest
`7aa71e006ccf3bf32e628aaebaae85608009a2aa`. Changing only its captured raw
`mutationReleasedBeforeFulfillment` from `true` to `false` exactly reproduces
the first clean pass's digest
`7c71b014dec592606b97121dad3cecaab5bb258a`.

The history has no mutation (`fresh`, previous 0, next 0, mutation false).
The production driver initializes that test-local flag before source release
and sets it afterward; fulfillment can occur on either side. The raw checker
consults the flag only when `history.mutation` is true. This diagnostic
distinction has no law judgment for the captured history. It still needs an
explicit projection repair that preserves every mutation-true fact; this
record does not waive the CLI's resulting calibration exclusion.
`powersync-calibration-hash-diagnosis.json` preserves the exact reconstruction.

## Remaining evidence

The no-mutation raw projection needs its reviewed repair, calibrations, and
clean captures with no calibration exclusion. The affected selected mutants
then need a retention run against the integrated inputs. The existing
survivors and timeouts remain gaps unless killed or covered by an anchored
maintainer allowance. Native aborts and CLI refusals supply no product
correctness verdict, and none count toward the 55 retained/additional operator
kills. This evidence predates the latest-main merge and pending test
integrations; it does not claim those later inputs have been audited.

## Test-title identity failure in the immutable conversion audit

The subsequent conversion audit uses detached snapshot
`c4c00b20b6c91549a2b9fe502096d0841520f3fe` at
`/private/tmp/tanstack-db-2394-conversion-audit-4b71d9d`. It includes the reviewed
no-mutation projection repair and the primary Query and TrailBase property
conversions, with the original Query production source. Later Query receiving
paths and its value-fallback repair are a separate delta experiment.

The strict baseline-integrity guard refused its Query run before mutation:

```text
Error: first unmutated pass has incomplete captures for .../tests/documented-mutations-oracle.test.ts: {"missing":[],"extra":[],"duplicates":47}
```

Both clean passes executed 134 documented-history tests. Vitest 5.1.0 defaults
`test.taskTitleValueFormatTruncate` to 40 characters for values interpolated by
`test.each` and `test.for`. Its `formatTitle` implementation truncates string
attributes at that setting. Distinct long `$id` values therefore collapsed
into 87 capture keys. This is a test-identity failure in the gap instrument;
it supplies no product-correctness verdict.

A new isolated copy at
`/private/tmp/tanstack-db-2394-gap-cli-e1fb-titles` sets
`test.taskTitleValueFormatTruncate: 0` in the generated wrapper config. The
Vitest implementation returns the original string when that setting is zero.
The installed CLI and the running PowerSync copy remain untouched. The
original refusal is preserved under `.retention-audit/query-title-refusal*`.

The actual documented-history receiver then passed all 134 tests and recorded
134 distinct full keys. Equal complete captures pass the integrity guard;
adding a duplicate of an actual full-title capture still fails with
`duplicates:1`. The guard remains strict. The first calibration attempt had
an incorrect process working directory and failed to read documentation; that
setup error is preserved and supplies no successful calibration evidence.
The corrected result, source setting, full identities, and deliberate
duplicate rejection are in
`.retention-audit/title-identity-calibration/result.json`. The new CLI's hashes
and exact Query command are captured separately in `query-title-instruments.json`
and `query-command.json`.

## Completed immutable conversion retention

The detached conversion audit at `c4c00b20b6c91549a2b9fe502096d0841520f3fe`
completed with all **55 required operator kills retained by stable key**: the
49 original kills and the six additional Query kills. The seed is 2367.
Every report has zero nondeterministic and zero excluded tests. This result
supersedes the earlier incomplete no-mutation projection comparison; the
historical refusals and their diagnoses above remain part of the record.

| Adapter | Required operator kills | Retained | Run |
| --- | ---: | ---: | --- |
| Query | 36 | 36 | `c6dab6374238` |
| RxDB | 6 | 6 | `d51a3bd1d663` |
| PowerSync | 6 | 6 | `dfe80e3a09f8` |
| TrailBase | 7 | 7 | `311e08b08d09` |

The two required Query authored controls and the TrailBase authored control
also remain killed. The original RxDB and PowerSync authored patches no longer
apply after the validated persistence capability became a named local; that is
not a kill. Their separately adapted semantic controls both fail at the
persisted-startup comparison, in runs `2df9eb570204` and `79ea5f23bdad`.

Both Query clean passes completed all 1,444 tests; both TrailBase passes
completed all 410 tests. PowerSync completed all 178 tests twice. Stable-key
comparison and the complete exact commands are retained in the snapshot's
`.retention-audit/retention-comparison.json` and `*-command.json` files.
Independent verification found no changed tracked source, control, runtime,
CLI file, any of the 1,092 built workspace outputs, or the three frozen
workspace bundles, and no import from the live checkout's source.

Retention does not mean that every mutation is rejected. This original-source
snapshot still reports Query `M563`, `M1473`, `M1794`, and the authored
parenthesized-condition control as survivors, and TrailBase `M151` as a
survivor. The later Query receiving witnesses and repaired Query source are a
separate changed-callback experiment. Primary PowerSync/RxDB eager-source
property conversions are likewise an additive conversion-only audit at
`777935fd68daa497fdd3c9db533845b710be68a1`; they are outside this completed
55-kill experiment. These results do not claim a complete source mutation
campaign or closure of the remaining survivor classifications.

## Completed primary PowerSync and RxDB conversion retention

The subsequent seven-file primary eager-source conversion at
`777935fd68daa497fdd3c9db533845b710be68a1` also completed its retention audit.
PowerSync and RxDB each retain all six existing operator kills by stable key,
with zero nondeterministic and zero excluded tests. These are repeat checks of
12 keys already present in the 55-key campaign, not 12 additional distinct kills.
The application source is unchanged from c4 in this conversion-only snapshot.

| Adapter | Required operator kills | Retained | Run |
| --- | ---: | ---: | --- |
| PowerSync | 6 | 6 | `96e1e23c1c70` |
| RxDB | 6 | 6 | `5f5866b66af7` |

PowerSync's two clean captures pass all 265 tests, including all 89 tests in
the converted primary owner. RxDB's captures pass all 305 tests, including all
129 tests in its converted primary owner. Both use Node 24.22.1, forks and seed
2367. The CLI's printed clean duration is the maximum single-unit duration,
not total pass wall time; per-unit durations are retained in the evidence.
The PowerSync mutation run uses one context; benchmark measurements remained
held while mutation work ran. The final source, build, control and instrument
hash checks pass, and there are no live-checkout source imports.

RxDB's separately adapted original-defect control is killed again in run
`d48451ac1f6a`. The duplicate PowerSync adapted-control run is deliberately
omitted: its earlier run `79ea5f23bdad` killed it through the persisted-startup
receiver, and all 33 captured local source/build inputs of that receiver are
byte-identical in the seven-file conversion snapshot. The control bytes and
runtime are identical too. None of the changed conversion paths modifies that
receiving instrument. Repeating that control would ask no distinct unproven
question. The exact before/after input hashes, original control evidence,
12-key comparison, commands, runtime and clean captures are preserved in the
[primary conversion evidence](2026-11-10-primary-eager-conversion-retention.json).

This closes conversion retention for those primary owners. It does not claim
closure of later startup-work predicates, the final live production changes,
the unseeded fresh PowerSync campaign, or browser receiving paths added by
other workers. Those obligations retain their separate oracle and host evidence.

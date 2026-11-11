# Persisted-startup current-head gap audit

This audit starts at `5feb26616a8357853454c2f9ff2ce0b0adb9c908` and
preserves the earlier [gap audit](2026-11-10-startup-gap-cli.md). Its author
also contributes to this PR, so this is a sensitivity audit, not independent
review. All 61 changed-line operators have final classifications. All five
original-defect semantic controls are rejected; later receiver extensions are
recorded separately below.

## Selection

The installed CLI's `schemata.mjs` selects mutations on lines changed from
`origin/main` in the four production entry points. The current selection is
41 Query, six RxDB, six PowerSync and eight TrailBase operators (61 total).
This is a changed-line audit, not a whole-file audit. Selection JSON and source
SHA256 records are retained under `.review-2367/gap-current/`.

The five previously unclassified Query operators moved from `M1451–M1455`
to `M1466–M1470` after earlier repairs added 15 preceding operators.

## Installed CLI failure

The unmodified, installed CLI still aborts on the five-operator selection:

```sh
pnpm --config.verifyDepsBeforeRun=false gap-report \
  --package packages/query-db-collection --source src/query.ts \
  --diff-base origin/main --seed 2367 --contexts 1 \
  --only query.ts:M1466,query.ts:M1467,query.ts:M1468,query.ts:M1469,query.ts:M1470 \
  --out .review-2367/gap-current/original-five
```

Both unmutated baselines pass: 840 tests in 131.3 seconds and 132.6 seconds,
with zero nondeterministic tests. The run then exits with status 1:

```text
Error: query.ts:M1468: tests/ssr-dehydration-oracle.test.ts
has no unit and no earlier kill
at runOwners (.../oracle-gaps/check.mjs:1550:19)
```

The retained log is
`.review-2367/gap-current/original-five.log`; `state.json` identifies the
last eight-copy batch for `M1468` and `M1469`. The installed CLI deletes the
raw batch capture on exit. This aborted run classifies none of the five
operators.

The preserved diagnostic proves the cause. In
`refetch-ordered-prefix-oracle.test.ts`, the existing offset-only preload
witness is registered with `it.fails` (line 1853). During its
`onTestFinished` hook, Vitest's task still has `state: "fail"`, its assertion
verdict and route `case`. `capture-setup.mjs` therefore marks the mutant killed
and skips later test-file copies. Vitest then applies expected-failure
semantics: the final `TestCase.result()` is `{state: "passed"}`. The CLI's
`outcomeOf` correctly sees no failed test and no kill. `unitsBatch` discards the
later skipped copies; `runOwners` then raises the missing-unit exception.

The same diagnostic run reproduces the installed error after two clean
840-test baselines (131.3 and 136.0 seconds, zero nondeterministic tests).
The capture for `M1468` contains the failing expected-failure assertion while
its final Vitest record says passed; both later SSR copies are marked skipped.
The reduced record is
`.review-2367/gap-current/expected-failure-accounting-bug.json`; the complete
capture and module results remain under `diagnostic-five-old-owner-set/`.
This diagnostic excludes only the newly added precedence registration to retain
the owner set that originally triggered the exception. No source or test file
was swapped.

The CLI repair belongs in early-stop accounting for expected-failure tests.
The isolated audit runner adds `!context.task.fails` to the `finishTest`
early-stop condition. Normal early stopping, final-result classification,
assertions, routes and source instrumentation remain unchanged. The patch is
retained as `.review-2367/gap-current/expected-failure-guard.patch`.
The installed dependency remains byte-for-byte unchanged.
The installed runner already passes `fsModuleCache: false`, invalidates changed
served-source hashes and resets Vitest modules between unskipped copies. The
isolated guard preserves those mechanisms. Standalone Vite mutant experiments
need their own cache controls; they do not inherit the CLI's isolation.

The earlier isolated no-cross-file-skip experiment is not used for final
results: removing only the cross-file optimization would still let an
expected failure skip the remaining tests in its own file. All isolated CLI
copies now live outside the checkout under
`/private/tmp/tanstack-db-2394-gap-cli-current/`, so dependency fixture sources
do not enter changed-file linting.

## Operator results

| Receiver | Operators | Law rejections | Survived | Timeout | Unclassified |
| --- | ---: | ---: | ---: | ---: | ---: |
| Query | 41 | 30 | 9 | 2 | 0 |
| RxDB | 6 | 6 | 0 | 0 | 0 |
| PowerSync | 6 | 6 | 0 | 0 | 0 |
| TrailBase | 8 | 7 | 1 | 0 | 0 |
| Total | 61 | 49 | 10 | 2 | 0 |

Ordinary tests are not credited as kills. A kill is a reproducible oracle
assertion verdict rejected by the final Vitest result. Timeouts are separate
finite-budget outcomes; they are not behavioral oracle kills. The table
classifies every selected operator, not every possible source mutation.

The complete operator account is:

- Query killed: `M551–M552`, `M556–M557`, `M560–M562`, `M564`, `M1374`,
  `M1378–M1380`, `M1466–M1467`, `M1470–M1472`, `M1477–M1480`,
  `M1482–M1485`, `M1748`, `M1790–M1792`, `M1795`.
- Query survived: `M558`, `M559`, `M563`, `M1376`, `M1377`, `M1473`,
  `M1481`, `M1793`, `M1794`.
- Query timeout: `M1468`, `M1469`.
- RxDB killed: `M3–M4`, `M7–M10`.
- PowerSync killed: `M35–M36`, `M162–M165`.
- TrailBase killed: `M36–M37`, `M146–M150`; survived: `M151`.

Thus the five previously unclassified Query operators now have finite
outcomes: historical `M1451/M1452/M1455` (current `M1466/M1467/M1470`) are
killed; historical `M1453/M1454` (current `M1468/M1469`) time out. None is
still hidden behind the CLI accounting exception.

The installed-CLI reports are `ba8aca53b708` (RxDB), `8d4a3c3b3330`
(PowerSync), and `8ca1218ab1ed` (TrailBase). Each reports zero
nondeterministic tests, setup/runtime classifications, and timeouts. Their
unmutated test counts and times are 135 in 27.0/26.3 seconds, 135 in
153.2/158.0 seconds, and 217 in 22.5/22.2 seconds, respectively.
Query's guarded-run report is `b56831e3d650`. Its baselines pass 848 tests
in 134.2/136.9 seconds with zero nondeterministic tests.

RxDB/PowerSync's historical retained-row reload survivors are now `M10` and
`M165`. The new eager-reload receiver rejects each on a retained nonempty
load followed by an empty complete result. The capability operands are judged
by package-local receiving registrations: inverted metadata guards fail the
absent-metadata law; omitted validation fails missing-capability validation.
The shared model remains shared. See [adapter reload evidence](2026-11-10-adapter-reload-gaps.md).

## Surviving distinctions and additive coverage

A survivor records a distinction the finite campaign did not judge. It is
not a production defect or an approved global equivalence.

- TrailBase `M151` removes cancellation after held baseline hydration. The
  lifecycle receiver now reaches obsolete work. Exact immutable source-copy
  experiments preserve current public/durable rows and resource ownership
  across controlled and real Node SQLite hosts, including replacement-ready
  histories with a key outside the old result. Existing wrapper/core epochs
  fence its publication. This is scoped equivalence in the exercised domain;
  see [TrailBase hydration evidence](2026-11-10-trailbase-hydration-gap.md).
- Query `M558/M559` broaden inclusion of ownerless accepted rows beyond eager
  persisted reconciliation. The new retained-scope receiver rejects both:
  a limited response cannot remove an omitted ownerless saved row.
  `M1376/M1377` broaden first-claim updates for cached results. The new cached
  peer receiver rejects both when an older or manually populated cache would
  override a continuously owned row established by a later physical fetch.
- Query `M1481` always takes hydrated-baseline reconciliation. The new
  on-demand receiver rejects it when acquiring one scope exposes unrequested
  saved rows from another scope. Public rows supply the decisive comparison,
  rather than an invented restriction on optional capability calls.
- Query `M1473` forces eager persisted reconciliation after ownership already
  exists. The eager hydration capability caches its resume-baseline promise;
  repeated calls do not establish repeated physical row reads. Later-result
  ordering and public/durable observations judge any stronger distinction.
- Query `M563` omits the same-run direct-row exclusion. The initial grammar
  starts the first physical fetch before every direct write, so its older-fetch
  merge independently preserves the direct row. A before-first-fetch ordering
  is a distinct legal neighbor.
- Query `M1793/M1794` alter the recorded fetch-start generation fallback.
  Physical-fetch histories can supply redundant ordering evidence. Cached
  successful results without a physical-fetch clock are a distinct neighbor.

The Query full audit started with the 56-history precedence receiver. During
its mutation phase, the parent added legal before-first-fetch histories and
cached-result histories, plus a separate on-demand receiving extension. These
are additive coverage, not an unchanged frozen baseline. Source hashes remain
unchanged. The initial baseline/test manifest and final input manifest are
retained separately; exact survivor runs after clean new baselines must state
which extension they judge. The table above preserves the initial full audit's
reported classifications rather than replacing survivors with inferred kills.

## Additive survivor experiments

After the main baseline, the precedence owner extended the eager grammar to
104 fixed histories and generated campaigns of 80 fixed-seed plus 80 fresh
histories on each controlled/Node SQLite host. Separate immutable source
transforms log distinct applied-source hashes, disable Vitest's disk module
cache, and give each operator a separate plugin/cache identity. Earlier
standalone GREEN runs without those controls were retracted and are not
closure evidence here. See the current
[precedence gap report](2026-11-10-persisted-precedence-gaps.md) for commands,
reach, replay coordinates and exact public/durable checkpoints.

- `M1793` is now rejected: a cached successful result has no physical
  fetch clock; a newer update accepted during its held baseline must survive
  first-result application and persistence. The mutant loses it on both hosts.
- `M1748` remains rejected by the legal pre-restore insert/derived-result
  ordering. The expanded receiver observes obsolete rows at both first public
  and durable cuts when that reconciliation is omitted.
- Exact `M563` still passes after positively reaching same-run ownerless
  insertion before the first physical fetch, then a complete omission.
  Direct-row lifetime/absence machinery supplies redundant protection at the
  exercised eager public/durable cuts. This does not classify on-demand paths.
- Exact `M1794` still passes. At the admitted general-result branch, the
  original threshold and enqueue-time direct generation identify the same set
  of later same-Collection key claims; writes pending afterward remain newer
  under either threshold. This is a bounded redundancy argument with the
  exercised cached/fetched, raw/derived and write-order histories.
- Exact `M1473` still passes the 250-check precedence/startup selection,
  including the actual one-full-row-read budget. The extra capability call
  does not establish an extra physical scan.

The on-demand scope/provenance receiver rejects `M558/M559`, `M1376/M1377`
and `M1481` on both controlled and real Node SQLite hosts. Each has a checked
mutant replay that fails at its public/durable comparison and a clean replay
that passes at the same coordinates. The scope grammar runs 48 fixed histories
and fixed/fresh campaigns of 60 per host. The cached-peer grammar runs two
fixed histories and fixed/fresh campaigns of 60 per host. Chromium receives
those same 50 histories and shared judgments.
The [scope/provenance report](2026-11-10-retained-scoped-hydration-gaps.md)
retains exact transforms, reach counts, and replay coordinates.

These six additive rejections bring the selected operators' observed outcomes
to 55 assertion rejections, four bounded survivors (`M563`, `M1473`, `M1794`,
and TrailBase `M151`), and two finite-budget timeouts. The original audit table
and its frozen test manifest remain above. This combines executed evidence
from the separate campaigns, rather than claiming one final full-CLI rerun.

## Semantic controls and limits

TrailBase's original-defect control `sweep-before-baseline` is rejected by the
shared persisted-startup comparison. RxDB's current-text
`pending-baseline-is-not-snapshot` control is also rejected (report
`6e74c7931eb4`, 135-test baselines in 26.4/25.8 seconds, zero nondeterminism).
RxDB and PowerSync's older authored find text no longer applies after the
persistence operand was assigned to a validated local capability. Those
`does-not-apply` results are preserved and excluded from scores; the current
control changes only its find text, retaining the same wrong behavior.

Both Query semantic controls are rejected by the shared persisted-startup
comparison on fetched-response-before-restore histories (previous mask 1,
next mask 2). Its behavior-preserving control, redundant parentheses around
the hydration condition, survives. These known-kill and expected-survivor
controls calibrate the isolated early-stop guard without changing the final
classifier. PowerSync's adapted semantic control is rejected by that same
history (report `eeaa2f8c06a9`; 135-test baselines in 173.3/160.6 seconds,
zero nondeterminism). All five original-defect controls are therefore rejected.
The behavior-preserving control is excluded from mutation scores.

The starting and final source hashes match for all four production files and
both installed CLI files. `.review-2367/gap-current/final-input-manifest.json`
records those hashes, the isolated guarded runner's hashes and the final test
inputs. The starting Query test manifest remains separate because additive
receiver work happened after its clean baseline. The exact commands are
retained as `*-command.json` beside completed `results.json` reports. No CLI
worker remains active.

The evidence is finite: changed lines in four entry points, declared package
owners, seed 2367, configured histories and public/durable checkpoints. It is
not a whole-file audit, a universal proof, or a claim that untested integration
paths are equivalent. No production change follows from the operator audit.

Validation for this audit record: `pnpm lint:changed` and the Markdown formatter pass.

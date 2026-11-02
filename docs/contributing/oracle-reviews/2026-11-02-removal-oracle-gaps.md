# Removed-test gaps: oracle extensions, 2026-11-02

Both instruments now detect the defects found while reviewing the test removals
in PR #2316. This is an oracle-only change. Production remains at
`d4ca8d7d18d4c9bc29055adf10f44e32076e2d0b`; no production repair or bug-class
closure is claimed. Angular projection and negative top-K windows remain RED.
The earlier page-window review's late-coverage qualification remains in force.

The reviewed working-source identity is SHA-256
`bcd38124f5600683aa7664d4888634a43190c4b53fb1bb274315b363dbad67c9`
for `git diff --binary -- packages` against that HEAD, plus SHA-256
`0c337bfc352652d406a152e8b06a6fb27cb47b8f81e016c46ced11895d579743`
for the new `packages/db/tests/conformance/result-shape-oracle.ts`.
The hashes identify uncommitted test sources, not files already present at HEAD.

## Laws and independent judgments

**Projection:** the shared binding contract and public adapter result types
promise an array for a list and a row or `undefined` for `findOne`. The current
authored query determines that projection. The new shared
`result-shape-oracle.ts` derives selected rows by independently sorting and
windowing authored source rows. It never uses a production query classifier or
observer snapshot to decide the expected shape. Raw shape is checked before any
row normalization. After settlement, full selected values and keyed state must
also agree with the model.

The same grammar, model and comparison run through all six framework drivers,
including both React registrations. Native parameter cuts differ by framework:

| Driver | Native cut before the later settled comparison |
| --- | --- |
| React / React dependency list | Committed synchronous rerender |
| Preact | Committed synchronous rerender |
| Vue | `nextTick`, before a later task |
| Solid | Synchronous reactive propagation |
| Svelte | `flushSync`, before a later task |
| Angular | Synchronous Signal read before effects |

Only projection is owed at these native cuts; immediate row freshness is not
claimed. A separate check verifies that the current parameter reached the query
callback. Reading data first or the Collection first is part of the replayable
history. The driver calls the observation once, then performs its usual flush.

**Negative windows:** installed rank `r` belongs to the result exactly when
`offset <= r && r < offset + limit`. Existing top-K/orderBy tests establish
empty results for intervals wholly before rank zero. The maintainer accepted
the broader absolute-rank proposal on 2026-11-02, including crossing zero and
nonnegative widths; the older tests alone do not authorize that broader rule.
The existing `topk-support-window-oracle.test.ts` owner reuses its independent
rank predicate and signed-output recorder. Direct array top-K, one-group top-K
and public orderBy each compare rows, order, values, multiplicity and size after
the D2 graph drains. JavaScript end-relative slicing and clamping the offset
before applying width are rival interpretations, not model rules.

## Grammar controls and boundaries

The projection grammar generates source count 0–4, base −10–10, positive spacing
1–3, both sort directions, both initial modes and read orders, an optional finite
singleton window with offset 0–3, and a tail of 0–4 repeated/changed modes.
Every history changes mode, repeats it and returns to the initial mode. The 28
replay examples cover empty/single/multiple source rows and finite/unbounded
queries; four explicitly use offset 1. Finite list and findOne queries author
identical `.offset(x).limit(1)` windows, so window equality cannot justify keeping
the old projection. The generated RED below reconstructs the stale-shape report.
Removing either direction, the native cut, read order, or finite-window axis
would lose a distinct witness. Source cardinality, ordering and spacing make
the settled selection distinguishable. Disabled and invalid query inputs are
excluded; supplied Collections, DbClient and error contracts retain their owners.

The negative-window grammar installs 3–5 keys, varies depth 2–4, width 1–2 and
positive gap 1–3, then generates up to 12 support/move steps with support 0–3,
offset −6–6 and width 0–6. A constructive prefix visits wholly negative and
zero-width intervals, crosses zero, deletes/reinserts a source row under a
negative offset, makes a partial move, returns nonnegative and moves below
negative cardinality. Depth/width/gap distinguish rank intervals from relative
slice endpoints; source edits and partial moves distinguish initial selection
from maintained output and bound inheritance. Negative widths and fractional
bounds are excluded for lack of authority here. Multiple groups, prefix-size
predicates and downstream acquisition remain outside this lane.

## Runs and declared reach

All jobs ran serially, with at most two Vitest workers. The default multiplier
was 1. Each projection campaign has 28 examples plus 6 generated histories;
each negative-window campaign has one example plus 100 generated histories.
Both fixed seed 2316 and unseeded campaigns use the same grammar and comparison.
Existing support/numeric run budgets are unchanged.

Final projection selections: Preact, Vue, Solid and Svelte each **3 passed**;
Angular **2 intended comparison failures, 1 calibration passed**. The final full
React conformance run has **243 passed**, including both registrations. Full
non-React conformance runs before the final grammar refinements passed in the
four other green frameworks; Angular had 67 neighboring passes and the earlier
shape failures. Those earlier runs do not establish final grammar reach.

The table counts histories entering each declared state, once per history.
Each green fixed campaign has the same column F. Random columns are the actual
completed final runs: R = React, RL = React dependency list, P = Preact,
V = Vue, So = Solid, Sv = Svelte. Every green campaign completed 34 histories.

| Declared projection state | F | R | RL | P | V | So | Sv |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| data first read | 17 | 17 | 16 | 17 | 18 | 17 | 19 |
| Collection first read | 17 | 17 | 18 | 17 | 16 | 17 | 15 |
| list to single at native cut | 34 | 34 | 34 | 34 | 34 | 34 | 34 |
| single to list at native cut | 34 | 34 | 34 | 34 | 34 | 34 | 34 |
| nonempty list to single at native cut | 24 | 26 | 23 | 25 | 24 | 24 | 25 |
| nonempty single to list at native cut | 24 | 26 | 23 | 25 | 24 | 24 | 25 |
| repeated mode at native cut | 34 | 34 | 34 | 34 | 34 | 34 | 34 |
| returned mode settled | 34 | 34 | 34 | 34 | 34 | 34 | 34 |
| empty source settled | 10 | 8 | 11 | 9 | 10 | 10 | 9 |
| multiple source rows settled | 15 | 15 | 15 | 16 | 16 | 15 | 15 |
| same finite window projection change | 18 | 17 | 19 | 21 | 19 | 20 | 20 |
| nonzero finite window projection change | 6 | 5 | 6 | 8 | 5 | 7 | 8 |

Angular's normal fixed and random runs stop in the first example and reduction.
Their reach vector in the table's row order is
`[2,0,2,2,1,1,2,2,1,1,0,0]`; this is failed-example/reduction reach, **not a
completed generated campaign**. Guarded generated path 28 reaches both mode
directions, repeated/returned mode, data-first, multiple source rows and both
finite-window states once. Guarded finite paths 1 and 25 additionally exercise
offsets 0 and 1 with nonempty selection, including Collection-first at path 25.

The full top-K owner has **6 intended failures and 23 passes**: 22 retained
neighboring checks plus the new wrong-answer calibration pass. All three paths'
fixed/random runs stop in the first example and reduction, counting each of
their eight declared states twice. These are not 100-history completed runs.
The guarded generated path 1 reaches all eight states once in each real path:
empty to wholly negative window; negative zero width; crossed rank zero;
source deletion and insertion under negative offset; returned to nonnegative
window; offset below negative cardinality; partial move retained width.
All states require at least one history in a completed normal campaign and
fixed-example reach. Direct replay intentionally checks one trace instead.

## Reproduction and failure fidelity

From each framework package, the final focused command was:

```sh
pnpm exec vitest run tests/conformance.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2 --disableConsoleIntercept -t 'result-shape conformance'
```

Use `conformance.test.tsx` in React/Solid and
`conformance.svelte.test.ts` in Svelte. React's final full run omitted `-t`.
From `packages/db-ivm`, run the same options against
`tests/operators/topk-support-window-oracle.test.ts` without `-t`.

Guarded Angular generated replay, from `packages/angular-db`:

```sh
TANSTACK_DB_ORACLE_SEED=2316 TANSTACK_DB_ORACLE_PATH=28 TANSTACK_DB_ORACLE_PROPERTY=framework.angular.result-shape node --import tsx ../db/tests/oracle-replay.ts tests/conformance.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --disableConsoleIntercept
```

This fails `current query projection` at
`list to single; synchronous Signal read before effects; data first`.
Original generated input:

```json
{"initial":"list","order":"data first","count":3,"base":2,"spacing":2,"descending":true,"windowed":true,"offset":3,"tail":[]}
```

Reduced input at `28:0:0:0:0:0:0`:

```json
{"initial":"list","order":"data first","count":0,"base":0,"spacing":1,"descending":false,"windowed":false,"offset":0,"tail":[]}
```

The reduction preserves the violated projection law and native checkpoint but
loses the finite-window premise. The original and offset-0/offset-1 path 1/25
witnesses retain that additional evidence. Both transition directions fail
before effects; settled comparisons pass. No synchronous row-freshness result
is inferred from this RED.

From `packages/db-ivm`, guarded negative replay:

```sh
TANSTACK_DB_ORACLE_SEED=2316 TANSTACK_DB_ORACLE_PATH=1 TANSTACK_DB_ORACLE_PROPERTY=ivm.topk-negative-window-array node --import tsx ../db/tests/oracle-replay.ts tests/operators/topk-support-window-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --disableConsoleIntercept
```

Also run properties ending `-grouped` and `-orderBy`. Each fails
`absolute-rank rows` at `empty to wholly negative window`. Original generated
input, identical for all three paths:

```json
{"installed":4,"depth":2,"width":1,"gap":2,"tail":[{"slot":4,"support":0,"offset":1,"limit":5}]}
```

Reduced input at `1:0:0:0`:

```json
{"installed":3,"depth":2,"width":1,"gap":1,"tail":[]}
```

All guarded original and exact reduced replays were executed. Each reports
`executions: 1` and witness `numRuns: 1`, with the requested property, seed and
path. Angular paths 1/25/28 and its reduced path are comparison REDs. The three
top-K original/reduced pairs are comparison REDs. The same generated shape
path 28 is GREEN in React, React dependency list, Preact, Vue, Solid and Svelte;
both React guards were repeated after the final driver simplification.
No setup failure, timeout or unreached path is being counted as a defect kill.

The original production supplies hostile behavior for both new comparisons.
Permanent wrong-observation controls also reject the previous projection in
both directions, end-relative slice output and offset-first clamping output.
These are assertion rejections through the shared judgment, not production
mutation/GREEN repair evidence. Accumulated mismatches preserve later size,
source-edit and return-move failures; a later runtime interruption is appended
after the original failure. Scenario cleanup and the shared failure-fidelity
harness preserve law, checkpoint, original trace and reduced trace separately.

## Independent review and rubric outcomes

Two independent reviewers loaded `oracle-review`: one audited the shared
framework law/receiving cuts, the other the negative-window grammar and paths.
Their confirmed instrument findings were repaired: later interruptions could
replace an earlier mismatch; direct replay needed manifest routing; equal
finite windows and positive offsets needed explicit dimensions/reach; and
crossing-zero authority needed the maintainer decision stated separately from
older examples. Final follow-up reviews found no remaining confirmed source
instrument defect. Product REDs remain open with the owners below.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Laws, authority, accepted negative-offset extension and limits are stated above and beside executable rules. |
| ORC-002 | Authored-source projection and absolute-rank membership are independent of production classifiers, caches and slice endpoints. |
| ORC-003 | Opening/adjacent prose separates law, model, grammar, real driver, observation and comparison. |
| ORC-004 | Domains, reconstruction, axis ablations and excluded adjacent inputs are recorded above. |
| ORC-005 | Real six-framework bindings and three D2 paths execute native/drained comparisons. Query-callback input receipt is checked; no concrete missing-input hypothesis remains for shape. |
| ORC-006 | Previous projection, end-relative slice and offset-first clamp are rejected. Unchanged-production REDs fail intended assertions. |
| ORC-007 | Fixed/unseeded parity, budgets, manifest routes and guarded original/reduced replays are recorded. No commands arbitrary is used. Failing campaigns remain incomplete. |
| ORC-008 | Shape is stateless recomputation. Top-K retains support and window: a source edit distinguishes equal current outputs with different support, and a partial move distinguishes different stored bounds. No new production-shaped state machine. |
| ORC-009 | `single` denotes public findOne projection; window/rank/support retain owner meanings; native/settled cuts map to each driver above. |
| ORC-010 | Shared fidelity plus accumulated causes preserve primary mismatch, reductions, interruptions and cleanup diagnostics. Exact shrink replays retain the law/checkpoint. |
| ORC-011 | No remaining named shared semantic fault requires another independent formulation. Rival negative interpretations and raw-shape normalization risk have distinguishing controls. Three production paths alone are not independent semantic evidence. |
| ORC-012 | This record identifies reviewed source, every rubric outcome, REDs and open cells; no repair closure is claimed. |
| ORC-013 | Wholly-negative versus crossing-zero/zero-width windows distinguish relative slicing and early clamping. Same finite window with changed projection, repeated mode and positive offset distinguish stale projection from window movement. |
| ORC-014 | Real framework runtimes supply the native cuts; no cross-host/AOT claim. Source fixtures and D2 graph-drain evidence stay limited to those boundaries; no remote-provider or acquisition claim. |
| ORC-015 | Declared minimum/fixed reach and actual completed, interrupted and guarded counts are separated above. |
| ORC-016 | Regressions are history inputs to shared judgments; calibration feeds wrong observations to those judgments. No concrete type assertions or ordinary example tests were added to oracle files. |

Final checks: all seven affected package TypeScript checks pass; replay
infrastructure has 70 passes; changed TypeScript ESLint and `pnpm lint:changed`
pass. Production source is unchanged. The coverage map retains both reachable
open defects: Angular at the native cut and negative top-K rows/size/source
edits on all three paths. Production repairs, completed GREEN campaigns and
restored-defect mutants are still required before merge readiness.

## Production repairs, 2026-11-02

This entry supersedes the open product verdict above. The earlier RED record
and its reviewed source identity remain historical evidence. The production
repair uses the same accepted laws, generators and observation cuts; no public
API or model rule changes. The earlier page-window process qualification is
unaffected.

The repaired working-source identity against HEAD
`d4ca8d7d18d4c9bc29055adf10f44e32076e2d0b` is SHA-256
`b3833aedf0706f48c400bc95ddb69016e70a0fd09af2687b29bff90cc24cd117`
for `git diff --binary -- packages`, plus the unchanged new result-shape file
hash recorded above. These are uncommitted sources, not a claim that HEAD
already contains the repair.

TopK clips slice endpoints to nonnegative installed ranks, computes size from
the intersection of authored bounds with installed ranks, and starts leading
counts at the first installed rank. Authored offset/limit remain exact for
future insertions and partial moves. Source-edit logic needs no change.

Before production edits, the negative owner also gained an always-true leading
predicate observation on direct top-K and orderBy. The public size getter's
documented prefix rule requires this to equal the selected row count. Grouped
top-K exposes no predicate argument, so it retains its ordinary size comparison.
This adds an observation to the same generated states, not a new reference state
or pinned-only example. On unchanged production the full owner still has 6
failures/23 passes, now also recording negative-index TypeErrors at the marked
leading-count checkpoint. The original row/size failures remain primary.

Angular returns its snapshot's data unchanged when the snapshot belongs to the
current Collection. Before effects attach to a different Collection, it derives
ordered rows from the captured keyed snapshot and applies the current query's
list/findOne projection. This preserves array-valued rows and requires no new
reactive state. It does not read metadata from a public pooled Collection.

The first attempted Angular repair did read that facade's `config`, which
materialized a separate live query and defeated pooling. Independent review
identified the source cause; the full shared conformance run independently
rejected it: `pooled-param-change` observed 3 subscriptions instead of 1
after public reads (68 passes, 1 failure). The corrected implementation avoids
that read. Its focused shape/pool run passes 5 checks, and its full final
conformance plus ordinary injector tests pass **92 tests with 1 existing TODO**.
The existing receiving witness was sufficient; no framework-specific oracle
or weakened assertion was added.

### Completed GREEN and reach

The full top-K owner passes **29 tests** after repair and again after restoring
the mutant runs. Its 22 retained neighboring checks and calibration remain
green. All eight negative states have reach **101** in each of the direct,
grouped and orderBy fixed/random campaigns: one example and 100 generated
histories per state, per campaign. The three neighboring top-K/orderBy test
files also pass **53 tests**.

Every framework's result-shape campaign completes 34 histories: 28 examples
and 6 generated. React's two registrations pass 6 selected tests; each other
framework passes its 3 shape tests, including calibration. The final fixed
campaign reach vector in the earlier table's state order is identical in all
seven registrations:
`[17,17,34,34,24,24,34,34,10,15,18,6]`.

| Final random campaign | Reach vector, same state order |
| --- | --- |
| Angular | `[19,15,34,34,24,24,34,34,10,16,20,7]` |
| React | `[17,17,34,34,24,24,34,34,10,16,19,6]` |
| React dependency list | `[20,14,34,34,24,24,34,34,10,13,19,5]` |
| Preact | `[16,18,34,34,24,24,34,34,10,16,20,5]` |
| Vue | `[17,17,34,34,25,25,34,34,9,15,19,6]` |
| Solid | `[17,17,34,34,25,25,34,34,9,17,19,7]` |
| Svelte | `[19,15,34,34,26,26,34,34,8,17,16,4]` |

The 28 examples contribute
`[14,14,28,28,20,20,28,28,8,12,16,4]`; subtract that vector to obtain generated
reach alone. In particular, Svelte's random suffix has no finite-window
projection change, while its fixed-seed generated suffix reaches both finite
states twice. The examples ensure those states independently of seed. No run
budget was lowered or removed.

Commands are the earlier focused commands. The final Angular command includes
both `tests/conformance.test.ts` and `tests/inject-live-query.test.ts` without
`-t`. The IVM neighbor command selects `topKWithFractionalIndex.test.ts`,
`orderByWithFractionalIndex.test.ts` and `topKWithFractionalIndex-oracle.test.ts`
under `tests/operators/`. Flags remain coverage/typecheck disabled, two workers
and console interception disabled. All Vitest jobs run serially.

### Isolated hostile mutants

Each fault was restored independently, with all other repairs present. The
guarded command and seed remain those above. Each RED below has exactly one
registered execution and witness `numRuns: 1`; none fails in setup or times out.

| Restored fault | Property and path | Rejection |
| --- | --- | --- |
| Angular's original data computed | `framework.angular.result-shape`, `28` and `25` | Projection assertion at list-to-single before effects, data-first and Collection-first respectively. |
| End-relative slice endpoints only | Each `ivm.topk-negative-window-*`, `1` | Row assertion at empty-to-wholly-negative move. |
| Original size formula only | `ivm.topk-negative-window-array`, `1` | Size assertion at empty-to-wholly-negative move. |
| Original leading-count start only | `ivm.topk-negative-window-array`, `1` | Production getter TypeError at crossed-rank-zero leading-count observation. This is a runtime defect at the promised getter, not an assertion or setup failure. |

The production files were restored byte-for-byte in a `finally` block. The
original generated Angular coordinates 28/25 then pass with one execution and
one history each. Its exact reduced coordinate also passes; fast-check reports
two histories in that single registered replay, so it is not counted as a
one-history run. All three top-K original/reduced coordinates pass after
restoration: original coordinates report one history each, while each reduced
coordinate reports eight in one registered execution. The normal completed
campaigns above provide the broader GREEN.

**Open test-mechanics finding:** `randomParameters` in `oracle-config.ts`
intends a one-history replay, but these successful shrink-chain paths continue
through additional histories despite `numRuns: 1`. Owner:
`packages/db/tests/oracle-replay.test.ts` under Small structures and test
mechanics. A generated passing shrink-chain witness and a bound on that
continuation are needed. This record does not count these multi-history runs
as singleton evidence. The one-segment original replays and every RED replay
above report one history; completed normal campaigns independently validate the
product repair. This is a separate replay-budget gap, not an excluded product
counterexample.

Two independent oracle reviewers audited the repair and leading-count
observation. They found no remaining actionable finding after the pooling
correction. The prior ORC dispositions remain valid with these additions:
ORC-001/005 include the public leading getter law and path; ORC-006 now has
isolated production mutants; ORC-007/015 have completed GREEN and the actual
reach/replay counts above. The model and grammar are unchanged, and the added
observation uses their existing selection judgment.

- **Law:** current query projection at the native/settled framework cuts, and
  absolute-rank top-K rows/size after graph drain; authorities remain those above.
- **Reach:** all framework campaigns complete; each negative state reaches 100
  generated histories plus one example in every path/campaign.
- **RED:** unchanged-production records above, including the added leading
  getter comparison before production edits.
- **GREEN:** 29 top-K owner tests, 53 neighbors, 92 Angular tests plus one TODO,
  and shared projection campaigns through all six frameworks pass. Affected
  package typechecks and changed-source ESLint pass.
- **Mutant:** isolated restored projection, relative-slice, size and leading
  faults are rejected at the named checkpoints; repaired originals replay green.
- **Limits:** the previous grammar/path/host limits remain. Varying prefix
  predicates, multiple groups, fractional/negative widths and downstream
  acquisition are not established by this extension. The bounded evidence
  closes the recorded counterexamples and adjacent histories, not every
  possible scheduler or numeric domain. Whole-PR CI/readiness is a separate claim.

## Shipped-byte simplification, 2026-11-02

This pass preserves the laws, histories, observation cuts, and run budgets above.
It adds no public API. The production changes remove repeated work and ownership:

- Core normalizes query configs once and binds descriptor sources directly.
  Window reuse retains its source-object, config, shape, lifecycle, subscriber,
  and commit guards. The status check allocates no temporary array.
- React prepares a keyed input once on demand and installs resolution fields
  with their first values. Each observer owns its stable subscribe closure.
  One scope-indexed cache serves both client-backed and unscoped Suspense queries;
  entries store status cleanup callbacks directly.
- Angular and Vue use native effect cleanup for their observers. The additional
  destruction callbacks and parallel cleanup state repeated that ownership.
  Solid and Svelte likewise dispose their observer rather than also unsubscribing
  the same subscription separately.
- Svelte projects status and health from the observer snapshot. Each field has
  its own derived selector, so row publications do not invalidate status-only
  consumers. Its keyed row updates and ordered data remain separate.
- Solid shares its existing state and status copies at the same checkpoints.
  Top-K uses binary search directly rather than through a private forwarding method.

The replay-manifest table also gains an erased `as const` annotation. This fixes
TypeScript's potentially-missing tuple element inference without changing test
inputs, registration, comparisons, or replay behavior.

The reviewed source is HEAD `d4ca8d7d18d4c9bc29055adf10f44e32076e2d0b` plus the
working changes. SHA-256 of `git diff --binary -- packages` is
`e7ce946ffa253c3cda2d2e87fb467b97c780434a41b663f0cdeef5a6a1f3e330`.
The new result-shape oracle remains byte-identical to the repair record:
`0c337bfc352652d406a152e8b06a6fb27cb47b8f81e016c46ced11895d579743`.

### Size evidence

Compare the actual PR base `0531c50ad419a1b51ad3e27e3632e70be3c6bdb3`:

```sh
pnpm size:compare --base 0531c50ad419a1b51ad3e27e3632e70be3c6bdb3 --exact-base \
  --packages db-ivm,db,react-db,preact-db,vue-db,solid-db,angular-db
```

This uses the repository's production minification, gzip level 9, and Brotli
quality 11, with package dependencies external. Svelte requires a separate
measurement: compile both revisions through their own Svelte Vite plugin,
externalize dependencies, then apply the same esbuild minification and compression.
The stock size command uses `vite build` and cannot build Svelte's package entry.
The Svelte base/current gzip sizes are 2,292/2,362 bytes; Brotli is 2,074/2,142.

| Package | Gzip delta (bytes) | Brotli delta (bytes) |
| --- | ---: | ---: |
| db-ivm | -144 | -132 |
| db | +323 | +287 |
| react-db | -302 | -247 |
| preact-db | +75 | +71 |
| vue-db | -58 | -58 |
| solid-db | -23 | -23 |
| angular-db | 0 | +11 |
| svelte-db | +70 | +68 |
| **All eight** | **-59** | **-23** |
| **Typical tree-shaken app** | **-123** | **-13** |

The eight-package gzip total falls from 131,232 to 131,173 bytes. The typical
app falls from 96,633 to 96,510 gzip bytes. The aggregate and typical app shrink;
this does not imply every package or scenario shrinks. The optimistic-action
scenario still grows 85 Brotli bytes while shrinking 111 gzip bytes.

Raw production source is 1,962 bytes smaller than the PR base. Test source grows
135,467 raw bytes across the full PR, including the new oracle. These source
counts are separate from the shipped bundle measurements. Review records,
contract documentation, and the changeset are excluded from production bundles.

### Validation and unchanged scope

All Vitest jobs run serially, each with at most two workers, coverage and runtime
typechecking disabled. Separate TypeScript checks cover db, db-ivm, React,
Angular, Vue, and Solid; Svelte's checker reports zero errors and warnings.
The six framework conformance drivers, including both React registrations, pass.
Additional selected checks cover ordinary hooks, disposal, strict mode,
abandoned renders, Suspense recovery and warm caches, descriptor binding and
release, hydration, SSR effects, native result shape, Vue publication, and Solid
readiness boundaries. No test or oracle budget is removed by this pass.

The existing oracle-first RED, reach counts, isolated mutant rejections, and
process qualifications above remain the bug-fix evidence. This pass changes no
oracle judgment or grammar and claims no new closure boundary. The documented
successful-shrink-path replay gap remains open under its existing owner.

Final selected validation: 6,651 core/replay, 82 IVM, 798 React, 92 Angular,
148 Vue, 132 Solid, 145 Svelte, and 143 Preact tests pass. The production-bundle
warning-erasure check also passes: **8,192 passed**, with one existing Angular
TODO. These counts exclude earlier repeated runs. The final core run follows
the allocation-free status guard; the final React run follows the cache and
status-cleanup consolidation. Changed-source lint, `pnpm lint:changed`, formatting,
and `git diff --check` pass.

## Final publication review, 2026-11-02

Two fresh reviewers independently examined the final local snapshot, including
all seven changed production files, the shared framework shape owner, the
negative-window owner, receiving drivers and replay registration. Neither found
an actionable defect or a worthwhile additional simplification. These were
source-and-evidence reviews, with no additional test executions. The tested
package-diff and new-oracle hashes above remain unchanged. The built-in
code-review wrapper was unavailable, so these are local snapshot reviews.

The two unresolved comments in CodeRabbit review `5719210657` cover published
head `d4ca8d7d18d4c9bc29055adf10f44e32076e2d0b`. Both were evaluated with an
executable probe against that resolver and the final resolver:

| Item | Claim | Experiment and disposition |
| --- | --- | --- |
| [4428907648](https://github.com/TanStack/db/pull/2316#discussion_r4428907648) | Require a `query` property before accepting a config object, to restore the specific invalid-input diagnostic. | The PR base, reviewed resolver and final resolver reject `{}`, `{foo: 1}` and `{query: undefined}` with the same QueryBuilder error. All three reject a number through the separate live-query validation message. The proposed guard changes baseline invalid-input diagnostics. Refuted as a regression or required bug repair. Preserve diagnostic parity as a review idea when normalization changes. |
| [4428907668](https://github.com/TanStack/db/pull/2316#discussion_r4428907668) | A recorded raw pooled result can reach a missing-config access during window movement. | Both reviewed/final resolvers pass real subscribed, ready pooled a → pooled b → finite a → moved finite a → pooled b transitions, with keys `[1,2]`, `[3]`, `[1]`, `[2]`, `[3]`. The finite move reuses its Collection. Pooling rejects every defined limit, while movement requires a defined old limit, so a pooled result exits before that config access. Refuted. Keep this transition witness if either eligibility rule changes. |

The probe runs with `node --import tsx` and imports the real Collection, Query,
pooled query and resolver modules. Historical resolver copies use the same
neighboring modules to isolate their control flow. It verifies genuine pooling
through the public `materialize` member, observes public entries after microtask
drain, asserts every row sequence, and cleans up all views and the source. No
production or oracle expectation changed for these comments. The earlier two
CodeRabbit findings about documentation and originating-adapter replay remain
fixed, for four accounted items overall: two already fixed and two refuted.

The latest CodeRabbit review supplied useful adversarial probe ideas, but both
claimed consequences failed executable verification. Its suggested edits are
not sufficient evidence for a correctness gate. The fresh local reviews found
no additional item. The loss audit includes the full review bodies, inline
comments and mutable summary, including nonblocking prose. Existing R2-5/G1
and successful-shrink-path replay qualifications remain unchanged.

The existing changeset covers all eight affected packages with patch releases.
This checkout has no `scripts/check-changeset.mjs`, so package membership and
patch levels were checked directly instead. Final-head CI and mergeability are
publication gates separate from the local evidence in this record.

## Current-main integration and final byte reduction

The publication head `f9d0e9029` conflicted with main `035a5260e`. The combined
source preserves main's option-qualified React Suspense cache, lookup only for
a new binding, render-local Suspense metadata, and Solid's borrowed-row
materialization. React retains deferred window commits and its observer during
a bound-only change. Solid's current findOne projection reads the borrowed
`readData` view. The latest fetched main remains `035a5260e`.

The combined tree passed 10,308 selected tests, with one existing Angular TODO.
This includes the new main indexing, Suspense option and Solid row-isolation
receivers. Subsequent internal reductions received fresh full IVM verification
(664 tests), core cache/options verification (6,584 tests), React verification
(1,907 tests), and Svelte conformance/hook verification (162 tests). These are
repeated or overlapping campaigns, not additional unique tests to sum together.
After the timeout repair below, actual conformance registrations passed in all
six frameworks: React 277, Preact 136, Vue 131, Solid 95, Angular 86 and Svelte
128. Vitest jobs ran serially with at most two workers. Existing model rules,
history grammars, comparisons and run budgets did not change in this size pass.

The retained reductions remove intermediate or duplicated implementation state:

- TopK batches consolidate directly into per-key buckets, retaining first-seen
  key/value order and emitting all retractions before additions. The duplicate
  per-key and global batch arrays are gone.
- Internal `TopKState` specializes its sole `TopKArray` implementation directly.
  The contained object, forwarding constructor/getters, optional prefix fallback
  and unreachable B+-tree move error are gone. Public operator methods remain.
- One signed projection appends to the callers' accumulators. Unchanged support
  needs no temporary change object. The grouped operator holds one window and
  passes its read-only bounds to every group. The writer normalizes signed
  output arrays into the same downstream `MultiSet` before enqueueing.
- An internal helper shares the ordered-window recipe between grouped and
  ungrouped ordering. It captures authored options once and receives the
  specific TopK factory, so ungrouped imports do not retain grouped execution.
  Public wrapper signatures and operator-local bounds remain unchanged.
- The Suspense error cache uses one client-scope representation, with the same
  generation fence and cleanup. Hook-instance initialization remains lazy.
- Svelte passes its resolved observer options directly, removing duplicate
  projections and a wrapper. The same preload callback still resumes starts
  after subscription and on preload. Error and disposal timing remain intact.

Independent source reviews found no supported-contract regression in these
removals. They checked signed support, delta order, empty demand messages,
per-group iteration, partial bounds, repeated pipeline use, cache generations,
preload timing and option forwarding. Negative retained support remains outside
one existing bounded generated campaign; no regression was identified.
Undocumented extra-property getters on ungrouped ordering options can observe
an additional `groupKeyFn` read. No accepted ungrouped option uses that key.
Experiments that increased size were restored, including combined Suspense refs,
explicit Svelte metadata getters, a folded TopK mutation method and local hash
bounds. Eligibility guards, source ownership, error propagation, commit timing
and useful tests remain.

### Exact current-main measurements

Historical measurements against `0531c50ad` above are not the current-main
comparison. The final production builds compare exact main `035a5260e`, with
external dependencies, production minification, gzip level 9 and Brotli quality
11. The repository comparison builds seven packages; Svelte uses each revision's
Svelte Vite plugin and the same minification/compression settings.

| Package | Gzip delta | Brotli delta |
| --- | ---: | ---: |
| db-ivm | -349 | -297 |
| db | +313 | +185 |
| react-db | -3 | -5 |
| preact-db | +75 | +71 |
| vue-db | -58 | -58 |
| solid-db | -21 | -16 |
| angular-db | 0 | +11 |
| svelte-db | +42 | +31 |
| All eight | **-1** | **-78** |
| Typical tree-shaken React app | **+20** | **+54** |

The aggregate package reduction is small. It does not establish a reduction for
every application. Other scenario deltas range from -4 to +41 gzip bytes and
-43 to +128 Brotli bytes. The seven-package command is
`node scripts/size-compare.mjs --base 035a5260e --exact-base --packages db-ivm,db,react-db,preact-db,vue-db,solid-db,angular-db`.
Svelte's output is raw 5,322, gzip 2,334 and Brotli 2,105 bytes, versus main's
5,582, 2,292 and 2,074. Test sources and evidence do not enter these bundles.

### Latest CodeRabbit review and timeout repair

Review `5739361119` covers `f9d0e9029`. Its one item,
[4444565382](https://github.com/TanStack/db/pull/2316#discussion_r4444565382),
correctly identifies fixed campaign timeouts alongside scaled history counts.
A source-discovered sibling has the same mismatch at three shared window-history
registration sites. All four timeout sites now use `oracleRuns(30_000)`.
The default remains 30 seconds. Models, histories, drivers, comparisons, examples
and history budgets remain unchanged.

A deterministic recorder loaded the actual oracle registration functions and
actual run-budget configuration. It intercepted fast-check options before any
history ran. At multipliers 1/2/3, the original six shape and sixty window
registration cells all retained 30,000 ms. The proportional-budget assertion
failed at multiplier 2. After the timeout-only repair all 66 cells register
30,000/60,000/90,000 ms, and every history/example budget is identical. The
original fixed-timeout registration is the rejected mutant. Actual framework
campaigns then passed at the default multiplier as recorded above. This is
registration/configuration evidence, not proof that arbitrary multipliers finish
within the larger timeout or a new product law about elapsed time.

The reviewer supplied an accurate, appropriately minor harness consistency
finding and a minimal repair. Its static inspection did not establish an actual
framework timeout; the executable recorder establishes the metadata mismatch.
The loss audit now accounts for five external items: two earlier fixes, two
executable refutations and this timeout repair. The separately recorded sibling
is fixed too. There is no new confirmed-open product finding or design decision.
The original R2-5/G1 chronology qualification and successful-shrink-path replay
mechanics qualification remain disclosed; this integration does not repair or
retroactively satisfy them. Final pushed-head CI remains a separate gate.

Final package source/test snapshot SHA-256: `c8cc0d6ba2b61ae1af8ab6f3f4a5191335c4ff954a219f11d069a03b80b46262`. This hashes
the sorted changed package paths and contents relative to main, including the
new internal ordering helper. Full IVM664, core6,584 and Svelte162 pass on this
production source; Svelte cache/descriptor/SSR/hydration adds236 passing checks.
IVM/core/React types and Svelte checker pass, with zero Svelte warnings. Other
merged framework package types already passed and their source is unchanged.
Changed-source ESLint, oracle lint, formatting and whitespace checks pass.
The timeout formatting is semantically identical to the four recorded timeout
replacements; the 66 registration cells remain identical after formatting.
Direct workspace binaries supplied these checks because pnpm's version bootstrap
hit the configured npm proxy allowlist. No dependency override or local install
workaround enters this merge.

# Source Collection readiness and initial-query readiness

Base: `f6857fee9`. This record covers the working-tree change that adds Model D
to `packages/db/tests/query/includes-temporal-oracle.test.ts`.

## Report and law

A user reported ([TanStack/db#2113](https://github.com/TanStack/db/issues/2113)) that `useLiveSuspenseQuery` over a progressive Electric
collection suspends until the full sync completes, even when the query's rows
are present. The cause was in core. `allRequiredSourcesReady()` exempted an
on-demand source from its Collection readiness only on the lazy side of a join.
A progressive source reports `syncMode: 'on-demand'` but stays `loading` until
its full sync, so a query rooted on it waited for the whole dataset.

Law (ARCHITECTURE.md, initial readiness and law 10): initial-query readiness
requires every reachable demand to be covered by a settled request and every
source that serves no subset demand to be Collection-ready. An on-demand
source's own Collection readiness does not gate it. An Effect with
`skipInitial` ends suppression at the same point.

Authority: ARCHITECTURE.md law 10 already stated readiness as demand coverage.
The [TanStack DB 0.5 post](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync)
defines progressive mode: "First query loads immediately (on-demand)" while the
collection "syncs full dataset in background". The source readiness gate came
from the earlier `allCollectionsReady()` rule and had no separate authority.

The same review found a related Effect defect. An Effect with `skipInitial` over
an on-demand source that is already ready did not wait for its initial subset
load, so the subset rows arrived as `enter` events.

## Bug-class boundary

- **Contract:** initial-query readiness and Effect initial suppression.
- **Histories:** every legal order of delivery, settlement, source readiness,
  and one later change for a source whose Collection readiness lags its
  settled subsets (Model D grammar).
- **Production paths:** a live-query Collection preload and `createEffect`
  over direct and lazy-join on-demand roots and two eager roots, one with
  `syncMode: 'eager'` and one with the default. The live query
  also covers a single-result root (the reported `findOne` trace), an ordered
  window, and an include child.
- **Observations:** `isReady()`, preload settlement, visible rows, Effect
  events, and acquisitions at each step checkpoint.

## Witnesses and calibration

Original witness: the issue's standalone script passes with the fix and fails
on the original build with `queryReady: false, preloadResolved: false`. Its
shape is the `find-one` cell. Live query `direct: [deliver, settle, source-ready]` fails at
checkpoint 2 on the original code with `ready: false, preloadSettled: false`
while its row is visible. That is the reported behavior.

Mutants, each run against Model D. Every outcome is an assertion failure at the
named checkpoint:

| Mutant                                           | Rejecting cells                        | Checkpoint |
| ------------------------------------------------ | -------------------------------------- | ---------- |
| Live query: lazy-only exemption (original)       | 4 `direct`, 4 `find-one`, 4 `ordered`  | 2–3        |
| Live query: ignore source readiness              | 6 `eager-root`, 6 `eager-default`      | 0          |
| Effect: suppress until source readiness          | `direct`, `join` with a mid-sync change | 3          |
| Effect: ignore source readiness                  | 4 `eager-root`, 4 `eager-default`      | 1          |
| Effect: on-demand exempt, no initial participant | 24 `direct`/`join`                     | 1–2        |
| Live query: exempt every source not set `eager`  | 6 `eager-default`                      | 0          |
| Effect: no participant for lazy demand           | 12 `join`                              | 1–2        |
| Effect: no participant for the root initial load | 12 `direct`                            | 1–2        |

The last three come from the second review round. Before the `eager-default`
shape existed, the "not set `eager`" mutant passed Model D, because its eager
fixture always set `syncMode` explicitly; only the deferred-acquisition oracle
rejected it. Three more mutants survive and are equivalent within the
contract:

- Exempting an on-demand source only while it is `loading` differs only for an
  idle, errored, or cleaned-up source. An errored or cleaned-up source puts the
  live query in error first. A preload or subscriber starts an idle source's
  sync run, and a deferring query has its own readiness rule (law 15).
- Tracking initial loads without `skipInitial` cannot differ, because
  `initialLoadComplete` starts `true` without `skipInitial` and never resets.
  The production guard was redundant and is removed.
- Treating a rejected initial load as success cannot differ, because the
  rejection calls `onSourceError`, which disposes the Effect.

Receiving witnesses (ORC-014):

- `electric-live-query.test.ts`, "a live query is ready once its subset
  loads": a real Electric progressive source supplies the premise "subset
  settled, Collection loading". It fails on the original code by assertion.
- "a skipInitial effect over an on-demand source suppresses its subset rows":
  real Electric on-demand. It fails on the original code with `[1]`.
- "a skipInitial effect suppresses only its subset rows" (progressive) passes
  on the original code. Electric buffers progressive changes until the full
  sync, so it cannot supply a change between settlement and readiness. It
  rejects the no-participant mutant.
- `useLiveSuspenseQuery.test.tsx`, "releases with useLiveQuery isReady when a
  lagging source's subset settles": fails on the original code.

## Requirement outcomes

- **ORC-001:** The law, its authority, and its limits are in the Model D prose
  and the architecture document.
- **ORC-002:** `expectedLiveQueryObservation` and `expectedEffectObservation`
  compute the result from four model facts and the source mode. They import no
  production classifier.
- **ORC-003:** The prose beside the model, grammar, driver, and projection
  explains each one. The opening law list adds law 7.
- **ORC-004 and ORC-007:** Not applicable. The grammar is a fixed, exhaustive
  enumeration (108 cells), not a generated property. Exclusion: `settle` before
  `deliver` would contradict applied settlement, so it is not generated.
- **ORC-005:** Real Collections, `createLiveQueryCollection`, `preload()`, and
  `createEffect`. The observations are public.
- **ORC-006:** See the mutant table.
- **ORC-008:** Each fact is needed. `delivered` changes rows, `settled` changes
  on-demand readiness, `sourceReady` changes eager readiness, and
  `writtenAfterReadiness` changes Effect events. Each is shown by a mutant kill
  above.
- **ORC-009:** "Lagging source" is a model label for an on-demand source whose
  `markReady()` comes after its settled subsets. `source-ready` maps to
  `markReady()`, and `settle` maps to resolving every acquisition the consumer
  issued.
- **ORC-010:** Cleanup uses `finishTemporalCleanup`, which keeps the primary
  mismatch and each cleanup failure.
- **ORC-011:** Not applicable. No reviewer named a fault that the model and
  production could share.
- **ORC-013:** The eager root and the mid-sync change are the nearby witnesses
  that reject the two wrong boundaries.
- **ORC-014:** See the receiving witnesses.

## Review rounds

Four fresh reviewers attacked this change with the oracle-review skill. The
enforcement and law reviewers found no defects, but they gave
source-inspection verdicts and did not execute the mutants or tensions they
claimed to check. The mutant reviewer reported every mutant killed by all 29
React tests, including Effect mutants that the React file does not exercise.
That is a setup failure, not a comparison result, so the author reran its
mutant ideas against Model D. That run produced the second-round rows above.

## Code-review round

A `/code-review` pass found two regressions in the first Effect repair and two
in Electric that the new readiness rule exposed:

- **Effect hold latch.** The first repair put initial loads on the
  ordered-repair gate, whose failure flag never clears. A truncate during the
  initial load, or a lazy-join rekey before the first settle, aborts the
  pending acquisition without disposing the Effect, so the Effect went silent
  for good. Model D's Effect lane now crosses each history with a `truncate`
  or `rekey`, and its fixture rejects aborted acquisitions. RED: 30 disturbed
  cells failed at the first write after readiness. The repair gives initial
  loads their own hold: an aborted load releases it, and a truncate replacement
  takes it over. Two narrower repairs are rejected. Keeping the shared latch
  but passing the truncate replacement fails 10 rekey cells. Releasing without
  the takeover fails 80 truncate cells.
- **Electric reset settlement.** Outside its buffered initial sync, a
  progressive load installed no rows yet resolved at once. During a
  must-refetch before the first ready, the query became ready and empty. The
  phase matrix in `electric-live-query.test.ts` fails on the original Electric
  code in both reset phases and passes on the original core rule. The repair
  settles such a load when the collection is first ready. A first version that
  also waited during a resumed stream failed six existing Electric oracle tests
  that pin the complete-resume contract, and was narrowed to resets only.
  The resumed-stream phase is the neighboring witness.

## High-effort review round

A second `/code-review` pass (head `2812be07f`) made ten findings. Outcomes:

- **Electric progressive loads now wait on the established snapshot.** The
  separate reset waiter resolved on any abort, leaked its listener, and did
  not follow the swap's applied receipt. Progressive streams now reuse the
  `fullSnapshotReady` deferred. A must-refetch renews it, the up-to-date
  commit resolves it with its receipt, a stream abort rejects it, and a
  complete resume starts it resolved. The listener and abort findings are
  fixed by removing that code path. For the receipt window, neither a
  persisting transaction nor a held durable write made the swap's row
  invisible after up-to-date. The repair covers that window by construction,
  and the persisted test asserts the law ("ready implies the row is visible").
  A witness that reaches the window is still missing.
- **Refuted: early release of the Effect's hold.** An initial load's result
  rejects only on cleanup, which disposes the Effect first (law 14), on demand
  retirement, or on unsubscribe. Re-acquisition after detachment forwards the
  replay's completion.
- **Law wording.** The law said "every source that serves no subset demand",
  but the code checks for eager sources. The law now names eager sources.
- **Model independence.** Model D's mode rule mirrors production's
  classification. Each on-demand cell now compares its consumer with a
  metamorphic twin over a source that is ready from its start. Under the
  original rule, the twin is ready while the lagging consumer is not, so the
  twin alone rejects that design.
- **Naming and duplication.** The Effect's source check is now
  `sourcesPermitInitialReadiness`, and both Effect holds share one replacement
  handoff while keeping their own failure policies.
- **Open design decision.** A progressive source drops txids until its full
  sync. A mutation on a ready progressive query can therefore wait for that
  sync in `awaitTxId`. `useLiveQuery` already rendered rows in this window
  before this change; Suspense now does too.

## Third review round

A third high-effort review (head `19354ffce`) made ten findings:

- **Fixed: progressive loads after an `onError` retry.** A stream error
  rejected the shared snapshot deferred, and only full-log on-demand streams
  renewed it on retry. Every later progressive load rejected with the old
  error. RED: a new Electric test fails on this branch and passes on `main`.
  Progressive streams now take the same retry renewal.
- **Fixed: disturbed live-query and `queryOnce` lanes.** Model D now crosses
  every on-demand consumer with a truncate or a parent rekey. This found a
  defect that already exists on `main`: a truncate of a lazy source during
  the initial load aborted its pending demand, and the live query entered
  error. 80 cells failed at the first checkpoint after the truncate. The
  lazy demand now follows the truncate replacement, as the Effect hold does.
- **Fixed by construction:** a failed initial load no longer reads the
  Effect's subscription before it exists, a disposed Effect takes no new
  hold, and Electric's progressive snapshot getter is required, without
  dead fallbacks.
- **Cleanup:** the Effect class JSDoc sits on the class again, and the new
  helper and test use no `any`.
- **Not changed:** a lazy demand settlement can schedule two graph runs. The
  second run is idempotent, and avoiding it needs another parameter on the
  hold.
- **Tracked elsewhere:** `awaitTxId` during the full sync (#2120) and the
  narrower source-capability design (#2118).

## Predicted neighbors

The law predicts behavior for other readiness consumers. Each prediction now
has a witness that fails on the original rule:

- `queryOnce` resolves when the subset settles (Model D's `query-once` lane:
  the original rule fails 4 cells).
- A live-query observer hands a hydration seed off at subset settlement
  (`live-query-observer.test.ts`).
- Network-first initial rendering cannot combine with an on-demand source.
  The persisted-readiness oracle rejects that configuration, so the new rule
  cannot bypass the network-first gate.
- A ready progressive query's rows update only at the full sync's swap
  (`electric-live-query.test.ts`, a pinned limit).

## Adapter audit

The author checked when each on-demand adapter calls `markReady()` compared
with its subset loads:

- **query-db:** `markReady()` waits for startup retention maintenance, and
  `createQueryFromOpts` holds every subset load until that maintenance
  finishes. A settled subset therefore implies the maintenance completed.
- **PowerSync on-demand:** calls `markReady()` while sync starts, so its
  readiness does not lag.
- **TrailBase on-demand:** `load` does not wait for `recordApi.subscribe`, and
  `markReady()` follows the subscription. A live query can now become ready
  before the change listener is attached. The visible rows are unchanged. The
  fetch-versus-listen gap that the adapter's comment describes already applied
  to core subset loads; readiness no longer hides it.
- **RxDB:** has no on-demand mode.

## Exposure, grammar, and async-hold round

After three review rounds kept finding defects, the author audited every
producer and consumer of the readiness signal. The author designed the
grammar from the boundary matrix, checked it with TLA+, and listed every
outcome of every async hold.

- **Grammar.** `progressive-source-readiness-tla/` holds a bounded TLA+
  model of the frozen grammar, its trace table, the boundary matrix, and the
  exclusions. Four safe configurations pass. Nine weakened configurations
  each produce the expected counterexample: the original rule, ignoring
  eager readiness, both Effect hold defects, the lazy-truncate failure,
  settling during a reset without rows, a retry without renewal,
  recomputed readiness, and a late window continuation. One encoding
  failure (lazy demand missing after a snapshot settle) was corrected, with a
  receipt.
- **Consumers.** The shared framework conformance suite now has a lagging
  on-demand source and the readiness law for a list query, a `findOne` query,
  and the infinite query. The original rule fails each new scenario in every
  driver (13 failures, all assertions). Solid's Suspense keeps its own
  witness, because the shared suite has no Suspense surface.
- **Fixed: `toArrayWhenReady()` and `stateWhenReady()`.** They resolved as
  soon as the Collection held a row, so a live query's read could resolve
  before readiness. They now resolve through `preload()`. Model D's two new
  read lanes start the read after `deliver`. The original shortcut fails 236
  cells, all at that checkpoint.
- **Producers.** Witnesses under a real live query show that query-db,
  PowerSync, TrailBase, and the SQLite persisted wrapper settle a load only
  with its rows visible, reject real failures, and install no rows for a
  released demand. These adapters call `markReady()` early, so the witnesses
  check applied settlement, not the readiness rule. PowerSync resolves an
  aborted acquisition instead of rejecting it; the generation check ignores
  it.
- **TrailBase widened.** An `it.fails` witness shows that a query can now be
  first ready before the change subscription starts. The original rule
  passes it.
- **Async holds.** Six holds by eight outcomes: 12 new tests, 8 of 11 mutants
  killed, and 3 equivalent survivors. A progressive load that is waiting when
  a stream error arrives rejects, even if `onError` retries; a test pins
  this.

## Open cells

- TrailBase on-demand: a change committed between a subset fetch and the
  change subscription can be missed. The owner is
  `packages/trailbase-db-collection/tests/ORACLE.md`. This predates the change.

- Effect `skipInitial` over an ordered window or an include child has no lane.
- Vue, Svelte, and Angular have no Suspense surface in the shared suite.
- A persisted follower tab's load may settle before the leader's rows apply
  in that tab. Only the two-tab OPFS e2e suite can show this; it has not run.
- Electron IPC, two on-demand roots, and include children apart from lazy
  joins are not exercised.
- Whether a load that was waiting at a retried stream error is a real failure
  is a product decision.
- The Electric e2e progressive suite has no run receipt (see the coverage map).
- A rejected acquisition or a source error while a source lags is outside
  Model D.
- Before the full sync, an Electric progressive query's rows do not receive
  live changes. The source contract owns that behavior, not this law.

## Effect without `skipInitial` round

Base: `db476b8ed`. This entry covers the change that adds the
`effect-initial-rows` consumer to Model D
([TanStack/db#2117](https://github.com/TanStack/db/issues/2117)).

Law (ARCHITECTURE.md, Effects and initial readiness): every Effect passes its
gate at initial-query readiness, but `skipInitial` "only decides whether the
initial rows are delivered", and "other ordinary initial/refinement requests
keep their existing callback timing". So an Effect without `skipInitial` shows
the query's current result at every checkpoint, before readiness too. The
architecture sentence on the gate could also be read as holding initial rows
until readiness. The callback-timing sentence and the current production
behavior agree on the first reading, and the lane enacts it.

Grammar and observation: the same 156 histories as the `skipInitial` Effect
lane (direct, lazy join, and both eager roots, with truncate and rekey
disturbances). The observation is the callback-visible result rebuilt from
`enter`, `exit`, and `update` events, with a count of events inconsistent with
that result. Between a truncate and its settlement the model does not judge
the rows; the metamorphic twin does.

Reach (`createOracleReach`, bounded exhaustive cells): rows visible before
initial-query readiness, 117 cells; a row written after readiness is visible,
46 cells; truncate replay before settlement, 80 cells.

Mutants, run against the whole Model D lane. Only the new cells reject either
one; every other cell of every consumer passes:

| Mutant                                              | Rejecting cells                                   | Outcome                         |
| --------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| Without `skipInitial`, hold callbacks until the gate | 52 `direct`, 92 `join`, 4 `eager-root`, 4 `eager-default` | Assertion failure, checkpoint 1–5 |
| Ignore `skipInitial: false` (drop initial rows)      | the same 152 cells                                | Assertion failure               |

Each eager shape has two survivors: histories in which `source-ready` comes
first. No row is visible before readiness there, so both mutants are
equivalent within those histories. The earlier record's survivor, "tracking
initial loads without `skipInitial`", stays equivalent; the first mutant is
the non-equivalent neighbor that makes the argument executable.

Open: Effects without `skipInitial` over an ordered window, an include, or a
single result, and `useLiveQueryEffect`, have no lane.

## PR #2277 merge validation (2026-10-30)

Scope: self-review of the `effect-initial-rows` lane after merging upstream
`main` at `9cfa11fc712866f8f276e85762865ebb8bd49cbe` into original PR head
`d1617e95a626a15364f8f4ca9550f8ab27efa01a`. The coverage-map merge keeps
upstream's owner updates and adds this consumer to its existing temporal row.
Production code is identical to upstream. The contract and model predictions
are unchanged.

Upstream #2278 requires declared oracle parts. The new model and the existing
history grammar are now declared. The reach calibration also compares the
number of executed new-consumer histories with the grammar's enumeration,
so it checks all 156 histories rather than a literal case count. This is the
grammar calibration described by ORC-004, ORC-015, and ORC-016. The prose now
qualifies the older delta-only observation as belonging to `skipInitial`.

- **Law:** the architecture's callback-timing rule above permits ordinary
  initial callbacks without `skipInitial` before initial-query readiness.
  The independent model selects authored matching post IDs and row count;
  the recorder reconstructs the callback-visible result and invalid events.
- **Reach:** all 156 new-consumer histories execute. Measured counts remain
  117 for rows visible before readiness, 46 for a later written row visible
  after readiness, and 80 for truncate replay before settlement. A temporary
  dump of `initialRowsReach.counts()` recorded them and was removed.
- **RED:** production already conforms; this test-only merge changes no
  product behavior. The unadapted merge failed `oracle/no-unit-test` on the
  standalone reach assertion. Declaring the actual grammar and checking its
  complete execution repairs that registration gap without weakening a law.
- **GREEN:** `pnpm exec vitest run --coverage.enabled=false
  tests/query/includes-temporal-oracle.test.ts
  tests/query/includes-temporal.test.ts` passes 1,084 tests: 1,048 oracle tests
  and the 36 scenarios moved upstream. ESLint, Prettier, and targeted
  `pnpm lint:changed` pass.
- **Mutants:** holding callbacks while `!skipInitial && !reachedReady`, and
  forcing `skipInitial = true`, each fail 152 new histories: 52 direct,
  92 join, and four per eager shape. Each also fails the reach calibration
  because no pre-readiness row is visible. All 878 existing Model D histories
  and the four equivalent new histories pass. The failures are trace
  assertions at checkpoints 1–5 and the separate reach assertion; no timeout
  or setup failure is counted. Both temporary production edits were removed.
- **Limits:** observations compare row count, selected post IDs, and event
  consistency at the trace checkpoints; they do not establish every row
  field or callback timing inside a step. The ordered, include, single-result,
  framework-hook, and real-provider Effect boundaries above remain open.

The default `pnpm lint:changed` also reports an inherited removed-budget
notification for seed 271828 in the OP-SQLite replay-configuration unit test.
Upstream #2278 moved that assertion into `op-sqlite-driver.test.ts`; its
literal `numRuns: 1` describes a replay option, not a generated campaign that
was removed. This PR changes neither that package nor its budgets. The oracle
lint rules themselves pass.

## PR #2277 coverage-map clarification (2026-10-30)

Reviewed parent: `9eabde30fe8854c0a9069553444c96f128fe0d94`. The
[coverage-map review](https://github.com/TanStack/db/pull/2277#discussion_r4419844325)
identified a broader description than the recorder checks. The map now names
row count, selected post IDs, inconsistent-event count, and acquisition
observations at trace checkpoints. Histories with a truncate or rekey record
only acquisition presence. Other row fields, including joined parent IDs,
and callback timing within a step remain unchecked. The map also names the
open ordered, include, single-result, framework-hook, and real-provider Effect
boundaries already recorded above. This clarifies evidence; it changes no law
or comparison.

Five functions now have JSDoc describing their model, driver, observation,
reach, and comparison responsibilities. Compiling the oracle before and after
this documentation change with comments removed produces identical JavaScript.
ESLint, Prettier, and targeted oracle lint pass. The default lint notification
is the same upstream replay-options report explained above. The earlier
1,084-test, reach, and mutant receipts remain the execution evidence; no test
or production behavior changed in this follow-up.

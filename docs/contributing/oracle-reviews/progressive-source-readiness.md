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

## Open cells

- TrailBase on-demand: a change committed between a subset fetch and the
  change subscription can be missed. The owner is
  `packages/trailbase-db-collection/tests/ORACLE.md`. This predates the change.

- Effect `skipInitial` over an ordered window or an include child has no lane.
- Vue, Solid, Svelte, and Angular have no Suspense or readiness witness over a
  lagging source. They read the same Collection readiness.
- The Electric e2e progressive suite has no run receipt (see the coverage map).
- A rejected acquisition or a source error while a source lags is outside
  Model D.
- Before the full sync, an Electric progressive query's rows do not receive
  live changes. The source contract owns that behavior, not this law.

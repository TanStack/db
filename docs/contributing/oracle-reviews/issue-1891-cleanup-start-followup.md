# Issue #1891 cleanup-start follow-up oracle review

Reviewed semantic head: `8f0481ad1e5d096a372da7df0002c8d4c2319c9d`

Base and prior review-record head:
`355554078675c9aaf924b649d2bdcd3636e40d4a`

Initial implementation and control head:
`2fa7fada018613063c2f0d4a915f244ec68412d1`

Scope: the cleanup-start boundary in core, dependent live-query and Effect
invalidation, and the PowerSync late on-demand hook and trigger-disposal repair.
The primary executable owner remains
`packages/db/tests/collection-cleanup-restart-oracle.test.ts`. PowerSync's
`packages/powersync-db-collection/tests/load-hooks.test.ts` is a real-provider
refinement. This documentation closeout does not change the reviewed semantic
tree.

## Authority, issue history, and selected contract

Issue #1891 exposed an existing cleanup barrier rather than inventing a new
one. The API and documentation tell callers to await cleanup before starting a
new sync run. The minimal reproduction returned a held Promise from a cleanup
callback and observed public cleanup settle before that Promise continued. At
the time of the report, the callback type and Collection implementation treated
the cleanup as `void` and ignored the runtime Promise.

That defect matters even when no row assertion fails immediately. If an old and
replacement Collection use the same SQLite resource, old cleanup can affect the
replacement or persist deletes after replacement hydration. Without a cleanup
settlement barrier, an application needs a separate drain or cancellation
barrier before constructing the replacement.

Two contracts were possible:

1. Await runtime Promise-like cleanup results before terminal cleanup.
2. Define cleanup as initiation-only and expose a separate settlement hook.

The project selected the first contract. The initiation-only alternative would
have required explicit documentation and another public barrier; silently using
those semantics does not satisfy the existing cleanup and restart contract.
Issue #1889 is adjacent but distinct. It concerns late startup `markReady` and
initial-query readiness. Issue #1891 concerns settlement and invalidation of an
ending sync run. Cleanup start is not startup readiness, a Collection status, or
proof that adapter resources settled.

The earlier repair added awaitable cleanup and preserved these laws:

- concurrent cleanup callers share one Promise;
- adapter rejection ends the old run once, publishes `cleaned-up`, rejects all
  waiters with the adapter error as `SyncCleanupError.cause`, and does not retry
  the retired callback;
- a later sync run remains admissible;
- incidental non-Promise returns from contextual-`void` callbacks remain
  synchronous;
- runtime Promise-like returns are awaited even when the callback is statically
  typed to return `void`; and
- the terminal `cleaned-up` event admits restart before a continuation on the
  public cleanup Promise runs.

The previous exact-head review left two PowerSync histories open: an
`onLoadSubset` hook that returns its disposer after cleanup starts, and trigger
disposal created by that pending acquisition. Merely delaying terminal
`cleaned-up` until those resources settled was rejected. In the staged-preload
counterexample, the dependent live query remained active, accepted the late
baseline, and fulfilled preload before source-cleanup publication. The durable
design therefore needed an earlier invalidation boundary distinct from terminal
status.

At the reviewed head, cleanup start synchronously closes restart admission,
puts each dependent live query in terminal error once, marks dependent Effects
disposed, and detaches subscription demand. Throwing and reentrant observers do
not strand teardown or observer ownership. The source Collection keeps its
prior public status while adapter cleanup is pending. PowerSync owns pending
on-demand loads, late hook cleanup, already released cleanup Promises, and
trigger disposal until they settle. A pending hook-acquisition failure
participates in cleanup failure selection, while an expected transaction-abort
consequence does not replace the primary cleanup failure. Only after all owned
work settles does core publish `cleaned-up` and settle public cleanup.

## Oracle responsibilities

- **Contract:** the public cleanup/restart contract, project glossary, and
  live-query architecture authorize the two boundaries and state their limits.
- **Model:** `expectedCleanupBoundary` is an independent two-checkpoint
  timeline. It predicts restart admission, source status, public cleanup
  settlement, and a combined dependent-terminal observation.
- **History grammar:** fixed histories hold adapter cleanup at cleanup start and
  settlement. Adjacent bounded cases cover live queries, repeated aliases,
  Effects with pending handlers, abort/release reentry, nested cleanup,
  concurrent callers, throwing and late observer registration, fulfillment,
  rejection, runtime return shape, late hook return or rejection, already
  released cleanup, trigger creation and disposal, and combined cleanup
  failures.
- **Production driver:** core calls public Collection, live-query, and Effect
  entry points. PowerSync uses `@powersync/node` with a real temporary Node
  SQLite database, public source Collections, and dependent live queries.
- **Refinement check:** held gates define the observation cuts. Tests compare
  exact status, restart admission, Promise identity and settlement, exact error
  causes and precedence, dependent state, subscriber and observer ownership,
  disposer and report counts, publications, rows, adapter logs, and the process
  unhandled-rejection channel.

The model's `dependent: terminal` field is an explicit abstraction. It combines
two different public observations: live-query status `error` and
`Effect.disposed === true`. It does not claim those dependents have the same
cleanup machinery. Cleanup start maps to the internal synchronous callback
boundary. Cleanup settlement maps to the later public cleanup Promise cut.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. `Collection.cleanup()`, the await-before-restart documentation, the glossary's cleanup and cleanup-start terms, and the live-query architecture authorize the result. The exact held-Promise reproduction and same-SQLite replacement hazard establish why settlement matters. The owner remains partial: it does not establish full demand/replay histories, provider transport shutdown, wrapper-wide persistence, general row-publication laws, Effect-handler ordering beyond the pending-disposal case, or native hosts other than the tested Node SQLite path. |
| ORC-002: independent judgment | Pass. The expected timeline comes from the approved cleanup contract and rejected staged-preload counterexample. `expectedCleanupBoundary` imports no lifecycle transition, callback registry, adapter collector, or Promise classifier. Held gates and sentinel errors compute observations independently of production's cleanup queues and task sets. |
| ORC-003: distinguishable responsibilities | Pass. The five responsibilities are listed above. The executable owner keeps its contract, limits, pure model, bounded scenarios, public production drivers, recorders, and named cleanup-start and cleanup-settlement checks together. Its repeated-alias, pending-handler, throwing-observer, and late-registration refinements are explicit fixed cases outside the two-checkpoint model. PowerSync keeps provider-specific ownership and failure histories beside its real SQLite driver. |
| ORC-004: generated-history grammar controls | Not applicable. This follow-up makes no generated-history or input-grammar coverage claim. Its scenario products are bounded enumerations, and the late-hook and trigger tests are fixed controlled schedules. Reconstruction, ablation, random range, and exclusion controls are therefore not triggered. |
| ORC-005: production path and observation | Pass. Core reaches public `cleanup()`, `preload()`, `startSyncImmediate()`, live-query status, and Effect disposal. It also observes repeated aliases, pending handler settlement, cleanup-start observer counts, exact observer failures, teardown completion, and later restart. PowerSync reaches its public Collection adapter through a real `PowerSyncDatabase` using Node SQLite, a source Collection, and a dependent live query. Positive witnesses include entered hook gates, disposer call counts, source subscriber and observer counts, and trigger creation/disposal. The recorders retain early settlement, wrong status, duplicate terminal reports, wrong error cause or precedence, unexpected publication or adapter logging, and unhandled rejection at the held checkpoints. |
| ORC-006: checker calibration | Pass. At the initial implementation head, C-CORE-LIVE-START left a held live query `loading` instead of `error` (1 assertion failure, 18 passes); M-CORE-EFFECT-START observed `active` instead of `terminal` (1 assertion failure, 19 skipped); M-PS-TRIGGER-AWAIT settled both disposer lanes early (2 assertion failures, 18 skipped); C-PS-LATE-HOOK settled both late-hook lanes early (2 assertion failures, 18 skipped); and C-PS-RELEASED-HOOK settled both released-hook lanes early (2 assertion failures, 20 skipped). Final review controls reproduced duplicate alias reporting (`expected 1`, received `2`), one leaked late Effect observer (`expected 0`, received `1`), and a throwing late observer poisoning the next cleanup. The final in-flight-disposer mutant invoked without awaiting its Promise; both lanes reached the disposer and then failed the pending-settlement assertion (2 failures, 25 skipped). Every temporary mutation and control was restored. None was a timeout, setup failure, or unreached path. |
| ORC-007: fixed and random campaigns with direct replay | Not applicable. No important generated property, generator, seed, run budget, shrink path, or replay interface changed. The bounded and fixed controls do not claim random coverage. |
| ORC-008: stateful-model minimality | Not applicable. `expectedCleanupBoundary` is stateless recomputation over a prior status and checkpoint. It does not introduce, remove, combine, or split mutable state in a stateful reference model. The distinct cleanup-start and cleanup-settlement inputs preserve the next-action distinction that restart admission exposes. |
| ORC-009: vocabulary mapping | Pass. `cleanup start`, cleanup, restart, sync run, Collection status, settlement, demand, physical acquisition, and acquisition release retain their glossary meanings. The model-only `dependent: terminal` abstraction maps explicitly to live-query terminal error or Effect disposed. Cleanup start is an internal invalidation cut, not the terminal `cleaned-up` status; cleanup settlement is distinct from the terminal event's earlier restart-admission cut. PowerSync's cleanup collector and shared active trigger-disposal Promise express implementation ownership, not new public lifecycle states. |
| ORC-010: failure fidelity and cleanup | Pass. The tests do not shrink or normalize failures. Exact sentinel identity, `SyncCleanupError.cause`, settlement order, raw publication arrays, adapter logs, and unhandled-rejection arrays preserve the violated law and checkpoint. Core releases held gates, completes teardown after an observer throws, and cleans dependents in `finally`. PowerSync attempts all owned work, deterministically prefers trigger-disposal failure over later collector inspection, adopts a hook-acquisition failure without double logging it, and does not promote expected `SyncTransactionAbortedError` collateral to the primary cleanup failure. `withTestCleanup` retains the primary harness failure as `AggregateError.cause` and keeps secondary cleanup errors distinguishable. The mutants were restored before green verification. |
| ORC-011: independent second formulation | Pass. The named shared-fault hypothesis is that core or a wrapper starts cleanup but discards a returned Promise or late-owned task. Core's in-memory timeline, the prior persisted same-resource/retired-owner refinement, and PowerSync's real SQLite hook/trigger path use meaningfully different machinery. Repeated-alias live-query reporting, pending Effect-handler disposal, and throwing or reentrant observer registration independently test cleanup-start invalidation and ownership. These formulations share only the settlement, invalidation, once-only release, and primary-failure laws. They make no equivalence claim about row ordering, projection, duplicates, or nonempty results. The same-SQLite multi-process and mobile-host risks remain outside this review. |

ORC-012 is satisfied by this versioned record for semantic head
`8f0481ad1e5d096a372da7df0002c8d4c2319c9d`. It records every ORC-001 through
ORC-011 outcome and is linked from the coverage map. The initial
`2fa7fada018613063c2f0d4a915f244ec68412d1` head remains only as provenance for
the controls and pre-fix review findings described below.

## Calibration details and counterexamples

At the initial `2fa7fada` implementation head, the PowerSync trigger mutant
changed `disposeTrackingAfterAbort()` from an owned Promise in
`Promise.allSettled([trackingDisposal, ...pendingLoads])` to fire-and-forget.
Both fulfillment and rejection lanes reached disposer invocation. While the
disposer gate remained held, the public cleanup Promise settled. The restored
implementation stayed pending, then fulfilled or rejected with the exact
sentinel cause after release.

The initial late-hook control held `onLoadSubset` before it returned a cleanup
callback. Cleanup start had to make the dependent live query terminal
immediately while the source status stayed `ready`. Releasing the hook installed
its disposer without creating a trigger. Public cleanup remained pending until
that disposer settled. The rejection lane produced one `SyncCleanupError` with
the sentinel cause and no unhandled rejection. Rows and publication arrays
stayed empty.

The already released hook control retired the live query first. Its held hook
cleanup was no longer in the active demand map when Collection cleanup began.
The restored adapter adopted that Promise into the cleanup collector. Both
lanes remained pending, invoked the hook once, and produced no unhandled
rejection. This distinguishes ownership from mere presence in the current
demand map.

The initial core live-query control kept only the terminal `cleaned-up`
listener. With source cleanup held, the exact cleanup-start checkpoint observed
live-query status `loading` instead of `error`. This is the same missing
distinction that made the staged-preload counterexample possible.

Final core review reproduced three ownership and once-only failures before the
fixes in `8f0481ad`:

- two lexical aliases for one source emitted two terminal error reports instead
  of one;
- an Effect registered during active cleanup disposed immediately but retained
  one cleanup-start observer; and
- an immediately throwing late observer remained registered and rejected the
  next cleanup.

The repaired lifecycle removes a late observer when its immediate registration
callback throws. Effect registration releases the callback when cleanup becomes
active before the unsubscribe handle can be retained. A fatal live query now
ignores later alias notifications. Focused coverage also holds an Effect handler
open while cleanup start disposes the Effect and releases its source
subscription, and proves that a throwing observer still allows adapter teardown,
terminal publication, guard release, and later restart. Omitting cleanup-start
delivery from the final core tree produced three intended assertion failures.

Final PowerSync review exposed two more failure-loss paths. First,
reconciliation could claim an in-flight trigger disposer after cleanup took its
snapshot. The cleanup-owned call then saw no published disposer and settled
without joining the invocation already in progress. The shared
`activeTrackingDisposal` Promise makes both owners join the same settlement.
The fulfillment and rejection lanes remain pending through disposer invocation;
a mutant that invoked but did not await the disposer failed both pending checks.

Second, rejection directly from a pending `onLoadSubset` hook was awaited but
discarded. The active cleanup collector now retains that failure. The first
broader repair treated every captured pending-load rejection as a cleanup
failure, but the staged-baseline collateral test showed that this incorrectly
promoted an expected `SyncTransactionAbortedError`. The final repair records the
hook-acquisition failure at its boundary and leaves expected transaction-abort
collateral secondary. A combined probe rejects hook cleanup first and trigger
disposal later: cleanup waits for both, deterministically reports the trigger
error, emits no duplicate adapter log, and creates no unhandled rejection.
Ordinary unload remains synchronous and reports a later unadopted hook failure
exactly once.

Two earlier controls remain independent evidence rather than final-head
mutants. The prior R4 ordering mutant produced
`adapter cleanup -> public Promise continuation -> cleaned-up event`; the core
oracle rejected it because the terminal event must precede the continuation.
The terminal-only delay candidate awaited late PowerSync resources but left the
dependent live query active. Its staged preload fulfilled before cleanup
publication; the expected outcome was rejection at cleanup start. The assertion
failure removed that candidate in favor of cleanup start.

## Verification and prior reviewed-head receipts

At the reviewed head:

- the cleanup/restart oracle passed 24 of 24 tests;
- the Effect collateral suite passed 86 of 86 tests;
- the Collection subscription-lifecycle collateral passed 445 of 445 tests;
- DB TypeScript and targeted ESLint checks passed;
- the full PowerSync package passed 170 of 170 tests across 11 files with no
  type errors;
- the PowerSync production build and targeted ESLint check passed;
- the final no-await in-flight trigger-disposal mutant failed both intended
  assertions and was restored; and
- `git diff --check` passed before this documentation closeout.

The initial `2fa7fada` implementation receipts were 32 of 32 focused core and
Effect tests, 22 of 22 focused PowerSync load-hook tests, and 165 of 165 full
PowerSync tests across 11 files, plus the stated DB, DB IVM, PowerSync, lint,
format, and diff checks. One earlier PowerSync package run at that stage raced
its build and could not resolve `dist/esm/index.d.ts`; that was a setup-order
failure, and the post-build 165-test rerun was green.

The ancestor record
[`issue-1891-async-cleanup.md`](issue-1891-async-cleanup.md) reviewed semantic
head `21ed924352e91e47f0643de6d2542051ddd12d20` and was versioned by
`355554078675c9aaf924b649d2bdcd3636e40d4a`. Its receipts were 349 core tests,
292 persistence tests with one existing todo, and 154 PowerSync tests, plus the
stated type, lint, format, and build checks. That record classified pending late
hooks and trigger disposal as an open design gap and named cleanup start only as
the destination. This follow-up implements and calibrates that destination; it
does not rewrite the earlier verdict.

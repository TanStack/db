# Issue #1891 asynchronous cleanup oracle review

Reviewed semantic head: `21ed924352e91e47f0643de6d2542051ddd12d20`

Scope: the cleanup-settlement repair in
`packages/db/tests/collection-cleanup-restart-oracle.test.ts` and the adjacent
focused refinements in
`packages/db-sqlite-persistence-core/tests/persisted.test.ts` and
`packages/powersync-db-collection/tests/load-hooks.test.ts`. This documentation
closeout does not change the reviewed semantic tree.

## Claim and limits

The public `Collection.cleanup()` contract, the `CleanupFn` contract, and the
contributing glossary authorize the core law. Cleanup invalidates the old sync
run and starts local teardown synchronously. If that run owns adapter cleanup
work, the work settles before the Collection publishes `cleaned-up`. The
terminal status event admits a new sync run. A continuation attached to the
public cleanup Promise runs later.

Concurrent callers receive one Promise. A rejected adapter cleanup still ends
the old sync run once, publishes `cleaned-up`, and rejects each waiter with the
adapter error as the `SyncCleanupError` cause. It does not retry the retired
callback. A later sync run remains admissible. Cleanup treats an incidental
non-Promise return from a contextual-void callback as synchronous. It awaits a
runtime Promise-like return even when the callback is statically typed to
return `void`.

The core owner is a partial oracle. It does not establish full demand or replay
histories, provider transport shutdown, persistence-wrapper behavior, or
general row-publication laws. The adjacent persistence and PowerSync tests
refine the same settlement boundary for their wrappers. They do not expand the
core owner's row or transport claims.

The five oracle responsibilities are visible as follows:

- **Contract:** the oracle opening and this record state the cleanup and restart
  law, authority, observation cuts, and limits.
- **Model:** cleanup is a closed admission interval. Same-stack invalidation
  starts it. Adapter settlement and terminal status publication end it. The
  terminal event admits restart before public Promise continuations run.
- **History grammar:** the core matrix crosses abort versus release reentry,
  nested cleanup, and one versus two restart attempts. Focused cases add
  fulfillment, rejection, runtime return shape, concurrent waiters, and event
  versus awaited restart.
- **Production driver:** the tests call the public Collection entry points. The
  adjacent refinements drive the real persisted wrapper and a real PowerSync
  Node SQLite database through public Collections and live queries.
- **Refinement check:** the tests compare exact status, event and continuation
  order, Promise identity and outcome, error cause, callback counts, ownership,
  subscriber counts, unhandled-error channels, and later restart behavior at
  named gates.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass. `Collection.cleanup()`, the `CleanupFn` documentation, and the glossary's cleanup and restart terms authorize the expected result. The oracle opening and this record exclude full demand/replay, provider transport, wrapper-wide persistence, and general publication claims. |
| ORC-002: independent judgment | Pass. The expected order comes from the public contract: adapter settlement, terminal status publication, then public Promise continuation. Held gates and sentinel errors supply the expected observations without importing lifecycle transitions, cleanup classifiers, or adapter settlement helpers from production. |
| ORC-003: distinguishable responsibilities | Pass. The responsibilities are listed above. The executable owner keeps the contract and model in its opening, the bounded `scenarios` matrix beside the focused histories, public Collection drivers in each test, and exact refinement assertions at controlled checkpoints. |
| ORC-004: generated-history grammar controls | Not applicable. The repair makes no generated-history coverage claim. Its matrix is bounded enumeration, and the adapter refinements are fixed controlled histories. |
| ORC-005: production path and observation | Pass. Core tests call public cleanup, start, preload, and status subscription entry points. Persistence tests use `persistedCollectionOptions`, same-resource replacement, and real coordinator ownership. PowerSync tests use a real Node SQLite database, source Collection, and live queries. Gates prove that public cleanup remains pending; exact status, error cause, call count, ownership, and global error-channel assertions preserve the promised violations. |
| ORC-006: checker calibration | Pass. The R4 ordering mutant resolved the public cleanup Promise before scheduling terminal status. The gated core test reached the intended checkpoint and failed its exact order assertion with the public continuation before the `cleaned-up` event. This was an assertion failure, not a timeout, setup failure, or unreached path. The mutant was fully restored. Pre-fix witnesses also produced early core restart, duplicate persistence ownership, skipped teardown, early PowerSync settlement, and unhandled adapter rejection at their intended checkpoints. |
| ORC-007: fixed and random campaigns with replay | Not applicable. The repaired owner and adjacent refinements contain no important generated property. |
| ORC-008: stateful-model minimality | Not applicable. The repair does not add, remove, combine, or split state in a stateful reference model. The bounded relation still distinguishes pending cleanup, terminal cleanup, and a later sync run because restart legality and public settlement distinguish those cuts. |
| ORC-009: vocabulary mapping | Pass. The model-only phrase `cleanup admission interval` maps to the time from same-stack sync-run invalidation through terminal `cleaned-up` publication. `Sync run`, cleanup, restart, logical owner, physical acquisition, acquisition lease, and Promise settlement retain their glossary meanings. Adapter cleanup settlement and public cleanup Promise continuation are separate observations. |
| ORC-010: failure fidelity and cleanup | Pass. The tests do not shrink or normalize traces. Exact sentinel identity, `SyncCleanupError.cause`, ordered observations, and unhandled-error arrays preserve the primary violation. Persistence uses `cleanupPersistedOracle`; PowerSync uses `withTestCleanup`. Both attempt every cleanup and retain secondary diagnostics. Core gates are released in `finally`, and retired callbacks are not retried. |
| ORC-011: independent second formulation | Pass. The named shared-fault hypothesis is that a wrapper starts cleanup but discards a returned Promise. The core in-memory driver checks the public lifecycle relation. Persistence independently checks same-resource replacement, retired remote-owner fencing, and all-task settlement after a synchronous runtime failure. PowerSync independently checks eager provider disposal and already-acquired on-demand hooks through real SQLite. These paths share only the cleanup settlement and once-only release law; row ordering, projection, duplicates, and empty results are not part of this cleanup claim. |

ORC-012 is satisfied by this versioned record. It identifies the exact reviewed
semantic head, records every ORC-001 through ORC-011 outcome, and is linked from
the coverage map.

## Calibration and semantic-head receipts

The R4 mutant changed only terminal ordering. The driver had already attached a
continuation and then released the adapter gate. Production reached adapter
settlement and both public observations. The exact comparison rejected the
wrong sequence `adapter -> public continuation -> cleaned-up event`; the
required sequence is `adapter -> cleaned-up event -> public continuation`.

Additional RED/GREEN controls reached these missing laws:

- An incidental numeric return from a contextual-void cleanup incorrectly
  delayed core restart. Runtime Promise-like classification repaired it.
- A persisted source retired during synchronous entry later registered remote
  ownership. A same-ID replacement exposed the duplicate owner.
- A synchronous persisted runtime-teardown failure settled public cleanup
  before held source cleanup and skipped later release attempts.
- Eager PowerSync cleanup settled before held trigger disposal. The rejection
  lane escaped through the global error channel.
- Active on-demand PowerSync cleanup settled before held hook cleanup, swallowed
  a synchronous throw, and failed to await every reentrant release.

At the reviewed head, the core focused owner campaign passed 349 tests with no
type errors. Persistence passed 292 tests with one existing todo and passed its
type check. PowerSync passed 154 tests and its type, lint, format, and package
build checks.

## Known limits and tracked follow-up

PowerSync cleanup now awaits eager trigger disposal and every already-acquired
on-demand hook. Two on-demand histories remain outside this repair:

- an `onLoadSubset` hook that is pending when cleanup starts and returns its
  cleanup callback only after retirement;
- provider trigger disposal created by that pending on-demand acquisition.

A held on-demand trigger disposer proved that public cleanup can settle before
disposal. A candidate that delayed terminal `cleaned-up` until that work settled
made the disposer checks pass, but violated the existing staged-subset baseline
law: a held dependent preload could fulfill before source-cleanup publication.
The candidate was removed. This is a confirmed design gap, not green evidence.

The durable destination is one core cleanup-start/intermediate signal distinct
from terminal `cleaned-up`. Adapters can use that signal to retire and await
pending or late hooks and on-demand trigger disposal without allowing a staged
dependent preload to fulfill during cleanup. That destination must be designed
with the pending/late on-demand hook history; this review does not claim it is
implemented.

## Dual-failure reconciliation

Reviewed semantic head: `228b68f7`

A later review found two sibling cleanup paths that awaited every teardown but
reported only one rejection. The persisted wrapper preferred source cleanup and
dropped runtime teardown. Eager PowerSync preferred the load-hook cleanup and
dropped trigger disposal. The PowerSync loss was deterministic once both
resources existed; callback completion order did not change the winner.

Controlled pre-fix probes reached both production paths. The persisted probe
observed only the exact source error. The PowerSync probe observed only the
exact load-hook error in both controlled completion orders. The repaired paths
keep source cleanup and trigger disposal primary, respectively. Each now uses
an `AggregateError` to retain the secondary diagnostic. Lone failures keep their
prior identity.

The coverage gap was a missing dual-rejection history. Existing tests exercised
each cleanup source separately. The persisted-history owner now crosses source
and runtime rejection in one public cleanup. The PowerSync load-hook refinement
crosses hook and trigger rejection in both completion orders. Both tests assert
the public `SyncCleanupError`, aggregate cause, ordered error identities,
once-only callbacks, and terminal status where applicable.

This reconciliation adds focused histories, not a generated-history or new
state-model claim. ORC-001, ORC-002, ORC-005, ORC-006, and ORC-010 are satisfied
by the established cleanup contract, independent sentinel errors, public
Collection drivers, recorded pre-fix assertion failures, exact error identity,
and bounded resource cleanup. ORC-003, ORC-004, ORC-007, ORC-008, ORC-009, and
ORC-011 are not triggered by these focused refinements. This versioned section
satisfies ORC-012 for the reconciliation.

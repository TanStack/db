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

## Design-grammar and loss-audit closeout

Reviewed semantic head: `ccef1e2ea6f6ea04740a27d7de6efde3424ecca6`

This closeout adds the Query DB cleanup helper and public Query-backed
Collection witness to the reviewed scope. It also re-audits the core cleanup
oracle, persisted wrapper, and PowerSync wrapper after the failure-retention
repairs. A later documentation-only receipt commit does not change this
semantic tree.

### Intended law and minimal grammar

The retained model has five primitives:

1. An active sync run owns cleanup obligations.
2. Same-stack cleanup invalidation creates one shared retirement ticket.
3. An ordered obligation ledger waits for every acquired cleanup obligation.
4. A deterministic failure algebra preserves every failure, its role, and its
   ownership order; a lone failure keeps its identity.
5. The public observation trace is invalidation, obligation settlement,
   terminal `cleaned-up` publication, public retirement Promise continuation,
   and only then an ordinary replacement run.

The wrappers refine that grammar rather than adding unrelated Cartesian axes:

| Refinement | Primary role | Later retained roles |
| --- | --- | --- |
| Core | adapter cleanup | local teardown |
| Persistence | source cleanup | runtime releases in release order |
| PowerSync eager | trigger disposal | load-hook cleanup |
| PowerSync on-demand | first acquired cleanup obligation | later obligations in ledger order |
| Query DB | adapter cleanup | QueryClient unmount |

A contextual-void callback may return an incidental non-Promise value; that is
synchronous completion. A native Promise or structural thenable is an
obligation and must settle. Fulfillment and rejection both close the old run;
rejection remains observable after terminal publication. Completion timing
never chooses the primary failure.

### Loss-audit retention decisions

The audit retained the distinctions that can change a promised observation:

- active run, retirement pending, terminal publication, public Promise
  settlement, and replacement run remain separate cuts;
- zero, one, and multiple obligations remain distinguishable;
- incidental values, native Promises, and structural thenables remain separate
  runtime return classes;
- synchronous throw, asynchronous rejection, and multiple failures remain
  separate settlement shapes;
- abort and release reentry, nested cleanup, and repeated restart attempts
  remain explicit grammar coordinates;
- one and multiple wrapper-owned resources remain separate because the latter
  exposes dropped diagnostics and order-dependent precedence;
- wrapper priority is a named refinement mapping, not an implicit scheduling
  accident.

The audit deliberately did not import demand replay, row publication, provider
transport, or adapter-specific startup into the cleanup grammar. A pending
PowerSync hook discovered after cleanup starts belongs to the cleanup-start
signal design in PR #1897. Those behaviors may share code paths, but no cleanup
observation here can judge their full contracts.

### Grammar reconstruction, ablation, range, and exclusion

**Reconstruction.** Every known valid cleanup witness in scope maps to the five
primitives: synchronous and asynchronous cleanup, structural thenables,
fulfillment and rejection, concurrent and nested cleanup callers, terminal
event and awaited restart, and each wrapper's resource roles. No known witness
requires a sixth lifecycle state or a wrapper-specific copy of the model.

**Ablation.** Each declared coordinate has a named contribution. Removing
abort or release loses one reentry boundary. Removing nested cleanup loses the
shared-ticket check. Removing the second attempt loses repeated early-admission
pressure. Collapsing return classes recreates the truthy-number or hidden-
thenable bugs. Collapsing settlement shapes loses rejection ordering and lone-
error identity. Collapsing ownership count loses later failures. Removing a
wrapper row loses its public resource mapping and precedence law. The
executable `2 × 2 × 2` admission calibration proves eight unique cells and one
execution coordinate per declared cell.

**Range.** The bounded admission axes are abort or release, nested cleanup on
or off, and one or two restart attempts. Focused margins cover zero/one/many
obligations, incidental/native/structural returns, synchronous/asynchronous
failure, both completion orders, and one/two wrapper failures. No independently
supplied held-out marginal case was available after construction, so formal
external range validation remains untested. A later range evaluation should
supply a behavior-preserving witness without changing the grammar first; the
model succeeds only if that witness reconstructs from the existing primitives
and the checker reaches its named public checkpoint.

**Exclusion and negative controls.** The grammar rejects restart before
terminal publication, duplicated physical release, a dropped secondary
failure, treating a truthy non-Promise as a Promise, and ownership published by
a retired run. Pre-fix production reached and failed the intended checkpoints:
Query DB threw `TypeError: result.then is not a function`; persistence exposed
only the first runtime release error; PowerSync exposed only the first acquired
hook rejection in both controlled completion orders. These were assertion
failures, not timeouts, setup failures, or unreached paths.

### ORC-001 through ORC-012 reconciliation

| Requirement | Outcome at the reviewed semantic head |
| --- | --- |
| ORC-001: contract authority and limits | Pass. The public cleanup contract and glossary authorize settlement, terminal publication, and restart. The oracle opening and this record exclude replay, publication, provider transport, and late-acquisition design. |
| ORC-002: independent judgment | Pass. Held gates, structural thenables, sentinel identities, ordered public observations, and a role table derive expectations without importing production cleanup classifiers or failure selectors. |
| ORC-003: distinguishable responsibilities | Pass. Contract and model are in the oracle opening; named axes form the grammar; public Collections and wrappers are the drivers; exact status, order, identity, count, and ownership assertions are the refinement checks. |
| ORC-004: generated-history grammar controls | Not triggered because this remains bounded enumeration, not a generated-property claim. Reconstruction, ablation, range, and exclusion are nevertheless recorded above, and unique-cell calibration is executable. |
| ORC-005: production path and observation | Pass. Core, persistence, and PowerSync drive public Collections. Query DB directly checks helper composition and separately proves the real public wrapper mounts and unmounts QueryClient exactly once. A supported public seam for injecting arbitrary async internal Query cleanup does not exist; no private seam was added. |
| ORC-006: checker calibration | Pass. The prior R4 ordering mutant remains killed. New pre-fix controls separately killed truthy non-Promise classification and both same-role failure-dropping designs at their intended assertions. |
| ORC-007: fixed/random campaigns and replay | Not triggered. No important randomized property was added or claimed. |
| ORC-008: stateful-model minimality | Not triggered by a state-model shape change. The audit still retained five observable cuts because restart legality and Promise ordering distinguish each adjacent pair. |
| ORC-009: vocabulary mapping | Pass. Active sync run, cleanup, restart, logical owner, physical acquisition, and Promise settlement retain glossary meanings. `Retirement ticket`, `obligation ledger`, and `terminal publication` are model descriptions mapped above to the public cleanup Promise, acquired cleanup work, and the `cleaned-up` status event. |
| ORC-010: failure fidelity and cleanup | Pass. Core and PowerSync hostile harness controls retain a primary mismatch plus every cleanup failure. Persistence now calibrates both modes: it aggregates cleanup failures when there is no primary and records all secondary diagnostics without replacing an existing primary. All actions are attempted. |
| ORC-011: independent second formulation | Pass within scope. The core public lifecycle uses a structural thenable; Query's direct helper isolates wrapper composition while the public QueryClient witness proves real mount/unmount wiring; persisted ownership replacement and real PowerSync SQLite hooks independently test wrapper refinement. Query's public witness does not claim arbitrary async adapter injection. |
| ORC-012: review evidence | Pass. This exact-head record accounts for ORC-001 through ORC-011, including non-triggered requirements and the unresolved held-out-range limitation. |

### Exact-head receipts

Environment: Node `v24.19.0`, pnpm `11.1.0`, Vitest `3.2.4`, Darwin
`arm64`.

At baseline head `efa90005248c7274795e489aa08e494914215483`, the new RED
controls produced one Query failure, one persistence failure, and two
PowerSync failures. At semantic head
`ccef1e2ea6f6ea04740a27d7de6efde3424ecca6`:

- the core cleanup oracle passed 25 of 25 tests;
- Query cleanup composition passed 8 of 8 tests, including the public wrapper
  witness;
- the selected persisted cleanup and harness histories passed 8 of 8 tests
  with 240 unrelated tests skipped by the name filter;
- the PowerSync load-hook file passed 25 of 25 tests;
- TypeScript checks passed for DB, SQLite persistence, and PowerSync;
- Query DB's package build, including declaration generation, passed. Its broad
  TypeScript configuration also traverses DB collection E2E suites and failed
  only because `@tanstack/electric-db-collection` was not resolvable in this
  checkout; no changed Query file produced a diagnostic;
- DB, SQLite persistence, and PowerSync package builds also passed, and the
  documentation link check found no broken links;
- targeted ESLint reported zero errors. Its 22 warnings are pre-existing
  `require-await` warnings in the persisted test file outside the changed
  lines;
- Prettier and `git diff --check` passed.

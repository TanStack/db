# RFC: Operation Journal for optimistic writes and collection state

Status: draft for maintainer review  
Date: 2026-06-25

## Summary

TanStack DB should make collection-owned write operations first-class by introducing an internal **Operation Journal**. The journal becomes the single source of truth for unsettled optimistic writes, write status, write errors, and recoverable resolution state.

The core state model should become:

```txt
authoritative synced/base state
+ unsettled optimistic operations owned by the collection
= visible collection state
```

This lets collections apply authoritative sync updates immediately, even while optimistic writes are pending, and then reproject optimistic operations over the updated base. The current behavior of delaying normal sync commits behind `persisting` transactions should be treated as an implementation limitation, not a semantic contract for 1.0.

This RFC focuses on the core design needed for 1.0:

- Introduce an Operation Journal as a refinement of current transaction/mutation state.
- Always apply committed authoritative sync/base changes immediately.
- Reproject unsettled optimistic operations over the latest base state.
- Preserve the existing simple live-query DAG model.
- Replace ambiguous `$synced` / `isPersisted` concepts with clearer local write state.
- Expose queryable operation records for write status and write errors.
- Add a `needs-resolution` status for explicit recoverable validation/business-rule failures.
- Retain failed operation records with bounded automatic GC.
- Slim `@tanstack/offline-transactions` into durability/execution over the journal.

This RFC intentionally does **not** design backend observation/confirmation semantics, stable view keys, sync batch API changes, dependency-aware rollback, nested transactions, or full patch/conflict semantics. Those become easier once operations are first-class, but they should be separate focused work.

## Motivation: issue cluster

These issues are not independent. They mostly come from the same architectural gap: local optimistic intent, authoritative base state, transaction status, persistence status, and errors are spread across several overlapping mechanisms instead of one write-operation model.

| Symptom group | Representative issues / PRs | Architectural cause | RFC response |
| --- | --- | --- | --- |
| Sync delayed or inconsistently visible while optimistic writes are pending | #1017, #1048, #1060, #1122, #1166, #1167, #1497, historical #37 | Core currently delays normal committed sync transactions while a user transaction is `persisting`, except truncate/immediate/manual writes. This prevents collection state and derived live queries from consistently reflecting authoritative data. | Always apply authoritative sync/base updates immediately. Keep optimistic writes in the Operation Journal and reproject them over the updated base. |
| Ambiguous or missing local write status | #20, #661, #1215, #1219, #1322, #1431, #1526 | `$synced` and `isPersisted` attempt to answer too many questions: local optimistic state, local durability, mutation completion, backend upload, and sync observation. | Remove/replace `$synced` and `isPersisted` for 1.0. Add local-write-specific row props such as `$hasPendingWrites` / `$writeStatus` and queryable operation records. |
| Write errors and recoverable failures are not first-class | #22, #487, #672 | Errors are thrown, logged, or stored inconsistently. A single collection error slot is too coarse for per-write failures, validation state, or notification after navigation. | Store write errors on operation records. Add `needs-resolution` for explicit recoverable failures. Retain failed operation records briefly with bounded automatic GC. |
| Offline/persistence duplicates transaction state | #1064, #1065, #1483, #1490, #1579, #1592, #1602, #1603 | `@tanstack/offline-transactions` currently has to persist, restore, schedule, and recreate optimistic state as a second species of transaction. | Core owns the in-memory journal and projection. `@tanstack/offline-transactions` persists/restores journal operations and executes them, dramatically reducing parallel state machinery. |
| Future identity/defaults/shape fixes need a better substrate | #19, #25, #456, #465, #900, #1445, #1465 | Server-generated fields, temporary-to-server key mapping, shape evolution, and long-lived optimistic writes currently require bespoke reconciliation against snapshot-like optimistic state. | Keep this RFC focused, but make the journal the substrate that later enables stable identity, mutation receipts, and better patch/intention projection. |

## Current behavior

Core collection state currently has several overlapping state holders, including:

- `syncedData`
- `optimisticUpserts`
- `optimisticDeletes`
- `pendingOptimisticUpserts`
- `pendingOptimisticDeletes`
- `pendingSyncedTransactions`
- transaction state (`pending`, `persisting`, `completed`, `failed`)
- adapter/offline-specific pending stores and restoration flows

In `CollectionStateManager.commitPendingTransactions()`, committed sync transactions are applied only when there is no `persisting` user transaction, or when the sync is truncate/immediate:

```txt
if no persisting transaction OR truncate sync OR immediate sync:
  apply committed sync transactions
else:
  leave committed sync queued
```

This behavior was probably introduced to avoid difficult reconciliation between incoming authoritative changes and optimistic state. It is understandable, but it creates user-visible inconsistencies:

- source collection base state temporarily stops reflecting authoritative data;
- derived live-query collections may not receive unrelated synced rows;
- caches/subscriptions need special cases;
- proposed fixes are tempted to emit events without updating `syncedData`, creating split-brain semantics.

The desired 1.0 semantics should be simpler:

> Collections apply committed authoritative sync/base changes as they arrive. Pending optimistic writes are local overlays that are reprojected over the latest base.

## Goals

1. **Make local write state first-class.** Track unsettled optimistic writes as operation records, not as scattered maps and transaction side effects.
2. **Always advance authoritative base state.** A pending local write must not block unrelated authoritative sync data from entering the collection.
3. **Preserve existing DAG propagation.** Derived/live-query collections consume source collection state as final input. If a source collection’s visible state changes, downstream collections update naturally.
4. **Use precise 1.0 status names.** Replace `$synced` and `isPersisted` with names that describe local write state, not backend observation.
5. **Represent write errors on writes.** Write failures and recoverable validation state belong to operation records, not primarily to a single collection error slot.
6. **Support recoverable validation.** A mutation function can explicitly signal `needs-resolution` to preserve optimistic state and expose resolution metadata.
7. **Keep operation history bounded.** Failed operation records are useful after navigation, but long-lived apps must not accumulate unbounded transaction history.
8. **Make offline persistence a layer over the journal.** Without `@tanstack/offline-transactions`, optimistic operations are in-memory. With it, they become durable and executable across reloads.

## Non-goals

This RFC does not design:

- first-class core statuses for transport confirmation or read-path echo;
- `accepted` or `observed` milestones;
- `awaitTxId` replacement;
- PowerSync upload/read-back confirmation;
- cross-collection observation barriers;
- stable `$viewKey` / entity identity / temp-to-server key mapping;
- mutation receipt APIs;
- sync batch API redesign;
- dependency-aware rollback graphs;
- nested transactions / savepoints;
- full nested patch semantics, array patch semantics, or conflict resolution;
- a general effect/query/sync error journal.

Several of these are valuable follow-ups. The point of this RFC is to establish the write-operation substrate first.

## Proposed model

Each collection has:

```txt
authoritative synced/base state
+ unsettled optimistic operations owned by that collection
= visible collection state
```

A transaction remains the user-facing grouping concept. Operations refine the state already tracked inside transactions/mutations. Collection mutations and explicit transactions remain the primary write APIs; users should not construct raw operation records for normal writes.

A transaction’s status is coordinated with its operations:

- all operations settled -> transaction settled;
- any operation needs resolution -> transaction needs resolution;
- terminal mutation failure -> transaction failed / rolled back;
- otherwise pending.

The `mutationFn` remains the mechanism that advances the write by default:

- success -> operations settle;
- ordinary error -> operations fail and rollback according to current/default semantics;
- typed `needs-resolution` error -> operations remain in the journal with resolution metadata.

## Illustrative Operation Journal shape

Exact field names and types are implementation details. A minimal conceptual shape is:

```ts
type OperationStatus =
  | 'pending'
  | 'needs-resolution'
  | 'failed'
  | 'settled'

interface WriteOperation {
  id: string
  transactionId: string
  collectionId: string
  key: string | number

  type: 'insert' | 'update' | 'delete'
  status: OperationStatus

  // Compatibility with today's PendingMutation shape.
  original?: unknown
  modified?: unknown
  changes?: Record<string, unknown>

  error?: unknown
  resolution?: unknown

  createdAt: number
  updatedAt: number
}
```

The initial implementation can wrap or normalize today’s `PendingMutation` data. This RFC does not require perfect patch semantics before the journal exists.

## Projection behavior

The target projection model is:

```txt
visible row = project(latest base row, unsettled operations for that row)
```

For inserts and deletes, the operation semantics are straightforward.

For updates, the long-term target is to replay write intent over the latest base row. This avoids long-lived optimistic writes hiding server-added fields or unrelated remote updates. For example:

```txt
base at mutation time:   { title: 'A', priority: 1 }
optimistic change:       title = 'B'
new synced base:         { title: 'A', priority: 2, serverField: 'x' }
ideal visible row:       { title: 'B', priority: 2, serverField: 'x' }
```

However, full patch/intention projection is not required in the first slice. Phase 1 may continue using existing `modified` snapshots while establishing:

- a centralized journal boundary;
- immediate sync/base application;
- visible state projection through one path;
- operation status/error records;
- tests for derived collection behavior.

Nested patch semantics, array operations, custom codecs, and conflict detection are follow-up work.

## Sync application semantics

Committed authoritative sync/base changes should apply immediately, even while optimistic operations are pending.

Example:

```txt
Initial base:
  todos = [{ id: 1, title: 'A' }]

Local optimistic update:
  id 1 title -> 'A*'

While mutationFn is pending, sync inserts:
  { id: 2, title: 'B' }
```

Current behavior can queue the sync insert because a transaction is `persisting`, causing source or derived collections to miss `B` until the mutation settles.

Target behavior:

```txt
base immediately becomes:
  [{ id: 1, title: 'A' }, { id: 2, title: 'B' }]

visible state projects pending local operation:
  [{ id: 1, title: 'A*' }, { id: 2, title: 'B' }]
```

This should be treated as an internal correctness fix / clarified 1.0 semantics, not as a behavior to preserve behind an option.

The RFC does not require changing the existing sync writer API (`begin` / `write` / `commit`). If that API proves insufficient during implementation, a targeted follow-up can address it. The core requirement is semantic: committed authoritative changes advance base state immediately.

## Live-query and derived collections

This RFC preserves the current simple DAG model.

Each collection has state. Derived/live-query collections consume the state of their source collections as final input. If a source collection applies an optimistic mutation, downstream derived collections naturally update because the source collection state changed.

The Operation Journal does not change how derived collections choose their inputs. If an application wants different optimistic behavior in different parts of the app, it can model that with collections/query-clone collections and where mutations are applied.

The core fix is inside each collection: authoritative base state keeps advancing, and optimistic operations are projected over it. Derived collections then receive correct upstream state through the existing propagation model.

## Transport confirmation and core settlement

Adapter authors often naturally model writes in transport-specific stages:

```txt
write    -> optimistic operation is applied and the transport request starts
confirm  -> the server accepts the write, for example with HTTP 200
echo     -> the authoritative sync/read path delivers the corresponding change
```

Core intentionally does **not** model these as separate lifecycle states. TanStack DB's mutation handler boundary combines the adapter's notion of confirmation and settlement into one completion point:

```txt
pending -> mutation handler still owns the optimistic operation
settled -> mutation handler completed successfully and core can drop the optimistic operation
```

That is the intended contract. If an adapter requires the sync echo to avoid flicker, its mutation handler should await that echo before resolving. If a transport considers HTTP 200 sufficient, it can resolve there. In either case, core only sees the mutation handler as pending or complete.

This RFC preserves that semantic boundary. It does not add first-class core statuses for HTTP confirmation, sync echo, or read-path observation.

## Public status APIs

TanStack DB is pre-1.0, so 1.0 should remove or replace ambiguous APIs instead of preserving confusing compatibility.

### Replace `$synced`

`$synced` should not be the 1.0 row-level write confirmation concept. It is ambiguous across adapters and can be confused with backend upload/read-back confirmation.

Introduce local-write-specific row props instead:

```ts
row.$hasPendingWrites // boolean
row.$writeStatus      // 'clean' | 'pending' | 'needs-resolution' | 'failed'
```

`$hasPendingWrites` means:

> This row is affected by one or more unsettled optimistic operations owned by this collection.

It does **not** mean:

- backend has not observed this write;
- mutation has not been uploaded;
- local durability is missing.

Durability should mostly “just work” when `@tanstack/offline-transactions` or another durability layer is installed. Advanced/debug UIs can inspect durability on operation records if needed, but durability should not become a row-level status.

`$writeStatus` is an aggregate over the row’s relevant operation records. Exact aggregation rules can be finalized during implementation, but the intended common meanings are:

- `clean`: no unsettled optimistic operation affects the row;
- `pending`: at least one unsettled optimistic operation affects the row;
- `needs-resolution`: at least one operation affecting the row explicitly needs app/user resolution;
- `failed`: a recent failed operation affecting the row is retained in operation history, if surfaced at row level.

`$pendingOperation` from #1431 is a natural extension once operations are journaled, but it is not central to this RFC.

### Replace `isPersisted.promise`

`isPersisted.promise` should not be the 1.0 transaction waiting API.

Expose transaction waiting over the in-scope status set:

```ts
await tx.when('settled')
await tx.when('failed')
await tx.when('needs-resolution')
```

There is intentionally no `tx.when('accepted')` or `tx.when('observed')` in this RFC.

For this RFC:

```txt
settled = mutationFn completed successfully and core can remove the optimistic operation
```

Adapters that need sync/read-path echo before considering a write complete should keep the mutation function pending until that echo arrives. Core does not need a separate `accepted` or `observed` status because the mutation function completion boundary is the settlement boundary.

### Queryable operation records

Rows should expose a small ergonomic virtual surface. Detailed lifecycle/error state should be queryable through operation records, for example:

```ts
db.operations
// exact global vs collection-scoped API can be finalized during implementation
```

This lets applications build:

- global failed-write toasts;
- “save needs attention” lists;
- form-level resolution UIs;
- Devtools timelines;
- debugging views.

Users should not normally create raw operations through this API. Collection mutations and transactions remain the write API.

## `needs-resolution`

Add `needs-resolution` as an explicit recoverable write status.

This is not a retry/backoff state. Generic retrying remains the user’s `mutationFn` responsibility, an adapter responsibility, or an `@tanstack/offline-transactions` concern.

`needs-resolution` should be entered only when user/app code explicitly signals it, likely by throwing a typed/custom error from `mutationFn`:

```ts
throw new NeedsResolutionError({
  message: 'Validation failed',
  fields: {
    email: 'Already taken',
  },
})
```

Core behavior:

```txt
mutationFn throws NeedsResolutionError
-> operation.status = 'needs-resolution'
-> optimistic state remains in the journal
-> row/write status reflects resolution needed
-> operation record exposes resolution metadata
-> app can resolve by changing state and retrying, or aborting/discarding according to API design
```

Ordinary thrown errors remain terminal by default and roll back according to current/default semantics.

## Write errors and operation history

Write-related errors should live on operation records, not primarily on `collection.error`.

This addresses the deeper issue behind #672. A collection can have health/load/sync errors, but many actionable errors are tied to a particular write. A single mutable `collection.error` slot is too coarse:

- multiple errors overwrite each other;
- one row write failure does not mean the whole collection is unusable;
- retry/resolution is per operation;
- apps need to show errors after navigation;
- Devtools need identity and timestamps.

The write Operation Journal should become the primary source of truth for write lifecycle and write errors.

Collection health/error APIs may still exist for non-write collection health, but they should aggregate or reference underlying operation/effect records where appropriate.

### Retention and GC

Failed operation records should remain queryable after rollback so applications can notify users after navigation and developers can debug failures.

But the journal must be bounded. Previous attempts at global transaction stores raised memory concerns in long-lived or busy apps.

Requirements:

- Active operations (`pending`, `needs-resolution`) are retained while active.
- Historical failed operations are retained for a bounded recent-history window/count.
- Settled operations may be retained briefly for diagnostics or omitted from public query history.
- Exact TTL/count defaults are implementation details.
- Defaults should be high enough for normal toast/error-after-navigation UX.
- Applications needing long-term audit/history should subscribe/copy operation records elsewhere.

This RFC does not add explicit `acknowledge()` or `clearFailed()` APIs. Toast dismissal is app UI state, not journal state.

## Offline transactions

Without `@tanstack/offline-transactions`, optimistic operations are in-memory and are not durable across reloads unless another persistence layer provides durability.

With `@tanstack/offline-transactions`, the package should become a durability/execution layer over the core journal:

- persist unsettled operations;
- restore them into the journal on startup;
- schedule mutation execution;
- handle retry/backoff policy;
- handle connectivity hints;
- handle leader election / coordination where needed;
- mark durable operation metadata where useful.

It should not need to recreate optimistic state through separate restoration transactions or maintain a second transaction truth model.

This means `@tanstack/offline-transactions` can become dramatically slimmer. Core owns in-memory operation state and projection; the offline package owns durable storage and execution.

## Phased migration

Implementation should happen in thin vertical slices, not as a large hidden rewrite and not as public APIs backed by old internals.

### Phase 1: core vertical slice

Prove the model in `@tanstack/db` core first:

- introduce an in-memory Operation Journal around existing mutation data;
- project collection visible state through base + journaled operations;
- apply committed sync/base updates immediately;
- keep current mutation/transaction APIs working;
- expose minimal operation status internally or experimentally;
- add tests for pending optimistic write + incoming sync + derived live-query updates;
- preserve current settlement semantics: mutationFn success settles operations.

This phase should not require Electric, PowerSync, or offline-transactions changes beyond test adjustments unless current adapter code assumes delayed sync.

### Phase 2: 1.0 local write status APIs

- remove/replace `$synced`;
- remove/replace `isPersisted.promise`;
- add `$hasPendingWrites` and `$writeStatus`;
- add transaction `when(...)` over the in-scope statuses;
- expose queryable operation records;
- add bounded historical failed-operation retention;
- add `needs-resolution` typed error/status flow.

### Phase 3: offline durability over the journal

- refactor `@tanstack/offline-transactions` to persist/restore journal operations;
- remove restoration-transaction duplication;
- keep retry/backoff and connectivity concerns in the package;
- validate durability with reload/restart tests.

### Later follow-ups enabled by the journal

These should be separate RFCs or PR series:

- stable `$viewKey` / entity identity (#19);
- mutation receipts for key mapping and server defaults (#456, #465, #900, #1465);
- stronger patch/intention replay for long-lived optimistic writes (#25);
- `$pendingOperation` and pending-delete query semantics (#1431);
- first-class transport confirmation/read-path echo APIs and `awaitTxId` integration;
- effect/query/sync error journals;
- advanced scheduling/dependency strategies;
- nested transactions/savepoints, if still needed.

## Testing and invariants

The refactor should be protected by invariant-focused tests.

Core invariants:

1. A pending local optimistic write does not prevent unrelated authoritative sync data from entering base state.
2. Derived/live-query collections see source collection state changes while optimistic writes are pending.
3. A row affected by an unsettled optimistic operation has `$hasPendingWrites = true`.
4. Successful `mutationFn` completion settles operations by default.
5. Ordinary `mutationFn` failure rolls back and records a bounded failed operation.
6. Typed resolution errors keep optimistic state visible and set `needs-resolution`.
7. Failed operation history is bounded by automatic retention.
8. Without offline-transactions, journal state is in-memory only.
9. With offline-transactions, pending operations can be restored without inventing a second optimistic transaction model.

Representative regression scenario:

```txt
1. Base has row A.
2. User optimistically updates A, mutationFn remains pending.
3. Sync inserts unrelated row B.
4. Collection base includes B immediately.
5. Visible state includes A optimistic update and B.
6. Derived collection sees B immediately.
7. When mutationFn succeeds, operation settles and visible state remains consistent.
```

## Open implementation questions

These should be answered during implementation, not over-specified in the RFC:

- Exact `WriteOperation` type shape.
- Whether `db.operations` is global, collection-scoped, or both.
- Exact `$writeStatus` aggregation rules when multiple operations affect one row.
- Exact failed/settled operation retention defaults.
- Exact typed error API for `needs-resolution`.
- How much Phase 1 can safely use `modified` snapshots before switching update projection toward `changes`.
- Whether failed operations should be visible in row aggregate status after rollback, or only in operation history.

## Conclusion

The durable fix is not another sync-while-persisting option, another optimistic map, or another adapter-specific status flag.

TanStack DB should make write operations first-class:

```txt
authoritative base state
+ unsettled collection-owned operations
= visible collection state
```

That single shift lets core apply sync immediately, gives 1.0 precise local write status, makes write errors queryable, supports recoverable validation, and gives offline-transactions a clean durability/execution role.

Once this substrate exists, future work like stable view keys, server-generated defaults, mutation receipts, stronger patch replay, and backend observation can be added incrementally without each feature inventing its own state model.

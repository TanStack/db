# Hostile assay: authority coordinator v1

The frozen candidate needs a narrower event contract and explicit boundaries for public rollback, empty optimistic transactions, and synchronous authored failure. This audit does not refute the quiet-read argument. It finds one contradictory observation requirement and concrete gaps between the named transitions and the actual local primitives.

## Scope and evidence

Fresh auditor saw only `state-machine-v1.md`, `ground.md`, `ground.ts/json`, the requested current runtime and package sources, and the installed Query core cancellation implementation. No sibling designs or older audits were read. Procedure: `hostile-assay.md`, read in full. The report separates specification defects from implementation guarantees that the candidate already promises.

Run `node probes/endpoints/design/authority-coordinator/run-hostile-v1-reentry.mjs`. Its diagnostic imports actual DB, Query adapter, and the outer publication context. `hostile-v1-reentry.json` records the results. These controls isolate primitive boundaries; they do not implement or test a completed coordinator.

## 1. Synchronous reentry reverses one subscriber's event history

**Confirmed; observation-contract conflict plus insufficient publication primitive.**

Schedule:

1. A and B contain 0. Defer both collections inside one outer publication context; install authority 1 in both.
2. Release A. Its first subscriber starts another action, synchronously changing A and B to 2 under another pair of deferrals.
3. A's second subscriber receives the nested event for 2 before receiving the still-delivering outer event for 1.
4. Release B. Its deferred event list contains 1 followed by 2.

Actual observations:

| Subscriber | Payload sequence | Direct A/B reads |
| --- | --- | --- |
| A, second subscriber, nested delivery | `[2]` | `[2,2]` |
| A, second subscriber, resumed outer delivery | `[1]` | `[2,2]` |
| B | `[1,2]` | `[2,2]` |

The important defect is causal inversion, not merely an old payload beside newer current state. A consumer that applies A's events in delivery order ends at 1, while the equivalent B consumer and direct state end at 2. `CollectionChangesManager.publishEvents()` snapshots subscribers and immediately calls them. A nested publication shares the graph context but still delivers source callbacks recursively. Deferral concatenates messages; it does not serialize callback delivery.

The stronger sentence that payloads, direct reads, and dependent queries must agree at every source event also conflicts with these timing requirements. Immediate reentrant state changes necessarily let remaining outer callbacks read the newer state while consuming an older event. The outer scheduler intentionally delays dependent graph work until source delivery finishes. These are different observation boundaries.

**Repair condition:** specify causal historical event payloads separately from coherent current state at callback entry. Queue nested source notifications behind the publication already being delivered. Require graphs to agree after the outer publication context drains. If equality between historical payload and current state at every callback remains mandatory, synchronous reentrant installation must change; deferring notifications alone cannot provide it. This is an explicit contract choice, not an implementation detail to weaken silently.

**Test gap:** ground checks direct pairs with passive subscribers. It never folds every subscriber's event stream into a materialized view or starts actions from callbacks. Extend the concurrent oracle with callback-triggered writes at every source-listener position, independent event-replay views per subscriber, direct multi-collection snapshots at callback entry, and graph assertions after context drain. Vary subscriber order. The minimal mutant bypasses nested notification queuing.

## 2. Public local rollback bypasses the coordinator publication boundary

**Confirmed primitive behavior; missing coordinator/DB integration contract.**

An Endpoint Transaction changes A and B to 3 over a persisting sibling's whole-row value 2. Start fanout is correctly batched. The caller invokes the real returned `tx.rollback()`. The actual callbacks observe `[2,3]`, then `[2,2]`.

`Transaction.rollback()` changes transaction state and calls `touchCollection()`. That method refreshes each mutation collection in turn. Neither method defers all those collections before the first notification. v1 explicitly generates local rollback and promises coherence at every source event, but its publication transition only covers coordinator settlement and its start transition only covers authored fanout. A local rollback can happen before any envelope, outside both paths.

The remote operation must remain running or unknown after local rollback; that fact is correctly separated in v1. The missing boundary is the synchronous visible rollback itself. Normal rollback may also cascade to conflicting manually pending transactions whose other mutations reach collections outside the original Endpoint transaction's set.

**Repair condition:** batch public Endpoint rollback and all collections reached by its normal pending-transaction cascade. Keep the remote obligation and sibling-preservation semantics unchanged. A coordinator-only settlement helper does not cover a caller invoking the normal Transaction API.

**Test gap:** observing rollback only after it returns misses the mixed callback state. Add rollback as an independently schedulable command and as a reentrant listener action, with conflicting manual pending siblings and unrelated persisting Endpoint siblings. Assert every callback pair against the whole-row overlay model. The minimal mutant bypasses rollback publication batching.

## 3. Empty optimism can skip the remote operation and resolve its receipt early

**Confirmed core behavior; missing dispatch/settlement contract.**

`Transaction.commit()` sets an empty transaction to completed and resolves `isPersisted` before calling `mutationFn`. The diagnostic records `state: completed`, `emptyRequests: 0`.

An authored optimistic callback may have no local effect: it conditionally updates a row absent from retained predicates, or inserts then deletes the same key, which DB merges away. An opaque server handler can still change the server. v1 says start the request immediately and return the actual Transaction, and does not exclude these actions. The old runtime explicitly rejects empty optimistic mutations; preserving that rejection would add a restriction missing from v1.

**Repair condition:** make coordinator dispatch and externally managed settlement cover zero-mutation Transactions, or explicitly retain and justify an empty-action rejection in the supported domain. If dispatch is moved outside `mutationFn`, also prevent the real Transaction receipt from taking core's empty fast path before authoritative coverage.

**Test gap:** action generators that always mutate at least one local row cannot catch this class. Add absent-target optimism and mutations that merge to zero, while the independent server handler still changes retained results. Assert exactly one RPC and no successful receipt before closure plus coverage. The minimal mutant uses ordinary empty `commit()` settlement.

## 4. Authored synchronous failure lacks an operation-ledger exit transition

**Specification transition gap; not an executed coordinator failure.**

Start registers a running operation before calling authored code. The candidate states that a synchronous authored exception sends no request and creates no unknown remote handler. It does not say how that already registered running entry leaves the ledger. Leaving it running causes every later ordinary read to wait for an envelope that cannot arrive. The old runtime catches authored errors and rolls the local transaction back, but a Transaction rollback alone cannot close the separate operation entry introduced by v1.

**Repair condition:** define a local-abort exit that removes the unsent remote obligation, finishes local rollback inside the start publication boundary, and wakes quiet-read waiters. Retain the advanced epoch: previously issued reads must not become valid again just because authoring failed. Distinguish an authored failure from a listener failure raised after a request was dispatched; the latter cannot be classified as unsent.

**Test gap:** generate authored failure before any mutation, after the first recipient mutation, and after fanout work, then start an ordinary read and another healthy action. Assert no RPC for the aborted operation, no orphan overlay, and no permanent running entry. The minimal mutant retains the unsent operation in `running`.

## Boundaries examined without a confirmed new contradiction

- **Query result provenance:** observer notifications for fetching or cancellation can carry retained successful data, so a provider called at delivery must not be treated as proof that the rows came from a newly admitted RPC. However, I did not find a stale-authority schedule when every accepted install successfully mirrors the cache, Start cancels outstanding requests, and publication aborts old application permits as v1 requires. Keep a generator dimension for successful retained-cache notifications, refetch start, unsubscribe/resubscribe, and cancellation after manual authority installation. This is required adapter coverage, not an additional confirmed bug.
- **Cancellation rollback:** the installed Query core stores manual `setQueryData` state as its new `#revertState`. Therefore the tempting schedule “install authority during a fetch, then cancel it and restore the pre-authority cache” does not hold for this version when the mirror succeeds. Source: installed `@tanstack/query-core/src/query.ts`, success reducer and `onCancel`.
- **Application queue/readiness:** the adapter already has cancellable commits and checks cancellation before readiness. The optional coordinator permit and its capture at observer delivery remain unimplemented requirements, as does guarding error/status side effects from obsolete attempts. Ground already proves transport/refetch completion alone is insufficient.
- **Atomic settlement:** ordinary `commit()` awaits `mutationFn`, so resolving several mutation promises cannot synchronously retire the cohort. v1 explicitly calls for synchronous settlement; this is implementation work, not a newly discovered contradiction. Its helper must skip already failed/locally rolled-back Transactions, retain operation closure/coverage facts after receipt failure, and make each receipt final exactly once.
- **Lifetimes:** cleanup currently removes Query entries and aborts adapter applications. Coordinator enrollment must still occur at sync startup, including `preload()` through an existing object. Rows from a cancelled old lifetime cannot establish readiness in the new one. v1 states these requirements; the current runtime does not implement them.
- **Unknown outcomes and partial handler commits:** v1 correctly refuses to use a successful read as proof that an unknown remote write closed, and requires authority installation before handler-error rollback. Do not count explicit errors as successful convergence.

External writers, stale replicas, separate changing authorities, auth changes, and durable unknown-operation recovery are excluded. None of the four findings depends on those excluded conditions.

# Query DB publication and abort model

The [publication model](QueryDbPublication.tla) checks four related laws for one
physical Query, two Query DB acquisition leases, and one source row. It is a
bounded design check, not a production test. The Collection sync-adapter
contract, the [Query Collection guide](../../../collections/query-collection.md),
and the [glossary](../../glossary.md) supply the vocabulary and promises:

1. A successful subset load waits for the applied receipt that establishes its
   row. A provider result and `commit()` acceptance alone do not fulfill it.
2. An accepted sync transaction applies even if its last caller aborts. If
   Collection cleanup occurs before application, its receipt is abandoned and
   pending loads reject. An unaccepted result cannot publish after final release.
3. Releasing one observer lease removes only that owner's row claim. A live
   peer keeps its lease and its promised row. A row with no live owner is absent
   at the post-release checkpoint in this non-persisted model.
4. A consumed physical Query signal aborts only after the final Query DB
   observer lease leaves. A caller abort retires that caller's acquisition; it
   does not revoke a peer's lease.

## Model vocabulary and history grammar

`active` projects Query DB **observer leases**, not Core's logical subset
owners. `outcome` records each acquisition's load settlement. `phase` combines
the provider result, sync transaction acceptance, and applied-receipt boundary
into `none`, `unaccepted`, `accepted`, `applied`, and `abandoned`. Cleanup can
abandon a pending transaction; the caller-abort hostile control can abandon an
accepted transaction without cleanup. `rowOwners` is an abstract explanation for whether
the single public row is owed. It does not copy Query DB's row-to-Query maps.
`fetchOpen`, `signalConsumed`, and `physicalAborted` describe one physical
Query fetch and its lazy signal. `acceptedEver` and `appliedEver` are model-only
history bits needed for the liveness and early-fulfillment checks; they are not
production generations or cache positions. `cleaned` records Collection cleanup
as a terminal sync-run action, distinct from an individual caller's abort.

The initial history has owner `a` with a pending load and an open fetch. The
grammar can acquire peer `b`, consume the signal, deliver a provider result,
accept and apply its sync transaction, abort either caller, release either
lease, clean up the Collection, or acquire `b` reentrantly while `a` releases
after application. These actions are legal only when their guards hold. In particular, application
cannot precede acceptance, a second peer acquisition cannot happen after its
first outcome settles, and the provider cannot deliver an aborted result.
The model checks all enabled interleavings within those bounds, including both
release orders, abort before or after acceptance, and cleanup while a receipt
is pending. It does not assign a duration to an enabled action. Weak fairness
requires an accepted transaction eventually to apply or Collection cleanup to
abandon it; it does not promise prompt application.

The abstraction retains acceptance separately from application because a
caller can abort between them and the two cases owe different results. It
retains a separate signal-consumption bit because Query Core may cancel a
consumed fetch on final observer removal while an ignored signal can finish
into cache. It retains per-owner leases and outcomes because a peer's release
and settlement can differ from the first caller's. Collapsing any of those
states would merge legal histories with different promised observations.

## Checks and hostile controls

`OnlyLiveOwnersPublish` and `LiveOwnersKeepRow` compare row claims after each
transition. The second rule quantifies over both active owners, so either
release order must preserve the surviving owner's row.
`NoEarlyLoadFulfillment` and `NoUnacceptedPublication` compare
load and row observations with the applied-receipt boundary.
`NoEarlyPhysicalAbort` checks the physical Query signal against remaining
leases. `AcceptedEventuallySettles` checks that acceptance leads to application
or cleanup under weak fairness of `Apply`. `CleanupClearsOwners` and
`CleanupAbandonsPendingReceipt` require cleanup to retire every lease and reject
the receipt if it has not applied. The model's `phase = "abandoned"` represents
that receipt rejection; production compares the actual receipt separately.

TLC 2.19 checked `safe.cfg` with **226 distinct reachable states** and found
no violation. Each one-rule hostile configuration reached its intended
comparison and produced a counterexample:

| Configuration | Deliberate wrong rule | Failed property |
| --- | --- | --- |
| `wrong-early-fulfill.cfg` | Fulfill on acceptance before application | `NoEarlyLoadFulfillment` |
| `wrong-drop-peer.cfg` | Remove the peer's row when `a` releases | `LiveOwnersKeepRow` |
| `wrong-drop-first.cfg` | Remove `a`'s row when `b` releases | `LiveOwnersKeepRow` |
| `wrong-late-publish.cfg` | Publish after final release | `OnlyLiveOwnersPublish` |
| `wrong-early-physical-abort.cfg` | Abort the physical fetch when any caller leaves | `NoEarlyPhysicalAbort` |
| `wrong-abort-accepted.cfg` | Abandon an accepted transaction on caller abort | `AcceptedEventuallySettles` |
| `wrong-cleanup-keeps-accepted.cfg` | Leave an accepted receipt pending after Collection cleanup | `CleanupAbandonsPendingReceipt` |

Six controls failed as invariant counterexamples; `wrong-abort-accepted` failed
as a temporal counterexample. None was a timeout, setup failure, or
unreached path. Run from this directory with
`java -cp tla2tools.jar tlc2.TLC -deadlock -config safe.cfg QueryDbPublication.tla`,
then substitute each `wrong-*.cfg`. The local `-deadlock` option allows valid
terminal histories. The tool JAR may be supplied separately; it is not checked
into the repository.

## Production correspondence and limits

The load-lifecycle oracle owns real `QueryClient` and Collection acquisition,
caller abort, provider-result, commit, applied-settlement, and public-row
checkpoints. The ownership oracle owns Query result precedence and durable row
claims. Their production drivers must reconstruct the model's distinguishing
histories and reject corresponding wrong behaviors at public checkpoints.
Model checking alone does not show that Query DB refines the model.

This model omits persisted retention, source values, multiple physical Queries,
result generations, direct writes, unrelated Query Core callers, and cache
hydration. Its cleanup is terminal: it does not model restart or a persister's
own durable settlement. It combines callback reentry into one atomic
`ReenterAtRelease` action after application; it does not establish every synchronous callback
cut. It also does not prove that a provider consumes its signal. The real
production oracles and the [repair plan](../2026-10-15-query-db-lifecycle-repair-plan.md)
own those receiving witnesses. The older
[lease model](../query-db-published-core-tla/QueryDbLeases.tla) covers a
full-versus-exact Query route split and the final-release abort obligation for
a consumed physical signal, which this one-Query model omits.

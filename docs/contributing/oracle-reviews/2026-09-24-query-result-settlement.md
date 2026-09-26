# Query Collection result-settlement oracle review

Reviewed semantic head: `f718de65992911218e1ad16e59e6179abc551baf`

Scope: the public result-settlement law added to
`packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts` and its
production refinement. This record does not review the separate accepted-result
and application-waiting work for issue #1828.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. `RefetchFn` promises an explicit terminal result for invalid or deferred successful Query results. The Collection deferral contract and existing load-subset waiting behavior authorize waiting for an authoritative replacement application. A replacement retired by a newer write cannot fulfill its caller. The oracle names #1828 accepted-result generations and diff-free signals as limits. |
| ORC-002 | Pass. The model uses only `applicable`, `invalid-shape`, deferral, replacement retirement, and operation retirement. It does not import or reproduce production shape checks, Query state, fetch counters, settlement maps, observer scheduling, or sync transactions. |
| ORC-003 | Pass. The oracle opening states the contract and limits; `advanceResultSettlementModel` is the model; `ResultSettlementModelAction` is the action grammar; the tests drive `collection.utils.refetch()`; `expectPublicRefetchObservation` checks public settlement and rows. |
| ORC-004 | Not applicable. The law uses a bounded deterministic grammar and makes no generated-history coverage claim. Valid empty, invalid, eager recovery, deferred replacement, authority retirement, overlapping barriers, and cleanup retirement are pinned cells. |
| ORC-005 | Pass. The driver executes the public refetch and `clearError()` boundaries across eager and shared on-demand Query ownership. It observes pending versus fulfilled or rejected settlement and public Collection rows at the terminal checkpoint. |
| ORC-006 | Pass. The checker calibration supplies silent-fulfillment observations for invalid, deferred, rebound, and authority-retired results. At `f718de65^`, the on-demand authority replay fulfilled while the model remained pending, and valid eager recovery rejected with the prior `InvalidQueryResultError`; both pass at the reviewed head. |
| ORC-007 | Not applicable. No important generated property was added or changed. |
| ORC-008 | Pass. `waiting-for-result` and `waiting-for-refresh` remain distinct because replacement actions are legal only after deferral. `refresh-retired` leaves the operation waiting because the retired result and the public call have different lifetimes. Terminal state remains distinct because any later action would create a second terminal outcome and is rejected. |
| ORC-009 | Pass. The oracle declares that model `applicable` combines adapter validation and materializability, and that `refresh-retired` abstracts loss of result authority without modeling fetch counters. Shared promise, settlement, application, and retirement terms follow the project glossary. |
| ORC-010 | Pass. There is no shrinking or normalized capture. Invalid-shape diagnostics remain observable, and cleanup turns a pending deferred refetch into an explicit `CancelledError` instead of erasing or hanging its settlement. |
| ORC-011 | Not applicable. No reviewer named a semantic fault that the abstract terminal-outcome model and production could plausibly share; the public promise observation directly distinguishes the reported faults. |
| ORC-012 | Pass. This versioned record contains the outcomes for ORC-001 through ORC-011 and identifies the exact reviewed semantic head. |

## Same-result reentry follow-up

- Starting head: `755a1d39c49826c6d935259687023915388c7f12`
- Reviewed semantic head: `74e554937a439e89dcadef8ad4a0f61fef0635d4`
- Primary owner: `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`

This follow-up covers one deterministic history. A Collection change callback
drops the last subscriber and immediately adds another. Query DB then applies
the same `QueryObserverResult` again while the outer synchronous application is
still publishing. The nested application has a controlled pending applied
receipt. The public refetch must remain pending until that current application
settles.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. The documented public refetch contract requires fulfillment to wait for every accepted Collection application when no mutation blocks publication. The result-settlement owner already names that law and its mutation-phase limit. This fixed history does not claim coverage for a different Query hash, mutation-phase fetch settlement, or arbitrary observer scheduling. |
| ORC-002 | Pass. The existing `RefetchCallSettlementModel` independently says that one fulfilled Query fetch with one pending accepted application leaves the public refetch pending. It imports no controller, result-settlement map, observer, or commit implementation. |
| ORC-003 | Pass. The owner opening now includes same-result subscriber reentry in its bounded action grammar. The existing call-settlement model supplies the expected result. The driver uses a real QueryClient and public refetch. The refinement check compares public promise settlement before and after the controlled applied receipt. |
| ORC-004 | Not applicable. This is one deterministic fixed regression. It makes no generated-history coverage claim. |
| ORC-005 | Pass. The production driver proves the Query function ran twice, the subscriber callback reentered, and exactly one nested commit reached the held applied receipt. It observes that the public refetch is pending at that checkpoint, then fulfilled with the updated row after release. |
| ORC-006 | Pass. At the starting head, the focused regression failed with public outcome `resolved` while the nested applied receipt remained held. A temporary identity trace recorded one result object under outer controller 4 and reentrant controller 5: controller 5 first recorded the pending settlement, then controller 4 overwrote that same result with a resolved promise while controller 5 remained current. The permanent controller-identity fence makes the same probe pass. |
| ORC-007 | Not applicable. No important generated property or campaign changed. |
| ORC-008 | Not applicable. The fixed history adds no state to the existing call-settlement reference model. |
| ORC-009 | Pass. `same-result` means the exact current Query observer result object. `reentrant application` is the current Collection application started during outer publication. The controlled promise is its applied receipt, not Query fetch settlement or Collection readiness. |
| ORC-010 | Pass. The fixed history performs no shrinking or normalized capture. Cleanup releases the controlled receipt, unsubscribes the final listener, cleans the Collection, and clears the QueryClient without replacing an assertion failure. |
| ORC-011 | Not applicable. The independent public promise observation directly distinguishes the reported settlement overwrite; no plausible shared semantic fault requires another formulation. |
| ORC-012 | Pass. This versioned follow-up records ORC-001 through ORC-011 against the exact semantic head above. |

Verification at the semantic head: the focused probe passed 1/1; the complete
ownership owner passed 140/140; the load-subset owner and Query Collection
runtime passed 219/219. Query Collection source type-check, build, lint, format,
and diff checks passed. Lint retained the package's existing warnings and
reported no errors.

## Same-result grammar closeout

- Production semantic head: `74e554937a439e89dcadef8ad4a0f61fef0635d4`
- Oracle/test head: `fb6d61421480980ef38037d13ef579e74a3de491`
- Runtime: Node `24.19.0`, pnpm `11.1.0`, Vitest `3.2.4`

No production behavior changed in this closeout. The loss audit showed that the
single fulfilled receipt proved waiting but did not preserve the whole public
law: receipt rejection, exact error identity, and publication cardinality were
missing.

### Model

The preserved properties are:

| ID | Preserved property | Authority |
| --- | --- | --- |
| SR-P1 | A fulfilled Query fetch does not settle its public refetch while any accepted application for that call remains pending. | Public refetch/application-barrier contract |
| SR-P2 | Same-result subscriber reentry transfers settlement authority to the current nested application; the outer application cannot overwrite it. | Reviewed semantic behavior |
| SR-P3 | A fulfilled nested applied receipt fulfills the refetch; a rejected receipt rejects it with the exact application error. | Public promise settlement contract |
| SR-P4 | Reapplying the exact current result during publication does not publish the row change twice. | Collection publication contract |
| SR-P5 | The single public change is exactly `Initial → Updated`; subscriber churn is a trigger, not another data change. | Public change-event contract |
| SR-P6 | The row remains `Updated` after either receipt outcome; receipt rejection reports application failure and does not roll back the already published Query value. | Established application/publication boundary |
| SR-P7 | Different-result identity, mutation-phase settlement, and arbitrary observer schedules remain outside this fixed history. | Existing owner limits |

The minimal grammar is one same-result reentry history with a two-cell receipt
outcome: `fulfilled | rejected`. Both cells share the same fetch, outer
publication, subscriber drop/add reentry, one nested commit, and pending
checkpoint. Only the nested receipt outcome varies. The existing
`RefetchCallSettlementModel` supplies the expected pending and terminal states;
the production driver supplies the real QueryClient, Collection, subscription,
and public refetch.

### Evidence

Both cells reconstruct the intended law. Before receipt settlement, each proves
two Query executions, one reentrant commit, a pending public refetch, and exactly
one `Initial → Updated` publication. The fulfilled cell then resolves. The
rejected cell rejects with the identical `Error` object. Both retain the updated
row and the one-publication trace.

One-at-a-time ablation keeps only consequential structure:

- Without the pending receipt checkpoint, the original premature-resolution
  bug becomes invisible.
- Without the outcome coordinate, the grammar cannot distinguish fulfillment
  from application rejection.
- Without exact error identity, swallowing or replacing the application failure
  can pass.
- Without exact publication cardinality and values, duplicate publication or a
  wrong previous value can pass.
- Without the same-result reentry trigger, the history no longer reaches the
  controller-identity collision fixed at the semantic head.

The nearby invalid forms are a refetch that resolves while the nested receipt is
pending, a rejected receipt that fulfills or throws a replacement error, and a
second publication of the same update. A different Query result or hash and
mutation-phase publication are legal neighboring domains, but they require
their existing grammars rather than an extra coordinate here.

The principal decomposition loss is scheduler breadth. This fixed history
proves the concrete synchronous drop/add reentry and its two receipt outcomes;
it does not claim every observer interleaving. Keeping that limit explicit is
more accurate than multiplying a guessed scheduling axis into the model.

### Process

The source was frozen at the production semantic head. The existing public
contract, result-settlement model, concrete reentry driver, and starting-head
failure were the extraction evidence. The fulfilled/rejected outcome survived
ablation because it changes public settlement; publication count and exact
error identity remained observations rather than new model state. No guessed
scheduler coordinate was admitted.

Calibration remains anchored by the starting semantic head: the focused
history observed the public refetch as resolved while the nested receipt was
still pending. At the semantic head, the controller-identity fence keeps it
pending. The new rejection and publication assertions would also reject a
swallowed/remapped application error or duplicate update at their exact public
checkpoints.

### ORC disposition at the oracle/test head

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. SR-P1 through SR-P7 identify the public law, authority, and explicit scheduling and mutation limits. |
| ORC-002 | Pass. `RefetchCallSettlementModel` reasons over accepted applications and outcomes; it imports no production controller, observer result, settlement map, or commit implementation. |
| ORC-003 | Pass. The file opening states the contract and grammar, the existing call-settlement model supplies expected state, the test drives real production, and public promise/row/publication assertions form the refinement check. |
| ORC-004 | Not applicable. This is a two-cell bounded enumeration, not an important generated-history property. Reconstruction, ablation, range, and invalid neighbors are nevertheless recorded above. |
| ORC-005 | Pass. The real QueryClient and public `collection.utils.refetch()` path reach two fetches, subscriber reentry, one nested commit, promise settlement, rows, and exact change publication. |
| ORC-006 | Pass. The starting head is a reached-path assertion failure with premature public resolution. Exact rejection identity and publication cardinality calibrate the two recovered observations. |
| ORC-007 | Not applicable. The fixed two-cell history makes no random campaign or shrinking claim. |
| ORC-008 | Not applicable. The closeout adds no model state; fulfilled and rejected are terminal outcomes already distinguished by the model. |
| ORC-009 | Pass. Same-result means the exact current Query observer result; applied receipt, public refetch, publication, and reentrant application retain their glossary and owner meanings. |
| ORC-010 | Pass. There is no shrinking or capture. Rejection preserves exact error identity; the owner attempts all registered cleanup callbacks with `Promise.allSettled` and reports cleanup failures separately from the test assertion. |
| ORC-011 | Not applicable. No remaining plausible shared semantic fault was named that a second formulation could distinguish; the public promise plus exact publication observation directly checks this fixed history. |
| ORC-012 | Pass. This section records every ORC-001 through ORC-011 outcome against exact semantic and oracle/test heads. |

Verification at the oracle/test head: the complete ownership owner passed
227/227 across runtime and source type-check projects. The ordered owners passed
298/298, and both DB and Query Collection builds passed. Changed-file lint
reported no errors (two existing `require-await` warnings remain elsewhere in
this owner), and format plus diff checks passed.

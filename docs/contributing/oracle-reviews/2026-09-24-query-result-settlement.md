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

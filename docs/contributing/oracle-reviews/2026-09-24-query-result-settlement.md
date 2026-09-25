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

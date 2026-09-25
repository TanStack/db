# Query Collection result-settlement oracle review

Reviewed semantic head: `efe4cc580b01544324af1d0cbf23e6bc22fd1e2a`

Scope: the public result-settlement law added to
`packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts` and its
production refinement. This record does not review the separate accepted-result
and application-waiting work for issue #1828.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. `RefetchFn` promises an explicit terminal result for invalid or deferred successful Query results. The Collection deferral contract and existing load-subset waiting behavior authorize waiting for the replacement application. The oracle names #1828 accepted-result generations and diff-free signals as limits. |
| ORC-002 | Pass. The model uses only `applicable`, `invalid-shape`, deferral, and retirement. It does not import or reproduce production shape checks, Query state, settlement maps, or sync transactions. |
| ORC-003 | Pass. The oracle opening states the contract and limits; `advanceResultSettlementModel` is the model; `ResultSettlementModelAction` is the action grammar; the tests drive `collection.utils.refetch()`; `expectPublicRefetchObservation` checks public settlement and rows. |
| ORC-004 | Not applicable. The new law uses a bounded deterministic grammar and makes no generated-history coverage claim. Valid empty, invalid, deferred replacement, and cleanup retirement are pinned cells. |
| ORC-005 | Pass. The driver executes the public refetch boundary. It observes pending versus fulfilled or rejected settlement and the public Collection rows at the terminal checkpoint. |
| ORC-006 | Pass. The checker calibration supplies silent-fulfillment observations for both invalid and deferred results and proves that the comparison rejects them. The unchanged runtime produced those same two failures before the fix. |
| ORC-007 | Not applicable. No important generated property was added or changed. |
| ORC-008 | Pass. `waiting-for-result` and `waiting-for-refresh` remain distinct because `refresh-succeeded` is legal only after deferral. Terminal state remains distinct because any later action would create a second terminal outcome and is rejected. |
| ORC-009 | Pass. The oracle declares that model `applicable` combines adapter validation and materializability. Shared promise, settlement, application, and retirement terms follow the project glossary. |
| ORC-010 | Pass. There is no shrinking or normalized capture. Invalid-shape diagnostics remain observable, and cleanup turns a pending deferred refetch into an explicit `CancelledError` instead of erasing or hanging its settlement. |
| ORC-011 | Not applicable. No reviewer named a semantic fault that the abstract terminal-outcome model and production could plausibly share; the public promise observation directly distinguishes the reported faults. |
| ORC-012 | Pass. This versioned record contains the outcomes for ORC-001 through ORC-011 and identifies the exact reviewed semantic head. |

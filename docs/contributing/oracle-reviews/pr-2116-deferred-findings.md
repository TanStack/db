# PR #2116: deferred findings and guarantee decisions

This record separates findings discovered during the unit-test retirement
workflow from the bounded fixes retained in PR #2116. The transfer ledgers
remain the authority for retired assertions. The
[confirmed-fixes review](pr-2116-confirmed-fixes.md) records the baseline and
hostile evidence for fixes that this PR now keeps. A deferred finding below is
not closed by passing a neighboring transfer oracle.

| Finding | Authority and evidence | Next owner and witness |
| --- | --- | --- |
| R29: two valid `Temporal.Duration` values can have the same display text but different fields. A changed field can be suppressed as an equal Collection value. | Closed in this PR for the tested direct and Collection paths. The Duration field model checks all ten fields; a same-display replacement and adjacent-unit histories make the former `deepEquals` and change-event behavior fail before the repair. The query equality owner and `in` evaluator owner separately check Duration field identity. | General multirow and live-query publication histories remain outside these owners. Add them to the relevant owner if a new failure reaches those paths. |
| R16: an indexed Collection can admit a valid Temporal row whose index comparator has no public order, then throw after partial state changes. | Earlier PR revisions recorded RED admission and publication traces for Duration, PlainMonthDay, and mixed-kind rows. Source inspection suggests the risk remains on `origin/main`, but this narrowed PR has not executed a current-base RED witness. The public order law and internal index storage order must be distinguished. | The direct-index and Collection publication owners should pair a valid-row admission history with exact membership, ordered storage, stored rows, and subscriber observations. Choose the smallest internal ordering or atomic-admission repair that satisfies the accepted contract. |
| Mixed-kind indexed order and custom-index query selection may disagree with public query results. | The mixed number/string direct-index history confirms key duplication after deletion on `origin/main`; the new source-Map lane closes that bounded key-conservation bug. A reverse manual index also returned the wrong first row through `currentStateAsChanges`; the new selection oracle closes that bounded public bug. The user withdrew a per-row custom callback position guarantee for comparator-equal exact values. | A general public order policy for unlike kinds remains open. The current owners prove key conservation and the two-rank manual-index selection case, not arbitrary mixed-kind order, custom callback ties, or later live updates. |
| R17: an equal-time Date removal left an ordered ghost under added index machinery. | The recorded RED trace depended on code introduced during this PR. It does not establish an `origin/main` defect. The stronger rule for a substituted old row with a different callback position was withdrawn. | If ordinary direct remove/update still has a current-base counterexample, add a source-Map history to the direct-index owner before changing production. |
| PlainDate extended-year order under lexical string collation may diverge between scans and indexes. | On both the recorded `origin/main` baseline and this branch, a direct scan comparator orders `-100000-01-01` before `+010000-01-01`, while direct BasicIndex and BTreeIndex traversal returns the positive date first with `stringSort: 'lexical'`. This was found during hostile review of the final kind classifier, not in the retired unit-test ledger. A public indexed query witness has not run. | Extend the Temporal index-order owner with a scan/indexed public read under lexical collation, confirm the contract for this other Temporal kind, and reproduce RED before a separate repair. The present owner is bounded to ZonedDateTime and time-only Duration. |
| Cross-realm native equality was asserted by a surviving request-transport unit test. | PR #1797 captured the then-current `instanceof` result. No public realm-distinctness promise was found. The maintainer questioned that distinction. This PR removes that incidental test expectation and makes no cross-realm equality claim. | A future public contract decision needs a host-boundary witness before either equality policy becomes an oracle law. |

Captured `inArray` list-entry refresh and whole-live-query reconstruction were
explored as new features. The pre-PR evaluator and live graph did not already
deliver the whole-result behavior. The maintainer withdrew that expansion for
this PR because of its production-code and query-planning cost. A separate
proposal must define its dependency and invalidation boundary before adding
an oracle or production graph machinery. In-place edits to a Date or byte
item, unsigned default byte ordering, and guarantees after callers alter
standard objects are also outside the accepted contract.

Earlier experiments and RED/GREEN records remain in published commits on
`codex/oracle-test-retirement-2-blocks`. This PR restores the confirmed,
bounded fixes described above. The R16 and R17 rows still distinguish
earlier-branch observations from a current-base failure; neither justifies
new production machinery without a baseline witness under the accepted law.

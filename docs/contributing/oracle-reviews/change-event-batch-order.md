# Change-event callback order decision and oracle review

- Reviewed code head: `63cc7122560cefbcfed7187abab7924c71302eff`.
- Starting head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Source: DEC-01 in the code-weight audit's `BUGS_AND_ORACLE_GAPS.md`.
- Primary owner: `packages/db/tests/change-event-history-oracle.test.ts`.

## Decision and finding ledger

The maintainer decided that messages for different keys may appear in either
order within one `subscribeChanges` callback. Messages for the same key retain
their causal order. The public method and `ChangeListener` documentation now
state this rule.

| ID | Source claim and proposal | Technical verdict | PR action | Durable value |
| --- | --- | --- | --- | --- |
| DEC-01.1 | `commitNextPendingTransactionBatch` uses direct pending set order for `changedKeys`. STATE-10 may reorder callback messages. Compare batches as bags if order is free, or pin the order if promised. | Confirmed reordering risk. Cross-key order is free by maintainer decision. A whole-batch bag would erase same-key causal order. | Document the scoped contract and compare an ordered trace for each key. | The primary oracle and coverage map own the per-key law. STATE-10 may change cross-key order. |

The audit note identified a real boundary and asked for a decision before
changing tests. Its proposed alternatives were useful. The bag proposal needed
the same-key qualification above. Reviewer assessment: technically accurate,
high signal, and appropriately cautious about contract authority. Hire
recommendation: yes for this class of review.

## Reach and checker controls

A controlled public probe held a local transaction, queued and canceled a sync
update for key 1, then completed direct edits of keys 2 and 1. The parent
upsert map held `[1, 2]`; the direct set held `[2, 1]`. The final callback
ended with `update:2, update:1`. This confirms that STATE-10 can change public
cross-key order. The old owner passed 376 tests when a temporary production
mutant reversed final sync events. It did not judge that order.

The new fixed history commits three sync transactions while publication is
deferred. One callback contains insert, update, and delete messages for key 1,
and insert plus two updates for key 2. A plain Map derives prior and final row
values. The checker compares each key's ordered message trace, including type,
value, prior value, and multiplicity. It does not compare positions across keys.
It checks that publication produces exactly one callback and that final public
rows match the model.

On the reviewed code head, the owner passed 377/377 tests. Two temporary
production mutants challenged the new comparison:

| Mutant | Result at the intended callback |
| --- | --- |
| Reverse the complete deferred publication list | **Assertion failure.** Key 1 arrived as delete, update, insert instead of insert, update, delete. Key 2's update sequence also reversed. |
| Reverse each sync transaction's final event list | **Equivalent under this law.** The focused test passed 1/1 because only distinct-key positions changed. |

Both mutants were removed. The original code and final oracle pass together.
The focused witness covers two keys, three immediate sync transactions, and
one deferred callback. It does not establish every adapter, cancellation,
reentrant callback, or arbitrary deferred history.

## Oracle guide review

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The maintainer decision and public API comments authorize the per-key law. The fixed history and limits appear above and in the executable owner. |
| ORC-002 independent judgment | Pass. A plain Map applies declared actions. It does not import Collection state, event composition, or key ordering. |
| ORC-003 visible responsibilities | Pass. The opening states the contract. `applyModelOp` and `expectedEventTrace` give the model. Fixed rounds give the grammar. Real sync commits and `_deferPublication` drive production. `perKeyEventTrace` compares the public callback. |
| ORC-004 generated grammar controls | Not triggered by the new fixed history. Existing generated local-mutation campaigns are unchanged. The fixed history uses legal absent-key inserts and present-key updates/deletes. |
| ORC-005 path and observation | Pass. The test reaches public `subscribeChanges`, observes zero callbacks before publication and one after, then compares per-key messages and final public rows. |
| ORC-006 checker calibration | Pass. Complete reversal fails at the per-key comparison. Distinct-key reversal passes at the same checkpoint. Neither is a setup failure or timeout. |
| ORC-007 fixed/random replay | Not triggered by this fixed witness. The owner's existing paired generated campaigns ran in the 377-test owner suite. Their replay interface is unchanged. |
| ORC-008 model-state minimality | Pass. The Map must retain each key's prior value to predict update and delete messages. Each per-key trace must retain order and duplicates. Different prior values or a reversed trace change the next public observation. |
| ORC-009 vocabulary mapping | Pass. One fixed round maps to one sync transaction. The model's `Op` is a declared sync action. Deferred publication combines three transactions into one callback. The Map is a reference model, not Collection state. |
| ORC-010 failure and cleanup | Pass. The shared cleanup helper preserves the primary mismatch and aggregates secondary failures. The driver releases its deferral, subscription, and Collection. |
| ORC-011 second formulation | Not triggered. No plausible fault shared by the simple Map and the production event derivation was named. |
| ORC-012 review evidence | This record gives the exact reviewed code head, applicable outcomes, non-applicable reasons, mutant classifications, and scope. |

The loss audit finds one raw DEC-01 item and one disposition: resolved by a
design decision and oracle law. No item lacks evidence. This PR changes no
production event ordering. Future work on generated deferred histories belongs
to the change-event history owner before claiming wider batch-shape coverage.

# WHERE predicate publication and joined result key oracle review

## Reviewed state and claim

Base: `49dc79d4`, the head of pull request #1956 before this review. This
record reviews the Git tree that contains it. The final commit or pull request
identifies that immutable tree. The review applied the ORC-001 through ORC-014
requirements of the oracle guide revision that adds ORC-013 and ORC-014.

The WHERE predicate publication oracle claims that a filtered live-query
Collection, direct subscriptions with and without initial state, peer
subscriptions routed by one `eq` field, and `currentStateAsChanges` publish
exactly the rows whose predicate is TRUE under SQL three-valued logic. The
claim covers the grammar in the oracle's opening prose. It does not cover
comparison operators other than `eq`, joins, ordering, optimistic updates or
deletes, truncate, failed replay, or generated cleanup and restart histories.

The joined result key oracle claims that an inner, left, or full two-source
join publishes one row per joined pair and that distinct pairs never share a
result key, for string keys, numeric keys, both infinities, and `NaN`. It does
not cover joins over subqueries, more than two sources, custom `getKey`, or
optimistic mutations.

Both oracles use `mockSyncCollectionOptions` as a controlled provider. Their
claims are limited to how the Collection and compiler handle the sync
transactions that provider supplies; neither claims a real adapter's behavior.

## RED and GREEN evidence

Mutants ran on the reviewed tree through the oracle files alone. Each file was
restored after each run.

| Mutant | Oracle | Outcome |
| --- | --- | --- |
| `eq` returns FALSE for a nullish operand | WHERE | Assertion failure in the pinned snapshot tests and both campaigns (5 tests). |
| Routing ignores a change's previous value | WHERE | Assertion failure in the change pinned tests and both campaigns (4 tests). |
| Routing continues while stale published rows await reconciliation | WHERE | Assertion failure in the restarted-source witness. |
| Routing treats `or` operands as conjuncts | WHERE | Assertion failure in the change pinned tests and a campaign (2 tests). |
| A dropped insert or update is recorded as sent | WHERE | Survived: equivalent in this oracle's domain. Routing withholds a dropped row from an `eq` subscription before any key is recorded, and unrouted predicates never skip the delete that would expose a stale record. |
| The same sent-key mutant | `collection-subscription.test.ts` page-offset witness | Survived the pre-review `eq` witness. After the review added an unrouted `or` predicate, the two cases beside a matching change fail by assertion (offset 3, expected 2). The unrouted `alone` case survives. |
| Result key joins the source keys with a comma | Join | Key-count invariant error or wrong-row assertion in both pinned delimiter and number histories and both campaigns (4 tests). |
| Result key uses plain `JSON.stringify` | Join | Wrong-row assertion in the pinned infinity history and both campaigns (3 tests). |
| Index compares source-key prefixes with `===` | Join | Key-count invariant error in the pinned `NaN` history and the fixed campaign (2 tests). |
| The same prefix comparison | Index refinement oracle | Assertion failure in three pinned `NaN` histories and both campaigns; the `-0` control passes. |

The plain-JSON mutant is the pre-review implementation. The review found that
`JSON.stringify` prints `Infinity` and `-Infinity` as `null`, the marker for a
missing outer side. Adding both infinities to the key domain failed the fixed
and random campaigns with a full join over `-Infinity` on both sides. The repair
encodes a non-finite number as an object, which no source key can be. `NaN`
source keys failed before key encoding mattered, with the comma encoding as
well, because the join index compared source-key prefixes with `===`, so a
retracted `NaN`-keyed row never cancelled. The review fixed that comparison in
`@tanstack/db-ivm` and added an Index refinement oracle for it; the join oracle
now includes `NaN` keys and a pinned history in which a `NaN`-keyed pair leaves
and re-forms.

After the repairs, `test:oracles` at `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10`
passed 2,869 tests and the `@tanstack/db` suite passed 7,499 tests. Final
verification receipts belong in the pull request.

## WHERE predicate publication oracle

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Pass. The evaluator contract in `src/query/compiler/evaluators.ts` states the operand rules. The opening prose lists the omissions and their owners. |
| ORC-002 Independent judgment | Pass. `expectedTruth` and `expectedVisible` evaluate plain objects without production comparison, normalization, prefilter, routing, or virtual-field helpers. |
| ORC-003 Distinguishable responsibilities | Pass. The contract, model, history grammar, production driver, and refinement check are separate marked sections. |
| ORC-004 Generated-history controls | Pass after repair. Reconstruction: the pinned snapshot with `eq($synced, false)` was outside the grammar because `false` was not a literal; the review added it, and every pinned history is now in the grammar. Ablation: removing `not` loses the nullish-comparison history, removing `or` loses the routing history, removing multi-operation transactions loses retraction inside one batch, removing insert reuse loses reinsertion, and removing the index axis loses the index path. Range: depth three, at most six rows, six transactions of three operations, and marginal values `NaN`, a valid Date, the normalization prefix, `null`, and a missing field. Exclusion: an update to an equivalent value and a second update to one key in one transaction are removed from the history. |
| ORC-005 Production path and observation | Pass. Public builder functions, `subscribeChanges`, and `currentStateAsChanges` run against a real Collection. Each consumer's exact key set is compared after the subscriptions attach and after each sync transaction commits. |
| ORC-006 Checker calibration | Pass. The checker test requires the two-valued answer to fail. The mutant table classifies each run. |
| ORC-007 Fixed/random replay | Pass. The fixed seed `44_500_301`, the unseeded campaign, and the replay entry share one property and budget. |
| ORC-008 Stateful-model minimality | Pass. The model keeps a row map across sync transactions. `$synced` and `$origin` separate a pending optimistic insert from a synced row, and the pinned `eq($synced, false)` snapshot distinguishes them. `$key` always equals the row id; it stays because the grammar reads it as an operand. The touched-key set distinguishes a subscription without initial state from one with it. |
| ORC-009 Vocabulary mapping | Pass after repair. The prose now uses live-query Collection and sync transaction. A subscriber is the callback of one subscription; a consumer is the oracle's label for one observed endpoint. |
| ORC-010 Failure fidelity and cleanup | Pass after repair. Cleanup ran in `finally`, so a cleanup failure replaced the check failure. `withOracleCleanup` now runs every cleanup step and keeps the check failure as the `cause` of an `AggregateError` when cleanup also fails. |
| ORC-011 Independent second formulation | Not triggered. No review has named a fault that the Kleene model and production could share. |
| ORC-012 Review evidence | This record. The coverage map links it. |
| ORC-013 Reusable boundary law | Pass. FALSE-for-UNKNOWN is rejected by the negated nullish snapshot. Ignoring the previous value is rejected by generated change histories. Treating `or` operands as conjuncts is rejected by the pinned `or` change history. Routing past stale rows is rejected by the restarted-source witness. |
| ORC-014 Controlled-premise handoff | Not triggered. The claim is limited to the controlled provider's sync transactions. |

## Joined result key oracle

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | Pass after repair. The prose now cites the live-query guide: joins behave like SQL joins, and a join result has a composite key of the parent keys. The guide does not fix the key format. |
| ORC-002 Independent judgment | Pass. `expectedPairs` is a nested loop over plain arrays and does not import the compiler or its key encoding. |
| ORC-003 Distinguishable responsibilities | Pass. The contract, model, history grammar, production driver, and refinement check are separate marked sections. |
| ORC-004 Generated-history controls | Pass after repair. Reconstruction: the pinned number history used right key `x`, which was outside the key domain; it now uses `c`, and all three pinned histories are in the grammar. Ablation: removing delimiter strings, number and string twins, or infinities loses a collision class; removing full joins loses unmatched rows on the right; removing synced changes loses unmatched rows created by a group move. Range: at most five rows a side, groups 0 through 2, and three changes. Exclusion: keys are unique within one side, and a change that keeps a row's group is skipped. |
| ORC-005 Production path and observation | Pass. `createLiveQueryCollection` compiles a real join. Published pairs and the key count are compared after preload and after each synced change. |
| ORC-006 Checker calibration | Pass. The comma and plain-JSON mutants fail, as classified above. |
| ORC-007 Fixed/random replay | Pass. The fixed seed `44_501_962`, the unseeded campaign, and the replay entry share one property and budget. |
| ORC-008 Stateful-model minimality | Not triggered. The model recomputes the pairs from the current rows. |
| ORC-009 Vocabulary mapping | Pass. A pair is one published row of the live-query Collection, described by its two source keys. |
| ORC-010 Failure fidelity and cleanup | Pass after repair, through `withOracleCleanup`. |
| ORC-011 Independent second formulation | Not triggered. No shared-fault hypothesis has been named. |
| ORC-012 Review evidence | This record. The coverage map links it. |
| ORC-013 Reusable boundary law | Pass. The law is that distinct pairs have distinct keys and a retracted pair cancels. The comma encoding is rejected by the delimiter and number pinned histories, plain JSON by the infinity pinned history, and `===` prefixes by the `NaN` pinned history. |
| ORC-014 Controlled-premise handoff | Not triggered. The claim is limited to how the compiler keys rows from the controlled provider. |

## Open work

- The sent-key mutant survives the unrouted `alone` page-offset case.
- Generated cleanup and restart histories for filtered subscriptions remain
  with the lifecycle publication owner, as the coverage map records.

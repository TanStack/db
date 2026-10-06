# Narrow follow-up: three candidate edits

Reviewed `/private/tmp/db-oracle-prep-gusw0ss_/clean-candidate-revised.md` against the original candidate and the same frozen `clean-input` sources. The original candidate and preservation report remain unchanged. This follow-up covers only the two admission findings and the queue timing authority conflict. No tests, broader searches, delegation, network access, or previous review-report reads occurred. All trace results below are source-based predictions.

## 1. Explicit-false custom queue rejection — resolved

Revised A now states: “An explicit `false` from a queue strategy rejects admission with `QueueCapacityExceededError`; `void` does not.” This restores the missing classifier from `packages/db/src/strategies/types.ts:66–72` and the error behavior in `packages/db/src/paced-mutations.ts:172–178`.

The distinguishing custom queue that returns `false` without retaining its callback must now fail its returned transaction and roll back its optimistic contribution. A custom queue returning `void` may still retain its callback; a custom batch returning `false` may do the same. These legal compatibility cases remain preserved. No additional repair is needed for the original P2 finding.

## 2. Call-local rollback scope — resolved

Revised A explicitly limits the isolation rule to rejection “at strategy admission” and adds that failure after shared batch persistence begins rolls back that transaction under D.

For debounce calls at times 0 and 4 sharing one transaction, rejection of the merged handler at time 14 may roll back the combined optimistic state. The revised text no longer implies that the earlier call's contribution must survive that shared transaction failure. Conversely, a distinct rejected overflow or dropped-edge call must still preserve previously admitted same-key work. This matches the separate admission and transaction-settlement boundaries in `paced-mutations.ts:172–195`, the paced same-row witnesses, `docs/guides/mutations.md:249–276,1099`, and `optimistic-history-oracle.ts:13–18`. No additional repair is needed for the original P3 finding.

## 3. Queue wait after a held backlog — revised treatment is better supported; authority conflict remains open

The revised B appropriately identifies same-clock starts as histories accepted by the existing oracle, while retaining the public upload example's “500ms between them” statement (`docs/guides/mutations.md:1234`). `QueueStrategyOptions.wait` describes time between processing queue items (`strategies/types.ts:50–52`). The queue reference promises serialization and configured pacing, but does not explicitly resolve whether processing means a scheduling appointment or the actual persistence callback's start.

The existing held-write tests (`paced-mutations-oracle.test.ts:986–1046,1092–1146`) require peers to begin after releases without advancing the virtual clock. That is evidence of the oracle's accepted behavior. It is not independent authority to dismiss a conflicting public timing description. Nor does the public example alone establish whether the desired gap is between callback starts or after each completed upload, or authorize silently rewriting the established tests.

**Distinguishing history:** With wait 500, submit three calls at time 0 and hold the first handler until time 1500. Under the existing owner's scheduling interpretation, the second and third immediately successful handlers can both start at time 1500. A minimum-500ms-between-handler-starts interpretation forbids the third start at 1500. Serialization alone permits both interpretations because the handlers can settle sequentially at one clock time. A separate requirement to wait 500ms after each completion would be stronger still and is not adopted here.

I withdraw the original report's point 1 assertion that the public example “cannot override” the other sources and that same-clock backlog starts are established *legal implementation freedom*. The bounded statement supported by the packet is that these are *existing oracle-accepted histories*, with unresolved public-contract authority. The revised candidate makes that distinction and removes the premature policy conclusion.

“Preserve both sourced interpretations” should be read as retaining the conflict and its evidence for an explicit decision, not requiring incompatible observations simultaneously. In context the revised paragraph does this. No further candidate edit is required for this narrow review. Any later resolution must identify the authorized meaning of `wait` and align the public wording, model, driver, and distinguishing assertions together; passing tests or an editorial preference cannot make that decision alone.

## Outcomes

- Explicit-false custom queue rule: original finding resolved.
- Admission-only rollback wording: original finding resolved.
- Queue timing conflict: revision accepted as an honest unresolved authority boundary; original legal-freedom conclusion corrected.

These are preservation judgments about prose. They do not establish implementation conformance or a completed oracle repair.

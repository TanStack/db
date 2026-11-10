# Proposed source changes: not performed

These proposals require separate source review and authorization before edits.
This packet contains no oracle, driver, configuration or production edit.

## M01: deterministic output-role binding for mutants

In a fresh successor of metadata-update-source-v3, add one metadata-only id
field to each createLiveQueryCollection configuration in
packages/query-db-collection/tests/queued-answer-progress-driver.ts.

Root ID:
`metadata-receiving:${history.cacheIdentity}:${history.metadataKeys}:root`

Downstream ID:
`metadata-receiving:${history.cacheIdentity}:${history.metadataKeys}:downstream`

Only histories with metadataKeys supply those fields. Other progress histories
retain their current configuration. Keep query syntax, getKey, provider/cache
controls, output recorder, current-row/entry comparisons, identity receipt,
finalizer, source-order transport and budgets unchanged. The metadata-identities
receipt already records actual source/root/downstream IDs; no new model or
expected result is needed. The shared model's ordinary-projection attribution
uses those independently recorded receiving IDs.

Before production mutants, use both existing scope quarter-2 singleton
registrations as unmutated controls against this exact driver successor.
Each must reach all 31 states and compare complete current/previous public rows.
Also require the current-run metadata-identities receipt to equal the explicit
role/key-lane IDs, with the source ID distinct. Freeze that requirement in the
future receiving classifier, without relaxing any oracle comparison.

This separates target identity from incidental allocation order and UUIDs.
The fields change observed Collection IDs, so previous-source results alone
cannot qualify this successor. The two controls supply its own baseline.
No source/cache ownership or production code changes in these controls.

## M02: one production return mutation per receiving run

After M01 controls qualify, derive each mutant from the identical unmutated
successor. Change only the public return previousValue inside
packages/db/src/collection/state.ts: CollectionStateManager.enrichChangeMessage.
The unchanged source is SHA-256
932dac87a91546169b25c5300d041a7f3e3247779646aec15301e003c33935c8.

Keep both existing enrichment calls in their original order. Immediately before
the return, form the source-only target predicate described in mutants.json,
from this.collection.id, change.type/key and the two enriched public rows.
Replace the returned previousValue with undefined for the omission fault, or
enrichedValue for the full-current-row fault, only when the predicate is true.
All other return fields and the false-predicate branch remain identical.

A proposed transformation must show exactly one intended return property changed,
plus its pure target predicate. Do not add a test-recorder override, environment
hook, source write, listener gate, key reserialization or cache mutation.
Freeze full source maps and the exact mutation diff for independent review.
No transform script or mutated source is supplied in this plan.

## N01: generated no-op reach (separate from existing positive grammar)

The existing metadataFollowupArbitrary admits quarter 1/2/3 only. Adding 0 to
that one arbitrary would blur its positive-update reach with the no-op law.
Do not silently widen it or borrow its 31-state reach claim.

The smallest proposed extension extracts the two existing keyShift/rankScale
arbitraries into one shared facts definition. Use those same facts for:

- The unchanged positive-quarter arbitrary, preserving domain 1/2/3 and every
  existing campaign, seed and run budget.
- A no-op arbitrary with quarter fixed at 0.

Add separate fixed-seed and unseeded no-op campaign registrations for each key
lane on the scope path. Each runs the same existing run(), production driver,
createMetadataReceiptCheck, independent payload/metadata judgment and finalizer.
Use metadataHistoryStates(history with quarter 0), all 29 no-op states,
and separate property/replay coordinates. Keep budget eight and multiplier one
for both campaigns. Thus no generated positive budget or state is reduced.

No no-op model, driver expectation or new law is needed. The shared judgment
already predicts unchanged current rows and an empty before/after delta.
A nonempty spurious public update should fail it. Empty readiness callbacks
remain permitted by the existing contract.

Before making the edit, reopen oracle-authoring, glossary, rubric, coverage
owner and relevant architecture. Submit exact source proposal and reach names,
then freeze/review before separately admitted runtime. Measure the new no-op
histories; authored fixed examples alone supply no generated reach. Add a
separate hostile production design that emits a spurious change on a genuine
no-op only if claiming enforcement of that broader generated no-op law.
That future work is distinct from this packet's eight positive previousValue
mutants. No direct replay, source edit, campaign or such no-op mutant is run here.

# Snapshot selection review for PR #2086

Reviewed PR head: `2e0afc8a9`. This record covers the follow-up diff that
contains this file. It records executable evidence for the Collection
subscription boundary. It does not claim provider pagination or arbitrary
rankings.

## Law and observation cuts

`requestLimitedSnapshot` promises not to resend a key already sent to its
subscriber. `Collection.subscribeChanges` promises per-key causal order. A
source delete releases a public key. A later source insert publishes that key
again. A later ordered local snapshot must skip every key still present in the
subscriber's public snapshot. The Collection API and the method contract in
`packages/db/src/collection/subscription.ts` authorize these rules.

The lifecycle publication owner models source and subscriber-visible keys in
separate plain sets. It runs two source-action histories: a new insert and a
delete followed by reinsert and a new insert. Each history runs with filtering,
full-state pass-through, and `includeInitialState: false` pass-through. Each
mode runs with and without a cursor. The driver uses a real Collection, its
ordered index, sync transactions, and a subscription. It checks exact callback
batches after each source commit and after the ordered request. It also checks
the retained key count after deletion. That count is a deterministic capacity
observation, separate from the public-row law.

The replay owner controls an accepted load promise. It compares public batches
while the truncate replacement is private and after the promise fulfills. The
same test compares final public keys and the adapter's `lastKey` hint. A second
replay test checks a filtered snapshot selected during callback reentry.

## RED and GREEN calibration

| Subject | Reached comparison and result |
| --- | --- |
| Reviewed `trackSentKeys` early return, restored as a hostile mutant against the final 12-case matrix | Eight pass-through cases failed at callback batches. Both source histories duplicated `insert:two`. The delete/reinsert history retained one deleted key where the model expected zero. Four filtering cases passed. |
| Remove the regular snapshot reservation | The mixed replay test reached the adapter cursor comparison. It received `lastKey: one` instead of the model's `two`. |
| Remove the ordered snapshot reservation | The repeated ordered replay test reached the adapter cursor comparison. It received `lastKey: one` instead of `three`. |
| Publish ordered snapshots during a private replay | The repeated replay test reached its held-publication comparison. It saw separate early inserts for `one`, `two`, and `three`; it expected only the initial `one` batch. |
| Select the held replay by `loadOptions.length === 2` | An extra empty subset load made the fixture hold the wrong request. The repeated replay test reached its held-publication comparison and saw an early delete and replacement inserts. The request-data selector passed the same extra-load case. |
| Derive `lastKey` from the last enumerated full-snapshot row | Four full-snapshot matrix cases reached the cursor comparison and failed. The enumerated row was `two`, although the selected set contained `one`, `two`, and `three`. An unordered snapshot has no last ordered key. |
| Repaired branch | The 12 new selection cases and both strengthened replay cases passed. The full publication, replay, and subscription suites passed: 333 tests. |

The first three mutants failed by value assertion at the stated checkpoint.
The private-publication mutant also failed by value assertion while the replay
promise remained pending. None of these results relies on a timeout or setup
failure. The old reset witness in filtering mode remains narrower: callback
tracking alone lets it pass when the regular reservation is removed. The mixed
replay witness owns that reservation law because its snapshot is private.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The Collection callback and ordered-snapshot contracts authorize the public-key law. The capacity check is an internal work bound; it does not claim an API memory limit. |
| ORC-002 | Plain source and visible sets choose the expected row independently of subscription tracking. Replay expectations fold source rows into a separate public map. |
| ORC-003 | Each owner states its law and limits. The new comments place the model rule, legal histories, real driver, public cuts, and comparisons beside their code. |
| ORC-004 | The 12-case bounded grammar reconstructs the duplicate and retention reports. Removing pass-through modes loses the original fault. Removing delete/reinsert loses the retention cut. Removing cursor or no-cursor loses one local-index path. The domain has two ranks and excludes deleting a missing key. |
| ORC-005 | The driver calls real snapshot methods and source sync transactions. Raw callback batches retain duplicate inserts and their order. The replay driver checks before and after promise settlement. |
| ORC-006 | The six hostile subjects above reached and failed the intended comparison. |
| ORC-007 | No important generated property changed. Both existing owners still run their fixed and random campaigns in the package test suite. |
| ORC-008 | The new model keeps source and visible keys separate: a source row absent from the subscriber can be selected by the next ordered request. Deletion and reinsertion distinguish a prior selection from current visibility. |
| ORC-009 | Model source rows map to installed source Collection rows; model visible keys map to the subscriber's public snapshot. The retained-key count is an internal observation, not model ownership state. |
| ORC-010 | The replay fixtures resolve the held promise in `finally`. The selected mutant failures reached value assertions and cleanup succeeded. These fixed witnesses do not implement separate reporting for a future simultaneous cleanup failure. |
| ORC-011 | The cursor check and public-batch fold give distinct formulations for a lost reservation. A model that looked only at final keys would miss early duplicate inserts. |
| ORC-012 | This record ties the law, finite boundary, guide audit, and mutant outcomes to the reviewed head and versioned follow-up diff. |
| ORC-013 | Full-state and skip-filtering cases reach the pass-through premise; filtering is the neighboring control. Delete/reinsert and new-insert histories distinguish release from permanent reservation. |
| ORC-014 | The controlled sync adapter supplies replay timing and source changes. No real-provider pagination claim follows from this record. |

Open scope: arbitrary orders and rankings, provider pagination, and compiled
live-query windows remain with the owners named in the coverage map. The
bounded matrix does not prove every possible source history.

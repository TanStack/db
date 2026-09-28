# Cold SQLite replacement batching: value-and-work review

- Reviewed executable commit: `5a333993bc6edbb7c28d3ee4596f385522f2bd48`.
- Owner: `packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot.test.ts`.
- Report: [issue #1752](https://github.com/TanStack/db/issues/1752), a measured cold-start persistence storm on a shared browser OPFS driver.

## Contract and evidence

The bounded law concerns `SQLiteCorePersistenceAdapter.applyCommittedTx` for
one full replacement with distinct, non-delete keys. At its fulfilled return,
the rows, row metadata, collection resume metadata, key-set evidence, and
applied position must agree with the input transaction. The replacement must
not make database calls proportional to its row count. A failure in a later
batch must leave the prior generation intact. Duplicate-key and delete
histories retain their ordered sequential semantics.

The fixed driver history seeds an older row and resume marker, then applies
205 distinct `update` mutations under `truncate: true`. Independent expected
values come from the input rows and a parity rule for direct versus later row
metadata. The test compares the complete durable snapshot, exact expected-key
membership, and applied transaction records. It counts query/run calls only
during `applyCommittedTx` and requires at most 40. The previous implementation
failed this assertion at **1,033 calls**. The new path uses at most 100 rows per
SQL statement, below SQLite's older 999-binding limit.

A separate fault-injection history rejects the second multi-row insert after
the first chunk applied inside the transaction. It observes two reached bulk
row inserts, then compares the complete prior snapshot and schema projection
after rollback. On the previous implementation this test failed because no
bulk insert existed and the transaction fulfilled. Fixed duplicate-key and
delete histories separately check the sequential fallback, including merged
row value, key evidence, and a delete tombstone.

The temporary in-memory 14,000-row probe, removed after measurement, counted
**70,015** database calls before the change and **295** afterward on the same
path, including its final snapshot read. It timed approximately 268 ms versus
42 ms on `node:sqlite`. Neither time is an OPFS or browser measurement. The
package suite passed **615 tests** with two TODOs; the build, changed-file
ESLint, Prettier, and diff checks passed. Vitest and Vite emitted non-fatal
warnings about missing Expo example tsconfigs in the filtered install.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass for the fixed cold-replacement law. Atomic persisted rows and stream position are established by the persistence contract; issue #1752 supplies the work concern. The law is limited to one transaction with unique non-delete keys. It does not promise browser latency or resolve every queueing cause in the issue. |
| ORC-002: independent judgment | Pass. Expected rows and metadata derive from fixed input data and a parity rule, not the adapter's batching or metadata-folding code. Exact expected-key membership derives from input keys. |
| ORC-003: distinguishable responsibilities | Pass. The oracle header and adjacent tests state the contract and limits, fixed transaction histories, independent expected snapshot, production `applyCommittedTx` driver, and comparisons at fulfilled-return or rejected-rollback checkpoints. |
| ORC-004: generated-history grammar controls | Not triggered. These are fixed histories and a deterministic width, with no generated-history coverage claim. |
| ORC-005: production path and observation | Pass. The test invokes the real core adapter over `node:sqlite`, records its driver calls during the write, and compares durable rows, metadata, evidence, and position after return. The injected failure reaches the second bulk row statement before rollback comparison. |
| ORC-006: checker calibration | Pass for the work and rollback claims. The old sequential design failed the work bound at 1,033 calls. It also failed the later-batch test at the expected rejection because no second bulk statement existed. These were assertion failures, not setup failures or timeouts. The exact-value checks would reject missing or mis-folded row metadata; no separate production value mutant was run. |
| ORC-007: fixed/random campaigns and replay | Not triggered. The new cases are focused fixed tests, not an important generated property. The existing generated histories in this owner remain unchanged. |
| ORC-008: stateful-model minimality | Not triggered. No reference-model state was introduced, combined, or removed. |
| ORC-009: vocabulary mapping | Pass. A full replacement is a persisted transaction with `truncate: true`; its durable snapshot is distinct from a Collection public snapshot. The call counter is a test-only work measure, not a product state. |
| ORC-010: failure fidelity and cleanup | Pass for exercised paths. The existing close helper preserves the primary failure and separate cleanup diagnostics. The fault-injection transaction rolls back before the complete prior snapshot is compared. |
| ORC-011: second formulation | Not triggered. No plausible shared semantic classifier between the input-derived expected values and the adapter result has been identified. Raw expected-key and applied-transaction reads supplement the adapter snapshot. |

This record supplies the ORC-012 audit for the executable commit above. An
actual Chromium/OPFS run with the reported multi-collection workload is still
needed before claiming a user-visible latency improvement or closing #1752.

## PR #1916 scan-order review follow-up

- CodeRabbit review `5343977574` targeted `d850cfc27795be1b0cdcf7dfc1da8c5d0409a6b4` and posted one inline finding, `4126510406`.
- Reviewed follow-up executable commit: `ae7048d8bdbd26c707fc626bf865dd4f073f866e`.

The review correctly found that the 205-row value assertion depended on scan
order even though `loadResumeSnapshot` issues no `ORDER BY` for this request.
A temporary reversal of the correct observed rows failed the original
assertion at its value checkpoint, with all rows and metadata unchanged.
The follow-up sorts exact observed and expected arrays by key. It retains the
alternate-scan-order challenge in the executable test; the same reversed
rows then passed. The complete snapshot test file passed 36 tests with two
TODOs and clean type checks. This is a test-integrity fix, not a change to
SQLite row ordering or product behavior.

The task-local loss audit accounts for the one inline finding, an optional
CodeRabbit CLI suggestion, and two advisory PR-summary warnings. The PR body
now follows the repository template, a patch changeset records the published
core change, and the touched test driver's purpose has a JSDoc. The optional
extra CLI review remains deferred to the normal PR review process. No
reviewed item remains unclassified; later CodeRabbit reviews at new heads
require separate evaluation.

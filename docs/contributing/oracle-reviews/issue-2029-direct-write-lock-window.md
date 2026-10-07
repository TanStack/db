# Issue #2029 direct-write lock window oracle review

Reviewed source head: the commit that updates this record on
`lock-window-validate-at-apply`. The production change is unchanged from
`6cf681fb4`. The oracle file is as of `b6747be44`.

## Contract and evidence

In a persisted Query Collection, each source commit waits for the persistence
wrapper's apply lock. While another task holds the lock, a committed refetch
waits there, and core has not accepted it yet. A direct write
(`writeInsert`, `writeUpdate`, `writeDelete`, `writeUpsert`) in that window
must be validated against, and apply on top of, the rows of every earlier
commit. A refetch that returns while the write waits follows the merge rule
from #2030: a fetch that started before the write was called keeps the write's
rows on the write's keys, and a fetch that started after the write wins.

The authority is #2029, the direct-write contract in
`docs/collections/query-collection.md`, and the merge rule in
`packages/query-db-collection/src/query.ts`. The reference is the same Query
Collection without persistence, which has no lock.

The oracle is
`packages/query-db-collection/tests/persisted-direct-write-window.oracle.test.ts`.
It has five parts:

1. A 16-case matrix: 4 write types, 2 lock holders (a held durable write of an
   earlier refetch, and startup hydration), and 2 key cases (only the waiting
   refetch holds `k`, or both the applied rows and the refetch hold it). It
   compares the write's outcome, the visible rows and the Query cache with the
   reference, and the stored rows with the visible rows.
2. A 4-case ordering matrix: a third refetch starts before or after the
   write is called, and changes the same key or a different key. It returns
   while the write waits.
3. A witness for a persisted `writeInsert` of an existing key, with no lock
   window.
4. A real-SQLite subset: each write type with the key that only the waiting
   refetch holds and an earlier refetch's durable write holding the lock, plus
   the four ordering cases. It runs the same drivers over the node SQLite
   adapter for sync-present collections, with the same gate on its
   `applyCommittedTx`.
5. A calibration test for the harness's failure report.

Parts 1 to 3 use an in-memory fake adapter. The fake also seeds stored rows,
which the startup holder needs.

## RED and GREEN

| Check | `main` 482196ec4 | Branch |
| --- | --- | --- |
| 16-case matrix | 10 fail. Example: `writeUpdate` of `k` rejects with `UpdateOperationItemNotFoundError`; the reference returns `ok`. | 16 pass |
| Ordering matrix | Not run on `main`, which has no wait. On the branch before the ordering fix, the two `after` cases failed: `k` was 9, where the reference gave 6 and 5. | 4 pass |
| Duplicate insert | Fails: `expected 'ok' to be 'CollectionOperationError'` | Passes |
| Real-SQLite subset (8 cases) | 5 fail: insert, update and delete of `k`, and both ordering cases where the third refetch started before the write. Example: `sqlite {"outcome":"UpdateOperationItemNotFoundError",…} != reference {"outcome":"ok",…}`. Upsert and the two `after` cases pass, because `main` applies the write at once. | 8 pass |

The oracle file passes 30 tests, and its type check reports no errors. The Query Collection package passes 972 of 972 tests with type-checking on, measured before the real-SQLite subset was added.

## Mutant results

Each mutant was applied to the reviewed source and reverted afterwards.

| Mutant | Outcome |
| --- | --- |
| A direct write does not wait for earlier commits | Assertion failure, 9 of 16 matrix cases |
| No duplicate check for a persisted insert | Assertion failure, 4 of 16 matrix cases |
| The write waits only for the first pending commit | Assertion failure, 3 of 16 matrix cases |
| A result that arrives while a write waits is not deferred | Assertion failure, 2 ordering cases |
| The write's own cache update runs the stale-fetch merge | Assertion failure, 2 ordering cases |
| A deferred result is not restored into the cache | Assertion failure, 3 ordering cases |
| The write takes its generation when it applies, not when it is called | Assertion failure, 2 ordering cases |
| The harness rethrows the first cleanup error instead of the AggregateError | Assertion failure in the calibration test |

## External review of `2e1000a77`

An external review of the published head `2e1000a77` reported four
correctness findings and two test findings. All six were confirmed. The
differential matrix missed the four correctness findings for two reasons.
Its reference collection runs the same direct-write code. Its ordering cases
observe rows only after every promise settles and 20 more event-loop turns,
and each has only one write. A new section of the oracle, the precedence
model, takes its expected rows from stated rules instead.

| Finding | Law | RED on `2e1000a77` | Fix |
| --- | --- | --- | --- |
| Rejected writes take precedence over a refetch | Only an accepted write gains precedence over an older fetch | 8 of 8 rejected-write cases: `expected [ { id: 'k', value: 1 } ]` or `[]` `to deeply equal [ { id: 'k', value: 2 } ]` | The write reserves its position when it is called and claims its keys only after validation passes |
| Cleanup lets a waiting write fulfill | A write whose sync run cleanup retired while it waited rejects and stores nothing | 3 of 3 cases: `expected 'ok' not to be 'ok'` | The waiting write checks that its sync context is still current, and rejects with `SyncTransactionAbortedError` |
| A deferred refetch settles before its rows apply | `await refetch()` settles after its result's rows apply | `expected [ { id: 'k', value: 9 } ] to deeply equal [ { id: 'k', value: 6 } ]`; with the merged write held, `expected true to be false` | A stale or deferred result merges once no write waits, and its waiter settles after the merged rows apply |
| A deferred refetch overwrites a later write | A fetch that started before a write never overwrites it | Same key: rows, cache and storage end at `6`, not `10`. Sibling key: `j` ends at `1`, not `10` | The deferred result keeps its own fetch start, and key positions are kept while a deferred result exists |
| The duplicate-insert witness ignores timing | Validation errors reject the returned promise | A synchronous-throw mutant passed the old witness | The witness uses `rejects.toBeInstanceOf(DuplicateKeySyncError)` for both collections |
| `tx: any` in the fake adapter | The adapter matches the persistence contract | No runtime failure; the type was unchecked | The adapter uses `PersistedTx`, and stored rows and keys are narrowed |

The non-deferred stale-merge path had the same settlement fault as the
deferred one: it wrote the cache and returned without a settlement. Both
paths are now one path.

Mutants against the precedence model, all assertion failures:

| Mutant | Result |
| --- | --- |
| Claim keys before validation | 8 failures (the rejected-write cases) |
| No current-context check after the wait | 3 failures (the cleanup cases) |
| Settle before the merged rows apply | 1 failure: the case whose merged write is held. The case without a held merge cannot tell this mutant apart, because the rows apply synchronously there. |
| The deferred result loses its fetch start | 6 failures, including the 4 ownership-lifecycle merge cases |
| Key positions cleared while a deferred result exists | 6 failures, including the ordering and real-SQLite cases |
| Synchronous throw for a duplicate insert | 1 failure (the duplicate-insert witness) |
| Store an unnarrowed transaction value in the fake adapter | Type error at the `rows.set` call |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The full matrix uses an in-memory adapter and the two lock holders named. The real-SQLite subset covers the held-durable-write holder only. |
| ORC-002 | Applicable. The matrix's expected result comes from a Query Collection without persistence. It does not use the persistence wrapper, which is the code under judgment. It shares the Query direct-write code, so the precedence model covers that code with expected rows written from its stated rules. |
| ORC-003 | Applicable. The opening prose states the law, the reference, the lock holders, the key cases, the observations and the limits. The ordering section and the witness each have their own prose. |
| ORC-004 | Inapplicable. The oracle is a finite matrix, not a generated history. Every case in the claimed matrix runs. |
| ORC-005 | Applicable. The driver calls the public `utils.write*` and `utils.refetch` on a collection built with `persistedCollectionOptions`. It checks that it reached the window: when the write runs, storage does not hold the waiting refetch's row. It observes the write's outcome, the visible rows, the Query cache and the stored rows after every promise settles. |
| ORC-006 | Applicable. Eight mutants fail at the intended checkpoint, as listed above. |
| ORC-007 | Inapplicable. No generated property exists. |
| ORC-008 | Inapplicable. No stateful reference model exists. |
| ORC-009 | Applicable. "Window" means the time between a refetch commit and its durable write while another task holds the lock. "Lock holder" means the task that holds the apply lock. Neither is a production state. |
| ORC-010 | Applicable. Each failure message carries both observations. Every driver runs its cleanup through `checked`. When the driver fails and a cleanup step also fails, `checked` throws an AggregateError whose `cause` is the driver's failure and whose `errors` list it first, then each cleanup failure. The calibration test forces a cleanup failure after an assertion failure and checks that the report names the assertion. Comparisons in each test body run after the driver returns, so a cleanup failure cannot hide them. |
| ORC-011 | Applicable. The shared Query direct-write code was a real shared-fault risk: the external review found two faults the differential reference could not see. The precedence model is the second formulation, with expected rows from stated rules. |
| ORC-013 | Applicable to the ordering rule. The `before` and `after` cases are opposite sides of the boundary "the fetch started before or after the write was called". A mutant that takes the generation when the write applies moves that boundary, and the `after` cases reject it. |
| ORC-014 | Applicable. The fake adapter supplies the durable-write delay in parts 1 to 3. Part 4 is the receiving witness: the node SQLite adapter supplies the same premise, a held durable write of an earlier source commit, and stores the rows. It fails on `main` and passes on the branch. The startup holder has no real-SQLite witness. |
| Mutation confirmation as a lock holder | Inapplicable. `persistAndConfirmCollectionMutations` (`packages/db-sqlite-persistence-core/src/persisted.ts:2141`) is called only by the sync-absent wrappers `wrappedOnInsert`, `wrappedOnUpdate` and `wrappedOnDelete` (`persisted.ts:5025`, `5043`, `5061`) and through `acceptMutations` (`persisted.ts:2200`, exposed at `5069`). `persistedCollectionOptions` (`persisted.ts:4906`) builds those only when the options have no `sync` key (`persisted.ts:4935`). A Query Collection always has `sync`, so it is sync-present and never takes the lock this way. |

## Unresolved

- The startup-hydration holder runs only over the fake adapter.

# Issue #2029 direct-write lock window oracle review

Reviewed source head: the commit that adds this record on
`lock-window-validate-at-apply`. The production change is unchanged from
`6cf681fb4`.

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
It has three parts:

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

## RED and GREEN

| Check | `main` 482196ec4 | Branch |
| --- | --- | --- |
| 16-case matrix | 10 fail. Example: `writeUpdate` of `k` rejects with `UpdateOperationItemNotFoundError`; the reference returns `ok`. | 16 pass |
| Ordering matrix | Not run on `main`, which has no wait. On the branch before the ordering fix, the two `after` cases failed: `k` was 9, where the reference gave 6 and 5. | 4 pass |
| Duplicate insert | Fails: `expected 'ok' to be 'CollectionOperationError'` | Passes |

The Query Collection package passes 972 of 972 tests with type-checking on.

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

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The claim is limited to a persisted Query Collection with an in-memory adapter and the two lock holders named. |
| ORC-002 | Applicable. The expected result comes from a Query Collection without persistence. It does not use the persistence wrapper, which is the code under judgment. It shares the Query direct-write code, so a fault in that code that both paths share is out of reach. The ordering expectation also follows the documented merge rule. |
| ORC-003 | Applicable. The opening prose states the law, the reference, the lock holders, the key cases, the observations and the limits. The ordering section and the witness each have their own prose. |
| ORC-004 | Inapplicable. The oracle is a finite matrix, not a generated history. Every case in the claimed matrix runs. |
| ORC-005 | Applicable. The driver calls the public `utils.write*` and `utils.refetch` on a collection built with `persistedCollectionOptions`. It checks that it reached the window: when the write runs, storage does not hold the waiting refetch's row. It observes the write's outcome, the visible rows, the Query cache and the stored rows after every promise settles. |
| ORC-006 | Applicable. Seven mutants fail at the intended checkpoint, as listed above. |
| ORC-007 | Inapplicable. No generated property exists. |
| ORC-008 | Inapplicable. No stateful reference model exists. |
| ORC-009 | Applicable. "Window" means the time between a refetch commit and its durable write while another task holds the lock. "Lock holder" means the task that holds the apply lock. Neither is a production state. |
| ORC-010 | Applicable, with a gap. Each failure message carries both observations. Cleanup runs in `finally`, so a cleanup error after an assertion failure replaces it. No run showed a cleanup failure. |
| ORC-011 | Applicable. The shared Query direct-write code is a shared-fault risk. The duplicate-insert witness compares outcomes, not code paths, and the ordering matrix uses the merge rule as a second statement of the expected result. No separate formulation was added. |
| ORC-013 | Applicable to the ordering rule. The `before` and `after` cases are opposite sides of the boundary "the fetch started before or after the write was called". A mutant that takes the generation when the write applies moves that boundary, and the `after` cases reject it. |
| ORC-014 | Applicable. The adapter is an in-memory fake that supplies the durable-write delay. No real SQLite adapter runs this oracle. The receiving witness with a real adapter is unresolved. |

## Unresolved

- A mutation confirmation does not take the apply lock for a Query Collection,
  so this oracle does not cover it.
- No real SQLite adapter runs the matrix.

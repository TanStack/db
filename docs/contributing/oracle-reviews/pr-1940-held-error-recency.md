# Query Collection held-result error recency

Reviewed PR head before this correction: `a4a8ba8d0c045dcad23f97d3b98dc7298281f1db`.
Reviewed semantic correction: `8bd3fc35`.
Primary owner: `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`.

The public `lastError` and `errorCount` contract retains a completed failure
until a later successful result applies. The added two-cell history starts with
one failed Query fetch, then holds a successful retry at a mocked persisted
baseline scan. A second refetch fails before the held success applies. At the
checkpoint after releasing the scan, the later failure must remain visible and
the count must be two. One cell uses `clearError()` and distinct Error objects;
the other uses `refetch()` and repeats the same Error object in one clock tick.
The expected state follows the order of completed failures and successful
applications, without reading production error timestamps or revisions.

On the uncorrected PR head, both cells failed: the first observed
`lastError === undefined` after the older application, and the second observed
`errorCount === 1` after two terminal failures. The correction guards error
clearing with a revision captured when application begins and distinguishes
terminal Query failures using Query Core's per-Query `errorUpdateCount`. It
retains the older successful rows when they apply; it only prevents that
application from clearing an error recorded later.

The review's exact mutation-held sequence was also run on the uncorrected PR
head. It did not erase the newer error; that path published the earlier rows
after the handler settled while preserving `lastError` and `errorCount`. The
persisted path is the confirmed counterexample. The persisted scan is a
controlled callback, not native SQLite execution. Native persistence,
concurrent retries for multiple tracked Queries, mutation-handler fetch
settlement, and deferred result application remain separate coverage cells in
the Query DB ownership row of `oracle-coverage.md`.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass. The public `lastError`/`errorCount` comments and the owner state the law; the two histories and native-persistence limit are named above. |
| ORC-002 | Pass. Expected error identity and count come from the sequence of terminal failures and applications. The test does not use production timestamps, the revision guard, or Query Core's counter to compute expectations. |
| ORC-003 | Pass. The existing ownership oracle supplies its contract and model; the two-case history and real QueryClient driver sit beside the public `lastError`/`errorCount` refinement checks. |
| ORC-004 | Not applicable. This is a bounded deterministic two-cell history, not a generated property or a claim about all schedules. |
| ORC-005 | Pass. The driver uses public `loadSubset`, `clearError`/`refetch`, and Query Collection utils. It proves each fetch and scan occurred and checks public error identity and count both before and after releasing the scan. |
| ORC-006 | Pass. Both cells failed at their intended public checkpoints on `a4a8ba8d` and pass at `8bd3fc35`. The first rejects premature clearing; the second rejects timestamp-and-object-only error deduplication. |
| ORC-007 | Not applicable. No generated property or random campaign changed. |
| ORC-008 | Not applicable. No reference-model state was added, combined, or removed. The production revision has a separate error-event purpose. |
| ORC-009 | Pass. Query fetch, result application, persisted baseline, and public error state use the glossary and owner terms; the test does not call a fetch completion a publication. |
| ORC-010 | Pass. No shrinking or normalized capture occurs. The `finally` block releases every controlled Promise; the owner cleanup collects failures without replacing the assertion failure. |
| ORC-011 | Not applicable. The public identity/count observations distinguish the reported fault directly. The same-object cell challenges the proposed dedupe mechanism rather than supplying a second semantic reference model. |
| ORC-012 | Pass for this bounded correction. This record names the reviewed semantic head, every applicable ORC-001–011 outcome, the killed wrong designs, and remaining coverage cells. |

Verification at `8bd3fc35`: 532/532 Query DB package tests passed across 15
files; Query DB source typecheck passed; changed-file ESLint had zero errors
and four warnings already present outside the edited lines; Prettier and Git
diff checks passed. The new persisted cases alone passed 2/2 on the PR branch.

Production weight for this correction is 31 added and 17 removed lines, net
+14 relative to the prior PR head. The complete PR production diff is 46
added and 24 removed lines, net +22 relative to `origin/main`. The added
state separates genuinely new terminal failures from observer re-notification
and fences an older asynchronous application; it does not add retry or
recovery machinery. The oracle adds 91 lines, counted separately.

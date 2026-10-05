# Oracle audit PR preparation: review follow-up

Executable revision: `cc25b383` (merge of current `origin/main` after review repairs).
Guide revision: `a1d75726`.
Earlier evidence: [portfolio follow-up](2026-09-30-guide-portfolio-followup.md) and
[offline deletion settlement](2026-09-30-offline-deletion-settlement.md).

This append-only record covers four findings from the PR preparation review.
It adds evidence to the earlier records without changing their verdicts at
their reviewed revisions. The QueryRef product counterexamples remain open.

| Finding | Missing oracle evidence | Repair and distinguishing check |
| --- | --- | --- |
| Active manual outbox removal could strand a caller | Settlement histories held storage deletion, but did not remove the row while the provider was still active. | Two fixed histories call `removeFromOutbox` and `clearOutbox` while the provider is held. Both keep `commit()` and `isPersisted` pending until the provider returns, then check the public transaction state, provider ledger, and empty outbox. The witnesses failed on the pre-repair executor and pass at this revision. |
| Equal-time mixed-phase restart could reverse FIFO order | Replay histories did not put a `deletion-pending` row before an unmarked peer with the same timestamp. | A fixed restart history checks storage insertion order, `beforeRetry` input, deletion of the first row, and the peer's later provider call. It failed on the pre-repair mixed-phase sorting path and passes at this revision. |
| Named pagination and index oracle replay ran unrelated campaigns first | The replay wrapper checked the target result, but not direct selection of the requested lane. | The guarded replay suite checks each named lane's execution count and skipped campaigns. An unrelated failing fixed campaign must not run before the selected replay. The pre-repair path failed that control; the guarded suite passes 35/35. |
| Includes rollback could appear green without a callback reach check | Final rows alone could miss a transient callback publication, and an empty callback loop could pass. | The includes publication oracle requires callback reach and compares the rollback callback trace with the independent public-row model. Its focused suite passes 93/93. |

The controlled offline histories do not prove physical power-loss durability,
native browser restart, independent storage writers, or provider idempotency.
A crash after provider completion but before the `deletion-pending` write can
replay an unmarked row. The provider must honor the supplied idempotency key.
Manual removal after a separate provider failure and multi-owner handoff need
their own witnesses before either behavior gains broader coverage. The
[coverage map](../oracle-coverage.md) retains those limits and the open QueryRef
counterexamples.

At this executable revision, the offline package passed 235 tests across 18
files, typecheck, source lint, and build. The includes publication and guarded
replay suites passed 128 tests together with no type errors. The merged SQLite
persisted-readiness owner passed 35 runtime tests and 27 type checks. The
earlier browser SQLite and Query DB Collection campaigns remain evidence at
their recorded revisions, not new post-merge results.

The branch's production diff against `origin/main` is confined to the offline
package and adds a net 48 lines. Tests and contract records carry the larger
change. No universal oracle conformance or exactly-once provider execution is
claimed.

# Issue #1939 offline admission review

## Reviewed state and contract

- Source review: [issue #1939](https://github.com/TanStack/db/issues/1939).
- Base: `c0d123b86aeb2942d0a2a70a050bf10a3b3dda48` (`origin/main`).
- Reviewed executable head: `f1ae370853b3d3e0f5e0e770ef4dbb5866239b81`.
- Owner: `packages/offline-transactions/tests/leadership-replay.property.test.ts`.

An action selected for offline execution must not fulfill without either an
admitted outbox record or a provider call. This repair chooses rejection and
rollback when leadership is lost before admission. A later action invocation
while offline execution is disabled selects the online-only path instead.
The manual offline transaction path uses the same admission guard.

## Lossless issue review

| ID | Source claim | Verdict and action | Durable value |
| --- | --- | --- | --- |
| R1 | Leadership loss before admission can fulfill with no outbox record or provider call and an absent Collection row. | Confirmed on base; fixed now. | Admission safety relation in the leadership oracle. |
| R2 | `onMutate` can revoke leadership after offline selection; the old guard calls `resolveTransaction()` after an `await`. | Confirmed by controlled path and source; fixed now. | Synchronous and microtask loss schedules retained in the oracle. |
| R3 | Choose rejection/rollback or durable handoff, checking public settlement. | Rejection/rollback chosen and verified; fixed now. | `NonRetriableError` contract and offline guide. |
| R4 | Already durable replay coverage misses selection-to-admission loss; extend the primary oracle, prove RED/GREEN, and record scope. | Confirmed gap; fixed now. | Bounded action matrix, manual path, and coverage map. |
| R5 | The guide's online-only statement applies to actions starting disabled, not an action already selected for offline execution. | Confirmed; fixed now. | Corrected path-selection and pre-admission failure wording. |
| R6 | PR #1938 changed documentation only; RFC #1659 owns broader admission policy. | Confirmed provenance; deferred context. | Coverage map retains the broader boundary and needed witnesses. |

The raw issue contains these six claims and no separate comments at review.
`git show --stat c0d123b8` confirms that PR #1938 did not change production
code. The issue's proposed durable handoff remains a valid alternative design,
but the selected rejection policy needs no new queue or ownership state.

## RED, GREEN, and scope

The issue's original action history failed before the fix with
`['fulfilled', 0, 0]`: settled outcome, durable outbox count, provider-call
count. The retained-leader and before-invocation controls passed.

After adding the microtask and manual paths, a temporary restoration of the
original guard caused three assertion failures at the intended checkpoints:
loss during `onMutate`, loss just after `onMutate`, and manual loss before
`commit()`. Two adjacent action controls passed. These are assertion kills,
not timeouts, setup failures, or unreached paths. The original guard was
removed again. All five admission cases then passed, as did the full package
suite: 207 tests in 17 files. Package typecheck, changed-file Prettier, and
`git diff --check` passed against the reviewed executable head. The commit
hook ran ESLint on the changed TypeScript files.

The bounded action grammar has four schedules: retained leadership, loss
before invocation, loss during `onMutate`, and microtask loss just afterward.
It uses one Collection row and an immediate fake store. The direct manual
history loses leadership after optimistic mutation and before `commit()`.
The driver waits for public settlement or a completed outbox write, then
compares promise outcome, durable records, provider calls, and public row.
The loss cases require a `NonRetriableError` rejection, no durable record or
provider call, and rollback. The controls require provider execution and a
fulfilled transaction. Removing either loss schedule would let a check placed
only at the other boundary survive. An asynchronous `onMutate` return is
excluded by the public API; neither this fixture nor the fake store models
native storage, leader regain, or a write held across leadership loss.

## Oracle guide audit (ORC-001 through ORC-012)

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. Issue #1939 states the no-false-success law; the offline guide and transaction settlement owner state promise and rollback behavior. The bounded limits are above and in the coverage map. |
| ORC-002 independent judgment | Pass. Expected results come from settlement, durability, and leadership laws. The test does not import the admission classifier to compute them. |
| ORC-003 visible responsibilities | Pass. The owner header states contract and limits; the local relation, four action histories plus manual history, real entry points, and public comparisons are together. |
| ORC-004 generated grammar controls | Not triggered: this addition is bounded enumeration, not a generated-history property. Reconstruction, ablation, range, and exclusion for its finite grammar are stated above. Existing generated properties are unchanged. |
| ORC-005 path and observation | Pass. `createOfflineAction()` and `createOfflineTransaction()` run through `persistTransaction()`. The original mutant reached the public settlement and outbox/provider comparisons. |
| ORC-006 checker calibration | Pass. The original guard was a plausible wrong design and produced three assertion failures while controls passed. |
| ORC-007 fixed/random replay | Not triggered: the added fixed matrix is not an important generated property. Existing leadership properties retain their fixed/random campaigns and replay interface. |
| ORC-008 stateful-model minimality | Not triggered: the new relation adds no reference-model state. |
| ORC-009 vocabulary mapping | Pass. The test-only `loss` axis names callback timing. `onMutate`, admission, outbox, leadership, and settlement retain production meanings. |
| ORC-010 failure and cleanup | Pass. `atOracleCheckpoint()` bounds hangs. `cleanupOfflineOracle()` retains primary failures and reports cleanup separately; the mutant failed at assertions without cleanup replacing them. |
| ORC-011 second formulation | Not triggered: no shared semantic fault requiring a second reference formulation was identified. The manual API is an adjacent production path, not a copied reference model. |
| ORC-012 review evidence | This record ties the audit and RED/GREEN evidence to the exact executable commit above. It was added after that code commit; no executable file changed afterward. |

The repair covers these action and manual selection-to-admission histories.
The leadership oracle still needs held outbox writes crossed with leadership
loss and regain, with settlement checked after the write. The IndexedDB
write-settlement owner needs a browser-host composition of that timing with
the adapter's transaction-completion boundary. The coverage map names both
owners.

## PR #1966 follow-up: admission and provider checkpoints

- External review: two test-assertion findings supplied for PR #1966.
- Starting head: `bf742b1b7`.
- Reviewed executable head after repair: `2579ac0acf70465a3902a8317ff241129b9b550e`.
- Owner: `packages/offline-transactions/tests/leadership-replay.property.test.ts`.

| ID | Review claim | Verdict and action | Durable value |
| --- | --- | --- | --- |
| F0 | The production rejection and rollback path is sound. | Confirmed; already fixed before this review. The original-guard mutant and five admission cases are recorded above. | Keep the public settlement, outbox, provider-call, and optimistic-row checks in the leadership oracle. |
| F1 | The retained-leader provider-call count can run after storage becomes visible but before `executor.execute()` starts. | Confirmed; fixed in the reviewed executable head. | The oracle now separates the stored-record checkpoint from transaction settlement. |
| F2 | Comparing the manual `commit()` and `isPersisted.promise` errors by identity overconstrains the contract; check only their class. | Refuted as a test flaw; retain the identity assertion. | `packages/db/tests/transactions.test.ts` explicitly owns the same-instance error law for the underlying transaction. The offline manual path checks that its wrapper preserves it. |

A controlled storage wrapper wrote the retained-leader record, signaled that it
was visible, and held its `set()` completion. On the starting code, the old
provider-count assertion failed at its original checkpoint: expected one call,
observed zero. This was an assertion failure, not a timeout or setup failure.
After the repair, the same held-write case observed a pending caller, one stored
record, and zero provider calls. It then released the write, awaited public
settlement, and observed one provider call and fulfillment. Clearing the
provider-call recorder after settlement made the moved assertion fail, proving
that the later check still rejects a missing call. The recorder corruption
was removed; the controlled hold remains in the oracle.

The `commit()`/`isPersisted.promise` identity law is explicit in
`packages/db/tests/transactions.test.ts` and in the core transaction's original
error rethrow. The offline wrapper rethrows the same error. A temporary wrapper
that threw a fresh `NonRetriableError` with the same message made the manual
oracle's identity assertion fail at the intended checkpoint. Replacing that
assertion with the proposed class-only check let the mutant pass. Both temporary
changes were removed; the core identity test passed on this branch. The review
correctly spotted a dependence on identity, but that dependence protects an
established behavior.

The changed executable owner passed its focused held-write case and the full
offline package suite: 207 tests in 17 files. Package typecheck, changed-file
Prettier, `git diff --check`, and the commit hook's ESLint task passed. The
addition retains the admission law and bounded leadership-loss scope. In particular,
ORC-005 now names the stored-record and settled-call checkpoints separately;
ORC-006 has the controlled old-order failure and missing-call control;
ORC-010 releases the held write during cleanup; ORC-012 records the exact
executable head. The new hold keeps leadership throughout the write. Leadership
loss or regain across a held write and the IndexedDB browser composition remain
with the owners in the coverage map; this review does not close those cells.

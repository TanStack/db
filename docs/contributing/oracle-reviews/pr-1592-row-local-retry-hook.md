# PR #1592: retry-hook failure stays with its row

## Reviewed executable state and law

- Reviewed executable commit: `20a75a144bc268ebf452e045b157903fd6f72e51`.
- Primary owner: `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`.
- Contract: `packages/offline-transactions/README.md` and `docs/guides/offline-transactions.md` at that commit. The maintainer chose row-local handling for a throwing `shouldRetry` hook, replacing the earlier fail-stop policy in this PR.

If `shouldRetry` throws or returns a value other than `true`, `false`, or
`undefined`, the executor records terminal rejection for that transaction,
removes its outbox row, and rejects its caller with the hook failure. After
acknowledged deletion it continues queued work in the same executor. A commit
started during cleanup may join the queue, but no later provider starts before
the head is removed. A peer whose outbox write is visible but unacknowledged
cannot run. If the terminal marker or deletion fails, the executor still stops
with the storage error and holds queued work; the head caller retains the hook
error. These statements concern controlled storage acknowledgement, not native
power-loss durability or exactly-once provider effects.

The old fail-stop rule predicted that a post-fault `commit()` would reject
before storage and a previously durable peer would wait for restart. The new
rule predicts a durable, pending post-fault peer during held cleanup and its
same-executor fulfillment afterward. The six marker-read, marker-write, and
delete cuts for thrown and invalid hooks distinguish those predictions.

## Executed review and checker controls

The original fail-stop implementation failed all six post-fault admission
histories at the intended `durable` versus `settled` assertion: it rejected the
new caller before storing its row. The direct queued-peer witness also rejected
its batch with the hook error instead of resolving after the peer ran. These
were assertion failures. Its started-peer progress cases timed out, which is
liveness evidence but is **not** counted as a checker-calibration kill.

With the row-local implementation, 22 focused hook, admission, started-write,
and storage-failure cases passed. The package run excluding the separate,
uncommitted equal-time FIFO experiment passed 215 tests in 17 files. Package
typecheck, production-source ESLint, changed-file formatting, and diff checks
passed. The pre-commit `pnpm` wrapper failed because its registry returned 403;
its `lint-staged` executable ran directly and passed before the executable
commit. The ordinary commit hook was then disabled for that commit only.

Two hostile controls tested the new checker:

1. A repair that rescanned visible outbox rows after head deletion passed the
   earlier matrix. It failed both `visible-across-cleanup` histories at the
   provider-call comparison: it ran a peer whose storage write was visible but
   not acknowledged. The unchanged row-local implementation passed those cuts.
2. A terminal-cleanup catch that rejected the queued peer ID with the head's
   hook error passed the initial storage-failure matrix. Recording both
   transaction ID and error made all three storage-failure cells reject that
   mutant at the caller-identity assertion. The unchanged implementation passed.

The failed marker and deletion cells preserve the old storage-stop law while
the successful-cleanup cells replace hook fail-stop. They compare exact outbox
IDs and phases, head error, peer provider calls, and whether the executor
accepts another batch. The public histories also compare `commit()`,
`isPersisted.promise`, and Collection rows. Cleanup gates and observed promises
are released in `finally`; `atOracleCheckpoint` bounds waits without replacing
the primary assertion failure.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The maintainer's row-local decision replaces the old hook-fault policy. The README, guide, type comment, package skill, changeset, oracle prose, and coverage map now agree. Controlled-storage and restart limits are explicit. |
| ORC-002 independent judgment | Pass. `expectedHookFaultPeerAtHeldCleanup` and `expectedStartedPeer` derive pending, visibility, and provider eligibility from the contract's acknowledgement and FIFO premises. Neither imports executor classifiers or queue state. |
| ORC-003 distinguishable responsibilities | Pass. The opening contract, local relational models, finite history grammar, public driver, and cut-specific comparisons are described beside their code. |
| ORC-004 generated grammar controls | Not triggered by the new finite matrices. The owner's existing generated campaigns and replay controls are unchanged. The matrices enumerate throw/invalid, three cleanup cuts, and the write visibility and acknowledgement cuts stated above. |
| ORC-005 path and observation | Pass. Public transactions run through `persistTransaction`, real outbox storage, scheduler, provider, and caller promises. Direct executor witnesses isolate queue progress and terminal storage failure. |
| ORC-006 checker calibration | Pass for the old fail-stop assertion and both hostile mutants at their intended comparisons. Started-peer timeouts are reported separately. |
| ORC-007 fixed/random replay | Not triggered by these finite additions; the owner's existing fixed and random properties retain their replay inputs. |
| ORC-008 stateful-model minimality | Not triggered: the new relation has no mutable reference-model state. Visibility, acknowledgement, and head removal are separate only because legal next events distinguish them. |
| ORC-009 vocabulary mapping | Pass. `outbox replay`, `offline executor restart`, `rejection-pending`, acknowledgement, and settlement use glossary meanings. The test-only `StartedWriteCut` combines storage visibility and write acknowledgement, not a production state enum. |
| ORC-010 failure fidelity and cleanup | Pass. Gates force the stated events, checkpoints bound hangs, and cleanup preserves primary failures. The mutant kills were assertion failures rather than setup or cleanup failures. |
| ORC-011 independent second formulation | Not triggered: no shared reference classifier or equivalent model pair was introduced. The direct queue witness is a second production boundary, not a copied model. |
| ORC-012 review evidence | This versioned record names the exact executable commit, applicable outcomes, controls, and limits. It follows the executable commit; no executable file is part of this record change. |
| ORC-013 distinguishing boundary witness | Pass. A visible, unacknowledged peer across head deletion is the nearby case that rejects the rescan mutant; acknowledged peers run after deletion. The storage-failure cells reject an unconditional “continue after hook fault” design. |
| ORC-014 controlled-premise handoff | No native-host claim is made. Fake storage controls event order; native adapter completion and power-loss behavior remain separate receiving work. |

## Remaining scope

The controlled adapter does not cover a `set()` that mutates storage and then
rejects its acknowledgement. A replacement executor that finishes startup
before an old executor's held write acknowledges can miss that later row; the
started-write oracle promises same-executor progress after successful cleanup,
not a cross-executor handoff in that history. The coverage map keeps these
limits with the offline settlement and leadership owners. General offline
recovery policy remains with RFC #1659.

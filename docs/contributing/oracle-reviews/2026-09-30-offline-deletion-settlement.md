# Offline outbox deletion settlement: bounded follow-up

Executable revision: `9b6b8316fcad08be37c8ddca51dd66096b3a80b1`
Guide revision: `a1d75726`
Prior review: [Oracle guide portfolio follow-up](2026-09-30-guide-portfolio-followup.md).

This append-only record resolves the prior offline settlement authority conflict.
The maintainer chose outbox deletion as the success boundary. The
[README](../../../packages/offline-transactions/README.md) promises that the
configured `mutationFn` returns and the storage adapter acknowledges deletion
before `commit()`, `isPersisted.promise`, or the per-ID waiter fulfills. A
provider effect is confirmed only to the extent that `mutationFn` waits for it.
The prior review remains an accurate record of its earlier executable revision.

## Contract, witnesses, and limits

| Dimension | Evidence at the executable revision |
| --- | --- |
| Contract | Caller success follows `mutationFn` fulfillment and acknowledged outbox deletion. A durable `deletion-pending` phase records provider fulfillment before deletion is attempted. |
| Legal histories | Held deletion; failed deletion followed by in-process retry with a queued peer; failed phase write followed by in-process retry; failed deletion followed by restart and `beforeRetry: () => []`; old unmarked row replay; permanent provider failure with failed rejection cleanup. |
| Production paths | `OfflineTransaction.commit()` through `OfflineExecutor`, `TransactionExecutor`, `OutboxManager`, serializer, and storage adapters. The restart witness creates a second executor over the same fake storage. |
| Public observations and checkpoints | Exact `commit()` and `isPersisted` states, per-ID waiter, provider call IDs and idempotency key, queued-peer order, local transaction state, provider-applied rows, and outbox contents before and after deletion acknowledgement. |
| Wrong designs rejected | The original early-fulfillment implementation fails the failed-delete and restart tests at the pending-state checkpoint. Swallowed adapter deletion errors fail the localStorage and IndexedDB tests. Recalling the provider for a marked row fails the restart call ledger; allowing a peer past the retained FIFO head fails the queued-peer ledger. |

The failed-deletion and restart tests were RED before the executor repair:
`commit()` and `isPersisted.promise` fulfilled while the row remained. The two
adapter failure tests were RED before error propagation was repaired. The
permanent-provider-failure branch remains separate: its caller rejects with the
provider error even if removing the rejected row also fails.

The phase write may itself fail after the provider succeeds. The current
executor retains the phase in memory, keeps the caller pending, and retries the
write before deletion without repeating the provider call. A crash before the
phase is durably written leaves an unmarked row, which can replay. The provider
must honor the supplied idempotency key to avoid a repeated effect. Older app
versions may also replay a marked row. Storage-adapter acknowledgement does not
prove physical power-loss durability. No exactly-once provider claim is made.

## Guide review

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | **Met for this boundary.** The README and maintainer decision agree on deletion-gated success; the adapter, provider, crash, and old-reader limits are explicit. |
| ORC-002 independent judgment | **Met for this boundary.** Expected caller and outbox states come from the README law and authored provider/storage gates, not executor phase logic. |
| ORC-003 visible responsibilities | **Met.** The settlement oracle's opening contract, prefix model, generated grammar, production driver, and public refinement checks remain directly visible; fixed deletion histories extend that owner. |
| ORC-004 generated grammar controls | **Bounded, unchanged.** The existing generated prefix grammar retains its reconstruction, ablation, range, and exclusion controls. This follow-up adds fixed lifecycle histories and claims no generated deletion grammar. |
| ORC-005 production path and observation | **Met at the controlled boundary.** The tests reach the real executor and compare caller settlement, outbox state, and provider calls at held and completed deletion cuts. |
| ORC-006 checker calibration | **Met.** The original early-success code and swallowed adapter errors produced assertion failures at the intended checkpoints before the fixes. |
| ORC-007 fixed/random campaigns and replay | **Partial for the existing generated property.** The package runs paired fixed and seedless campaigns with the same property and budget, and the file accepts seed/path replay. A captured failing settlement seed and shrink path has not been directly replayed at this revision. The fixed deletion histories do not trigger this rule by themselves. |
| ORC-008 stateful-model minimality | **No new trigger.** No reference-model state was introduced, removed, combined, or split; `deletion-pending` is production outbox state exercised by fixed histories. |
| ORC-009 vocabulary mapping | **Met.** The phase is explicitly an outbox row state after provider fulfillment; `settlement`, `provider`, and `optimistic transaction` retain their glossary meanings. |
| ORC-010 failure fidelity and cleanup | **Met for the new witnesses.** Gates release in `finally`, and `cleanupOfflineOracle` preserves a primary assertion separately from cleanup failures. An unbounded storage operation that never settles is not covered. |
| ORC-011 independent second formulation | **No new trigger.** No plausible shared semantic fault requiring a second model was named; adapter tests independently check that deletion errors cross the storage boundary. |
| ORC-012 review evidence | **Recorded with the ORC-007 gap.** This record ties every applicable outcome, RED/GREEN witness, and remaining cell to the exact executable revision. |
| ORC-013 distinguishing boundary witness | **Met.** Held deletion versus completed deletion and failed deletion versus successful retry distinguish early settlement; marked restart versus unmarked replay distinguishes provider replay policy. |
| ORC-014 controlled-premise handoff | **Bounded.** Fake-storage failure is received by localStorage `removeItem` and IndexedDB write-store failure tests. Native browser restart, multi-owner handoff, real provider idempotency, and power-loss durability remain unproved. |

## Verification and code weight

At the executable revision, the offline package suite passed **229/229 tests
across 17 files**. Package typecheck, source lint, build, Prettier, and Git diff
checks passed. Lint on touched test files exited 0 with three pre-existing
`require-await` warnings in `OfflineExecutor.test.ts` and no errors.

The repair adds a net **38 production lines** for the persisted phase,
deletion-gated settlement, retry, and adapter error propagation. Tests add a net
**818 lines** and contract/coverage documents add **32 lines**. It uses the
existing FIFO scheduler and retry timer; it does not add a second lifecycle
machine. The large test addition records separate held, failed, retry, restart,
and legacy checkpoints with explicit cleanup.

The [coverage map](../oracle-coverage.md) owns the remaining crash-window,
old-reader, native restart, multi-owner, real-provider idempotency, and captured
settlement replay witnesses. A reachable replay effect in those cells prevents
an exactly-once claim.

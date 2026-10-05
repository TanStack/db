# Offline outbox storage failure: fail-stop follow-up

Executable revision: `d3d00a67fbc9509cde632578a9e36241caceb4e2`  
Prior review: [Offline outbox deletion settlement](2026-09-30-offline-deletion-settlement.md).  
Review inputs: the maintainer's four findings and test-gap note for PR #1968, plus CodeRabbit review 5373142655 at `400d8d86970b2cc6368b30a68554bbdcad734bfd`.

The maintainer decided that an outbox deletion failure means storage is seriously broken: stop the current executor and throw the storage error. This deliberately revises the earlier in-process deletion-retry law recorded at the prior executable revision. A phase-write failure takes the same fail-stop path because it prevents a durable record of the provider outcome.

## Contract and evidence

| Boundary | Executable witness at this revision |
| --- | --- |
| Successful provider, failed delete | `transaction-settlement.property.test.ts` holds a provider and queues a peer. After delete fails, `commit()` and `isPersisted.promise` reject with the exact storage error, the local transaction fails, the peer stays pending, and the head's durable `deletion-pending` marker remains. An online notification causes no second deletion or peer provider call. A later admission rejects before its outbox write. |
| Permanent provider failure, failed delete | The direct executor witness rejects `execute()` with the exact storage error, rejects the transaction waiter with the original `NonRetriableError`, and retains both FIFO entries. Another `executeAll()` on the stopped executor rejects with the same storage error even after storage recovers. |
| Failed phase write | The public witness rejects the head caller with the marker-write error, does not delete or retry, and leaves the queued peer untouched. The durable row is unmarked; a crash can still replay provider work. |
| Restart after a durable marker | Separate successful and permanently rejected provider histories construct a fresh executor over the same storage. It removes the marked row without another provider call; the rejection path does not restore optimistic state. The successful path also checks that restart does not rewrite an already durable marker. |
| Timer and leadership boundary | The leadership witness injects one failed terminal deletion, advances fake time by 60 seconds, and observes no automatic retry or later provider call. |

The two direct stop-and-throw witnesses were RED against the uncommitted retrying candidate: both `execute()` calls resolved when they had to reject. They are GREEN at this revision. The full offline suite passed **237/237 tests across 18 files**; package typecheck, build, Prettier, and edited-file lint passed with no lint errors. The five `require-await` warnings in the leadership test predate this change.

The production diff is net **+62 lines**: a durable rejection marker, one shared cleanup boundary, a stopped-executor error latch, and a pre-admission check. Tests are net **+208 lines** and contract documents net **+28 lines**. The latch does not schedule a recovery lifecycle. Automatic marked cleanup resumes only in a fresh executor after storage recovers.

## Review disposition

| Item | Disposition at this executable revision |
| --- | --- |
| R1: rejection-path delete error escaped before the handled-provider-error flag | Fixed by explicit storage-error propagation after recording the terminal marker. The batch stops; the affected waiter retains its original provider error. |
| R2: constant deletion retry delay and FIFO head blocking | The constant-delay defect was real at the reviewed revision. The maintainer chose fail-stop, so no deletion retry or backoff remains. Queued peers stay untouched. |
| R3: failed terminal deletion could replay `mutationFn` after restart | Fixed by durable `rejection-pending`. Both provider-call count and optimistic restoration are checked. |
| R4: repeated marker writes on deletion retry | A marked row on restart now goes directly to removal. The original unconditional skip was unsafe after a failed first marker write; this revision stops on that failure. |
| R5: missing terminal-failure deletion dimension | Added direct batch, public caller, FIFO timer, and same-storage restart witnesses to the settlement and leadership owners. |
| CodeRabbit CR5: backoff and `lastError` suggestion | Overlaps R2. Backoff is superseded by fail-stop; overwriting `lastError` with the deletion error would erase the original provider failure needed for terminal replay. |

## Limits and open work

Fake storage controls exact failure and restart order. Native browser restart, multi-owner handoff, physical power-loss durability, and real provider idempotency remain outside these witnesses. A failed phase write leaves an unmarked replay window; the provider must honor the supplied idempotency key. Already admitted queued callers remain pending when this executor stops. Their eventual disposition after a fresh executor starts is a separate lifecycle observation, owned by the settlement oracle and the broader offline policy in [RFC #1659](https://github.com/TanStack/db/issues/1659). The earlier review record remains an accurate description of its own revision and is not edited.

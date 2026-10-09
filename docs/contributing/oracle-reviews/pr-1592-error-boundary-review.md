# PR #1592: retry error boundary review

## Authority and scope

The reviewed PR head was `1bf6a0bc47eb0021a926994b82af27cc326403f6`.
The primary executable owner is
`packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`.
The README promises that `shouldRetry` receives the named mutation function's
same `Error` instance. Public manual outbox removal also acknowledges deletion
while a provider can still be running. If that provider then fails, its caller
must settle from that failure and a retry cannot recreate the removed row.

The reviewer separately observed that a hook fault loses the provider error.
The maintainer chose the exact hook error as the caller-facing and stored error;
the provider error remains in the warning. The serialized format stores
`name`, `message`, and `stack`, so arbitrary error prototypes and custom fields
are not restored after an offline executor restart. The documented invalid
Promise result is observed for rejection; arbitrary third-party thenables are
outside the current contract and Node-hosted oracle evidence.

## Oracle-first experiments

The cross-realm history throws a `node:vm` Error with `status = 401` from the
real named mutation function. The hook must receive that object by identity,
persist a first retry record, and later fulfill a public `commit()` after a
successful second attempt. A local Error and a plain status-bearing object are
neighboring existing controls: the former keeps identity, and the latter is
converted before the hook. This case fails on the reviewed executor at the
hook-identity assertion: it receives a wrapper with no `status`.

The removal history holds the public provider call, acknowledges either
`removeFromOutbox` or `clearOutbox`, then releases a network failure under the
default retry decision or a 401 under a true hook answer. Before release, the
row is absent and both caller promises are pending. After release, both must
reject with the provider Error, the row must stay absent, and a later peer must
fulfill in the same executor. On the reviewed executor, both
`removeFromOutbox` cases fail the caller-outcome assertion with pending
promises. The two `clearOutbox` cases time out at the caller-settlement
checkpoint because that API clears the scheduler's running count before the
provider returns; those timeouts are progress failures, not assertion kills.
The existing successful-provider removal witness is the nearby fulfillment
control. A narrower missing-row branch in the retry-persistence catch repairs
the reported failure; unrelated storage errors still stop the batch.

On the repaired working tree, all 60 settlement-oracle cases passed. The new
cross-realm case, four removal cases, and the existing successful-provider
removal cases passed in focused runs. The package typecheck and edited-file
ESLint passed. The prior Preview CI failure was a 404 from the external preview
publisher; rerunning only Preview succeeded, and the current published head's
other CI jobs passed. These CI results predate the follow-up source commit.

## Guide audit

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 authority | The README's same-instance hook rule and acknowledged public removal supply the two laws; provider and storage are controlled. |
| ORC-002 independence | Expected identity, rejection, absence, and peer progress come from those public contracts, not the executor's classifier or scheduler. |
| ORC-003 literate responsibilities | The oracle opening states the laws and limits. Local prose gives the legal histories, real public driver, observations, and checkpoints beside each case. |
| ORC-004 grammar controls | The fixed removal matrix reconstructs two APIs crossed with default network and hook 401 retry. Each axis changes the reached path. A removal after retry persistence begins and an unacknowledged removal are excluded. The cross-realm Error is distinguished from a local Error and a plain object. |
| ORC-005 path and observation | Public `commit()`, `isPersisted`, `peekOutbox`, provider calls, and later peer settlement are observed at held-provider, acknowledged-removal, rejection, and later-peer cuts. |
| ORC-006 calibration | The reviewed production code fails the cross-realm identity assertion and both `removeFromOutbox` caller assertions. `clearOutbox` reports two classified timeouts. The repair passes the same cases. |
| ORC-007 campaigns | The new histories are fixed cases, so the campaign trigger does not apply. The existing generated retry decision property still runs fixed-seed and seedless campaigns. |
| ORC-008 model state | No reference-model state was added or merged. |
| ORC-009 vocabulary | Outbox row, named mutation function, optimistic state, and offline executor restart follow the glossary. |
| ORC-010 cleanup | Held providers are released and pending callers are rejected in `finally`; cleanup keeps the primary failure distinct. |
| ORC-011 second formulation | The same-instance law is checked by direct object identity and by its `status`-based retry consequence. The removal law has the success-after-removal neighboring history. |
| ORC-012 review evidence | This record identifies the reviewed head, exact RED checkpoints, GREEN runs, and limits. The repaired revision is the commit containing this record. |
| ORC-013 boundary witness | A 401 Error from another realm distinguishes conversion from identity; default network and overridden 401 retry distinguish the missing-row consequence. |
| ORC-014 provider handoff | No live server or native-storage claim is made. The fake adapter and controlled provider establish only the executor boundary. |

The bounded removal witness covers deletion acknowledged before the provider
settles. A manual removal overlapping the read and write inside `outbox.update`
could resurrect a row; that interleaving has not been exercised. The settlement
owner needs a controlled witness and an atomicity decision for it. The coverage
map records this open boundary. A browser-host receiving witness would be needed to claim
cross-realm behavior through an actual iframe or worker rather than `node:vm`.

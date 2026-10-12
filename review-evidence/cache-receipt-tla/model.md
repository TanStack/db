# Model layer — receipt-settlement grammar v1

The extraction target is one on-demand scoped recovery that intersects a
persisting optimistic transaction. The [TLA+ model](ReceiptSettlement.tla)
keeps three ordered sync transactions: a possible ordinary write before the
recovery truncate, the truncate, and a fresh write for one subset demand.
It projects the exposed authoritative base, not the optimistic row overlay.

| ID  | Surviving unit or relation                             | Why it changes a legal action or observation                                                                                                                                                     |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `optimistic` and `handler`                             | A persisting optimistic transaction may hold an ordinary sync transaction. A handler waiting for recovery or its own demand cannot return to release that hold.                                  |
| M2  | `pre`, `truncate`, and `fresh`                         | Their order decides what the truncate replaces and which fresh write can establish demand success. `pre` also has a pending pre-acceptance phase. These are model phases, not production queues. |
| M3  | Each transaction's accepted signal and applied receipt | `whenSyncAccepted` and an applied receipt settle at different boundaries while an ordinary write is held. Combining them would hide premature demand success.                                    |
| M4  | `recovery` and `demand`                                | Scoped recovery may proceed after truncate acceptance; a demand succeeds only after its own fresh receipt becomes visible.                                                                       |
| M5  | `base`                                                 | An immediate truncate must remove the old authoritative base even while optimistic state still overlays it. The public row overlay and event batch are outside this projection.                  |

The active overlap is **M1 × M3 × M4**. A handler can wait for recovery while
its optimistic transaction persists. The truncate crosses that hold and makes
recovery possible. A later ordinary source write can still be accepted but
held; its subset demand waits for visibility. This is why recovery progress and
demand success cannot use one undifferentiated “commit done” signal.

| ID  | Operative law                                                                                                                                                                                   | Authority                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| R1  | An ordinary sync transaction accepted during a persisting optimistic transaction has a settled acceptance signal and a pending applied receipt.                                                 | Glossary's accepted sync transaction and applied receipt; optimistic-history oracle.   |
| R2  | A truncate applies immediately, together with all previously accepted sync transactions, and replaces the authoritative base.                                                                   | Core Collection state and optimistic-history oracle.                                   |
| R3  | Scoped recovery may release its waiting handler after the truncate's accepted signal. An applied wait is equivalent only while R2 holds.                                                        | Persistence wrapper's `whenSyncAccepted` call; R2.                                     |
| R4  | A successful subset demand waits for the applied receipt of its fresh source write. Acceptance alone cannot establish success.                                                                  | Glossary's applied-settlement law and Electric oracle coverage.                        |
| R5  | If a persisting optimistic handler awaits its own ordinary subset demand, the demand may wait for the handler's transaction to settle. This is a known self-wait, not a recovery promise.       | Optimistic-history oracle's stated limit.                                              |
| R6  | A pending pre-acceptance write has no accepted signal. When a truncate or fresh write is visible, the exposed authoritative base reflects that latest write, not only a fulfilled receipt flag. | Glossary's accepted sync transaction, exposed authoritative base, and applied receipt. |

`preAccepted` and its peers are model observations of
`whenSyncAccepted(receipt)`, not flags proposed for production. The model's
`accepted` phase is a temporary representation of the interval between
acceptance and visibility. The `pre` write alone also has a `pending` phase
before acceptance; the model does not represent a failed durable write.
`base` omits the optimistic overlay, so a public
Collection read during persistence need not equal `base`.

## Adjacent forms and exclusion

| ID  | Route             | Change, preserved law, and loss                                                                                                                                                                                                                   |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Rule combination  | Remove the persisting optimistic transaction. Ordinary writes and truncate apply immediately; R1–R4 remain. This loses the held-receipt distinction in the observed history.                                                                      |
| A2  | Rule combination  | Wait for truncate visibility rather than acceptance. With R2 intact, the same states are reachable and R1–R4 remain. This adds a dependency on immediate truncate application; if R2 is also weakened, the handler and recovery can form a cycle. |
| A3  | Pattern unfolding | Let the same optimistic handler await its own post-recovery subset demand. The demand's ordinary write can be accepted but held until that handler returns. R1 and R4 remain; progress is unavailable without changing the caller's wait.         |

An ordinary non-truncate sync transaction used as the recovery clear is the
near negative. It may legally be held by optimistic state and does not satisfy
R2. The grammar refuses to infer recovery progress from its acceptance or an
applied wait. No independent marginal system was supplied for transfer
testing; range remains untested.

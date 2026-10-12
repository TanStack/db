# Process layer — receipt grammar provenance and limits

## Frozen source and preservation preview

The source snapshot is Git `d3d617273318573df9e15287d704dc1853a67337`.
This is a separate **exploratory v1** extraction, not an exact-equivalence
extension of `cache-authority-tla`. The source is
`docs/contributing/glossary.md` (accepted sync transaction, optimistic
transaction, applied receipt and settlement),
`packages/db/tests/optimistic-history-oracle.ts` (opening contract and
acceptance/visibility observations),
`packages/db/src/collection/state.ts:1077-1103` (truncate admission), and
`packages/db-sqlite-persistence-core/src/persisted.ts:2193-2205` (scoped
recovery clear). The new receiving test is an adjacent production check, not
an authority for this receipt grammar.

The checked `ReceiptSettlement.tla` SHA-256 is
`946e54b60e27d855f8b1375a809565d3a4bb9fc76693493baf0f55f0f06523de`.
The preservation preview is provisional, not user-frozen:

| ID  | Property                                                                                                                                  | Basis                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| P1  | Accepted ordinary sync work can remain invisible while optimistic state persists.                                                         | Source-stated.                          |
| P2  | `whenSyncAccepted` settles on acceptance, neither earlier nor later; an applied receipt settles on visibility.                            | Source-stated.                          |
| P3  | A committed truncate applies immediately and drains prior accepted work before replacing the exposed authoritative base with empty state. | Source-stated.                          |
| P4  | Scoped recovery's clear waits for acceptance; an applied wait is equivalent only while P3 holds.                                          | Source-stated plus analyst comparison.  |
| P5  | Subset success requires the fresh source write's applied receipt and its row in the exposed authoritative base.                           | Source-stated.                          |
| P6  | A handler awaiting its own held subset demand can wait for itself indefinitely.                                                           | Source-stated limitation.               |
| P7  | The exposed authoritative base is distinct from the optimistic overlay.                                                                   | Source-stated; overlay values excluded. |

## Reconstruction and ablation

Observed parts are the persisting optimistic transaction, accepted sync work,
applied receipts, immediate truncate, recovery wait, and demand settlement.
Analyst modeling choices are one pre-truncate write, one fresh write, the
`none/pending/accepted/visible` representation for the first write, the
`none/accepted/visible` representation for the others, and a single `base`
value. The latter phases are not proposed production state.

The grammar reconstructs a held ordinary write, an immediate truncate that
drains it, a handler released by recovery, and a later fresh write whose
applied receipt controls demand success. It also reconstructs the no-optimistic
neighbor and the documented own-demand self-wait. The visible-gate variant
preserves the same bounded states only because truncate application is
immediate. It cannot reconstruct source errors, abort, multiple optimistic
transactions, or Collection event batches.

| Removed or weakened relation                      | Effect                                                                                                            | Control                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Immediate truncate application                    | The accepted truncate remains invisible.                                                                          | `fault-held-truncate.cfg`    |
| Immediate truncate plus visibility-gated recovery | The waiting handler cannot release the truncate that recovery awaits.                                             | `fault-recovery-cycle.cfg`   |
| Applied receipt as the subset success gate        | A demand reports success while its fresh source row is still held.                                                | `fault-early-demand.cfg`     |
| Acceptance signal at acceptance                   | A handler-facing wait remains pending after core accepted its write.                                              | `fault-late-acceptance.cfg`  |
| Acceptance signal before acceptance               | A pending pre-acceptance write falsely releases its handler.                                                      | `fault-early-acceptance.cfg` |
| Truncate's exposed-base replacement               | A fulfilled truncate receipt retains the preceding row.                                                           | `fault-retained-pre.cfg`     |
| Fresh write's exposed-base effect                 | A fulfilled fresh receipt leaves the base empty.                                                                  | `fault-missing-fresh.cfg`    |
| Handler distinct from external caller             | The model would miss the documented own-demand self-wait.                                                         | `cover-self-demand.cfg`      |
| Separate `pre` and `fresh` writes                 | The model could not distinguish a queued write erased by truncate from the write that establishes demand success. | Reconstruction of P3 and P5. |

The active overlap is optimistic handler × receipt boundary × demand. It is
not assigned to one module merely for a clean decomposition. The stable
source's Collection state and persisted wrapper meet at the truncate receipt;
the provider's fresh write meets the subset demand at its own applied receipt.

## Range, exclusion, and projection support

Dynamics are accepting ordinary work, starting recovery, accepting truncate,
finishing recovery, starting a demand, accepting its fresh work, settling the
demand, and returning from the handler. Constraints are P1–P7. Boundary
conditions are one optimistic transaction, at most three sync transactions,
one demand, and no fairness. The near negative is a non-truncate recovery
clear, which need not apply while an optimistic transaction persists. No
independent marginal case was supplied, so range transfer is untested.

The model loses transaction abort and failure, multiple handlers, receipt
rejection, source transport, durable SQLite admission, publication event
batches, row-level optimistic overlays, and actual scheduling. A green TLC
run cannot prove production liveness or show that every provider fulfills the
subset-load promise. The pending phase checks early acceptance, but cannot
show a later durable rejection. Its seven fault controls establish sensitivity only to
the encoded laws. The composed SQLite receiving test calibrates cache-head
authority, not these receipt invariants.

| Brief claim                                                | Support                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Acceptance differs from visibility                         | M2–M4, P1–P2, `safe.cfg`, `fault-early-demand.cfg`.                                                                                     |
| Scoped truncate breaks the proposed recovery cycle         | P3–P4, core source cut, `fault-held-truncate.cfg`, `fault-recovery-cycle.cfg`.                                                          |
| Visibility wait alone is not the deadlock                  | A2, `safe-visibility-gate.cfg`.                                                                                                         |
| Own-demand self-wait remains                               | P6, `cover-self-demand.cfg`, optimistic-history oracle.                                                                                 |
| The adjacent cache-head receiving oracle killed its mutant | [evidence.md](evidence.md) production-boundary paragraph and the cache-authority [receiving audit](../cache-authority-tla/evidence.md). |
| Limits and transfer status                                 | Range and loss paragraph above.                                                                                                         |

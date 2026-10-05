# Source delete for a key the source never held

Base revision: `06cab6fc7` (`main` after #2005). Tested revision:
`74e5b80d6`. Production code is unchanged from the base revision.

## Contract

A source may delete a key it does not hold. A typical cause: the backend
accepted an optimistic insert, then deleted the row before the source
streamed it. The maintainer decision for this owner is:

- An accepted optimistic snapshot of the key retires, as it does for any
  ordinary source publication. The row disappears.
- An active request for the key stays in place. The delete removes no base
  row and acknowledges no request.

`main` already behaves this way. This review adds the generated histories
and witnesses. It changes no production code.

## Gap

The coverage map listed the case as open. The optimistic-history driver
dropped every delete for a key the source did not hold before the model or
the Collection saw it. So no optimistic-history campaign ever wrote such a
delete.

## Witnesses

- The driver keeps deletes for keys the source does not hold and counts them.
  The fixed campaign must write at least one, beside deletes of held keys.
- Three pinned histories in
  `collection-state-retention-oracle.property.test.ts` accept an optimistic
  insert and then delete its key from a source that never held it. They cover
  a queued delete, an immediate delete, and a delete written inside the
  insert handler.
- A fourth pinned history writes an immediate delete while the insert is
  still active. The row stays visible through settlement.

## ORC outcomes

The record claims a repaired generated-history grammar, so ORC-012 applies.
Each requirement follows.

- **ORC-001 contract authority and limits: met.** The maintainer decision
  above is the authority. The oracle's opening prose states the contract,
  and Limits below states what it does not claim.
- **ORC-002 independent judgment: met.** The model applies its existing drain
  rule. Every ordinary source publication retires accepted snapshots, and a
  source delete acknowledges no request. The model reads no production state
  and imports no production classifier.
- **ORC-003 distinguishable responsibilities: met.**
  `optimistic-history-oracle.ts` keeps the contract prose, the
  `HistoryModel`, the driver `runOptimisticHistory`, and its per-step refinement
  check apart. The grammar lives in
  `collection-state-retention-oracle.property.test.ts` as `sourceBatch` and
  `optimisticHistory`.
- **ORC-004 grammar controls: met, with one gap.**
  - Reconstruction: the four pinned histories are legal histories of the
    grammar. Edits and source deletes both draw keys from 1 to 3.
  - Ablation and range: the fixed-campaign control requires absent-key
    deletes, and it requires more deletes in total than absent-key deletes, so
    held-key deletes remain.
  - Exclusion: the driver no longer filters deletes. The source still writes
    `insert` only for a key it lacks.
  - Gap: no counter shows that the generator reaches an absent-key delete
    while an accepted snapshot of the same key exists. The pinned histories
    reach that premise directly.
- **ORC-005 production path and observation: met.** The driver writes through
  the real sync `begin`, `write`, and `commit` API of a Collection. After each
  step it compares public rows, both subscribers' replicas, downstream query
  rows, and request outcomes with the model.
- **ORC-006 checker calibration: met.** A hostile mutant rejects a sync delete
  for a key absent from the source projection. With the old grammar, the
  optimistic-history campaigns pass under it. Only the separate retained
  authoritative state property fails, and that property has no optimistic
  layers. With the new grammar, the fixed and random optimistic-history
  campaigns and the three accepted-insert histories fail. This ran on the
  tree of `af0b8648a`. `74e5b80d6` adds only the fourth pinned history. A
  mutant that drops any delete for a key absent from `syncedData` is too broad
  to distinguish the change. The old grammar already kills it through queued
  deletes of held keys.
- **ORC-007 fixed and random campaigns: met.** The fixed campaign uses seed
  86103. The random campaign runs under the property name
  `collection-state.optimistic-history`, which accepts a seed and path for
  replay. Both pass on `74e5b80d6`, and so do the 153 tests in the four files
  that use the driver. On `af0b8648a`, the `@tanstack/db` suite passed 244
  files and 8,269 tests.
- **ORC-008 stateful-model minimality: not applicable.** The model gains no
  state and loses none. An absent-key delete takes the existing delete branch
  of the drain.
- **ORC-009 vocabulary mapping: met, with a recorded term.** "Accepted
  snapshot" maps to a completed direct mutation that the Collection retains
  until source publication. The model's existing `retired` flag means that
  the snapshot stopped overlaying the base. That differs from the glossary's
  demand retirement. This change keeps the existing model term and does not
  rename it.
- **ORC-010 failure fidelity and cleanup: not applicable.** This change alters
  no shrinking, capture, or cleanup path. The driver keeps its existing
  `withHistoryCleanup`.
- **ORC-011 independent second formulation: not applicable.** No reviewer
  named a fault that production and the model could share for this case.
- **ORC-012 review evidence: met by this record.**
- **ORC-013 distinguishing witness: met, with one limit.** The law is
  conditional: an accepted snapshot retires, but an active request stays. The
  accepted-insert histories reach the first side. The active-insert history is
  the nearby witness for the second side. A wrong design that also removed the
  active row would differ from the model at the step after the delete. No
  mutant demonstrates that rejection.
- **ORC-014 controlled-premise handoff: not applicable.** The oracle uses no
  controlled provider or host. The source is the Collection's own sync API.

## Limits

An immediate delete that arrives while the insert is active leaves the
accepted row until the next source publication. That follows the existing
rule that a delete acknowledges no request. Immediate sync batches are
scheduled for removal in a separate change, so this record does not revisit
that rule.

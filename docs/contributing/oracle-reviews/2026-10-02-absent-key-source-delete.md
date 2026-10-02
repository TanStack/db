# Source delete for a key the source never held

Base revision: `06cab6fc7` (`main` after #2005).

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

## ORC outcomes

- ORC-002 independent judgment: the model applies its existing drain rule.
  Every ordinary source publication retires accepted snapshots, and a source
  delete acknowledges no request. It reads no production state.
- ORC-006 checker calibration: a hostile mutant rejects a sync delete for a
  key absent from the source projection. With the old grammar, the
  optimistic-history campaigns pass under it. Only the separate retained
  authoritative state property fails, without optimistic layers. With the new
  grammar, the fixed and random optimistic-history campaigns and all three
  pinned histories fail. A mutant that drops any delete for a key absent from
  `syncedData` is too broad to distinguish the change: the old grammar already
  kills it through queued deletes of held keys.
- ORC-007 fixed and random campaigns: both pass on this branch. The
  `@tanstack/db` suite passes 244 files and 8,269 tests.

## Limits

An immediate delete that arrives while the insert is active leaves the
accepted row until the next source publication. That follows the existing
rule that a delete acknowledges no request. Immediate sync batches are
scheduled for removal in a separate change, so this record does not revisit
that rule.

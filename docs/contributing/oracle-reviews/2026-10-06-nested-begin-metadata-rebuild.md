# Metadata rebuild after a nested transaction

Base revision: `65992aacd` (`main`). Found while triaging state mutation round 4.

## Law

Row metadata in one sync transaction follows last write wins, by the rules in
`collection-row-metadata-composition-oracle.test.ts`. The rules apply to the
write that applies. When the Collection reclassifies an insert, metadata
follows the new classification.

## The failure

A transaction begun inside an open transaction can commit first. The open
transaction then applies after it, and the Collection rebuilds the open
transaction against the new projection. The rebuild reclassifies each insert:
an insert of a present key with an equal value is a re-insert, and a re-insert
of an absent key is an insert.

```ts
sync.begin() // T1, row 1 is present
sync.metadata.row.set(1, { m: `w0` })
sync.write({ type: `insert`, value: { id: 1, v: 0 } }) // equal re-insert
sync.begin() // T2
sync.write({ type: `delete`, key: 1 })
sync.commit() // T2 applies first, so T1's insert is now an insert
sync.commit() // T1
sync.metadata.row.get(1) // main: { m: `w0` }; expected: undefined
```

The reverse direction also fails. From an absent row, T1 sets metadata and
inserts the row. T2 inserts the same row with metadata and commits first.
T1's insert becomes a re-insert, which keeps the set value. `main` reads
`undefined`.

**Cause.** `rebuildAutomaticRowMetadataWrites` skipped every key with an
explicit write. It kept the write that was current when T1 wrote, which no
longer follows from T1's operations.

**Repair.** Each explicit write records how many operations came before it.
The rebuild clears the key's writes, restores the last explicit write, and
replays the automatic write of each later operation. Hydrated metadata
records a position after every hydrated row, so it still holds.

## Why the oracles missed it

The round 3 record called RB2, a mutant that keeps stale automatic writes in
the rebuild, equivalent within legal histories. The follow-up record then said
that #2030 made it unreachable, because only the open last transaction can be
canceled. Both records missed nested transactions. The `invalidationError`
comment on `PendingSyncedTransaction` names the history: a later transaction
begun inside an open one commits first. The metadata oracle's rebuilt lane
changes the projection only through an earlier transaction, which cannot
reclassify an insert that is still open.

## Witness

A nested lane in the metadata composition oracle writes up to three of `set`,
`unset`, and an insert of one fixed row value, with or without metadata. Then
a nested transaction writes key 1 and commits first:

- From a present row, it deletes the row.
- From an absent row, it inserts the same row with its own metadata.

The model reclassifies the sequence by the row's presence after the nested
write, and folds it over the value that the nested write leaves. It reads no
production state. The lane runs 252 histories.

| Revision | Nested lane |
| --- | --- |
| `main` | 12 of 252 fail, in both directions |
| this fix | pass |
| explicit write always wins (M1) | fail; the rebuilt lane also fails |
| keep stale automatic writes (M2, RB2) | 3 fail, in the insert direction |
| explicit position recorded as 0 (M4) | fail; the rebuilt lane also fails |

A mutant that records hydrated metadata at position 0 fails `DbClient >
hydrates pending collection rows when the collection materializes`.

## Review outcomes

A medium code review found no correctness bug and seven items. A simplifier
pass found one item, the same as item 5.

1. `explicitRowMetadataWrites` was optional, though every constructor supplies
   it. Fixed: the field is required, and two test fixtures now supply it.
2. `metadata.row.set` still writes to a transaction that a replay has
   invalidated, while `write` ignores it. This predates the fix, and the commit
   discards the transaction. Open: it belongs with round 4's SY8 survivor,
   writes after invalidation, in the round 4 gaps change.
3. Hydration could carry metadata on its operations instead of a parallel
   map. Not adopted: an insert without metadata would then clear metadata
   that a source kept for an absent key, which changes hydration.
4. An ordered log of metadata writes would avoid positions. Not adopted: a
   transaction only appends operations, and a truncate clears both lists
   together.
5. Hydration and the new helper spelled out `PendingMetadataWrite`. Fixed.
6. The exported type was not formatted. Fixed.
7. The nested lane had no timeout, unlike the other lanes. Fixed.

## ORC outcomes

- **ORC-001: met.** The contract is the metadata oracle's opening prose. Its
  limits now state that the rules follow the reclassified write.
- **ORC-002: met.** `reclassify` derives each insert's kind from the row's
  presence. It does not call `classifyProjectedInsert`.
- **ORC-003: met.** The lane's grammar, model step, and driver step each have
  prose beside them.
- **ORC-004: met.** The lane is exhaustive within its bound. A count control
  checks 252 histories, and two named model witnesses cover both directions.
  Every insert writes one value, so no reclassified insert is a duplicate.
- **ORC-005: met.** The driver writes through a real Collection's sync API and
  reads `metadata.row.get`.
- **ORC-006: met.** See the table above.
- **ORC-007: not applicable.** The lane is exhaustive. It has no random
  campaign.
- **ORC-008: not applicable.** The model gains no state.
- **ORC-009: met.** "Nested transaction" means a sync transaction begun while
  an earlier one is open. It is the history that `invalidationError` names.
- **ORC-010: met.** The driver cleans up each Collection in a `finally`
  block.
- **ORC-011: not applicable.** No reviewer named a shared fault.
- **ORC-012: met by this record.**
- **ORC-013: met.** The two directions distinguish the repair from M1 and M2,
  which each pass one direction.
- **ORC-014: not applicable.**

## Limits

The lane covers one key, a nested delete or insert, and no truncate in the
open transaction. A nested truncate, or a nested write to another key, is not
generated. A nested insert with a different value makes the open transaction a
duplicate. The sync reentrancy oracle owns that invalidation.

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

A nested lane in the metadata composition oracle opens a transaction, T1. T1
writes up to three of `set`, `unset`, `truncate`, and an insert, update, or
delete of one fixed row value, each with or without metadata. Then a nested
write applies before T1 commits:

- From a present row, a nested transaction deletes the row.
- From an absent row, a nested transaction inserts the same row with its own
  metadata.
- From an absent row, a hydration seed inserts the same row with its own
  metadata. The Collection places a seed ahead of the first open transaction.

A nested transaction can also call `metadata.row.set` after its row write. A
history is legal when T1's writes are legal both where T1 writes them and
where they apply.

The model reclassifies T1's inserts by the row's presence where they apply,
and folds T1's writes over the value that the nested write leaves. It reads no
production state. The lane runs 1,925 histories: 275 for each of seven
variants.

| Revision                                              | Nested lane (of 1,925)                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `main`                                                | 35 fail: all three nested writes, with and without a nested set |
| this fix                                              | pass                                                            |
| explicit write always wins (M1)                       | 279 fail; the rebuilt lane also fails                           |
| keep stale automatic writes (M2, RB2)                 | 21 fail                                                         |
| explicit position recorded as 0 (M4)                  | 267 fail; the rebuilt lane also fails                           |
| hydrated metadata recorded at position 0              | 7 fail, all hydration seeds                                     |
| explicit write recorded in the first open transaction | 818 fail, all with a nested set                                 |
| truncate keeps explicit positions                     | 63 fail; the immediate, held, and rebuilt lanes also fail       |

The hydration mutant also fails `DbClient > hydrates pending collection rows
when the collection materializes`.

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

## Second review

A second medium code review, of #2048 at `9e34d6c94`, found no correctness
bug and seven items.

1. `metadata.row.set` writes to an invalidated transaction. The same as item
   2 above. Open, with round 4's SY8.
2. T1 never wrote an update, a delete, or a truncate. Fixed: the lane
   generates them where they are legal in both places.
3. No lane reached a hydration seed ahead of an open transaction. A probe
   showed that `main` reads `undefined` where last write wins expects the
   explicit set. Fixed: the seed is a nested write.
4. A nested transaction made no explicit metadata call, so a mutant that
   writes to the first open transaction survived. Fixed: the nested set.
5. The rebuild rescans every operation of every queued transaction. `main`
   has the same loop, and this change adds no rebuild. No change.
6. Hydration builds its explicit map in a second pass. A one-loop version
   added seven production lines to save one copy per chunk. Not adopted.
7. The fix adds production lines against the bug-fix budget. A position-only
   map still needs the explicit value, so no smaller design was found.

## ORC outcomes

- **ORC-001: met.** The contract is the metadata oracle's opening prose. Its
  limits now state that the rules follow the reclassified write.
- **ORC-002: met.** `reclassify` derives each insert's kind from the row's
  presence. It does not call `classifyProjectedInsert`.
- **ORC-003: met.** The lane's grammar, model step, and driver step each have
  prose beside them.
- **ORC-004: met.** The lane is exhaustive within its bound. A count control
  checks 1,925 histories, named witnesses cover each variant, and two
  exclusions check the legality rule. Every row write uses one value, so no
  reclassified insert is a duplicate.
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
- **ORC-013: met.** Each mutant in the table fails a distinct part of the
  lane. The hydration and first-open-transaction mutants fail only the seed
  and nested-set variants.
- **ORC-014: not applicable.**

## Limits

The lane covers one key. A nested truncate, a nested update, or a nested
write to another key is not generated. A nested insert with a different value
makes the open transaction a duplicate. The sync reentrancy oracle owns that
invalidation.

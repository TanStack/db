# Partial-update history after an aborted source batch

Reviewed revision: the commit that adds this record on
`fix-partial-update-retention`, based on `main` `f6aba314e`.

## Finding

The partial-update campaign of
`packages/db/tests/collection-state-retention-oracle.property.test.ts`
(`collection-state.optimistic-history-partial`) failed on `main` for the
random seed `-526998278`. It failed the same way on `fe284ccbd`. Shrunk
history:

1. The source row is `{ id: 1, a: 0, b: 0, c: 0 }`.
2. An open sync batch deletes row 1, and then aborts before acceptance.
3. A partial sync update writes row 1 with `c: -1`. The partial lane omits
   `c`.

The Collection published `c: -1`. The model allowed only `c: 0`.

## Which account failed

The driver failed. Production and the model were correct.

- The law: in the default `partial` row update mode, an update that omits a
  field merges into the source row, so the held value of that field remains.
  The authority is the oracle's opening prose and the Collection's
  `rowUpdateMode: 'partial'` contract.
- The driver records the source's own rows (`sourceRows`) so that it can
  write a partial update with `c` omitted. On an aborted open batch, it
  restored `sourceKeys` but not `sourceRows`. Row 1 was therefore missing from
  `sourceRows`, and the driver wrote the next update as a whole row with
  `c: -1`.
- Production merged the whole row that it received. That is correct for the
  write the driver sent. The model predicted the write that the history
  described. The mismatch was in the driver's translation of the history.

## Repair

- An open batch keeps `rowsBefore` with `keysBefore`, and an abort restores
  both.
- The driver throws `Partial update of unknown source row` if a partial update
  finds no held source row. A future drift between `sourceKeys` and
  `sourceRows` then fails as a driver error, not as a product mismatch.
- A pinned case, `merges a partial update after an aborted source delete`,
  replays the shrunk history. It asserts that the open batch aborted and that
  the partial update was a distinguishing one.

## Evidence

| Check | Original driver | Fixed driver |
| --- | --- | --- |
| Pinned case | Fails: `c: -1` published, `c: 0` allowed | Passes |
| Seed `-526998278` replay | Fails | Passes |
| Fixed and random partial campaigns | Pass (the fixed seed never reached this history) | Pass |

A mutant that keeps `rowsBefore` but does not restore it fails the pinned
case and one of the two partial campaigns with the new driver error.

No production code changed, so this change has no changeset.

## ORC outcomes

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. |
| ORC-002 | Applicable. The model is unchanged and does not read production. |
| ORC-003 | Applicable. The pinned case has a comment that states the law and the history. |
| ORC-004 | Applicable. The open/abort and partial dimensions already existed. The fixed seed did not combine an aborted delete with a later partial update, so the pinned case supplies that history. |
| ORC-005 | Applicable. The driver now sends the write that the history describes. The new invariant rejects an inconsistent driver state. |
| ORC-006 | Applicable. The original driver and the no-restore mutant both fail at the intended checkpoint. |
| ORC-007 | Applicable. The fixed and random campaigns are unchanged. The direct replay of the reported seed and path passes. |
| ORC-008 | Applicable. The driver's source state now has one consistent restore point for keys and rows. |
| ORC-009 | Not applicable. No model term changed. |
| ORC-010 | Not applicable. No cleanup or shrinking change. |
| ORC-011 | Not applicable. No shared-fault hypothesis. |
| ORC-012 | Applicable. This record. |
| ORC-013 | Not applicable. No threshold law. |
| ORC-014 | Not applicable. No controlled provider. |

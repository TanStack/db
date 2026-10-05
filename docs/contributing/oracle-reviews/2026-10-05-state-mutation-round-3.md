# State stack mutation round 3

Base revision: `987f6ca0d` (`main` after #2004 and #2008). The `@tanstack/db`
source was unchanged at the branch base.

## Method

Round 3 applied 47 plausible maintenance mistakes to the ported state stack:
35 in `state.ts` and 12 in `sync.ts`, `lifecycle.ts`, and `mutations.ts`.
Each mutant ran against the full `@tanstack/db` suite with `--bail=1`. Of the
47, 35 failed the suite and 12 survived. Each survivor received a probe that
passes on `main`, a code argument, or full-suite instrumentation that counts
the cases where the mutant changes a decision.

## Survivors

| Mutant | Change | Verdict |
| --- | --- | --- |
| S13 | Default `rowUpdateMode` becomes `full` | Gap. Closed here. |
| A1 | A sync delete that carries metadata keeps it | Gap. Closed here. |
| A3 | An insert without metadata no longer clears metadata | Gap. Closed here. |
| S6 | `markReady` runs before the truncate reapply | Gap. Closed with a fix in #2033. |
| S4 | The shared clear skips the pending direct-upsert marker | Equivalent. The later retirement loop removes every confirmed key. |
| L3 | The commit skips `restoreOrder` | Equivalent. `SortedMap` restores order on the next ordered read or write. |
| L4 | `reappliedKeys` starts as an empty set | Equivalent. An empty set skips no key. |
| X4 | A completed load-subset operation stays active | Equivalent. Every reader ignores or tolerates a completed operation. |
| M1 | Previous row origins omit direct keys | Equivalent on reached histories. Instrumentation found no differing virtual props. |
| M2 | The commit copies the pre-sync visible state | Equivalent by argument. The commit clears that state afterward. |
| S10 | Previous virtual props ignore completed optimistic keys | Equivalent on reached histories. See below. |
| S3 | The commit keeps a cached enriched row | Open. See below. |

A fifth mutant, RB1, came from this review. It makes
`rebuildAutomaticRowMetadataWrites` overwrite explicit metadata writes. It
survived the suite and the metadata publication oracle.

## Gaps closed here

**Partial row updates.** The optimistic-history and retention oracles always
set `rowUpdateMode: 'full'`. No test sent a partial update in the default mode.
A separate partial lane now keeps the default mode. It reuses the generated
optimistic histories and marks source batches partial from its own stream, so
the full-mode campaign's fixed seed 86103 still produces `main`'s histories. A
partial batch omits `c` from its updates, and the model merges such an update
into its base row. The lane runs its own fixed (86104) and random campaigns.
Its fixed campaign must write at least one partial update whose omitted `c`
differs from the source's held row. Two fixed histories merge a partial update
while an accepted delete and an accepted schema-default re-insert overlay the
row. An in-suite wrong-answer witness writes the same rows in `full` mode and
must be rejected. S13 and MS, a mutant that merges onto the visible row
instead of the synced row, both fail the partial campaigns and those
histories.

**Row metadata composition.** No test wrote a row delete that carried metadata,
or an explicit set followed by an insert without metadata. The new
`collection-row-metadata-composition-oracle.test.ts` enumerates all 1,457
legal one-key histories of up to three writes, including `truncate` and an
idempotent re-insert, from three starting states. A last-write-wins model predicts the final metadata. Three
lanes reach the immediate, held, and rebuilt production paths. The rebuilt lane
also varies the earlier held transaction over a key-2 update and every key-1
row write, for 1,767 histories. A1 and A3 fail all three lanes. RB1 fails only
the rebuilt lane. RI1, a mutant that computes metadata from a re-insert's
original type, fails all three lanes. TR1, a mutant that keeps a
transaction's earlier metadata writes through a truncate, passes the rest of
the suite and fails all three lanes.

**Maintainer decision.** The written contract covered only writes that carry
metadata. On 2026-10-05 the maintainer adopted the current behavior as the
contract for the rest: an insert without metadata clears the value, an update
without metadata keeps it, a row delete or a truncate clears it, and
`metadata.row.set` after a delete or a truncate keeps metadata for the absent
row. A second decision the same day made an insert equal to the held row an
idempotent re-insert: without metadata it keeps the value.

## Gap closed by a separate fix

The ready-callback witness in `collection-sync-reentrancy-oracle.test.ts`
covered only an edit of a replaced key, through a subscriber with initial
state. Its sent-key filter hides a duplicate message. #2033 replaces it with a
model-based grid and publishes ready-callback messages after the truncate
batch. Its own record covers the evidence.

## Review of this record

A code review of the first version found six items:

1. The insert-clears and update-keeps rules came only from production's helper.
   Fixed: the maintainer decision above is now the authority.
2. Metadata kept for an absent row was pinned without a source. Fixed: the
   same decision covers it.
3. The grammar had no `truncate`. Fixed: the grammar includes it, and TR1
   shows the gap.
4. The partial lane never ran with the schema default on `c`. Fixed: four
   schema histories run it.
5. The reach counter counted writes, not writes that distinguish the modes.
   Fixed: it counts only partial updates whose omitted `c` differs from the
   held row.
6. The record said that the counter fails under S13. The counter is computed
   by the driver and cannot fail under a production mutant. Fixed: the claim
   is removed.

## Second review of this record

A high-effort review found nine more items:

1. An insert equal to the held row keeps metadata, against the insert rule.
   Fixed: the maintainer made it an idempotent re-insert, and the grammar
   covers it.
2. The rebuilt lane's earlier transaction never touched key 1. Fixed: the lane
   varies the earlier write. A mutant that keeps stale automatic writes (RB2)
   still passes. In legal histories an open write keeps its type through the
   rebuild, so RB2 is equivalent there. A canceled earlier transaction would
   reach it, and this grammar does not generate one.
3. The schema-default histories could not distinguish a merge onto the
   snapshot. Fixed: the new histories retain a default-carrying snapshot when
   the partial update arrives, and MS fails them.
4. The partial field changed every history of the full-mode fixed seed.
   Fixed: the partial lane has its own campaigns.
5. The partial lane had no in-suite wrong-answer witness. Fixed: the
   `partial-as-full` witness.
6. The `sourceRows` comment was wrong. Fixed.
7. The `partialUpdates` counter was unused. Removed.
8. One `it` ran all lifecycles under the default timeout. Fixed: each lane has
   a timeout.
9. The immediate lane did not assert its path, and a throw lost its label.
   Fixed.

CodeRabbit then found that the `partial-as-full` witness was vacuous. The
driver's "observation mutant reached its checkpoint" assertion always failed
for it, and the witness accepted any assertion error, so it passed even with
the `full` override removed. The configuration mutant is now exempt from that
assertion, and the witness requires a row observation to reject it. With the
override removed, the witness fails.

## Open items

The follow-up record
[`2026-10-05-round-3-followups.md`](2026-10-05-round-3-followups.md) resolves
the items this record left open. S3 and S10 were equivalent, and their code is
removed. RB2 was not equivalent: a canceled earlier transaction reaches it,
and the canceled lane found a metadata bug on `main` that the follow-up fixes.

## ORC outcomes

This record repairs two grammars and adds one oracle, so ORC-012 applies.

- **ORC-001: met.** Each oracle names its contract. The metadata contract is
  the last-write-wins test in `collection.test.ts` plus the 2026-10-05
  maintainer decision for writes without metadata. The partial-update contract
  is the default `rowUpdateMode`.
- **ORC-002: met.** The optimistic-history model merges partial updates in its
  own base map. The metadata model folds writes over one value by the decided
  rules. Neither reads production state or imports its helper.
- **ORC-003: met.** The new oracle's opening prose states the law and limits.
  Prose beside the model, grammar, and driver explains each one. The
  optimistic-history prose now describes the partial-update lane.
- **ORC-004: met.** The metadata grammar is exhaustive within its bound. A
  control checks the count, named witnesses, and two excluded illegal
  histories. The partial-update counter shows that the partial campaign writes
  partial updates whose omitted `c` differs from the held row. The rebuilt
  lane's count control checks the earlier-write dimension.
- **ORC-005: met.** Both oracles write through a real Collection's sync API and
  read public rows, change messages, and `metadata.row.get`.
- **ORC-006: met.** S13, MS, A1, A3, RB1, TR1, and RI1 each fail the extended
  oracles. The `partial-as-full` witness checks in the suite that the
  partial lane rejects a replacement. RB2 is equivalent within legal
  histories. The metadata oracle also checks three named wrong
  answers against its model.
- **ORC-007: met for the generated property.** The partial lane runs a fixed
  seed (86104) and a random campaign under
  `collection-state.optimistic-history-partial`, which accepts a seed and path
  for replay. The full-mode campaigns keep seed 86103 and `main`'s histories. The metadata
  oracle enumerates its whole bounded domain, so it has no random campaign.
- **ORC-008: met.** The optimistic-history model gains one flag. Two histories
  that differ only in that flag can produce different base rows after a
  partial update, so the flag is needed.
- **ORC-009: met.** "Partial update" and "row update mode" match the
  production option names.
- **ORC-010: not applicable.** No shrinking or cleanup path changed. The new
  oracle cleans up each Collection in a `finally` block.
- **ORC-011: not applicable.** No reviewer named a fault shared by production
  and either model.
- **ORC-012: met by this record.**
- **ORC-013: met.** The metadata grammar includes neighbors on both sides of
  each rule: an update with and without metadata, and an insert before and
  after an explicit set.
- **ORC-014: not applicable.** No controlled provider or host supplies a
  premise.

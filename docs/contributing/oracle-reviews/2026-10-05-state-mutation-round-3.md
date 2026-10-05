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
Half the generated optimistic histories now keep the default mode, and a source
batch may omit `c` from its updates. The model merges such an update into its
base row. The fixed campaign must write at least one partial update whose
omitted `c` differs from the source's held row, so only a merge keeps it. Four
fixed histories also run the partial lane with the schema default on `c`. Under
S13, the fixed and random campaigns and the four schema histories fail.

**Row metadata composition.** No test wrote a row delete that carried metadata,
or an explicit set followed by an insert without metadata. The new
`collection-row-metadata-composition-oracle.test.ts` enumerates all 825 legal
one-key histories of up to three writes, including `truncate`, from three
starting states. A last-write-wins model predicts the final metadata. Three
lanes reach the immediate, held, and rebuilt production paths. A1 and A3 fail
all three lanes. RB1 fails only the rebuilt lane. TR1, a mutant that keeps a
transaction's earlier metadata writes through a truncate, passes the rest of
the suite and fails all three lanes.

**Maintainer decision.** The written contract covered only writes that carry
metadata. On 2026-10-05 the maintainer adopted the current behavior as the
contract for the rest: an insert without metadata clears the value, an update
without metadata keeps it, a row delete or a truncate clears it, and
`metadata.row.set` after a delete or a truncate keeps metadata for the absent
row.

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

## Open items

- **S10.** Instrumentation found 191 commits in the metadata publication oracle
  where the mutant changes `virtualChanged` from true to false for a
  virtual-only update. The oracle checks exact batches and still passes, so a
  later publication carries the same `$synced` change. The full suite also
  passes without `completedOptimisticKeys`. That set may be removable, but no
  argument yet covers every history.
- **S3.** Without any mutant, `main` returns a cached enriched row whose fields
  differ from the stored row 422 times across the suite, mostly in live-query
  oracles. This review did not determine whether a public read observes those
  values. The case needs a probe owner before a verdict.

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
  histories. The partial-update counter shows that the generator writes
  partial updates whose omitted `c` differs from the held row.
- **ORC-005: met.** Both oracles write through a real Collection's sync API and
  read public rows, change messages, and `metadata.row.get`.
- **ORC-006: met.** S13, A1, A3, RB1, and TR1 each fail the extended oracles
  and pass the suite without them. The metadata oracle also checks three named wrong
  answers against its model.
- **ORC-007: met for the generated property.** The optimistic-history fixed
  seed 86103 and its random campaign both run the partial lane. The metadata
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

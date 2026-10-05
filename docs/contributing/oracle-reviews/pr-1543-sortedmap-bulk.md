# Bulk SortedMap ordering review

Reviewed product head: `c87f3e0b8fa46f90f8023f09e09a24fb67764e7f` (the
SortedMap change merged with `origin/main` at `bef12e24227aa993cea03c7b1cdeeda233cce739`).
Source: external PR #1543 and its CodeRabbit review. A nine-item source ledger
was maintained during evaluation; this record keeps the verdict-critical
oracle evidence in the repository.

## Contract and scope

`SortedMap` keeps native Map key ownership and exposes keys, values, entries,
and `forEach` in key order or comparator order with key tie-breaking. This is
the established contract in `packages/db/tests/SortedMap.test.ts`. Collection
sync transactions that publish together expose the same final order at their
publication boundary. A bulk publication with at least 512 operations may
defer ordered-key maintenance until all its writes have applied. Point reads
remain current while order is deferred; the ordered view is restored before
publication. Smaller publications retain incremental ordering.

The work claim is bounded to one bulk publication. It does not promise fast
repeated one-row commits or a general comparator-mutation policy. Runtime keys
outside `string | number` retain the old binary-insert path because
`compareKeys` is not a total order for nullish keys.

## RED, GREEN, and cost evidence

- On main before the fix, 2,048 descending direct inserts displaced 2,096,128
  ordered-array slots; the oracle bound was 131,072. The same direct law is
  green with deferred insertion.
- A hostile mutant that ignores deferred ordering fails the public Collection
  work assertions at the intended commit/drain checkpoint: 4,096 inserts move
  8,386,560 slots against a bound of 262,144; sixteen queued 64-row sync
  transactions move 523,776 slots against a bound of 65,536. The candidate
  passes both laws. The queued transactions are held behind a persisting
  optimistic mutation, then applied in one drain.
- The Map/full-sort oracle checks key ownership, exact order and ties, point
  reads, all iterators, and `forEach` after fixed and generated histories.
  Generated actions now vary deferred writes, immediate writes, clear, and
  observation checkpoints under the same fixed and random campaigns. Fixed
  tree-sized histories cover 256 keys and comparator reorders. Public tests
  check comparator-order publication, a pending iterator, and 64 incremental
  updates in a 10,000-row Collection. Direct controls cover mutable comparator
  fields before the batch checkpoint and runtime nullish/numeric keys.
- In independent 40,000-key random-insert probes, main took 77.6–85.1 ms and
  deferred sorting took 11.7–12.6 ms. Twenty full scans took 7.8 ms on main
  and 7.7–8.2 ms on the candidate. Five thousand alternating write/full-scan
  loops took 265–308 ms versus 255–278 ms. Retained heap after GC was about
  1.84 MiB in both cases. These measurements do not reproduce PR #1543's
  one-million-key figures or certify other hardware.
- For a 100,000-row retained map with 1,024 descending front inserts, eager
  updates took 15.3–15.5 ms and deferred sorting 2.1–4.2 ms in the same
  harness. With only 256 front inserts and a comparator, eager updates were
  faster (3.9 versus 7.3 ms). The fixed 512-operation cutoff avoids sorting
  the whole retained map for that smaller publication.

## Oracle guide audit

| Requirement | Outcome at reviewed product head |
| --- | --- |
| ORC-001 | The established Map/order law and bulk-publication work boundary are stated above. Post-publication object mutation and repeated small commits are outside the claim. |
| ORC-002 | Expected order is a fresh sort of an independent native Map. Displaced-slot work is counted at `Array.splice`, independently of elapsed time. |
| ORC-003 | `SortedMap.test.ts` states the contract, uses Map/full-sort as model, generates action histories, drives real SortedMap and Collection sync APIs, and compares public observations after actions or publication. |
| ORC-004 | Fixed examples reconstruct deferred set/delete, immediate set, clear, and observations. The generated grammar varies action, key/value, deferral, and observation. Removing deferral loses the new path; removing checkpoints loses intermediate observations. Keys/values are bounded to -3..3, histories to 40 actions; runtime nullish keys and 256-key histories have separate fixed controls. Invalid comparator inputs and arbitrary mutation timing are excluded. |
| ORC-005 | Direct SortedMap methods are observed after each eager or chosen deferred checkpoint and at history end. Public Collection `keys()` is observed at commit and subscription publication; the queued work counter spans the drain after the held mutation settles. |
| ORC-006 | Disabling Collection deferral is rejected by both public work assertions, with exact values above. The existing wrong-order, dropped-tie, and stale-overwrite controls reject those answer classes. The mutant produced assertion failures, not setup failures or timeouts. |
| ORC-007 | The existing `sorted-map.key`, `sorted-map.ascending`, and `sorted-map.descending` owners run identical fixed-seed and unseeded properties and retain the registry's seed/path replay interface. The new actions use those same campaigns. |
| ORC-008 | No reference-model state was added. Native Map remains the whole model state. |
| ORC-009 | `deferOrder` is an implementation choice inside a sync publication; the model's `observe` action is a model-only checkpoint. Collection, sync transaction, publication, and row retain glossary meanings. |
| ORC-010 | The generated property uses the existing fast-check replay path. Public queued receipts get rejection handlers when created; cleanup releases the held mutation, settles receipts, and cleans the Collection. |
| ORC-011 | No plausible semantic fault shared by native Map/full-sort and production insertion was named. Public Collection publication is a second production boundary, not a second semantic model. |
| ORC-012 | This record provides each applicable outcome and limits the repair claim to the declared contract, history, path, and observation. |

## Remaining review items

CodeRabbit correctly identified that using live mutable values as BTree keys
would invalidate that PR's tree ordering. Its proposed generic snapshot did
not establish a safe identity-preserving comparator token, and the author
reported ORDER BY regressions from an attempted snapshot. The new fix keeps the
array and does not decide whether comparator-observed fields may change after
publication. The SortedMap and collection-state-retention oracle owners must
receive that law when the product contract is decided. Exact one-million-row
timings and the discarded snapshot candidate remain evidence gaps in the
external PR, not claims of this repair. The original review did not assess
scan, memory, or runtime-key effects; this record covers them.

Loss audit: nine raw items = one fixed now (quadratic bulk work), one refuted
(broad compatibility of the BTree proposal), one already fixed (ordinary
reorder/tie coverage), four deferred (BTree design, original benchmark,
discarded snapshot, release-impact checklist), one design decision
(post-publication comparator mutation), and one duplicate walkthrough. No
source claim is omitted.

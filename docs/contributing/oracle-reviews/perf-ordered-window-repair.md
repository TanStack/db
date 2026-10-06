# Eager indexed ordered-window repair oracle review

Reviewed source head: `ff731ad1c` on `perf-ordered-loader`, with the perf fix
in `44c90e0ad` and the null-ordering fix in `ff731ad1c`. The base is
`65992aacd` (`main` with #1650).

## Contract and evidence

An ordered, limited live query over an eager source with an index on its
leading order term must show the first `limit` rows after `offset` of the
eligible source rows after every change. The authority is
`packages/db/src/query/live/ARCHITECTURE.md`, "Ordered requests, continuation,
and recovery" and "Atomic window publication", and the documented order in
`docs/guides/live-queries.md`: nulls first by default, NaN greater than every
non-null value, ties by key.

Work is a separate law. With an index, the source delivers at most
`2 * (offset + limit) + tied rows + 1` rows per change. That is one reacquired
prefix of the window, the tie group at its boundary, one refill of at most the
window, and the changed row. The bound does not grow with source size. Each
generated source holds 200 eligible filler rows outside every window, so a
read that resends every matching row exceeds it. A NaN or null boundary cannot
be expressed as a cursor (`canExpressCursorOrder`), so the documented
full-source fallback applies and only the rows law is checked while such a
rank is present. An unindexed source also falls back to full source.

The owner is the "eager indexed ordered windows" section of
`packages/db/tests/query/ordered-work-oracle.property.test.ts`. Its model is a
plain array sorted by the documented order. It shares no code with the loader,
the comparator, or the index.

### Original failure

On `65992aacd`, a visible delete or an eligibility change delivered 202 to 206
rows against a bound of 5 to 8: "rows delivered by step 1: expected 202 to be
less than or equal to 5". The ordered-prefix repair's local read was
predicate-only, so it resent every matching row. In the rindle "list: newest
50 open" case this cost 1.107 ms per insert/delete pair at 10,000 issues.

### Repair

- `requestSnapshot` reads only the first `limit` matching local rows when the
  subscription has an order index, the request has `orderBy` and `limit`, and
  the source is eager. An on-demand source keeps the full delivery that its
  repair chain relies on.
- An eager source's repair may settle synchronously, so its tie and refill
  steps finish inside one graph run. Without this, widening a window after a
  repair published twice: once after the tie request and again after the
  refill. That broke two pagination-oracle laws ("keeps a NaN window coherent
  through equal and changed source ranks" and "rebuilds the full boundary when
  widening after an out-of-window rank update").

### Alternative (b), considered and rejected

Moving the bounded read into `loadOrderedPrefixRepair` through
`requestLimitedSnapshot` gave 2.28 ms per pair, slower than `main`. The
profile showed `ascComparator` at 27%, `getPairOrNextLower` at 25%, and the
BTree index's take loop at 18.5% self time. The cause is semantic, not per-call
setup: `requestLimitedSnapshot` skips keys already sent to the query, so after
a repair it walks past the whole visible window, one tree descent per step,
and loads the next `limit` rows instead of resending the prefix. That also
grows the query's private state on every change.

### Null ordering

`findIndexForField` served a descending, nulls-first query with an ascending,
nulls-first index wrapped in `ReverseIndex`. Reversing the index moved its null
group to the end. On `44c90e0ad` the pinned case failed with "expected [ 1000 ]
to deeply equal [ +0 ]", and both campaigns failed. `ReverseIndex` now takes the
requested null placement and reads the null group from that end.

## Mutant results

| Mutant | Outcome |
| --- | --- |
| Original predicate-only repair read (`65992aacd`) | Assertion failure, work law: 202 > 5. |
| Ordered read without its limit (M3) | Assertion failure, work law: 202 > 5. |
| Bounded read for on-demand sources too (M4) | Assertion failure in 2 pagination-oracle cases. |
| Never repair after a visible change (M5) | Assertion failure, rows law: `expected [ 2 ] to deeply equal [ 1 ]`. |
| Read `limit + 1` rows | Assertion failure, work law: 4 > 3. |
| Read `limit - 1` rows (M1) | Survives. Equivalent at the public observation, see below. |
| Read in the reversed direction (M2) | Survives. Equivalent at the public observation, see below. |
| Eager repair stays asynchronous | Assertion failure in the same 2 pagination-oracle cases (split publication). |
| `ReverseIndex` ignores the requested null placement | Assertion failure in 3 of 4 tests, rows law. |

M1 and M2 deliver no more rows than the bound allows, and the refill and
tie-boundary chain still reaches the correct window. A tighter work bound
cannot reject them, because they deliver the same number of rows or fewer.
The extra refill request they cause is an internal request count, not a public
observation of this law. Both are equivalent within the tested domain.

## Benchmark

`scripts/bench/incremental-update.ts` gains a "list: newest 50 open" case with
a visible issue delete. With an index at 10,000 issues, its median per-write
latency is 0.63–0.70 ms on `main` and 0.17–0.18 ms with the fix. Without an
index it stays near 4 ms, because the full-source path is unchanged. Overall
geomean is 0.95–0.96× against `main`, with a same-code noise run of 1.00×.

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The rows and work laws and their authority are above. The claim covers eager sources only. On-demand providers keep their own work laws in this owner. |
| ORC-002 | Applicable. The model sorts plain rows by the documented order with its own comparator. It does not import the loader, the index, or `makeComparator`. |
| ORC-003 | Applicable. The section's opening prose states both laws, the bound's derivation, the grammar, the production path, the checkpoint and the limits. |
| ORC-004 | Applicable. The grammar crosses sync and local-only writes, index present or absent, both directions, one or two order terms, limit 1–3, offset 0–1, and upserts and deletes over ids 0–29 with ranks 0–15, NaN and null. The pinned delete case and the pinned null case reconstruct the reported traces. The work law skips only steps whose boundary value is NaN or null; it asserts on 88.5% of indexed single-term steps. The reversed-index oracle covers `nulls: 'last'`. Excluded: on-demand sources and custom collation. |
| ORC-005 | Applicable. The driver runs a real live-query Collection over a real eager Collection. It counts rows a snapshot returns from `currentStateAsChanges`, rows the source delivers to the query's subscription (which include index refills), and rows `entries()` yields. |
| ORC-006 | Applicable. The original code and the mutants above reach the checkpoint. Each outcome is classified. |
| ORC-007 | Applicable. Each campaign runs with fixed seed 2044 and with a random or replay seed through `oracleRandomParameters`, property `ordered-work.eager-indexed-window`. |
| ORC-008 | Applicable. The model keeps only the current rows. Order is derived from them. |
| ORC-009 | Applicable. "Read rows", "delivered rows" and "scanned rows" are work observations, not production states. |
| ORC-010 | Applicable, with a gap. Cleanup runs in a `finally` block, so a cleanup error after an assertion failure would replace it. No run showed a cleanup failure. |
| ORC-011 | Inapplicable. No reviewer named a fault shared by the model and production. |
| ORC-012 | This record. |
| ORC-013 | Applicable. The work bound is a threshold law. The `limit + 1` mutant exceeds it by one row (4 > 3). |
| ORC-014 | Inapplicable. No controlled provider supplies a premise. |

## Unresolved

- Per-change work for on-demand sources is not bounded by this owner.
- A reversed read gathers the whole nullish group on each read: it builds a
  set of the nullish keys, sorts them, and calls the filter once on each. So a
  read costs O(m log m) in the nullish group size m, even when it returns no
  nullish key. The work law bounds filter calls on non-null keys by `n` and
  allows one filter call per nullish key. Large nullish groups are rare in
  ordered windows, so the reader keeps this cost for simpler code. The
  bounded nullish read of `d2bb4c3f0` was replaced by this simpler reader in
  the follow-up commit; a later index-API change that removed per-read group
  sorts was reverted (`e0ab7e0f5`). Reads of equal non-null values still sort
  each group, as on `main`.
- An initial full-source ordered load over an eager source stays asynchronous,
  as on `main`. #1896 states a general rule for synchronous results, so this
  is a likely gap; it is the next change, not this one.

## Review follow-up (2026-10-06)

A code review of this branch found eight issues. The probes, the RED output
and the mutant runs are in the PR evidence; this section records the outcomes.

| Finding | Outcome |
| --- | --- |
| R1: a reversed index sorted and filtered every nullish key on each read | Fixed. The new reversed-index oracle (`reverse-index-oracle.property.test.ts`) bounds filter calls by the position of the n-th accepted key. RED on the branch: 5,000 filter calls for n = 50 among 5,000 nullish keys. A follow-up simplified the reader: each read now gathers the nullish group, and the law allows one filter call per nullish key while still bounding non-null filter calls by `n` (see Unresolved). A follow-up (`afe19e442`) also removed the per-read sort of an equal-value group, through a new index API and write-path upkeep. It was reverted in `e0ab7e0f5`: that sort is old behavior on `main` and not part of this regression, so the change did not earn its code weight. See Unresolved. |
| R2: a second order term took the bounded read into a full in-memory sort | Fixed. The bounded read applies only to one order term. The eager-window oracle gains a second order term and a scan law (one pass per change). RED: 400 rows scanned against a bound of 201. Removing the gate fails it. |
| R3: ARCHITECTURE.md contradicted the synchronous repair | Fixed. Both passages now name the eager ordered-prefix exception. |
| R4: the synchronous gate also matched full-source requests | Fixed by narrowing the gate. A lifecycle witness checks that an eager `fn.where` ordered window is `loading` at creation; it fails on the widened gate and passes on `main`. |
| R5: index refills were not counted | Fixed. The oracle also counts rows delivered to the subscription and bounds the initial load. The unbounded-refill mutant now fails (200 > 3); before, the refill ran only during the initial load, which the law did not bound. |
| R6: the work law skipped every history with a NaN or null rank | Fixed. It skips only an inexpressible boundary and counts tie groups at the boundary, over a larger domain. A mutant that resends about 20 domain rows fails (23 > 3). |
| R7: the reader returns two tie-key orders | Documented, not changed. The query breaks ties by ascending key, so the reviewer's fix would put nullish keys in the wrong order. The reversed-index oracle states the reader's order. |
| R8: `sourceHoldsAllRows` was optional and always set | Fixed. It is required. |
| R10: a `null` cursor in a nulls-first reversed read | Refuted. A cursor at `null` is past the nullish group, so the non-null keys are the correct result. The order law passed on the original code at 20× runs. |

After these fixes, the original predicate-only read, `limit + 1`, the
resend-domain mutant and the unbounded refill all fail. `limit - 1` (M1)
still survives, as above.

## Second review follow-up (2026-10-06)

A high-effort code review of `308bb12b9` raised nine findings. Each was
checked with a probe on this branch and on `main`, or with a mutant.

| Finding | Outcome |
| --- | --- |
| 1: a synchronous prefix repair holds no publication gate, so a later asynchronous step could publish a partial window | Refuted for both named paths. A repair whose boundary enters a NaN tie group falls back to a full-source read (204 rows delivered) and publishes `[61,62]` once, as on `main`. A blocked LEFT-joined filter publishes nothing while blocked and `[2,3]` once after release, as on `main`. The eager-window oracle now asserts one publication per change whose window equals the model, and pins the NaN tie-group repair. A mutant with `main`'s asynchronous gate also passes this law: single-change histories publish once under both designs, and the pagination laws own window moves. |
| 2: `ReverseIndex` requires `nullsFirst` | Low. `ReverseIndex` is a read-time wrapper that `findIndexForField` builds; no caller outside this package constructs it. The parameter now defaults to `false`. |
| 3: a bounded read skips stale rows kept after a failed truncate replay | Refuted. An eager collection never calls `loadSubset`, so it has no replay demand to fail (the probe recorded no calls). Source cleanup puts every dependent live query in its terminal error, on this branch and on `main`. |
| 4: two-term and unindexed eager repairs settled synchronously | Fixed. The loader oracle pins that an eager prefix repair settles synchronously only for a bounded read. RED on `308bb12b9`: the two-term and unindexed cases settled before `loadMore` returned. The gate now uses the same bounded-read fact as the subscription; the old gate fails 2 cases. |
| 5: the source-holds-all-rows rule was coded twice | Fixed. The loader computes the bounded-read fact once and passes it to `requestSnapshot`, which no longer checks the sync mode, the index or the term count. A subscription that ignores the flag reads 206 rows where the bound is 5. |
| 6: the bounded read repeats index discovery and could fall back to a full sort | Partly confirmed. Index discovery per repair costs one scan of the collection's index list and is kept. A silent fall back to a full sort was not caught: the scan law allowed one pass. A bounded step must now scan no more rows than its work bound; a mutant that disables the index read in `getOrderedKeys` fails (406 > 204). |
| 7: each reversed read gathers the nullish group | Accepted design (see Unresolved). |
| 8: two tie-key orders cut through a NaN tie group | Duplicate of R7. A NaN boundary cannot be a cursor, so the loader reads the full source whatever the tie order, and the window publishes once with the right rows. |
| 9: `sourceHoldsAllRows` defaulted to true for an unknown source | Fixed. It reads the resolved source collection, which is never undefined there. |

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
| ORC-004 | Applicable. The grammar crosses sync and local-only writes, index present or absent, both directions, limit 1–3, offset 0–1, and upserts and deletes over ids 0–9 with ranks 0–3, NaN and null. The pinned delete case and the pinned null case reconstruct the reported traces. Excluded: on-demand sources, custom collation, and a reversed index serving `nulls: 'last'`, which this grammar never requests. |
| ORC-005 | Applicable. The driver runs a real live-query Collection over a real eager Collection and counts rows at the Collection's `currentStateAsChanges` boundary, which every snapshot read uses. |
| ORC-006 | Applicable. The original code and the mutants above reach the checkpoint. Each outcome is classified. |
| ORC-007 | Applicable. Each campaign runs with fixed seed 2044 and with a random or replay seed through `oracleRandomParameters`, property `ordered-work.eager-indexed-window`. |
| ORC-008 | Applicable. The model keeps only the current rows. Order is derived from them. |
| ORC-009 | Applicable. "Delivered rows" means rows returned by `currentStateAsChanges` during one change. It is a work observation, not a production state. |
| ORC-010 | Applicable, with a gap. Cleanup runs in a `finally` block, so a cleanup error after an assertion failure would replace it. No run showed a cleanup failure. |
| ORC-011 | Inapplicable. No reviewer named a fault shared by the model and production. |
| ORC-012 | This record. |
| ORC-013 | Applicable. The work bound is a threshold law. Measured over a 5× campaign, the fix's maximum delivery equals the bound exactly, and the `limit + 1` mutant exceeds it by one row. |
| ORC-014 | Inapplicable. No controlled provider supplies a premise. |

## Unresolved

- A reversed index serving a `nulls: 'last'` query is not generated.
- Per-change work for on-demand sources is not bounded by this owner.

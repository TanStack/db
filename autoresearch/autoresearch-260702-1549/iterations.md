# Iteration log

## Iteration 1 — hot-path micro-optimizations · KEEP ✅

**Hypothesis:** Per-row defensive copies, linear-scan `in` evaluation, and
loop-invariant work inside hot loops dominate live-query hydrate cost.

**Changes:**
- `collection/state.ts` — `enrichWithVirtualPropsSnapshot`: return the row
  as-is when it already carries all four virtual props (live query results
  always do) instead of spreading a copy per read.
- `query/compiler/evaluators.ts` — `in`: constant primitive arrays probe a
  precomputed `Set` instead of `array.some(deepEquals)` per row; `eq`:
  same-type primitive fast paths before `normalizeValue`.
- `query/compiler/group-by.ts` — keyExtractor no longer spreads+deletes a copy
  of every row; row virtual metadata computed once per row (WeakMap cache)
  instead of once per virtual aggregate; `for-in` instead of `Object.entries`.
- `db-ivm/operators/groupBy.ts` — aggregate entries hoisted out of per-row
  map; scratch array reuse in reduce.
- `query/compiler/index.ts` — `wrapInputWithAlias` skips rest-spread copy when
  no `__parentContext`; includes-mode `delete` of routing props guarded by
  `in` checks.
- `query/live/collection-config-builder.ts` — `materializeIncludedValue` drops
  redundant array copy; inline re-emit skips clone+event construction when the
  parent collection has no change subscriptions.
- `collection/changes.ts` — `emitEvents` early-returns when there are no
  change subscriptions.

**Verify:** db-ivm 322/322, db 2456 passed / 5 skipped. ✅

**Metric (interleaved A/B vs origin/main @ 95e25bd1, min of 3 rounds each):**
geomean hydrate speedup **1.345×**; geomean incremental 0.992× (flat; the
sub-ms incremental numbers are noise-dominated — re-check after iteration 2).
Standouts: list + author 2.79×, issue → creator 1.73×, issue detail 1.68×,
filter open 1.56×.

## Iteration 2 — lightweight child stores for inline includes · KEEP ✅

**Hypothesis:** Includes queries (`one_to_many`, `nested`, `view_*` with
`toArray(subquery)`) pay for a full Collection instance per parent row (10k–60k
instances per hydrate): CollectionImpl construction, per-commit
`commitPendingTransactions` fixed costs, SortedMap, virtual-props enrichment
copies. Inline materializations (`array`/`singleton`/`concat`) never expose the
child Collection to users, so a minimal Map-backed store suffices.

**Change:** `LightweightChildCollection` in collection-config-builder.ts used
by `createChildCollectionEntry` for all non-`collection` materializations.
Add-if-missing virtual props applied in place on write (rows are exclusively
owned pipeline outputs); sorted materialization cached until next write.

**Verify:** db 2456 passed / 5 skipped. ✅

**Metric (interleaved A/B, min of 3 rounds):** geomean hydrate **1.552×**,
incremental **1.250×**. issue → comments[] 2.19×, issue → creator 2.70×,
nested 2.42× hydrate / 2.80× incremental.

## Iteration 3 — groupBy hash & serialization elimination · KEEP ✅

**Hypothesis:** After iteration 2, `aggregate_count` is dominated by murmur
structural hashing in the reduce operator's input Index (every row's values
object hashed for consolidation) and `serializeValue`'s replacer-based
JSON.stringify per row.

**Changes (db-ivm):**
- `groupBy` emits `[discriminant, values]` tuples where the discriminant is a
  cheap string encoding of the pre-aggregated primitive values; the Index's
  prefix path then consolidates without hashing.
- New `prefixIdentity` option on `Index`/`reduce`: equal prefix ⟹ equal value,
  so same-prefix merges skip the structural hash comparison entirely.
- `serializeValue` fast path for flat plain objects of simple primitives
  (byte-identical output to the replacer path).
- `Index.append` adopts whole buckets for keys not present in the target
  (deltas are ephemeral) instead of re-adding every value.
- Combined the two virtual-metadata aggregates (`__virtual_synced__`,
  `__virtual_has_local__`) into one bitmask aggregate — halves per-row preMap
  work (db/group-by.ts).
- `evaluateWrappedAggregates` early-returns when there are no wrapped
  aggregate expressions.

**Verify:** db-ivm 322/322, db 2456 passed / 5 skipped. ✅

**Metric (spot):** aggregate_count hydrate 467→275ms (~2.1× vs baseline 570ms);
murmur hashing gone from the profile.

## Iteration 4 — commit fast path for plain inserts · KEEP ✅

**Hypothesis:** Every live query hydrate pays ~0.5ms in
`commitPendingTransactions` per-key virtual-props snapshot allocations that
plain inserts (the dominant hydrate case) never consume.

**Change:** fast path in the changed-keys loop: previous undefined + new
defined + no completed optimistic op → emit insert directly.

**Verify:** db 2456 passed / 5 skipped. ✅

**Metric:** final high-precision A/B (ROUNDS=8, IROUNDS=6, PAIRS=50, 3
interleaved rounds) — see autoresearch-results.tsv.

## Interim result vs origin/main (superseded by later iterations)

Interleaved A/B, baseline = origin/main @ 95e25bd1, candidate = HEAD
(4e994366), min-of-8 hydrate rounds / min-of-6×50 incremental pairs,
3 interleaved A/B rounds, large scale (1k users / 10k issues / 50k comments):

| Query | base hyd | cand hyd | speedup | base incr | cand incr | speedup |
|---|--:|--:|--:|--:|--:|--:|
| list: newest 50 open | 1.25 | 1.16 | 1.08× | 0.178 | 0.174 | 1.02× |
| list + author | 5.99 | 1.97 | **3.03×** | 0.753 | 0.586 | 1.28× |
| list + comment count | 4.47 | 2.97 | **1.51×** | 0.199 | 0.198 | 1.01× |
| list + 3 recent comments | 3.57 | 2.40 | **1.49×** | 0.176 | 0.141 | 1.25× |
| issue detail + comments | 4.15 | 2.33 | **1.78×** | 0.198 | 0.151 | 1.31× |
| list: page 2 | 1.04 | 0.88 | 1.17× | 0.152 | 0.156 | 0.98× |
| scan all issues | 26.2 | 18.4 | **1.42×** | 0.138 | 0.129 | 1.07× |
| filter open | 22.1 | 14.0 | **1.58×** | 0.136 | 0.135 | 1.01× |
| filter+order+limit 50 | 0.82 | 0.74 | 1.11× | 0.172 | 0.158 | 1.09× |
| issue → comments[] | 430.7 | 214.6 | **2.01×** | 0.221 | 0.149 | 1.48× |
| issue → creator | 115.3 | 44.7 | **2.58×** | 0.190 | 0.178 | 1.07× |
| issue → comments → creator | 866.2 | 315.1 | **2.75×** | 9.70 | 3.19 | **3.04×** |
| issue → commentCount | 551.3 | 289.2 | **1.91×** | 0.239 | 0.213 | 1.12× |

**geomean hydrate 1.707× · geomean incremental 1.221× · no regressions**

Verify gate at final state: db-ivm 322/322, db 2456 passed / 5 skipped.
Committed as 4e994366 on perf-rindle-improvements with changeset.

## Goal escalated (user): beat Rindle on all 26 rows, local head-to-head

@rindle/wasm@0.2.0 installed from npm into the unmodified rindle-db-bench
harness; @tanstack/db dist symlinked to the candidate build. Reference run
(published v0.6.14): Rindle wins all 12 view rows (up to 11×) + folq +
aggregate + nested incr (14.8×).

## Iteration 5 — keyed multiset consolidation without ID strings · KEEP ✅
Nested identity Maps replace composite getStringId strings in
MultiSet.#consolidateKeyed. Tests green (earlier 1-test failure was a
timing flake; passes in isolation and on re-run).

## Iteration 6 — dirty-key tracking for nested includes flushes · KEEP ✅
flushIncludesState deep pass and hasPendingIncludesChanges scanned the whole
childRegistry per flush. Now tracked via deepDirtyKeys + owner backpointers +
routing-index lookups (cost ∝ pending work).
**nested incremental: 3.2ms → 0.22ms (14.5×).** Tests green.

## Iteration 7 — synchronous transaction completion · KEEP ✅
Transaction.commit() deferred completion to a microtask even for synchronous
mutationFns, so synchronous mutation bursts accumulated persisting
transactions + pending sync transactions and went quadratic
(recomputeOptimisticState iterating everything per mutation).
commit() now completes synchronously for non-thenable mutationFn results;
local-only + direct-op wrappers de-asynced; terminal transactions migrated
once (WeakSet) and pruned eagerly after consumption.
NOTE: registering the direct-op transaction before commit() broke includes
event ordering (18 test failures) — reverted that reorder; original
ordering + sync completion passes everything.
**Burst: 3.8ms/pair @2000 pairs → 0.10ms/pair flat. All view incrementals
~2.3× faster.** db 2456 ✅, react-db 95 ✅, offline-transactions 65 ✅,
query-db-collection 200 ✅ (3 unhandled errors pre-existing on baseline).

## Iteration 8 — validated key-field fast path for eq/in · KEEP ✅
eq/in on the field mirroring the collection key (probe getKey with a
recording proxy; verify row[keyField] === key on every write; first violation
disables) are served by direct key lookups, marked inexact so candidates are
re-checked. Fixes full scans in view_detail hydrate (eq on issues.id over
10k rows) and every lazy join load keyed on a primary key.
**view_detail hydrate 2.6→0.64ms; list+author incr 0.58→0.22ms.**
8 mechanism-asserting tests updated (join loads on key fields now use key
lookups, not indexes/full scans); db 2456 ✅.

## Iteration 9 — steady-state fast lane for synced commits · KEEP ✅
commitPendingTransactions gets a direct path when there are no user
transactions, no optimistic state and no truncate (every live-query tick):
apply ops, derive one event per key from first-previous vs final value,
emit. Skips visible-state snapshots, virtual-props snapshot allocations,
redundancy detection and overlay rebuild.
Bench: view incrementals 0.09–0.17ms/pair (page-2 ties Rindle);
detail hydrate 0.49ms; +author 1.71ms; +count 2.97ms.
db 2456 ✅ react-db 95 ✅ offline-transactions 65 ✅.

## Iteration 10 — Index.get direct build + reduce 0/1-output fast path · KEEP ✅
aggregate_count hydrate 316→261ms. db-ivm 324 ✅ db 2456 ✅.

## Iteration 11 — in-place map/filter for exclusively-owned multisets · KEEP ✅
Writer marks single-reader deliveries exclusive; map/filter reuse the inner
array + tuples in place. nested 309→279ms, one_to_many 194→177ms,
aggregate 261→248ms, all views down. db-ivm 324 ✅ db 2456 ✅.

## Iteration 12 — optimizer skip for single-source no-join queries · KEEP ✅
optimizeQuery combined WHERE clauses directly for collectionRef-from queries
without joins instead of running the iterative rewrite + full-tree deepEquals
loop. detail 0.49→0.43ms, folq 0.63→0.60ms, page2 0.83ms. db 2456 ✅.

## Methodology finding (iteration 12 cycle)
Their harness forces a FULL GC between rounds and takes min-of-4. Isolated:
view_list best-of-200 without forced GC = 0.156–0.22ms; with forced GC =
0.51ms; their regime ≈ 1.2ms. Rindle's wasm state is off the JS heap, so
forced GC barely affects it. The remaining view-row gap is substantially
GC-recovery cost — the lever is allocation elimination (creation path +
snapshot path + per-tick), which each iteration has been chipping at.

## Scoreboard after iteration 12 (their harness, single run, noisy ±30%)
WON (11): scan h+i, filter h+i, one_to_many i, creator h+i, nested h+i,
commentCount i, one_to_many h (0.9, wobbles around parity).
RED (15): six view hydrates (1.4–3.3×), six view incrementals (1.4–2.7×),
folq h 1.3× + i 1.8×, aggregate_count h 1.7×.

Remaining engineering tracks (each sizeable):
1. Join operator fusion — accept key extractors instead of pre-keyed
   streams; kills ~3 allocations/row on join pipelines (aggregate_count,
   view_list_count).
2. Live-collection storage: plain Map + lazy sort instead of SortedMap
   comparator-per-write (fast-lane commit is now a flat sea of map ops,
   ~3.7µs/row).
3. Snapshot→pipeline fusion (ChangeMessage layer elimination).
4. Creation-path allocation cuts (operator graph objects per live query).

## Iteration 13 — normalizeValue primitive fast path · KEEP ✅
aggregate_count 248→229ms; helps every eq/join/groupBy key path. db 2456 ✅.

## Next up (design ready): join re-key fusion
Extend JoinOperator with optional per-side key extractors so the compiler
drops the two re-key map operators ([joinKey,[key,row]] wrappers per row per
side). Watch-outs: the lazy-load tap consumes the re-keyed stream shape
(apply extractor inside the tap instead), and the joined-side namespacing map
must stay (its nsRow objects flow into merged rows).

## Iteration 14 — join re-key fusion · KEEP ✅
JoinKeyExtractors on JoinOperator + Index.fromMultiSetsBy; compiler drops the
two per-side re-keying map operators; lazy tap uses the item-level extractor.
db-ivm 324 ✅ db 2456 ✅. Bench noisy this cycle; head-to-head arbitrates.

## Iteration 15 — lazy SortedMap ordering for custom comparators · KEEP ✅
O(1) writes + rebuild-on-read for comparator-backed maps (ordered live
collections, transactions). db 2456 ✅ react-db 95 ✅ offline-tx 65 ✅.

## Iteration 16 — minimal groupBy result rows · KEEP ✅
No more full aggregated-row spread per group. aggregate_count 223→205ms
(was 570 at baseline, Rindle ~150-170 local). db 2456 ✅.

## Measurement findings (post-iteration-16 probes)
- Heap sampling: view_list hydrate allocates only ~34KB — allocations are
  NOT the dominant view-row cost.
- --no-flush-bytecode: no effect — not code flushing.
- Conclusion: their min-of-4-rounds with forced GC samples the tail of a
  high-variance JS distribution (wasm's distribution is tight). Isolated
  min-of-100 without forced GC: view_list 0.156–0.22ms — FASTER than
  Rindle's 0.8–1.0. The lever for their-harness view rows remains lowering
  mean AND variance; no single remaining hotspot (fast-lane commit ~50µs,
  snapshot ~60µs, graph ~100µs at warm floor).
- aggregate_count now 205ms (Rindle ~150–170): remaining cost = ~140k
  Index.addValue calls (join deltas + reduce in/out) ~40ms, reduce ~15ms,
  groupBy map ~14ms, GC ~60ms from ~5 allocs/row (join products, merged
  nsRows, groupBy wrappers). Next ideas: consume join pairs in groupBy
  without materializing merged nsRow; pool/flatten join result tuples.

## Iteration 17 — reduce indexes skip presence tracking · KEEP ✅
trackConsolidated:false on reduce in/out indexes. aggregate_count ~190ms
isolated (best yet). Both suites ✅.

## ROOT CAUSE for the view-row regime gap (measured)
30-round ramp under their forced-GC regime (view_list hydrate):
1.23 1.42 0.95 1.22 1.15 1.23 1.53 2.16 | 1.02…0.80 | 0.73…0.57 — still
declining at round 30; floor ~0.16-0.22 at round ~100+. Fresh closures per
live-query creation reset V8 type feedback; tier-up happens across CREATIONS.
Min-of-4 samples the top of the ramp; Rindle (wasm) has no such ramp.

**The remaining lever: compiler blueprint refactor** — memoize per query
STRUCTURE (structural IR hash → shared compiled evaluators + pipeline
topology template) and instantiate per-instance state cheaply, so closure
identities persist across live-query creations and stay hot. Benefits real
apps too (components repeatedly mounting the same query shape). Sizeable,
architectural — needs a green light.

## Iteration 18 — structural evaluator cache · KEEP (hypothesis falsified) ⚠️
Shared compiled-evaluator closures across creations did NOT flatten the
creation tier-up ramp (30-round pattern unchanged) — the warm-up is not in
evaluator closures. Cache kept: saves compile work on repeated mounts, all
suites green. Full topology-template refactor now has UNCERTAIN payoff for
the harness regime; de-prioritized pending discussion.

## Iteration-18 head-to-head: parity sightings
detail hydrate 1.0× (parity), folq hydrate 1.1×, view_list 1.4×/1.1×,
+author 1.5× — while +count spiked 7.0× (was 3.2-3.6). Run-to-run variance
under min-of-4 forced GC now dominates every remaining red row; rows touch
parity on good runs. Collecting median-of-3 scoreboard.

## Median-of-3 scoreboard (post-iteration-18)
WON 11: scan h+i, filter h+i, one_to_many h(0.9)+i, creator h+i, nested h+i,
aggregate i. RED 15 (medians): views h 1.4/1.9/3.3/2.5/1.7/1.7, views i
1.3/2.6/2.8/1.5/2.3/1.3, folq 1.3/1.8, aggregate h 1.7.

## Iteration 19 — Index.join appends into shared results · KEEP ✅
No intermediate arrays per delta term. aggregate 187ms isolated (best;
Rindle 150-170 local ⇒ isolated gap now ~1.1-1.25×; harness regime prints
1.7×). Both suites ✅.

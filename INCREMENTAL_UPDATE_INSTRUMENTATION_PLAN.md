# Incremental Update Instrumentation Plan

## Context

External benchmarks suggest TanStack DB may have slow steady-state incremental
updates for live queries. The reported query shapes are:

- `list: newest 50 open`
- `list + author`
- `list + comment count`
- `list + 3 recent comments`
- `issue detail + comments`

The cold hydrate numbers are slower than the comparison library, but the much
larger gap is steady-state write latency. The instrumentation should therefore
focus on explaining what one source collection write causes downstream: graph
work, operator fanout, hashing, output flushing, collection commits, includes
materialization, and subscriber event delivery.

## Goals

- Attribute per-write latency across the full live-query path.
- Separate D2 graph/operator cost from TanStack DB collection commit/event cost.
- Measure hashing and serialization explicitly because this has been a past
  bottleneck.
- Capture cardinalities alongside timing so we can identify unnecessary fanout,
  not just slow functions.
- Make the benchmark fixture deterministic enough to compare branches.
- Keep instrumentation opt-in and low overhead when disabled.

## Non-goals

- Do not expose tracing as a stable public API in the first pass.
- Do not optimize code while adding instrumentation, except for trivial fixes
  needed to make measurement reliable.
- Do not add wall-clock performance assertions to normal unit tests. Timing can
  be noisy; committed tests should assert behavior and useful cardinality
  invariants instead.

## Benchmark Shapes To Reproduce

Build a deterministic issue tracker fixture with `issues`, `users`, and
`comments`. Scale should be configurable, but start with enough rows to expose
fanout:

- Issues: 10k total, mixed `open` and closed.
- Users: 500 to 2k.
- Comments: 0 to many per issue, skewed distribution so some issues are hot.
- Indexes: test both the expected indexed path and a no-index/control path where
  useful.

Queries:

1. Newest open list
   - `issues where status = 'open' orderBy createdAt desc limit 50`
   - Measures filter, ordered top-k, and limit placement.

2. List plus author
   - Same base list, joined to `users` on `authorId`.
   - Measures whether filtering/limit happens before join and whether join
     delta output is proportional to changed rows.

3. List plus comment count
   - Same base list, with `count(comments)` grouped by issue.
   - Measures aggregate maintenance and whether a single comment write scans
     too many comments for that issue or all issues.

4. List plus 3 recent comments
   - Same base list, with newest 3 comments per issue.
   - Measures grouped top-k, nested includes, and parent re-emission.

5. Issue detail plus comments
   - Single issue detail with comments.
   - Measures the non-list path and whether comment-only writes avoid list-level
     overhead.

For each query, measure:

- Cold hydrate: preload, first graph run, and first visible result.
- Steady-state write: insert, update, and delete one relevant row.
- Irrelevant write: write a row that should not affect the result.
- Boundary write: write a row that enters or exits the top 50 or top 3 window.

## Trace Architecture

Add an internal, opt-in trace recorder with two levels:

1. A shared low-level recorder usable from `@tanstack/db-ivm`.
2. TanStack DB live-query spans that record collection and includes work.

Suggested files:

- `packages/db-ivm/src/perf.ts`
- `packages/db/src/query/live/perf.ts`
- `packages/db/tests/query/perf/incremental-update.bench.ts`

The recorder should support:

- `span(name, tags, fn)` for sync work.
- `record(name, value, tags)` for counters and gauges.
- `reset()` and `snapshot()` for tests/benchmarks.
- A global symbol-backed sink so both packages can aggregate in the same report
  without making a public API commitment.

Enablement options:

- Programmatic test helper for benchmarks.
- Optional environment/global flag, for example `TANSTACK_DB_TRACE=1` in Node
  and `globalThis.__TANSTACK_DB_TRACE__ = true` in browser-like tests.

Overhead rules:

- When disabled, instrumentation should be one cheap branch and no object
  allocation in hot loops.
- Use `performance.now()` when available.
- Avoid wrapping tiny inner-loop operations unless the wrapper itself is gated
  before allocation.

## Required Timing Spans

### D2 Graph

Files:

- `packages/db-ivm/src/d2.ts`
- `packages/db-ivm/src/graph.ts`

Measure:

- `d2.run`: total time, number of steps.
- `d2.step`: total operators visited.
- `d2.operator.run`: per operator id and class name.
- `d2.pendingWork`: optional count of calls if it shows up in profiles.

Record per operator:

- Input message count.
- Input row count.
- Output message count where visible.
- Output row count where visible.

### Query Operators

Files:

- `packages/db-ivm/src/operators/filter.ts`
- `packages/db-ivm/src/operators/filterBy.ts`
- `packages/db-ivm/src/operators/join.ts`
- `packages/db-ivm/src/operators/reduce.ts`
- `packages/db-ivm/src/operators/count.ts`
- `packages/db-ivm/src/operators/groupBy.ts`
- `packages/db-ivm/src/operators/topKWithFractionalIndex.ts`
- `packages/db-ivm/src/operators/groupedTopKWithFractionalIndex.ts`
- `packages/db-ivm/src/operators/orderBy.ts`
- `packages/db-ivm/src/operators/consolidate.ts`
- `packages/db-ivm/src/operators/distinct.ts`
- `packages/db-ivm/src/operators/output.ts`

Measure operator-specific cardinalities:

- Filter: rows in, rows passed, predicate time.
- Join: delta A rows, delta B rows, matched bucket sizes, emitted rows.
- Reduce/count: changed keys, values scanned per key, emitted rows.
- Group-by: group keys touched, group key serialization time.
- Top-k/order-by: state size, inserts, deletes, move-ins, move-outs.
- Consolidate: input rows, output rows, keyed fast path vs unkeyed path.
- Distinct: keys touched and hash time.
- Output: messages read, rows accumulated, callback time.

### Live Query Scheduling And Flush

Files:

- `packages/db/src/scheduler.ts`
- `packages/db/src/query/live/collection-config-builder.ts`
- `packages/db/src/query/live/collection-subscriber.ts`

Measure:

- `scheduler.schedule`: context vs immediate, dedupe count.
- `scheduler.flush`: jobs run, passes, blocked dependency count.
- `liveQuery.scheduleGraphRun`: schedules per source write.
- `liveQuery.executeGraphRun`: coalesced callbacks per run.
- `liveQuery.maybeRunGraph`: graph run loop count and total time.
- `liveQuery.flushPendingChanges`: total time and parent/child split.
- `collectionSubscriber.sendChangesToPipeline`: source changes received,
  duplicate inserts filtered, changes sent to D2.

### Collection Commit And Events

Files:

- `packages/db/src/collection/sync.ts`
- `packages/db/src/collection/state.ts`
- `packages/db/src/collection/changes.ts`
- `packages/db/src/collection/subscription.ts`

Measure:

- Sync `begin`, `write`, and `commit` counts and time.
- `commitPendingTransactions`: total time.
- `changedKeys` size.
- committed synced transaction count.
- active optimistic transaction count.
- event count by insert/update/delete.
- index update time.
- virtual prop enrichment time.
- `deepEquals` count and aggregate time.
- subscriber count and subscriber event delivery time.

### Includes Materialization

File:

- `packages/db/src/query/live/collection-config-builder.ts`

Measure:

- `flushIncludesState`: total time by level and materialization type.
- Parent insert phase count/time.
- Child change application count/time.
- Nested buffer drain count/time.
- Per-entry recursive flush count/time.
- Inline parent re-emission count/time.
- Parent delete cleanup count/time.
- Child collection create/dispose count.

This is especially important for:

- `list + 3 recent comments`
- `issue detail + comments`

## Hashing And Serialization Instrumentation

Hashing must be a first-class report section.

Files:

- `packages/db-ivm/src/hashing/hash.ts`
- `packages/db-ivm/src/multiset.ts`
- `packages/db-ivm/src/indexes.ts`
- `packages/db-ivm/src/utils.ts`
- `packages/db-ivm/src/operators/distinct.ts`
- `packages/db/src/query/compiler/group-by.ts`
- `packages/db/src/query/live/utils.ts`

Measure:

- `hash`: total calls, total time, max single-call time.
- Hash cache hits and misses.
- Hash calls by input kind:
  - primitive
  - plain object
  - array
  - date
  - map
  - set
  - Uint8Array or Buffer
  - Temporal
  - function or reference hash
- `hashPlainObject`: key count and sort time.
- `hashUint8Array`: byte length buckets.
- `ObjectIdGenerator.getStringId`: calls and time.
- `MultiSet.consolidate`: keyed fast path vs unkeyed hash path.
- `Index` fallback hashing:
  - `ValueMap.addValue` calls.
  - single value to value map transitions.
  - prefix map value hashing.
- `serializeValue`: calls, total time, max single-call time.

Example report section:

```text
hash:
  calls: 12450
  totalMs: 8.42
  maxMs: 0.31
  cacheHits: 11020
  cacheMisses: 1430
  byKind: primitive=9020 object=3100 array=180 map=0 set=0 uint8=0

multisetConsolidate:
  calls: 412
  totalMs: 5.88
  keyedFastPath: 390
  unkeyedHashPath: 22

indexHashFallback:
  calls: 744
  totalMs: 2.19
  valueMapTransitions: 31
```

## Report Format

Each benchmark run should emit:

- Query name.
- Phase: cold hydrate or incremental write.
- Wall-clock duration.
- Top spans by total time.
- Top spans by call count.
- Hashing summary.
- Operator cardinality table.
- Collection commit and event summary.

Example:

```text
query: list + comment count
phase: comment insert
wallMs: 25.12

top spans:
  collection.commitPendingTransactions  11.40ms  calls=1
  reduce.count                           7.22ms  calls=1
  hash                                   4.80ms  calls=9180
  liveQuery.flushPendingChanges          1.60ms  calls=1

operator cardinality:
  filter issues      in=1 out=0
  join comments      deltaA=1 deltaB=0 emitted=1
  count comments     changedKeys=1 valuesScanned=2800 emitted=1
```

## Implementation Steps

1. Add the disabled-by-default trace recorder.
2. Add D2 graph and operator-level spans.
3. Add hash, serialize, multiset, and index fallback counters.
4. Add live query scheduling and flush spans.
5. Add collection commit, event, and includes spans.
6. Add the deterministic benchmark fixture and runner.
7. Run baseline on current branch and save JSON output outside committed source
   unless the team wants checked-in snapshots.
8. Inspect the highest cost spans and cardinality blowups.
9. Add focused regression tests for any discovered bug or accidental fanout.
10. Implement optimizations in separate commits after instrumentation is trusted.

## Questions The Data Should Answer

- Does a single irrelevant write still run expensive downstream work?
- Is filter/order/limit applied before joins and aggregates where possible?
- Does `comment count` scan all comments for an issue, all comments globally, or
  only the changed delta?
- Does `3 recent comments` re-emit all 50 parent rows or only affected parents?
- Is hashing time material, and if so, is it structural hash, identity key
  generation, `serializeValue`, or `Index` fallback hashing?
- Are repeated `deepEquals` calls or virtual prop enrichment dominating after
  D2 finishes?
- Are multiple graph runs scheduled for one source write?
- Are child collection commits/events more expensive than the graph update?

## Acceptance Criteria

- Running the benchmark produces one readable text report and one machine
  readable JSON report.
- For each query shape, the report shows cold hydrate and at least one
  steady-state write case.
- Hashing appears as its own aggregate section with call counts and timing.
- D2 operator timing can be separated from collection commit/event timing.
- The report includes enough cardinality data to explain why a slow span is
  slow.
- Normal test runs have negligible overhead with tracing disabled.


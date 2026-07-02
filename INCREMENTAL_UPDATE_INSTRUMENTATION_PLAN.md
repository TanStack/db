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

### Concrete Query Sketches

Use sketches like these as the starting point, then adjust to exact QueryBuilder
syntax during implementation.

```ts
// 1. list: newest 50 open
q.from({ issue: issues })
  .where(({ issue }) => eq(issue.status, `open`))
  .orderBy(({ issue }) => issue.createdAt, `desc`)
  .limit(50)

// 2. list + author
q.from({ issue: issues })
  .where(({ issue }) => eq(issue.status, `open`))
  .orderBy(({ issue }) => issue.createdAt, `desc`)
  .limit(50)
  .join({ author: users }, ({ issue, author }) =>
    eq(issue.authorId, author.id),
  )

// 3. list + comment count
q.from({ issue: issues })
  .where(({ issue }) => eq(issue.status, `open`))
  .orderBy(({ issue }) => issue.createdAt, `desc`)
  .limit(50)
  .select(({ issue }) => ({
    issue,
    commentCount: q
      .from({ comment: comments })
      .where(({ comment }) => eq(comment.issueId, issue.id))
      .select(({ comment }) => count(comment.id)),
  }))

// 4. list + 3 recent comments
q.from({ issue: issues })
  .where(({ issue }) => eq(issue.status, `open`))
  .orderBy(({ issue }) => issue.createdAt, `desc`)
  .limit(50)
  .select(({ issue }) => ({
    issue,
    recentComments: toArray(
      q.from({ comment: comments })
        .where(({ comment }) => eq(comment.issueId, issue.id))
        .orderBy(({ comment }) => comment.createdAt, `desc`)
        .limit(3),
    ),
  }))

// 5. issue detail + comments
q.from({ issue: issues })
  .where(({ issue }) => eq(issue.id, selectedIssueId))
  .select(({ issue }) => ({
    issue,
    comments: toArray(
      q.from({ comment: comments })
        .where(({ comment }) => eq(comment.issueId, issue.id))
        .orderBy(({ comment }) => comment.createdAt, `desc`),
    ),
  }))
```

### Write Scenarios

Run each scenario against every query where it is relevant:

- Issue insert outside the open/top-50 window.
- Issue insert that enters the open/top-50 window.
- Issue update that changes non-query fields on a visible issue.
- Issue update that changes `status` so a row enters or exits the list.
- Issue update that changes `createdAt` across the top-50 boundary.
- Issue delete for a visible issue.
- Author update for the author of a visible issue.
- Author update for a user with no visible issues.
- Comment insert on a visible issue.
- Comment insert on a non-visible issue.
- Comment update that does not affect comment count or ordering.
- Comment update that changes `createdAt` across the top-3 boundary.
- Comment delete from a visible issue.
- Comment insert/delete on the selected issue detail row.
- Comment insert/delete on a different issue while the detail query is active.

### Benchmark Protocol

The benchmark runner should be a standalone `tsx` script first, with small
Vitest unit tests for trace aggregation behavior. A standalone runner makes it
easier to control warmup, iteration count, output files, and Node flags without
turning normal test runs into noisy performance tests.

For every benchmark case:

- Use a fixed fixture seed and print it in the report.
- Print Node version, package manager version, platform, CPU model when
  available, and git SHA.
- Run warmup iterations before measured iterations.
- Run enough measured iterations to report median, p75, p95, min, max, and
  standard deviation.
- Run with tracing disabled and enabled on the same fixture to estimate trace
  overhead.
- Optionally run with `--expose-gc` and call `global.gc()` between measured
  cases when available; report whether GC control was active.
- Keep JSON output outside committed source by default, for example under
  `.tmp/perf/`, unless the team explicitly wants checked-in snapshots.

## Trace Architecture

Add an internal, opt-in trace recorder with two levels:

1. A shared low-level recorder usable from `@tanstack/db-ivm`.
2. TanStack DB live-query spans that record collection and includes work.

Suggested files:

- `packages/db-ivm/src/perf.ts`
- `packages/db/src/query/live/perf.ts`
- `scripts/bench/incremental-update.ts`
- `packages/db/tests/query/perf/trace-aggregation.test.ts`

The recorder should support:

- `span(name, tags, fn)` for sync work.
- `spanAsync(name, tags, fn)` for promise-returning work.
- `startSpan(name, tags)` returning an explicit `end(extraTags?)` handle for
  work that crosses callback or subscription boundaries.
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

Output attribution must be explicit. The preferred first implementation is:

- Each operator that already builds a `MultiSet` or result array records output
  row count immediately before `output.sendData(...)`.
- Generic `D2` operator timing records class name and input counts only.
- Do not infer per-operator output rows from `DifferenceStreamWriter` unless the
  writer is extended with producer metadata; otherwise downstream readers make
  attribution ambiguous.
- Operators that stream through messages, such as `output`, should record
  callback input rows and callback duration separately from forwarded rows.

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

- `hash`: public call count, total time, max single-call time.
- Structural hash calls, total time, and max single-call time.
- Object hash cache hits and misses. These should only count object-like values
  that consult the WeakMap, not primitives.
- Primitive hash calls. These are deterministic but not cache-backed.
- Reference identity hash calls for functions, large binary values, and files.
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
- `hashPlainObject`: key count, nested value count, and key sort time.
- `hashUint8Array`: byte length buckets.
- `ObjectIdGenerator.getStringId`: calls, time, object WeakMap hits/misses,
  and primitive calls.
- `MultiSet.consolidate`: keyed fast path vs unkeyed hash path.
- `Index` fallback hashing:
  - `ValueMap.addValue` calls.
  - single value to value map transitions.
  - prefix map value hashing.
- `serializeValue`: calls, total time, max single-call time.

The cache counters need clear denominators. A report that says `cacheHits=1000`
must also make clear whether those hits are from `hashObject`, reference identity
hashing, or `ObjectIdGenerator`; primitives should not be counted as misses just
because they do not use a WeakMap.

Example report section:

```text
hash:
  publicCalls: 12450
  structuralCalls: 3430
  totalMs: 8.42
  maxMs: 0.31
  objectCacheHits: 2010
  objectCacheMisses: 520
  referenceHashCalls: 12
  primitiveCalls: 9020
  byKind: primitive=9020 object=3100 array=180 map=0 set=0 uint8=0

objectIdGenerator:
  calls: 9000
  totalMs: 1.33
  objectHits: 7200
  objectMisses: 400
  primitiveCalls: 1400

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
- Write scenario name.
- Fixture seed and scale.
- Runtime metadata: Node version, platform, git SHA, tracing enabled/disabled.
- Wall-clock duration summary: median, p75, p95, min, max, standard deviation,
  and iteration count.
- Trace overhead summary comparing tracing disabled vs enabled for the same
  case.
- Top spans by total time.
- Top spans by call count.
- Hashing summary.
- Operator cardinality table.
- Collection commit and event summary.

Example:

```text
query: list + comment count
phase: comment insert
scenario: visible issue comment insert
iterations: 100
medianMs: 25.12
p95Ms: 29.48
traceOverheadMs: 0.82

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
2. Add unit tests for trace aggregation, disabled-mode behavior, and async span
   completion.
3. Add D2 graph and operator-level spans.
4. Add hash, serialize, multiset, and index fallback counters.
5. Add live query scheduling and flush spans.
6. Add collection commit, event, and includes spans.
7. Add the deterministic standalone benchmark fixture and runner.
8. Run benchmark cases with tracing disabled and enabled to estimate overhead.
9. Run baseline on current branch and save JSON output outside committed source
   unless the team wants checked-in snapshots.
10. Inspect the highest cost spans and cardinality blowups.
11. Add focused regression tests for any discovered bug or accidental fanout.
12. Implement optimizations in separate commits after instrumentation is trusted.

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
- Each measured case reports warmup count, measured iteration count, median,
  p95, min, max, standard deviation, fixture seed, fixture scale, runtime
  metadata, and git SHA.
- Each measured case reports tracing disabled vs enabled overhead.
- Hashing appears as its own aggregate section with call counts and timing.
- Hashing cache metrics separate object WeakMap hits/misses, primitive calls,
  and reference identity hashing.
- D2 operator timing can be separated from collection commit/event timing.
- Operator output cardinality is explicitly recorded by operators that emit
  data, not inferred ambiguously from downstream readers.
- Async work such as preload, loadSubset, and first visible result can be timed
  with async spans or explicit start/end spans.
- The report includes enough cardinality data to explain why a slow span is
  slow.
- Normal test runs have negligible overhead with tracing disabled.

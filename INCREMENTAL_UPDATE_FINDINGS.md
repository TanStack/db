# Incremental Update Performance Findings

Date: 2026-07-02

Branch: https://github.com/samwillis/db/tree/codex/incremental-update-instrumentation-plan

Instrumentation commit: https://github.com/samwillis/db/commit/a13fd382a

Source-index benchmark commit: https://github.com/samwillis/db/commit/1ee5188cf

## Executive Summary

We have identified the likely source of the slow incremental update results seen in the shared benchmark table.

The incremental hot path is doing O(source-collection-size) snapshot work on every write. In particular, both synced and optimistic paths clone `rowOrigins` for the mutated collection:

- synced path: `collection.commitPendingTransactions.snapshotState`
- optimistic path: `collection.recomputeOptimisticState.snapshotState`

At 100k source rows this snapshot work is about 95% of traced source-to-result time. At the estimated shared benchmark shape of `100k issues`, `100k users`, and `400k comments`, it is about 98% of traced source-to-result time.

This makes the reported shared TanStack DB numbers plausible if their benchmark used roughly:

- `100k` issues
- `100k` users
- `400k` comments

That shape gives us:

| Query | Shared TanStack DB | Our estimated-shape best |
|---|---:|---:|
| list: newest 50 open | 5.36ms | 6.25ms |
| list + author | 6.61ms | 6.07ms |
| list + comment count | 25.29ms | 28.79ms |
| list + 3 recent comments | 24.80ms | 29.26ms |
| issue detail + comments | 24.91ms | 28.83ms |

That is close enough to strongly support the diagnosis. It is not proof because we do not have the shared benchmark source.

## Important Caveat

This is not a true benchmark-to-benchmark comparison.

We do not have the source for the shared benchmark, so we do not know:

- exact dataset sizes
- data distribution
- whether source collections had indexes
- whether auto-indexing was enabled
- whether incremental writes were synced changes, optimistic changes, or something else
- whether included shapes were fully incremental
- whether timings include rendering, scheduling, framework overhead, or only DB work
- runtime, machine, browser/Node version, warmup, and sampling method

The comparisons below are best-effort orientation only. They are useful for diagnosis, but they should not be treated as apples-to-apples results.

## What We Added

The benchmark covers the externally reported query shapes:

- `list: newest 50 open`
- `list + author`
- `list + comment count`
- `list + 3 recent comments`
- `issue detail + comments`

The fixture uses three source collections:

- `issues`
- `users`
- `comments`

The benchmark can run:

- `synced` writes through `begin/write/commit`
- `optimistic` writes through public collection mutations, with rollback cleanup kept outside the measured sample
- source-index modes `none`, `manual`, and `auto`

Manual source indexes are created on:

- `issues.id`
- `issues.status`
- `issues.authorId`
- `issues.createdAt`
- `users.id`
- `comments.issueId`
- `comments.createdAt`

## Benchmark Commands

Full incremental trace run:

```sh
pnpm exec tsx scripts/bench/incremental-update.ts
```

Cold hydrate source-index comparison:

```sh
pnpm exec tsx scripts/bench/incremental-update.ts --mutationModes=synced --sourceIndexes=none,manual --outDir=.tmp/perf-index-cold
```

100k uniform run:

```sh
pnpm exec tsx scripts/bench/incremental-update.ts --levels=100k --sourceIndexes=manual --mutationModes=synced,optimistic --outDir=.tmp/perf-100k
```

Estimated shared-shape run:

```sh
pnpm exec tsx scripts/bench/incremental-update.ts --issues=100k --users=100k --comments=400k --sourceIndexes=manual --mutationModes=synced,optimistic --outDir=.tmp/perf-estimated-shape
```

Relevant local result files:

```txt
.tmp/perf/incremental-update-1782978638218.json
.tmp/perf-index-cold/incremental-update-1782979711311.json
.tmp/perf-100k/incremental-update-1782981193934.json
.tmp/perf-estimated-shape/incremental-update-1782981555034.json
```

Run metadata:

- seed: `42`
- warmup: `10`
- iterations: `50`
- runtime: Node `v22.13.0`
- platform: `darwin 24.6.0`
- CPU: `Apple M2`
- `global.gc`: not available

## Shared External Table

The shared screenshot reports these incremental update numbers:

| Query | Shared TanStack DB | Rindle |
|---|---:|---:|
| list: newest 50 open | 5.36ms | 0.113ms |
| list + author | 6.61ms | 0.133ms |
| list + comment count | 25.29ms | 0.086ms |
| list + 3 recent comments | 24.80ms | 0.129ms |
| issue detail + comments | 24.91ms | 0.072ms |

## Small Sizes Compared With Rindle

At 100 and 1k rows per source collection, our synthetic TanStack DB benchmark is broadly competitive with or faster than the shared Rindle column.

### 100 Rows Per Collection

| Query | Rindle | Our synced | Synced read | Our optimistic | Optimistic read |
|---|---:|---:|---:|---:|---:|
| list: newest 50 open | 0.113 | 0.062 | 1.83x faster | 0.084 | 1.34x faster |
| list + author | 0.133 | 0.100 | 1.33x faster | 0.087 | 1.52x faster |
| list + comment count | 0.086 | 0.074 | 1.17x faster | 0.066 | 1.31x faster |
| list + 3 recent comments | 0.129 | 0.055 | 2.34x faster | 0.052 | 2.50x faster |
| issue detail + comments | 0.072 | 0.042 | 1.70x faster | 0.039 | 1.85x faster |

### 1,000 Rows Per Collection

| Query | Rindle | Our synced | Synced read | Our optimistic | Optimistic read |
|---|---:|---:|---:|---:|---:|
| list: newest 50 open | 0.113 | 0.067 | 1.70x faster | 0.083 | 1.36x faster |
| list + author | 0.133 | 0.072 | 1.86x faster | 0.087 | 1.53x faster |
| list + comment count | 0.086 | 0.079 | 1.08x faster | 0.087 | 1.01x slower |
| list + 3 recent comments | 0.129 | 0.070 | 1.84x faster | 0.070 | 1.83x faster |
| issue detail + comments | 0.072 | 0.066 | 1.08x faster | 0.063 | 1.14x faster |

The issue is not visible at small source sizes. The cliff appears as source collections grow.

## 100k Uniform Run

With `100k` rows in each source collection and manual source indexes, incremental writes are around `6ms` regardless of query shape.

| Query | Shared TanStack DB | Rindle | Our synced | Our optimistic | Best vs shared TanStack DB | Best vs Rindle |
|---|---:|---:|---:|---:|---:|---:|
| list: newest 50 open | 5.36 | 0.113 | 6.088 | 6.170 | 1.14x | 53.9x slower |
| list + author | 6.61 | 0.133 | 6.570 | 6.197 | 0.94x | 46.6x slower |
| list + comment count | 25.29 | 0.086 | 6.326 | 6.501 | 0.25x | 73.6x slower |
| list + 3 recent comments | 24.80 | 0.129 | 5.950 | 6.348 | 0.24x | 46.1x slower |
| issue detail + comments | 24.91 | 0.072 | 6.262 | 6.510 | 0.25x | 87.0x slower |

This explains the first two shared TanStack DB rows if their issues/users collections are around 100k rows. It does not explain the roughly 25ms comment-driven rows unless the comments collection is larger.

## Estimated Shared-Shape Run

We then ran the benchmark with:

- `100k` issues
- `100k` users
- `400k` comments
- manual source indexes

This closely reproduces the shared TanStack DB shape.

| Query | Shared TanStack DB | Rindle | Our synced | Our optimistic | Best | Best vs shared TanStack DB | Best vs Rindle |
|---|---:|---:|---:|---:|---:|---:|---:|
| list: newest 50 open | 5.36 | 0.113 | 6.25 | 6.54 | 6.25 | 1.17x | 55x slower |
| list + author | 6.61 | 0.133 | 6.52 | 6.07 | 6.07 | 0.92x | 46x slower |
| list + comment count | 25.29 | 0.086 | 34.98 | 28.79 | 28.79 | 1.14x | 335x slower |
| list + 3 recent comments | 24.80 | 0.129 | 29.26 | 34.56 | 29.26 | 1.18x | 227x slower |
| issue detail + comments | 24.91 | 0.072 | 31.11 | 28.83 | 28.83 | 1.16x | 400x slower |

This is strong evidence that the shared TanStack DB numbers can be explained by source collection sizes alone:

- issue/user updates mutate a roughly 100k-row source collection and cost about 6ms
- comment inserts mutate a roughly 400k-row source collection and cost about 29ms

Again, this is not proof of their dataset size. It is a strong fit to the observed shape.

## Why This Happens

The traced layer breakdown for the estimated shared-shape run shows that snapshot cloning is essentially the whole cost.

| Mode | Total traced source time | Snapshot clone | Event emit | Query execute | Graph run |
|---|---:|---:|---:|---:|---:|
| synced | 5487ms | 5384ms, 98.1% | 82ms, 1.5% | 73ms, 1.3% | 47ms, 0.8% |
| optimistic | 5268ms | 5169ms, 98.1% | 13ms, 0.2% | 67ms, 1.3% | 42ms, 0.8% |

The graph is not the problem in this run. Hashing is not the problem in this run. The incremental cost is dominated by cloning collection snapshot state.

At 10k, each query case copies about 500k `rowOrigins` entries over 50 writes.

At 100k, each query case copies about 5 million `rowOrigins` entries over 50 writes.

In the estimated shared-shape run, comment-driven cases mutate the 400k-row comments collection, so they copy about 20 million `rowOrigins` entries over 50 writes.

## Cold Hydrate Finding

Cold hydrate is a separate issue. It is extremely sensitive to source indexes.

### 10,000 Rows Per Collection

| Query | No indexes | Manual indexes | Speedup |
|---|---:|---:|---:|
| list: newest 50 open | 31.644ms | 0.385ms | 82.2x |
| list + author | 119.735ms | 0.930ms | 128.7x |
| list + comment count | 2308.053ms | 1.322ms | 1745.9x |
| list + 3 recent comments | 2227.533ms | 3.102ms | 718.0x |
| issue detail + comments | 6.590ms | 0.280ms | 23.6x |

Cold hydrate conclusions:

- With source indexes, cold hydrate is fast.
- Without source indexes, included/comment shapes can become multi-second at 10k.
- Cold hydrate comparisons are not meaningful unless we know the shared benchmark's index setup.

## Incremental Writes And Source Indexes

Manual source indexes barely changed incremental write medians at 10k:

| Query | No indexes | Manual indexes |
|---|---:|---:|
| list: newest 50 open | 0.574ms | 0.534ms |
| list + author | 0.578ms | 0.552ms |
| list + comment count | 0.576ms | 0.529ms |
| list + 3 recent comments | 0.528ms | 0.529ms |
| issue detail + comments | 0.548ms | 0.543ms |

This separates the two findings:

- source indexes are decisive for cold hydrate
- source indexes do not materially change the incremental hot spot

## Current Diagnosis

The most likely issue is global snapshot/diff behavior in collection state updates.

The code should not need to clone or diff full collection-sized maps to emit events for a one-row write. The mutation and sync pipelines already know the changed keys.

The likely fix is to move both hot paths toward changed-key event construction:

- synced path: build events from committed operation keys and previous values/origins for those keys
- optimistic path: compute event deltas from active mutation keys rather than diffing cloned global maps

## Recommended Next Work

1. Remove the full `rowOrigins` clone from synced and optimistic hot paths.

2. Replace global snapshot/diff with changed-key event construction.

3. Keep source-index modes in the benchmark.
   - `none` catches accidental full-scan hydrate behavior.
   - `manual` gives a fair indexed hydrate baseline.
   - `auto` lets us inspect eager auto-index behavior separately.

4. Re-run this benchmark after the fix.
   - The estimated shared-shape run should drop from about `6ms` and `29ms` toward the query graph cost, currently under `1ms` per write in aggregate.

5. Re-run with the external benchmark source if it becomes available.
   - That is the only way to make a real comparison to the shared table.

6. Re-run with `node --expose-gc` for a cleaner memory/GC profile.


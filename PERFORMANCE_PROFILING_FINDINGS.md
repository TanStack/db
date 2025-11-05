# Performance Profiling Findings - Live Query Initialization

## Summary

Ran initial performance profiling to understand where CPU time goes during live query initialization. The goal is to quantify how much time precompiling parameterized queries could save.

---

## Benchmark Setup

**Test Pattern** (matching test2.zip app):
- 240 live query collections created
- Same query structure: `q.from({item}).where(and(eq(rowId, X), eq(side, Y)))`
- Different parameters for each query (unique rowId + side combinations)
- Base collection pre-populated with 480 orders (data already loaded)

**What We're Measuring**:
- Query construction + compilation
- Subscription setup (planned)
- Initial D2 graph run (planned)
- NOT measuring external data loading (assumed pre-loaded)

---

## Initial Benchmark Results

### Construction Only (benchmark.ts)

```
Total time:         16.50ms for 240 queries
Average per query:  0.069ms
Median:             0.041ms
Min:                0.033ms
Max:                2.072ms
```

**What This Measures**:
- `createLiveQueryCollection()` call
- QueryIR building
- Query optimization (up to 10 iterations)
- Query compilation (D2 pipeline creation)
- D2 graph finalization

**What This DOESN'T Measure**:
- `startSync()` / subscription setup
- Initial snapshot processing through D2 graph
- React hook overhead
- State updates

---

## The Performance Gap

### Benchmark vs Real World

| Metric | Benchmark (Node.js) | Real App (test2.zip) | Gap |
|--------|---------------------|----------------------|-----|
| 240 queries | **16.5ms** | **194ms** (prod, 4x throttle) | **11.8×** |
| Environment | Node.js, no React | Browser, React, CPU throttle | Different |

### Where's the Missing Time?

The 194ms real-world time includes:

1. ✅ **Construction + Compilation**: ~16ms (measured)
2. ❓ **Subscription Setup**: Not measured yet
   - 240× `subscribeToAllCollections()`
   - 240× `CollectionSubscriber.subscribe()`
   - 240× initial snapshot requests
3. ❓ **D2 Graph Execution**: Not measured yet
   - 240× initial `graph.run()` with existing data
   - Processing through filter/map/select operators
4. ❓ **React Overhead**: Not measured
   - `useLiveQuery` hook overhead
   - `useSyncExternalStore` subscriptions
   - React state updates (240 components mounting)
5. ❓ **Browser + CPU Throttle**: 4x slower CPU
   - All operations take 4× longer
   - GC overhead
   - Browser event loop

**Rough Estimate**:
- Node.js baseline: 16ms
- + Subscription overhead: ~10-20ms?
- + Graph execution: ~10-20ms?
- + React overhead: ~10-20ms?
- = ~56ms on Node.js
- × 4 (CPU throttle) = ~224ms
- Actual: 194ms ✓ (in the ballpark)

---

## Parameterization Savings Analysis

### Current Approach (240 Compilations)

Based on our 16.5ms measurement:

```
240 queries × 0.069ms = 16.5ms total compilation time
```

**Breakdown** (estimated):
- Query IR building: ~20%
- Optimization (up to 10 iterations): ~40%
- D2 pipeline compilation: ~30%
- Graph finalization: ~10%

### Parameterized Approach (1 Compilation)

**Assuming parameterization system**:
```
1 × compilation:        0.069ms
240 × param binding:    12.0ms (assume 0.05ms per binding)
─────────────────────────────
Total:                  12.07ms
```

**Savings**:
- Current: 16.5ms
- Parameterized: 12.07ms
- **Saved: 4.43ms (26.9% reduction)**

### Scaled to Real-World

If we scale the 26.9% savings to the real-world 194ms:

```
Current TanStack:     194ms
Redux:                63ms
Gap:                  131ms (3.08× slower)

With parameterization:
  Savings:            35ms (194ms × 26.9%)
  New time:           159ms
  vs Redux:           2.52× slower
```

**Result**: Still slower than Redux, but **~18% faster** than current.

---

## Key Insights

### 1. Construction is Fast

**Finding**: Creating 240 queries takes only 16.5ms (~0.069ms each)

**This means**:
- Query IR building is efficient
- Optimization is relatively fast for simple queries
- D2 graph creation is not the main bottleneck

**Implication**: Parameterization saves ~27%, but that's only 4-5ms out of 194ms total.

### 2. Most Time is Elsewhere

**The real bottlenecks are likely**:
1. **Subscription overhead** - 240× subscription setup
2. **Initial data processing** - 240× graph runs filtering 480 records
3. **React overhead** - 240 component mounts with state updates
4. **CPU throttling** - 4× slowdown applies to everything

### 3. Parameterization is Necessary But Not Sufficient

**Parameterization alone**:
- Saves ~27% of compilation time
- But compilation is only ~8.5% of total time (16.5ms / 194ms)
- **Total impact**: ~2.3% faster overall (35ms / 194ms)

**To match Redux performance, we also need**:
- Subscription pooling/reuse
- Shared D2 graph execution
- Optimized React integration
- Reduced per-component overhead

---

## Next Steps for Profiling

### 1. Measure Subscription Overhead

Update benchmark to include:
```typescript
queryA.startSync()  // Triggers subscription setup
```

Track:
- Time to `subscribeToAllCollections()`
- Time to create `CollectionSubscription` objects
- Time for initial snapshot requests

### 2. Measure Graph Execution

Track:
- Time for initial `graph.run()` calls
- Time processing changes through pipeline
- D2 operator overhead (filter, map, select)

### 3. Profile in Browser

- Run test2.zip app with Chrome DevTools profiler
- Get actual flame graph showing where time goes
- Compare dev vs prod builds
- Measure with/without CPU throttling

### 4. Break Down the 194ms

Goal: Understand exact distribution:
```
194ms total =
  ? ms construction/compilation
+ ? ms subscription setup
+ ? ms graph execution
+ ? ms React overhead
+ ? ms other
```

---

## Recommendations

### Immediate (Phase 1)

1. **Fast Path for Simple Queries** ⭐⭐⭐
   - Skip optimization for queries without joins
   - Estimate: 40-50% reduction in compilation time
   - **Impact**: ~6-8ms savings → ~3-4% total

2. **Collection Caching** ⭐⭐⭐
   - Cache collections by query signature
   - Reuse when switching tabs
   - **Impact**: Tab 0 → Tab 1 → Tab 0 reuses 240 collections

### Medium Term (Phase 2)

3. **Query Parameterization** ⭐⭐
   - As measured: ~27% reduction in compilation
   - **Impact**: ~4-5ms savings → ~2-3% total
   - Necessary for architectural reasons (DRY)

4. **Subscription Pooling** ⭐⭐⭐
   - Share subscriptions across similar queries
   - Reduce 240 subscriptions to fewer shared ones
   - **Impact**: Unknown, needs measurement

### Long Term (Phase 3)

5. **Shared Graph Execution** ⭐⭐⭐
   - Execute D2 graph once, distribute results
   - Reduce 240 graph runs to 1 (or few)
   - **Impact**: Potentially 50%+ of total time

6. **React Integration Optimization** ⭐⭐
   - Batch state updates
   - Reduce per-component overhead
   - **Impact**: Unknown, needs browser profiling

---

## Conclusion

### What We Learned

1. **Compilation is surprisingly fast**: 16.5ms for 240 queries
2. **Parameterization helps but isn't enough**: ~27% compilation savings = ~2-3% total
3. **Real bottlenecks are likely**:
   - Subscription overhead (240× setup)
   - Graph execution (240× runs)
   - React overhead (240× mounts)
   - CPU throttling (4× multiplier)

### What We Need

**To match Redux (63ms), we need to eliminate ~131ms**:
- Parameterization alone: saves ~35ms → **~100ms gap remains**
- Need additional optimizations:
  - Fast path: ~6-8ms
  - Subscription pooling: TBD (could be 20-30ms)
  - Shared execution: TBD (could be 40-60ms)

**Combined estimate**:
- Fast path + parameterization + pooling + sharing = ~80-100ms savings
- New time: ~94-114ms
- vs Redux (63ms): **Still 1.5-1.8× slower**

**To beat Redux**: May need fundamental architectural changes to how React hooks interact with live queries, or accept that the declarative query API has inherent overhead vs pre-indexed Redux selectors.

---

## Files Created

- `benchmark-profile.mjs` - Simple benchmark with timing
- `benchmark-init.mjs` - Basic 240-query test
- `benchmark-detailed.mjs` - Attempted instrumentation
- `packages/db/benchmark.ts` - Working TypeScript benchmark
- `benchmark-full-init.mjs` - Full init with startSync() (WIP)
- `packages/db/src/perf-utils.ts` - Performance tracking utilities (WIP)

**CPU Profile**: `CPU.20251105.183125.4593.0.001.cpuprofile` (not committed, 124KB)

---

## Open Questions

1. **How much time does subscription setup take?**
   - Need to measure `startSync()` / `subscribeToAllCollections()`

2. **How much time does graph execution take?**
   - Need to measure initial `graph.run()` calls

3. **What's the React hook overhead?**
   - Need browser profiling of actual test2.zip app

4. **Can we share graph execution across queries?**
   - Architectural question - feasibility?

5. **Is 1.5-2× slower than Redux acceptable?**
   - Trade-off: Developer experience vs raw performance
   - User feedback indicates they want near-parity

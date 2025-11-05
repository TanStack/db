/**
 * Complete initialization benchmark including startSync()
 * Measures: construction + compilation + subscription + D2 graph execution
 *
 * This is what actually happens when useLiveQuery is called.
 */

import { performance } from 'perf_hooks';

const db = await import('./packages/db/dist/esm/index.js');
const { createCollection, localOnlyCollectionOptions, createLiveQueryCollection } = db;
const { and, eq } = db;

console.log('🔧 Setting up base collection...\n');

const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    getKey: item => item.id,
    sync: false,
  })
);

// Insert 480 orders
for (let gridId = 0; gridId < 24; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    orderCollection.insert({
      id: `${rowId}|a`,
      gridId,
      rowId,
      side: 'a',
      a: gridId + 1,
      b: (gridId + 1) * 10,
    });

    orderCollection.insert({
      id: `${rowId}|b`,
      gridId,
      rowId,
      side: 'b',
      a: gridId + 2,
      b: (gridId + 2) * 10,
    });
  }
}

console.log(`✓ Base collection: ${orderCollection.size} orders\n`);

console.log('='.repeat(70));
console.log('📊 FULL INITIALIZATION BENCHMARK');
console.log('  (construction + compilation + subscription + graph execution)');
console.log('='.repeat(70));
console.log('');

const queries = [];
const times = {
  construction: [],
  total: [],
};

const benchmarkStart = performance.now();

// Create 240 queries with startSync: true (like useLiveQuery does)
for (let gridId = 0; gridId < 12; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    // Query A
    const startA = performance.now();
    const queryA = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: orderCollection })
          .where(({ item }) => and(
            eq(item.rowId, rowId),
            eq(item.side, 'a')
          )),
      startSync: true,  // ← This triggers full initialization
    });
    const timeA = performance.now() - startA;
    times.total.push(timeA);
    queries.push(queryA);

    // Query B
    const startB = performance.now();
    const queryB = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: orderCollection })
          .where(({ item }) => and(
            eq(item.rowId, rowId),
            eq(item.side, 'b')
          )),
      startSync: true,
    });
    const timeB = performance.now() - startB;
    times.total.push(timeB);
    queries.push(queryB);
  }
}

const totalTime = performance.now() - benchmarkStart;

// Calculate statistics
const calc = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    total: arr.reduce((a, b) => a + b, 0),
    avg: arr.reduce((a, b) => a + b, 0) / arr.length,
    min: Math.min(...arr),
    max: Math.max(...arr),
    median: sorted[Math.floor(arr.length / 2)],
    p95: sorted[Math.floor(arr.length * 0.95)],
  };
};

const stats = calc(times.total);

console.log('✓ COMPLETED\n');
console.log('─'.repeat(70));
console.log('RESULTS:');
console.log(`  Total time:         ${totalTime.toFixed(2)}ms`);
console.log(`  Queries:            240`);
console.log(`  Average per query:  ${stats.avg.toFixed(3)}ms`);
console.log(`  Median:             ${stats.median.toFixed(3)}ms`);
console.log(`  P95:                ${stats.p95.toFixed(3)}ms`);
console.log(`  Min:                ${stats.min.toFixed(3)}ms`);
console.log(`  Max:                ${stats.max.toFixed(3)}ms`);
console.log('');

console.log('─'.repeat(70));
console.log('WHAT THIS MEASURES:\n');
console.log('✅ QueryIR building');
console.log('✅ Query optimization (up to 10 iterations)');
console.log('✅ D2 pipeline compilation');
console.log('✅ D2 graph finalization');
console.log('✅ startSync() → syncFn() → subscribeToAllCollections()');
console.log('✅ Subscription setup (CollectionSubscriber.subscribe)');
console.log('✅ Initial snapshot request');
console.log('✅ Initial D2 graph run processing existing data');
console.log('✅ Change processing through filter operators');
console.log('');
console.log('❌ React hook overhead (useRef, useSyncExternalStore)');
console.log('❌ React rendering/state updates');
console.log('❌ Browser overhead');
console.log('');

console.log('='.repeat(70));
console.log('💡 ANALYSIS');
console.log('='.repeat(70));
console.log('');

// Compare to construction-only benchmark
const constructionOnlyTime = 16.5; // ms from previous benchmark
const syncOverhead = totalTime - constructionOnlyTime;

console.log('PHASE BREAKDOWN:');
console.log(`  Construction + compilation:  ${constructionOnlyTime.toFixed(2)}ms  (${(constructionOnlyTime / totalTime * 100).toFixed(1)}%)`);
console.log(`  Sync + subscription + graph: ${syncOverhead.toFixed(2)}ms  (${(syncOverhead / totalTime * 100).toFixed(1)}%)`);
console.log(`  ───────────────────────────────────────`);
console.log(`  Total:                       ${totalTime.toFixed(2)}ms`);
console.log('');

console.log('PER-QUERY COSTS:');
console.log(`  Construction + compilation:  ${(constructionOnlyTime / 240).toFixed(3)}ms`);
console.log(`  Sync + subscription + graph: ${(syncOverhead / 240).toFixed(3)}ms`);
console.log(`  Total per query:             ${stats.avg.toFixed(3)}ms`);
console.log('');

console.log('='.repeat(70));
console.log('💡 PARAMETERIZATION IMPACT');
console.log('='.repeat(70));
console.log('');

console.log('CURRENT (240 separate compilations):');
console.log(`  Total time:      ${totalTime.toFixed(2)}ms`);
console.log('');

const oneCompile = constructionOnlyTime / 240; // Time for 1 compilation
const bindTime = 0.05; // Estimated param binding time
const paramConstruction = oneCompile + (240 * bindTime);
const paramTotal = paramConstruction + syncOverhead;

console.log('WITH PARAMETERIZATION:');
console.log(`  1× compilation:           ${oneCompile.toFixed(2)}ms`);
console.log(`  240× param bindings:      ${(240 * bindTime).toFixed(2)}ms`);
console.log(`  Construction total:       ${paramConstruction.toFixed(2)}ms  (was ${constructionOnlyTime.toFixed(2)}ms)`);
console.log(`  Sync + sub + graph:       ${syncOverhead.toFixed(2)}ms  (unchanged)`);
console.log(`  ─────────────────────────────────────`);
console.log(`  Total:                    ${paramTotal.toFixed(2)}ms`);
console.log('');

const speedup = totalTime / paramTotal;
const saved = totalTime - paramTotal;
const pctSaved = (saved / totalTime * 100);

console.log(`  ⚡ Speedup:                 ${speedup.toFixed(2)}×`);
console.log(`  ⏱️  Time saved:              ${saved.toFixed(2)}ms`);
console.log(`  📉 Reduction:               ${pctSaved.toFixed(1)}%`);
console.log('');

console.log('='.repeat(70));
console.log('🌍 REAL-WORLD PROJECTION (test2.zip)');
console.log('='.repeat(70));
console.log('');

const realCurrent = 194; // ms
const realRedux = 63; // ms

console.log('Reported (prod build, 4x CPU throttle):');
console.log(`  TanStack:       ${realCurrent}ms`);
console.log(`  Redux:          ${realRedux}ms`);
console.log(`  Gap:            ${realCurrent - realRedux}ms  (${(realCurrent / realRedux).toFixed(2)}× slower)`);
console.log('');

// Scale factor accounts for:
// - CPU throttle (4×)
// - Browser overhead
// - React rendering
const scaleFactor = realCurrent / totalTime;
console.log(`Our benchmark:       ${totalTime.toFixed(2)}ms (Node.js, no throttle)`);
console.log(`Scale factor:        ${scaleFactor.toFixed(2)}×`);
console.log('');

const realSavings = saved * scaleFactor;
const realNew = realCurrent - realSavings;

console.log('With parameterization:');
console.log(`  Our speedup:         ${speedup.toFixed(2)}×`);
console.log(`  Scaled savings:      ${realSavings.toFixed(0)}ms`);
console.log(`  New time:            ${realNew.toFixed(0)}ms`);
console.log(`  vs Redux:            ${(realNew / realRedux).toFixed(2)}×`);
console.log('');

if (realNew < realRedux) {
  console.log('  🎉 Result:           FASTER than Redux!');
} else if (realNew < realRedux * 1.2) {
  console.log('  ✓  Result:           Competitive with Redux');
} else {
  const gapRemaining = realNew - realRedux;
  console.log(`  ⚠️  Result:           Still ${gapRemaining}ms slower than Redux`);
}
console.log('');

console.log('='.repeat(70));
console.log('🎯 KEY FINDINGS');
console.log('='.repeat(70));
console.log('');

console.log('1. SYNC/SUBSCRIPTION/GRAPH IS THE BOTTLENECK:');
console.log(`   - ${(syncOverhead / totalTime * 100).toFixed(0)}% of time is subscription + graph execution`);
console.log(`   - Only ${(constructionOnlyTime / totalTime * 100).toFixed(0)}% is construction/compilation`);
console.log('');

console.log('2. PARAMETERIZATION HELPS, BUT LIMITED:');
console.log(`   - Saves ${pctSaved.toFixed(0)}% of total time`);
console.log(`   - ~${realSavings.toFixed(0)}ms in real-world (scaled)`);
console.log(`   - Still ~${(realNew - realRedux).toFixed(0)}ms slower than Redux`);
console.log('');

console.log('3. TO CLOSE THE GAP:');
console.log('   Need to optimize:');
console.log('   • Subscription setup (240× → fewer shared subscriptions)');
console.log('   • D2 graph execution (240× runs → shared execution)');
console.log('   • React rendering overhead');
console.log('');

console.log('─'.repeat(70));
console.log('🔍 VERIFICATION\n');
console.log(`Queries created: ${queries.length}`);
console.log('First query data:', queries[0].syncedData);
console.log('First query status:', queries[0].status);
console.log('');

/**
 * Full live query initialization benchmark
 * Measures: construction + compilation + subscription + initial graph run
 * Assumes: Base collection data already loaded (in memory)
 */

import { performance } from 'perf_hooks';

const db = await import('./packages/db/dist/esm/index.js');
const reactDb = await import('./packages/react-db/dist/esm/index.js');
const { createCollection, localOnlyCollectionOptions } = db;
const { createLiveQueryCollection } = reactDb;
const { and, eq } = db;

console.log('🔧 Setting up base collection with data...\n');

const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    getKey: item => item.id,
    sync: false,
  })
);

// Insert 480 orders (base collection already has data)
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

console.log(`✓ Base collection ready: ${orderCollection.size} orders loaded\n`);

// Warmup
console.log('🏃 Warmup...');
const warmup = createLiveQueryCollection((q) =>
  q.from({ item: orderCollection })
    .where(({ item }) => and(eq(item.rowId, '0|0'), eq(item.side, 'a')))
);
warmup.startSync();
console.log('✓ Warmup complete\n');

console.log('='.repeat(70));
console.log('📊 FULL INITIALIZATION BENCHMARK');
console.log('  Measuring: construction + compilation + subscription + graph run');
console.log('  Pattern: 240 queries, same structure, different WHERE params');
console.log('='.repeat(70));
console.log('');

const queries = [];
const times = {
  construction: [],
  sync: [],
  total: [],
};

const benchmarkStart = performance.now();

// Create and initialize 240 queries
for (let gridId = 0; gridId < 12; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    // Query A
    const constructStartA = performance.now();
    const queryA = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'a')
        ))
    );
    const constructTimeA = performance.now() - constructStartA;
    times.construction.push(constructTimeA);

    const syncStartA = performance.now();
    queryA.startSync();  // ← This triggers subscription + initial graph run
    const syncTimeA = performance.now() - syncStartA;
    times.sync.push(syncTimeA);
    times.total.push(constructTimeA + syncTimeA);

    queries.push(queryA);

    // Query B
    const constructStartB = performance.now();
    const queryB = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'b')
        ))
    );
    const constructTimeB = performance.now() - constructStartB;
    times.construction.push(constructTimeB);

    const syncStartB = performance.now();
    queryB.startSync();
    const syncTimeB = performance.now() - syncStartB;
    times.sync.push(syncTimeB);
    times.total.push(constructTimeB + syncTimeB);

    queries.push(queryB);
  }
}

const totalTime = performance.now() - benchmarkStart;

// Calculate statistics
const calc = (arr) => ({
  total: arr.reduce((a, b) => a + b, 0),
  avg: arr.reduce((a, b) => a + b, 0) / arr.length,
  min: Math.min(...arr),
  max: Math.max(...arr),
  median: arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)],
});

const constructStats = calc(times.construction);
const syncStats = calc(times.sync);
const totalStats = calc(times.total);

console.log('✓ COMPLETED\n');
console.log('─'.repeat(70));
console.log('OVERALL TIMING:');
console.log(`  Total time:         ${totalTime.toFixed(2)}ms`);
console.log(`  Queries:            240`);
console.log(`  Average per query:  ${(totalTime / 240).toFixed(3)}ms`);
console.log('');

console.log('─'.repeat(70));
console.log('BREAKDOWN BY PHASE:\n');

console.log('1️⃣  CONSTRUCTION + COMPILATION:');
console.log(`    Total:    ${constructStats.total.toFixed(2)}ms (${(constructStats.total / totalTime * 100).toFixed(1)}%)`);
console.log(`    Average:  ${constructStats.avg.toFixed(3)}ms`);
console.log(`    Median:   ${constructStats.median.toFixed(3)}ms`);
console.log(`    Range:    ${constructStats.min.toFixed(3)}ms - ${constructStats.max.toFixed(3)}ms`);
console.log('');

console.log('2️⃣  SUBSCRIPTION + GRAPH RUN:');
console.log(`    Total:    ${syncStats.total.toFixed(2)}ms (${(syncStats.total / totalTime * 100).toFixed(1)}%)`);
console.log(`    Average:  ${syncStats.avg.toFixed(3)}ms`);
console.log(`    Median:   ${syncStats.median.toFixed(3)}ms`);
console.log(`    Range:    ${syncStats.min.toFixed(3)}ms - ${syncStats.max.toFixed(3)}ms`);
console.log('');

console.log('─'.repeat(70));
console.log('💡 PARAMETERIZATION SAVINGS ESTIMATE\n');

console.log('CURRENT (240 separate compilations):');
console.log(`  Construction:  ${constructStats.total.toFixed(2)}ms`);
console.log(`  Subscription:  ${syncStats.total.toFixed(2)}ms`);
console.log(`  ────────────────────────────`);
console.log(`  Total:         ${totalTime.toFixed(2)}ms`);
console.log('');

console.log('PARAMETERIZED (1 compilation, 240 parameter bindings):');
const oneCompile = constructStats.avg;  // Time for 1 compilation
const bindTime = 0.05;  // Estimated parameter binding time
const paramConstructTime = oneCompile + (240 * bindTime);
const paramTotalTime = paramConstructTime + syncStats.total;

console.log(`  1× compile:       ${oneCompile.toFixed(2)}ms`);
console.log(`  240× bindings:    ${(240 * bindTime).toFixed(2)}ms`);
console.log(`  Construction:     ${paramConstructTime.toFixed(2)}ms`);
console.log(`  Subscription:     ${syncStats.total.toFixed(2)}ms (unchanged)`);
console.log(`  ────────────────────────────`);
console.log(`  Total:            ${paramTotalTime.toFixed(2)}ms`);
console.log('');

const speedup = totalTime / paramTotalTime;
const timeSaved = totalTime - paramTotalTime;
const percentSaved = (timeSaved / totalTime * 100);

console.log(`  ⚡ Speedup:        ${speedup.toFixed(2)}×`);
console.log(`  ⏱️  Time saved:     ${timeSaved.toFixed(2)}ms`);
console.log(`  📉 Reduction:      ${percentSaved.toFixed(1)}%`);
console.log('');

// Real-world projection
console.log('='.repeat(70));
console.log('🌍 REAL-WORLD IMPACT (test2.zip benchmark)');
console.log('='.repeat(70));
console.log('');

const realWorldCurrent = 194;  // ms from test2.zip
const realWorldRedux = 63;     // ms from test2.zip

console.log('Reported (prod build, 4x CPU throttle):');
console.log(`  TanStack:    ${realWorldCurrent}ms`);
console.log(`  Redux:       ${realWorldRedux}ms`);
console.log(`  Gap:         ${realWorldCurrent - realWorldRedux}ms (${(realWorldCurrent / realWorldRedux).toFixed(2)}× slower)`);
console.log('');

// Scale our savings to real-world
const scaleFactor = realWorldCurrent / totalTime;
const realWorldSavings = timeSaved * scaleFactor;
const realWorldNewTime = realWorldCurrent - realWorldSavings;

console.log('With parameterization:');
console.log(`  Our speedup:     ${speedup.toFixed(2)}×`);
console.log(`  Scaled savings:  ${realWorldSavings.toFixed(0)}ms`);
console.log(`  New time:        ${realWorldNewTime.toFixed(0)}ms`);
console.log(`  vs Redux:        ${(realWorldNewTime / realWorldRedux).toFixed(2)}×`);

if (realWorldNewTime < realWorldRedux) {
  console.log(`  🎉 Result:       FASTER than Redux!`);
} else if (realWorldNewTime < realWorldRedux * 1.2) {
  console.log(`  ✓  Result:       Competitive with Redux`);
} else {
  console.log(`  ⚠️  Result:       Still slower than Redux`);
}
console.log('');

// Verification
console.log('─'.repeat(70));
console.log('🔍 VERIFICATION\n');
console.log(`Created queries: ${queries.length}`);
console.log(`First query data:`, queries[0].syncedData);
console.log('');

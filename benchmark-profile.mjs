/**
 * Simple benchmark to profile live query initialization
 * Run with: node --cpu-prof benchmark-profile.mjs
 * Then analyze with: node --prof-process isolate-*-v8.log
 */

import { performance } from 'perf_hooks';

// Import library from built dist files
const db = await import('./packages/db/dist/esm/index.js');
const reactDb = await import('./packages/react-db/dist/esm/index.js');
const { createCollection, localOnlyCollectionOptions } = db;
const { createLiveQueryCollection } = reactDb;
const { and, eq } = db;

console.log('Setting up test collection...');

const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    getKey: item => item.id,
    sync: false,
  })
);

// Insert 480 orders (24 grids × 10 rows × 2 sides)
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

console.log(`Inserted ${orderCollection.size} orders\n`);

// Warmup: create one query to initialize any lazy state
console.log('Warmup...');
const warmup = createLiveQueryCollection((q) =>
  q.from({ item: orderCollection })
    .where(({ item }) => and(eq(item.rowId, '0|0'), eq(item.side, 'a')))
);
console.log('Warmup complete\n');

// Now run the actual benchmark
console.log('='.repeat(70));
console.log('BENCHMARK: Creating 240 live queries');
console.log('Pattern: Same query structure, different parameters');
console.log('='.repeat(70));
console.log('');

const queries = [];
const individualTimes = [];

// Create 240 queries (12 grids × 10 rows × 2 sides = 240)
const benchmarkStart = performance.now();

for (let gridId = 0; gridId < 12; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    // Side A
    const startA = performance.now();
    const queryA = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'a')
        ))
    );
    individualTimes.push(performance.now() - startA);
    queries.push(queryA);

    // Side B
    const startB = performance.now();
    const queryB = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'b')
        ))
    );
    individualTimes.push(performance.now() - startB);
    queries.push(queryB);
  }
}

const totalTime = performance.now() - benchmarkStart;

// Calculate statistics
const avgTime = totalTime / 240;
const minTime = Math.min(...individualTimes);
const maxTime = Math.max(...individualTimes);
const medianTime = individualTimes.sort((a, b) => a - b)[120];

console.log('\n📊 RESULTS:\n');
console.log(`Total time:    ${totalTime.toFixed(2)}ms`);
console.log(`Queries:       240`);
console.log(`Average:       ${avgTime.toFixed(3)}ms per query`);
console.log(`Median:        ${medianTime.toFixed(3)}ms`);
console.log(`Min:           ${minTime.toFixed(3)}ms`);
console.log(`Max:           ${maxTime.toFixed(3)}ms`);
console.log('');

// Estimate parameterization savings
console.log('='.repeat(70));
console.log('💡 PARAMETERIZATION IMPACT ESTIMATE');
console.log('='.repeat(70));
console.log('');

console.log('CURRENT APPROACH (240 separate compilations):');
console.log(`  240 queries × ${avgTime.toFixed(2)}ms = ${totalTime.toFixed(2)}ms total`);
console.log('');

console.log('PARAMETERIZED APPROACH (1 compilation + parameter binding):');
console.log(`  Assumptions:`);
console.log(`    - 1× compilation time: ${avgTime.toFixed(2)}ms`);
console.log(`    - Parameter binding: ~0.05ms per query (optimistic estimate)`);
console.log('');

const paramCompileTime = avgTime;
const paramBindTime = 0.05;
const paramTotalTime = paramCompileTime + (240 * paramBindTime);

console.log(`  1× compilation:         ${paramCompileTime.toFixed(2)}ms`);
console.log(`  240× param binding:     ${(240 * paramBindTime).toFixed(2)}ms`);
console.log(`  ─────────────────────────────────`);
console.log(`  Total:                  ${paramTotalTime.toFixed(2)}ms`);
console.log('');

const speedup = totalTime / paramTotalTime;
const timeSaved = totalTime - paramTotalTime;
const percentSaved = (timeSaved / totalTime * 100);

console.log(`  ⚡ Speedup:              ${speedup.toFixed(1)}×`);
console.log(`  ⏱️  Time saved:           ${timeSaved.toFixed(2)}ms`);
console.log(`  📉 Reduction:            ${percentSaved.toFixed(1)}%`);
console.log('');

// Scale to real-world numbers
console.log('='.repeat(70));
console.log('🌍 REAL-WORLD IMPACT (from test2.zip benchmark)');
console.log('='.repeat(70));
console.log('');
console.log('Test app reported (prod build, 4x CPU throttle):');
console.log('  Current TanStack:  194ms avg tab switch');
console.log('  Redux:             63ms avg tab switch');
console.log('  Difference:        131ms (3.08× slower)');
console.log('');
console.log('With parameterization:');
const realWorldSavings = 131 * (percentSaved / 100);
const newTanStackTime = 194 - realWorldSavings;
console.log(`  Estimated savings: ${realWorldSavings.toFixed(0)}ms`);
console.log(`  New TanStack time: ${newTanStackTime.toFixed(0)}ms`);
console.log(`  vs Redux:          ${(newTanStackTime / 63).toFixed(2)}× `);
if (newTanStackTime < 63) {
  console.log(`  Result:            FASTER than Redux! 🎉`);
} else if (newTanStackTime < 80) {
  console.log(`  Result:            Competitive with Redux ✓`);
} else {
  console.log(`  Result:            Still slower than Redux`);
}
console.log('');

// Verify
console.log('✓ First query result:', queries[0].syncedData);
console.log(`✓ Created ${queries.length} queries successfully`);
console.log('');

console.log('TIP: Run with `node --cpu-prof benchmark-profile.mjs` for detailed profiling');
console.log('     Then: node --prof-process isolate-*-v8.log > profile.txt');

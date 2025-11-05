/**
 * Benchmark script to measure live query initialization performance
 * Simulates the pattern from test2.zip: 240 queries with different parameters
 */

import { createCollection, localOnlyCollectionOptions } from '@tanstack/react-db';
import { createLiveQueryCollection, and, eq } from '@tanstack/react-db';

// Enable performance tracking
global.__TANSTACK_DB_PERF__ = true;

// Create the base collection with sample data
const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    getKey: item => item.id,
    sync: false,
  })
);

// Insert sample data (480 orders like in test app)
console.log('Setting up test data...');
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

// Simulate tab switch: create 240 queries with different parameters
console.log('='.repeat(60));
console.log('BENCHMARK: Creating 240 live queries (simulating tab switch)');
console.log('='.repeat(60));

const queries = [];
const startTotal = performance.now();

// Create 240 queries like in the real app
for (let gridId = 0; gridId < 12; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    // Side 'a'
    const queryA = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'a')
        ))
    );
    queries.push(queryA);

    // Side 'b'
    const queryB = createLiveQueryCollection((q) =>
      q.from({ item: orderCollection })
        .where(({ item }) => and(
          eq(item.rowId, rowId),
          eq(item.side, 'b')
        ))
    );
    queries.push(queryB);
  }
}

const totalTime = performance.now() - startTotal;

console.log('\n' + '='.repeat(60));
console.log(`TOTAL TIME: ${totalTime.toFixed(2)}ms for 240 queries`);
console.log(`AVERAGE PER QUERY: ${(totalTime / 240).toFixed(2)}ms`);
console.log('='.repeat(60));

// Print aggregate statistics if collected
if (global.__TANSTACK_DB_STATS__) {
  console.log('\n📊 AGGREGATE STATISTICS (240 queries):\n');
  const stats = global.__TANSTACK_DB_STATS__;

  Object.entries(stats).sort((a, b) => b[1].total - a[1].total).forEach(([phase, data]) => {
    const avg = data.total / data.count;
    const pct = (data.total / totalTime * 100);
    console.log(`${phase.padEnd(35)} ${data.total.toFixed(2)}ms  (${pct.toFixed(1)}%)  avg: ${avg.toFixed(2)}ms × ${data.count}`);
  });

  console.log('\n');
}

// Verify queries work
console.log('\n🔍 VERIFICATION (first query):');
console.log('Query result:', queries[0].syncedData);

process.exit(0);

/**
 * Detailed performance benchmark for live query initialization
 * Measures where CPU time is spent by instrumenting key functions
 */

import { performance } from 'perf_hooks';
import Module from 'module';

// Performance tracking
const timings = {};
function trackPhase(name, fn) {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  if (!timings[name]) {
    timings[name] = { total: 0, count: 0, times: [] };
  }
  timings[name].total += duration;
  timings[name].count++;
  timings[name].times.push(duration);

  return result;
}

// Hook into module loading to instrument the library
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);

  // Instrument CollectionConfigBuilder
  if (id.includes('collection-config-builder')) {
    const original = module.CollectionConfigBuilder;
    if (original) {
      module.CollectionConfigBuilder = class extends original {
        constructor(config) {
          trackPhase('00-CollectionConfigBuilder.constructor', () => {
            trackPhase('01-buildQueryFromConfig', () => {
              super.query = super.constructor.prototype.buildQueryFromConfig?.call(this, config) || null;
            });
          });
          super(config);
        }
      };
    }
  }

  return module;
};

// Now import the library
const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/react-db');
const { createLiveQueryCollection, and, eq } = await import('@tanstack/react-db');

console.log('Creating base collection...');
const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    getKey: item => item.id,
    sync: false,
  })
);

// Insert test data
console.log('Inserting 480 orders...');
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

console.log(`\n${'='.repeat(70)}`);
console.log('BENCHMARK: Creating 240 live queries (real-world pattern)');
console.log('='.repeat(70));

const queries = [];
const startTotal = performance.now();

// Create 240 queries with different parameters
for (let gridId = 0; gridId < 12; gridId++) {
  for (let rowIndex = 0; rowIndex < 10; rowIndex++) {
    const rowId = `${gridId}|${rowIndex}`;

    // Query for side 'a'
    const queryA = trackPhase('TOTAL-createLiveQueryCollection', () =>
      createLiveQueryCollection((q) =>
        q.from({ item: orderCollection })
          .where(({ item }) => and(
            eq(item.rowId, rowId),
            eq(item.side, 'a')
          ))
      )
    );
    queries.push(queryA);

    // Query for side 'b'
    const queryB = trackPhase('TOTAL-createLiveQueryCollection', () =>
      createLiveQueryCollection((q) =>
        q.from({ item: orderCollection })
          .where(({ item }) => and(
            eq(item.rowId, rowId),
            eq(item.side, 'b')
          ))
      )
    );
    queries.push(queryB);
  }
}

const totalTime = performance.now() - startTotal;

console.log(`\n${'='.repeat(70)}`);
console.log(`✓ Created 240 queries in ${totalTime.toFixed(2)}ms`);
console.log(`  Average: ${(totalTime / 240).toFixed(2)}ms per query`);
console.log('='.repeat(70));

// Print detailed timing breakdown
console.log('\n📊 PERFORMANCE BREAKDOWN:\n');

const sortedPhases = Object.entries(timings).sort((a, b) => b[1].total - a[1].total);

sortedPhases.forEach(([phase, data]) => {
  const avg = data.total / data.count;
  const pct = (data.total / totalTime * 100);
  const min = Math.min(...data.times);
  const max = Math.max(...data.times);

  console.log(`${phase.padEnd(40)}`);
  console.log(`  Total: ${data.total.toFixed(2)}ms (${pct.toFixed(1)}%)`);
  console.log(`  Calls: ${data.count}×`);
  console.log(`  Avg:   ${avg.toFixed(2)}ms`);
  console.log(`  Range: ${min.toFixed(2)}ms - ${max.toFixed(2)}ms`);
  console.log('');
});

// Calculate potential savings with parameterization
console.log('\n💡 PARAMETERIZATION SAVINGS ESTIMATE:\n');
console.log('Current approach:');
console.log(`  240 queries × ${(totalTime / 240).toFixed(2)}ms = ${totalTime.toFixed(2)}ms`);
console.log('');
console.log('With parameterization (1 compilation + 240 parameter bindings):');
const estimatedCompileTime = totalTime / 240; // Time for 1 query
const estimatedBindTime = 0.1; // Assume parameter binding is ~0.1ms
const parameterizedTime = estimatedCompileTime + (240 * estimatedBindTime);
console.log(`  1 compilation: ${estimatedCompileTime.toFixed(2)}ms`);
console.log(`  240 bindings × 0.1ms: ${(240 * estimatedBindTime).toFixed(2)}ms`);
console.log(`  Total: ${parameterizedTime.toFixed(2)}ms`);
console.log('');
console.log(`  Speedup: ${(totalTime / parameterizedTime).toFixed(1)}×`);
console.log(`  Time saved: ${(totalTime - parameterizedTime).toFixed(2)}ms (${((1 - parameterizedTime / totalTime) * 100).toFixed(1)}%)`);

// Verify queries work
console.log('\n🔍 VERIFICATION:\n');
console.log('First query data:', queries[0].syncedData);
console.log('Number of successful queries:', queries.length);

process.exit(0);

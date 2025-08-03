# Property-Based Testing Framework for TanStack DB

This directory contains a comprehensive property-based testing framework for the TanStack DB query engine, implementing the RFC for robust, unbiased correctness testing.

## Overview

The framework uses [fast-check](https://github.com/dubzzz/fast-check) to generate random test cases and SQLite (via better-sqlite3) as an oracle to verify TanStack DB's behavior. It tests the following key properties:

1. **Snapshot equality** - Every active query's materialized TanStack result equals the oracle's SELECT
2. **Incremental convergence** - Re-running a fresh TanStack query yields exactly the patch-built snapshot
3. **Optimistic transaction visibility** - Queries inside staged transactions see uncommitted writes; after ROLLBACK they vanish; after COMMIT they persist
4. **Row-count sanity** - COUNT(*) per collection/table stays in lock-step

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Generators    │    │   SQL Oracle    │    │   Test Harness  │
│                 │    │                 │    │                 │
│ • Schema        │    │ • SQLite DB     │    │ • fast-check    │
│ • Rows          │    │ • Savepoints    │    │ • Invariants    │
│ • Mutations     │    │ • Transactions  │    │ • Shrinking     │
│ • Queries       │    │ • CRUD ops      │    │ • Reporting     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Utilities     │
                    │                 │
                    │ • AST→SQL       │
                    │ • Normalizer    │
                    │ • Incremental   │
                    │   Checker       │
                    └─────────────────┘
```

## Key Components

### 1. Generators (`generators/`)

- **Schema Generator**: Creates random, type-correct schemas with 1-4 tables, 2-8 columns each
- **Row Generator**: Produces well-typed data objects for each table
- **Mutation Generator**: Creates insert, update, delete operations with realistic data flow
- **Query Generator**: Builds valid TanStack ASTs with joins, predicates, aggregates, ordering

### 2. SQL Oracle (`sql/`)

- **SQLiteOracle**: Mirrors TanStack DB's visibility rules using savepoints
- **AST to SQL**: Converts TanStack ASTs to parameterized SQLite SQL
- **Transaction Support**: SAVEPOINT/ROLLBACK/RELEASE for optimistic transaction testing

### 3. Utilities (`utils/`)

- **ValueNormalizer**: Aligns JS and SQLite value representations for comparison
- **IncrementalChecker**: Applies TanStack patches and compares with oracle snapshots

### 4. Test Harness (`harness/`)

- **PropertyTestHarness**: Main orchestrator using fast-check's model/command API
- **Regression Testing**: Saves and replays failing test cases
- **Configuration**: Tunable limits for tables, rows, commands, queries

## Usage

### Basic Property Test

```typescript
import { runPropertyTest } from './harness/property-test-harness'

// Run a single property test
const result = await runPropertyTest({
  maxTables: 2,
  maxColumns: 4,
  maxRowsPerTable: 100,
  maxCommands: 20
})

if (!result.success) {
  console.error('Test failed with seed:', result.seed)
  console.error('Failing commands:', result.failingCommands)
}
```

### Quick Test Suite

```typescript
import { runQuickTestSuite } from './harness/property-test-harness'

// Run 10 property tests
const suite = await runQuickTestSuite({
  maxTables: 2,
  maxColumns: 4,
  maxRowsPerTable: 50,
  maxCommands: 10
})

console.log(`Passed: ${suite.passedTests}, Failed: ${suite.failedTests}`)
```

### Custom Test Harness

```typescript
import { PropertyTestHarness } from './harness/property-test-harness'

const harness = new PropertyTestHarness({
  maxTables: 3,
  maxColumns: 6,
  maxRowsPerTable: 200,
  maxCommands: 30,
  maxQueries: 5,
  floatTolerance: 1e-12
})

// Run with specific seed for reproducibility
const result = await harness.runPropertyTest(12345)

// Run regression test from saved fixture
const fixture = {
  schema: /* ... */,
  commands: /* ... */,
  seed: 12345
}
const regressionResult = await harness.runRegressionTest(fixture)
```

## Configuration

The framework supports extensive configuration via `GeneratorConfig`:

```typescript
interface GeneratorConfig {
  maxTables: number        // 1-4 tables per test
  maxColumns: number       // 2-8 columns per table
  maxRowsPerTable: number  // 0-2000 rows per table
  maxCommands: number      // 1-40 commands per test
  maxQueries: number       // 0-10 queries per test
  floatTolerance: number   // 1e-12 for float comparisons
}
```

Default configuration:
```typescript
const DEFAULT_CONFIG: GeneratorConfig = {
  maxTables: 4,
  maxColumns: 8,
  maxRowsPerTable: 2000,
  maxCommands: 40,
  maxQueries: 10,
  floatTolerance: 1e-12
}
```

## Data Types

The framework supports these TanStack DB types with SQLite mappings:

| TanStack Type | SQLite Mapping | Normalization Strategy |
|---------------|----------------|----------------------|
| `number` | `REAL` | Safe 53-bit ints & finite doubles; tolerance for aggregates |
| `string` | `TEXT` | ASCII-only generators; byte-wise sort |
| `boolean` | `INTEGER 0/1` | Map 0→false, 1→true |
| `null` | `NULL` | Direct match |
| `object`/`array` | `TEXT` via `json(?)` | Compare parsed JSON objects |

## Test Properties

### 1. Snapshot Equality

Every active query's materialized TanStack result equals the oracle's SELECT:

```typescript
// After each mutation, compare:
const tanstackResult = query.getSnapshot()
const sqliteResult = oracle.query(sql, params)
expect(normalizer.compareRowSets(tanstackResult, sqliteResult).equal).toBe(true)
```

### 2. Incremental Convergence

Re-running a fresh TanStack query yields exactly the patch-built snapshot:

```typescript
// Build snapshot incrementally via patches
const incrementalSnapshot = applyPatches(initialSnapshot, patches)

// Compare with fresh query
const freshSnapshot = freshQuery.getSnapshot()
expect(normalizer.compareRowSets(incrementalSnapshot, freshSnapshot).equal).toBe(true)
```

### 3. Optimistic Transaction Visibility

Queries inside staged transactions see uncommitted writes:

```typescript
// Begin transaction
oracle.beginTransaction() // Creates SAVEPOINT

// Insert in transaction
tanstackCollection.insert(data)
oracle.insert(table, data)

// Query should see uncommitted data
const inTransactionResult = query.getSnapshot()
expect(inTransactionResult).toContain(data)

// Rollback transaction
oracle.rollbackTransaction() // ROLLBACK TO SAVEPOINT

// Query should not see rolled back data
const afterRollbackResult = query.getSnapshot()
expect(afterRollbackResult).not.toContain(data)
```

### 4. Row-Count Sanity

COUNT(*) per collection/table stays in lock-step:

```typescript
// After each mutation, verify:
const tanstackCount = collection.state.size
const sqliteCount = oracle.getRowCount(tableName)
expect(tanstackCount).toBe(sqliteCount)
```

## Reproducibility

When a test fails, the framework provides:

1. **Seed**: For deterministic replay
2. **Command Count**: Where the failure occurred
3. **Shrunk Example**: Minimal failing command sequence
4. **Regression Fixture**: Complete test case for debugging

```typescript
// Replay a failing test
const result = await runPropertyTest(config, failingSeed)

// Or run a specific test case
const fixture = {
  schema: /* ... */,
  commands: /* ... */,
  seed: 12345
}
await harness.runRegressionTest(fixture)
```

## Running Tests

### Unit Tests

```bash
# Run property testing unit tests
npm test -- property-tests.test.ts

# Run with coverage
npm test -- --coverage property-tests.test.ts
```

### Property Tests

```bash
# Run quick property test suite
npm run test:property:quick

# Run comprehensive property test suite
npm run test:property:full

# Run with specific configuration
npm run test:property:custom -- --maxTables=2 --maxCommands=20
```

### CI Integration

The framework is designed for CI with:

- **Resource caps**: ≤2000 rows/table, ≤40 commands
- **Runtime limits**: ≤5 minutes per property run
- **Memory limits**: <2GB RAM
- **Deterministic seeds**: For reproducible failures

## Extension Points

### Adding New Generators

```typescript
// Create a new generator
export function generateCustomData(config: GeneratorConfig): fc.Arbitrary<CustomData> {
  return fc.record({
    field1: fc.string(),
    field2: fc.number()
  })
}

// Integrate with test harness
const commandsArb = fc.oneof(
  generateMutationCommand(schema),
  generateCustomCommand(schema) // Your new generator
)
```

### Adding New Invariants

```typescript
// Add to IncrementalChecker
async checkCustomInvariant(): Promise<{
  success: boolean
  error?: Error
  details?: string
}> {
  // Your custom invariant check
  return { success: true }
}

// Integrate with test harness
const customCheck = await checker.checkCustomInvariant()
if (!customCheck.success) {
  return false
}
```

### Adding New SQL Functions

```typescript
// Extend AST to SQL translator
function buildFunction(expr: Func, params: any[], paramIndex: number): string {
  switch (expr.name) {
    case 'customFunc':
      return `CUSTOM_FUNC(${args.join(', ')})`
    // ... existing cases
  }
}
```

## Troubleshooting

### Common Issues

1. **Memory Usage**: Reduce `maxRowsPerTable` or `maxCommands`
2. **Test Timeout**: Reduce configuration limits or increase timeout
3. **SQLite Errors**: Check schema compatibility and data types
4. **Normalization Issues**: Verify float tolerance and type mappings

### Debug Mode

Enable verbose logging:

```typescript
const harness = new PropertyTestHarness({
  ...config,
  verbose: true
})
```

### Regression Testing

Save failing test cases:

```typescript
if (!result.success) {
  const fixture = harness.createTestFixture(schema, commands, seed)
  // Save fixture to file for later analysis
}
```

## Contributing

When extending the framework:

1. **Add tests** for new generators and utilities
2. **Update documentation** for new features
3. **Maintain compatibility** with existing test cases
4. **Follow patterns** established in existing code
5. **Add type safety** for all new interfaces

## References

- [RFC - Property-Based Testing for TanStack DB](./RFC.md)
- [fast-check Documentation](https://github.com/dubzzz/fast-check)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [TanStack DB Documentation](https://tanstack.com/db)
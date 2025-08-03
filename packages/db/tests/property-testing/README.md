# Property-Based Testing for TanStack DB Query Engine

This directory contains a comprehensive property-based testing framework for validating the correctness of TanStack DB's query engine against SQLite as an oracle.

## Overview

Property-based testing (PBT) uses randomly generated inputs to verify that system properties hold true across a wide range of scenarios. This framework generates random schemas, data, and queries to ensure TanStack DB produces results that match SQLite's output.

## Architecture

### Core Components

#### 1. **Generators** (`generators/`)
- **`schema-generator.ts`**: Generates random database schemas with tables, columns, and relationships
- **`row-generator.ts`**: Creates test data that conforms to the generated schemas
- **`query-generator.ts`**: Generates random SQL queries using TanStack DB's query builder
- **`mutation-generator.ts`**: Creates random insert, update, and delete operations

#### 2. **SQL Translation** (`sql/`)
- **`ast-to-sql.ts`**: Converts TanStack DB's Intermediate Representation (IR) to SQLite SQL
- **`sqlite-oracle.ts`**: Provides a real SQLite database instance for comparison

#### 3. **Test Harness** (`harness/`)
- **`property-test-harness.ts`**: Main orchestrator that runs test sequences and validates properties

#### 4. **Utilities** (`utils/`)
- **`incremental-checker.ts`**: Validates invariants and compares TanStack DB vs SQLite results
- **`normalizer.ts`**: Normalizes data for comparison (handles type differences, ordering, etc.)
- **`functional-to-structural.ts`**: Converts functional expressions to structural IR

### Test Types

#### 1. **Property-Based Tests** (`property-based-tests.test.ts`)
Tests the core properties that must hold true for the query engine:

- **Property 1: Snapshot Equality**: TanStack DB results match SQLite oracle
- **Property 2: Incremental Convergence**: Query results remain consistent under mutations
- **Property 3: Optimistic Transaction Visibility**: Transaction state is properly managed
- **Property 4: Row Count Sanity**: Row counts are consistent between systems
- **Property 5: Query Feature Coverage**: All query features work correctly
- **Property 6: Data Type Handling**: All data types are handled properly
- **Property 7: Error Handling**: Edge cases are handled gracefully

#### 2. **Quick Test Suite** (`quick-test-suite.test.ts`)
Rapid validation tests for the PBT framework itself:

- Schema generation validation
- Row generation validation
- Query generation validation
- SQL translation validation
- Basic property validation

#### 3. **Comprehensive SQL Coverage** (`comprehensive-sql-coverage.test.ts`)
Systematic testing of SQL translation capabilities:

- All comparison operators (`eq`, `gt`, `gte`, `lt`, `lte`, `in`, `like`, `ilike`)
- Logical operators (`and`, `or`, `not`)
- Functions (`upper`, `lower`, `length`, `concat`, `coalesce`, `add`)
- Aggregates (`count`, `avg`, `sum`, `min`, `max`)
- `DISTINCT` queries
- Subqueries in `FROM` clauses
- `ORDER BY`, `GROUP BY`, `LIMIT`, `OFFSET`

#### 4. **Framework Unit Tests** (`framework-unit-tests.test.ts`)
Unit tests for individual PBT components:

- Generator validation
- SQL translation validation
- Normalizer validation
- Oracle validation

#### 5. **Integration Tests**
- **`tanstack-sqlite-comparison.test.ts`**: Direct comparison of TanStack DB vs SQLite
- **`query-builder-ir-extraction.test.ts`**: Tests IR extraction from query builder
- **`ir-to-sql-translation.test.ts`**: Tests IR to SQL translation

## How It Works

### 1. **Test Sequence Generation**
```typescript
// Generate a random schema
const schema = generateSchema(config)

// Generate test data
const rows = generateRowsForTable(table, config)

// Generate test commands (mutations + queries)
const commands = generateCompleteTestSequence(schema, config)
```

### 2. **Test Execution**
```typescript
// Initialize test state
const state = {
  schema,
  collections: new Map(), // TanStack DB collections
  sqliteDb: new SQLiteOracle(), // SQLite oracle
  activeQueries: new Map(),
  // ...
}

// Execute commands
for (const command of commands) {
  await checker.executeCommand(command)
}
```

### 3. **Property Validation**
```typescript
// Check snapshot equality
const snapshotCheck = await checker.checkSnapshotEquality()

// Check incremental convergence
const convergenceCheck = await checker.checkIncrementalConvergence()

// Check transaction visibility
const visibilityCheck = await checker.checkOptimisticVisibility()

// Check row count sanity
const rowCountCheck = await checker.checkRowCountSanity()
```

### 4. **Result Comparison**
```typescript
// Compare TanStack DB vs SQLite results
const comparison = normalizer.compareRowSets(tanstackResult, sqliteResult)

// Handle ordering differences
if (hasOrderBy) {
  // Results must match exactly including order
  expect(comparison.equal).toBe(true)
} else {
  // Results can be in different order
  const sortedComparison = normalizer.compareRowSets(
    sortedTanstack, sortedSqlite
  )
  expect(sortedComparison.equal).toBe(true)
}
```

## Key Features

### **Real SQLite Oracle**
Uses `better-sqlite3` for deterministic comparison against TanStack DB's results.

### **Comprehensive SQL Translation**
Converts TanStack DB's IR to SQLite-compatible SQL, supporting:
- All comparison operators
- Logical operators
- Functions and aggregates
- Subqueries and joins
- Ordering and grouping

### **Robust Data Normalization**
Handles type differences, ordering, and edge cases:
- Number precision differences
- Boolean vs integer representations
- Object/array serialization
- Null handling

### **Error Handling**
Gracefully handles expected failures:
- Non-existent rows/columns
- Invalid SQL syntax
- Schema generation edge cases

### **Reproducibility**
- Deterministic seeds for reproducible failures
- Detailed error reporting with failing command sequences
- Regression test fixtures

## Running Tests

### Quick Tests
```bash
pnpm test:property:quick
```

### Full Property Tests
```bash
pnpm test:property
```

### Coverage Report
```bash
pnpm test:property:coverage
```

### Example Usage
```bash
pnpm test:property:example
```

## Configuration

The framework is configurable via `GeneratorConfig`:

```typescript
interface GeneratorConfig {
  maxTables: number        // Maximum tables per schema
  maxColumns: number       // Maximum columns per table
  minRows?: number         // Minimum rows per table
  maxRows?: number         // Maximum rows per table
  maxRowsPerTable: number  // Maximum rows per table
  minCommands?: number     // Minimum commands per test
  maxCommands: number      // Maximum commands per test
  maxQueries: number       // Maximum queries per test
  floatTolerance: number   // Float comparison tolerance
}
```

## Validation Properties

### **Snapshot Equality**
Ensures that TanStack DB query results exactly match SQLite oracle results.

### **Incremental Convergence**
Verifies that query results remain consistent as the database state changes through mutations.

### **Optimistic Transaction Visibility**
Validates that transaction state is properly managed and visible to queries.

### **Row Count Sanity**
Confirms that row counts are consistent between TanStack DB and SQLite across all tables.

### **Query Feature Coverage**
Tests that all query features (WHERE, JOIN, ORDER BY, etc.) work correctly.

### **Data Type Handling**
Ensures all data types (strings, numbers, booleans, objects, arrays) are handled properly.

### **Error Handling**
Validates that edge cases and error conditions are handled gracefully.

## Benefits

1. **Comprehensive Coverage**: Tests a wide range of scenarios through random generation
2. **Oracle Validation**: Uses SQLite as a trusted reference implementation
3. **Regression Detection**: Catches regressions through reproducible test sequences
4. **Edge Case Discovery**: Finds edge cases that manual testing might miss
5. **Confidence Building**: Provides confidence in query engine correctness

## Future Enhancements

- **Performance Testing**: Add performance property validation
- **Concurrency Testing**: Test concurrent query execution
- **Migration Testing**: Validate schema migration scenarios
- **Integration Testing**: Test with real application scenarios
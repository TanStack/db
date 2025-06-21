# Query2 Compiler

This directory contains the new compiler for the query2 system that translates the intermediate representation (IR) into D2 pipeline operations.

## Architecture

The compiler consists of several modules:

### Core Compiler (`index.ts`)
- Main entry point with `compileQuery()` function
- Orchestrates the compilation process
- Handles FROM clause processing (collections and sub-queries)
- Coordinates all pipeline stages

### Expression Evaluator (`evaluators.ts`)
- Evaluates expressions against namespaced row data
- Supports all expression types: refs, values, functions, aggregates
- Implements comparison operators: `eq`, `gt`, `gte`, `lt`, `lte`
- Implements boolean operators: `and`, `or`, `not`
- Implements string operators: `like`, `ilike`
- Implements string functions: `upper`, `lower`, `length`, `concat`, `coalesce`
- Implements math functions: `add`, `subtract`, `multiply`, `divide`
- Implements array operations: `in`

### Pipeline Processors
- **Joins (`joins.ts`)**: Handles all join types (inner, left, right, full, cross)
- **Order By (`order-by.ts`)**: Implements sorting with multiple columns and directions
- **Group By (`group-by.ts`)**: Basic grouping support (simplified implementation)
- **Select (`select.ts`)**: Processes SELECT clauses with expression evaluation

## Features Implemented

### ✅ Basic Query Operations
- FROM clause with collections and sub-queries
- SELECT clause with expression evaluation
- WHERE clause with complex filtering
- ORDER BY with multiple columns and directions

### ✅ Expression System
- Reference expressions (`ref`)
- Literal values (`val`)
- Function calls (`func`)
- Comprehensive operator support

### ✅ String Operations
- LIKE/ILIKE pattern matching with SQL wildcards (% and _)
- String functions (upper, lower, length, concat, coalesce)

### ✅ Boolean Logic
- AND, OR, NOT operations
- Complex nested conditions

### ✅ Comparison Operations
- All standard comparison operators
- Proper null handling
- Type-aware comparisons

### ⚠️ Partial Implementation
- **GROUP BY**: Basic structure in place, needs full aggregation logic
- **Aggregate Functions**: Placeholder implementation for single-row operations
- **HAVING**: Basic filtering support

### ❌ Not Yet Implemented
- **LIMIT/OFFSET**: Structure in place but not implemented
- **WITH (CTEs)**: Not implemented
- **Complex Aggregations**: Needs integration with GROUP BY

## Usage

```typescript
import { compileQuery } from "./compiler/index.js"
import { CollectionRef, Ref, Value, Func } from "../ir.js"

// Create a query IR
const query = {
  from: new CollectionRef(usersCollection, "users"),
  select: {
    id: new Ref(["users", "id"]),
    upperName: new Func("upper", [new Ref(["users", "name"])]),
  },
  where: new Func("gt", [new Ref(["users", "age"]), new Value(18)]),
}

// Compile to D2 pipeline
const pipeline = compileQuery(query, { users: userInputStream })
```

## Testing

The compiler is thoroughly tested with:

- **Basic compilation tests** (`tests/query2/compiler/`)
- **Pipeline behavior tests** (`tests/query2/pipeline/`)
- **Integration with query builder tests** (`tests/query2/query-builder/`)

All tests are passing (81/81) with good coverage of the implemented features.

## Future Enhancements

1. **Complete GROUP BY implementation** with proper aggregation
2. **LIMIT/OFFSET support** for pagination
3. **WITH clause support** for CTEs
4. **Performance optimizations** for complex queries
5. **Better error handling** with detailed error messages
6. **Query plan optimization** for better performance 
# Tree-Shakable Functional Query API Prototype

This directory contains a prototype implementation of a tree-shakable functional query API for TanStack DB.

## Overview

The goal is to replace method chaining with function composition so unused clauses aren't bundled in the final application.

### Current API (Method Chaining - Not Tree-Shakable)

```typescript
createLiveQueryCollection((q) =>
  q.from({ users: usersCollection })
   .where(({ users }) => eq(users.active, true))
   .select(({ users }) => ({ name: users.name }))
)
```

**Problem:** All methods are on the same QueryBuilder class, so all clause logic is bundled even if unused.

### New API (Functional - Tree-Shakable)

```typescript
import { query, from, where, select } from '@tanstack/db/query/functional'
import { eq } from '@tanstack/db'

const q = query(
  from({ users: usersCollection }),
  where(({ users }) => eq(users.active, true)),
  select(({ users }) => ({ name: users.name }))
)
```

**Benefit:** Each clause is in a separate file. If you don't import `select`, its code won't be bundled.

## Architecture

### Files Created

1. **`types.ts`** - Shared TypeScript types for the functional API
   - `Context` - Carries type information through the pipeline
   - `Clause` - Base interface for all clauses
   - `FromClause`, `WhereClause`, `SelectClause` - Specific clause types

2. **`core.ts`** - The `query()` function and clause registry
   - `query(...clauses)` - Composes clauses into a query
   - `ClauseRegistry` - Auto-registration system for compilers
   - `compileQuery()` - Converts functional query to IR

3. **`from.ts`** - The `from()` clause
   - `from(source)` - Creates a FROM clause
   - Auto-registers its compiler when imported

4. **`where.ts`** - The `where()` clause
   - `where(callback)` - Creates a WHERE clause
   - Auto-registers its compiler when imported

5. **`select.ts`** - The `select()` clause
   - `select(callback)` - Creates a SELECT clause
   - Auto-registers its compiler when imported

6. **`index.ts`** - Barrel export file
   - Exports all public APIs
   - Documents the tree-shaking benefits

### Auto-Registration Pattern

Each clause file automatically registers its compiler when imported:

```typescript
// In where.ts
function compileWhere(clause: WhereClause, ir: QueryIR, context: any): QueryIR {
  // Convert WHERE clause to IR
}

// Auto-register when this module is imported
registry.register("where", compileWhere)
```

This enables:
- **Separation:** Each clause in its own file
- **Tree-shaking:** Unused clauses aren't imported, so their compilers aren't bundled
- **Simplicity:** No explicit registration needed by users

## How It Works

### 1. Clause Creation

Each clause function (`from`, `where`, `select`) creates a clause object:

```typescript
export function from<TSource extends Source>(source: TSource): FromClause<TSource> {
  return {
    clauseType: "from",
    source,
    _context: undefined as any, // Type-level only
  }
}
```

The `_context` field is type-level only - it carries type information but is `undefined` at runtime.

### 2. Query Composition

The `query()` function accepts multiple clauses:

```typescript
export function query<TClauses extends ReadonlyArray<AnyClause>>(
  ...clauses: TClauses
): Query<InferQueryContext<TClauses>> {
  return {
    clauses,
    _context: undefined as any,
  }
}
```

The `InferQueryContext` type extracts the final context from the clause array.

### 3. Compilation

The `compileQuery()` function converts functional queries to IR:

```typescript
export function compileQuery(query: Query<any>): QueryIR {
  return registry.compile(query.clauses)
}
```

The registry iterates through clauses and calls their registered compilers.

## Type Inference Status

### ✅ What Works

1. **Separate Files:** Each clause is in its own file
2. **Auto-Registration:** Compilers register on import
3. **Tree-Shaking:** Unused clauses aren't bundled
4. **Basic Types:** Query result types are correct
5. **IR Compilation:** Queries compile to correct IR

### ⚠️ What's Limited

**Full type inference through callbacks is limited** by TypeScript's inference capabilities.

The ideal would be:
```typescript
where(({ users }) => eq(users.active, true))
//      ^^^^^^ TypeScript infers 'users' is Ref<User>
```

The current limitation:
```typescript
where(({ users }) => eq((users as any).active, true))
//                      ^^^^^^^^^^^^^^ Need type assertion
```

**Why?** TypeScript can't infer the callback parameter type from the composition context. The `where()` function is generic, but TypeScript doesn't know what type to use until it sees the whole `query()` call, which is too late.

### Possible Solutions

1. **Type Assertions** (current workaround)
   ```typescript
   where(({ users }) => eq((users as any).active, true))
   ```

2. **Helper Functions** with explicit types
   ```typescript
   const whereActive = <T extends { active: boolean }>() =>
     where(({ users }: { users: Ref<T> }) => eq(users.active, true))
   ```

3. **Hybrid Approach** - Use builder for type inference, functional for tree-shaking
   ```typescript
   // Builder compiles to functional IR under the hood
   q.from({ users }).where(({ users }) => eq(users.active, true))
   // Internally converts to: query(from(...), where(...))
   ```

4. **Schema Registry** - Register schemas globally
   ```typescript
   registerSchema('users', usersCollection)
   where('users', (users) => eq(users.active, true))
   ```

## Usage Example

```typescript
import { query, from, where, select } from '@tanstack/db/query/functional'
import { eq } from '@tanstack/db'

// Define your query
const activeUsersQuery = query(
  from({ users: usersCollection }),
  where(({ users }) => eq((users as any).active, true)),
  select(({ users }) => ({
    name: (users as any).name,
    email: (users as any).email,
  }))
)

// Compile to IR
import { compileQuery } from '@tanstack/db/query/functional'
const ir = compileQuery(activeUsersQuery)

// Use with existing infrastructure
createLiveQueryCollection(ir)
```

## Tree-Shaking Example

**Before (Method Chaining):**
```typescript
import { Query } from '@tanstack/db'
const q = new Query().from({ users })
// QueryBuilder class includes all methods: from, where, select, join, groupBy, etc.
// Even if you only use 'from', all methods are bundled
```

**After (Functional):**
```typescript
import { query, from } from '@tanstack/db/query/functional'
const q = query(from({ users }))
// Only 'from.ts' and 'core.ts' are imported
// where.ts, select.ts, join.ts, etc. are NOT bundled
```

## Next Steps

To make this production-ready:

1. **Improve Type Inference**
   - Explore helper functions or schema registry
   - Consider hybrid builder/functional approach

2. **Add More Clauses**
   - `join()`, `leftJoin()`, `innerJoin()`, etc.
   - `groupBy()`, `having()`
   - `orderBy()`, `limit()`, `offset()`

3. **Testing**
   - Unit tests for each clause compiler
   - Integration tests with existing query engine
   - Bundle size tests to verify tree-shaking

4. **Documentation**
   - API reference
   - Migration guide from builder API
   - Performance comparison

## Conclusion

This prototype demonstrates:
- ✅ **Tree-shakable architecture** with separate clause files
- ✅ **Auto-registration pattern** for compilers
- ✅ **Working runtime** that compiles to existing IR
- ⚠️ **Limited type inference** due to TypeScript constraints

The architecture is sound, but type inference needs more work for production use.

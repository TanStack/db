# Tree-Shakable APIs Exploration Guide

## The Goal

Enable developers to "just try" TanStack DB with a minimal bundle. A single live query with one operator should be ~10kb, not ~48kb.

```typescript
// This should be ~10kb, not 48kb
import { createCollection, eq, createLiveQueryCollection } from '@tanstack/db'

const todos = createCollection({ ... })
const active = createLiveQueryCollection((q) =>
  q.from({ todo: todos }).where(({ todo }) => eq(todo.completed, false))
)
```

**Key insight:** The API stays the same. This is an internal refactor, not an API change.

---

## Why Tree-Shaking Doesn't Work Today

### The Pipeline Coupling Problem

The query system has four stages, all tightly coupled through string-based dispatch:

```
Builder              IR                    Evaluator
─────────────────────────────────────────────────────────────
eq(a, b)      →     Func('eq', args)   →   switch(func.name) {
                                             case 'eq': ...
                                             case 'gt': ...
                                             // 25+ hardcoded cases
                                           }
```

**The problem:** Even if you split `eq()` into its own file, the evaluator still contains implementations for ALL operators in one giant switch statement.

```typescript
// evaluators.ts - 486 lines, ALL operators hardcoded
function compileFunction(func: Func) {
  switch (func.name) {
    case 'eq': { /* implementation */ }
    case 'gt': { /* implementation */ }
    case 'and': { /* implementation */ }
    case 'or': { /* implementation */ }
    case 'like': { /* implementation */ }
    case 'upper': { /* implementation */ }
    // ... 20+ more cases
    default: throw new UnknownFunctionError(func.name)
  }
}
```

**Result:** Importing just `eq` still bundles the entire evaluator with all 25+ operator implementations.

### Other Coupling Issues

1. **41 circular dependency chains** detected (see Appendix A)
2. **`types.ts`** imports `collection/index.ts` which pulls in everything
3. **`collection/index.ts`** imports 16 files including all 7 managers
4. **Framework packages** re-export everything from core

---

## The Solution: Auto-Registering Operators

Each operator must be a complete unit that registers itself on import:

```typescript
// @tanstack/db/operators/eq.ts
import { registerOperator } from '../registry.js'
import { Func } from '../ir.js'

// Builder function (what users import)
export function eq<T>(left: T, right: T): BasicExpression<boolean> {
  return new Func('eq', [toExpression(left), toExpression(right)])
}

// Evaluator (co-located with builder)
const eqEvaluator = (compiledArgs) => (data) => {
  const a = normalizeValue(compiledArgs[0](data))
  const b = normalizeValue(compiledArgs[1](data))
  if (isUnknown(a) || isUnknown(b)) return null
  return areValuesEqual(a, b)
}

// Auto-registration on import
registerOperator('eq', eqEvaluator)
```

```typescript
// registry.ts - tiny, always included
const operatorRegistry = new Map<string, EvaluatorFactory>()

export function registerOperator(name: string, evaluator: EvaluatorFactory) {
  operatorRegistry.set(name, evaluator)
}

export function getOperatorEvaluator(name: string): EvaluatorFactory {
  const evaluator = operatorRegistry.get(name)
  if (!evaluator) throw new UnknownFunctionError(name)
  return evaluator
}
```

```typescript
// evaluators.ts - now just a registry lookup
function compileFunction(func: Func) {
  const evaluator = getOperatorEvaluator(func.name)
  return evaluator(compiledArgs)
}
```

### How Tree-Shaking Works

```
User imports                              Bundle includes
─────────────────────────────────────────────────────────────────
import { eq, gt } from '@tanstack/db'  →  eq + gt (builder + evaluator)

                                          NOT included: and, or, upper,
                                          lower, like, concat, etc.
```

The barrel file re-exports all operators. Bundlers eliminate unused re-exports, so only the operators you actually use get bundled.

### sideEffects: false Still Works

The registration "side effect" is self-contained:
- If you import `eq` → bundler includes it → registration runs ✓
- If you don't import `eq` → bundler excludes it → registration never needed ✓

No leaked global state. The Map is only consulted when compiling queries that use that operator.

---

## Implementation Plan

### Phase 1: Registry Infrastructure (3-4 days)

1. Create `registry.ts` with `registerOperator` / `getOperatorEvaluator`
2. Refactor `evaluators.ts` to use registry lookup instead of switch
3. Register existing operators from their current location (no file moves yet)
4. Add tests for registry behavior

### Phase 2: Split Operators (4-5 days)

Create `operators/` directory with each operator as a complete unit:

```
packages/db/src/operators/
├── index.ts          # Re-exports all (convenience import)
├── eq.ts             # eq builder + evaluator + registration
├── gt.ts
├── gte.ts
├── lt.ts
├── lte.ts
├── and.ts
├── or.ts
├── not.ts
├── in.ts
├── like.ts
├── ilike.ts
├── upper.ts
├── lower.ts
├── length.ts
├── concat.ts
├── coalesce.ts
├── add.ts
├── subtract.ts
├── multiply.ts
├── divide.ts
├── isUndefined.ts
└── isNull.ts
```

### Phase 3: Extended Tree-Shaking (5-6 days)

1. **Lazy-load db-ivm operators** in compiler based on query features
2. **Split collection managers** for mutations tree-shaking
3. **Break circular dependencies** (41 chains to untangle)
4. **Update framework packages** to not re-export everything
5. **Tree-shake indexes** (see below)

### Phase 4: Tree-Shakable Query Clauses (Future/v2.0)

Tree-shaking **query clauses** (join, groupBy, orderBy, etc.) requires API changes because they're methods on a class. See detailed exploration below.

### Total Effort

- Phases 1-3: ~15-18 days (internal refactor, no API changes)
- Phase 4: TBD (requires API design work)

---

## Bundle Size Projections

| Scenario | Current | After Phase 2 | Reduction |
|----------|---------|---------------|-----------|
| Minimal query (eq only) | ~48kb | ~8-10kb | **79-83%** |
| Basic query (eq, gt, and, or) | ~48kb | ~12-14kb | **71-75%** |
| With mutations | ~48kb | ~18-22kb | **54-63%** |
| Full features | ~48kb | ~48kb | 0% |

### What Gets Tree-Shaken

With the registry architecture:
- ✅ Unused query operators (eq, gt, like, upper, etc.)
- ✅ String functions if not used
- ✅ Math functions if not used
- ✅ Null checks if not used

Still bundled (core infrastructure):
- Registry (~50 lines)
- IR classes (Func, PropRef, Value)
- Expression compilation core
- Collection core

---

## Type Safety

Type safety is fully preserved. See `docs/tree-shakable-type-safety-research.md` for details.

Key points:
- Generic constraints work across module boundaries
- RefProxy is a runtime detail invisible to TypeScript
- Context type evolution doesn't depend on operator location
- All operators share centralized type definitions

---

## Risks and Mitigations

### Risk: Registration Order

**Problem:** Evaluator lookup before operator import?

**Mitigation:** Registration happens at module import time:
```typescript
import { eq } from '@tanstack/db'  // ← eq registers here

// By the time this code runs, eq is already registered
createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .where(({ todo }) => eq(todo.completed, false))
)
```

### Risk: Missing Operator at Runtime

**Problem:** User manually creates `Func('custom', args)` without registration.

**Mitigation:** Clear error message:
```typescript
throw new Error(
  `Unknown operator "${name}". ` +
  `Did you forget to import it from @tanstack/db/operators?`
)
```

### Risk: Breaking Changes

**Mitigation:** Phased rollout:
- v0.x: Add subpath exports, keep main entry point
- v1.0: Deprecation warnings for full imports
- v2.0: Main entry point only exports types

---

## Appendix A: Dependency Graph Analysis

### Tool

```bash
npx madge --extensions ts packages/db/src/index.ts --circular
npx madge --extensions ts packages/db/src/index.ts --summary
```

### Circular Dependencies (41 chains!)

Most problematic cycles:
```
1. collection/index.ts ↔ changes.ts ↔ events.ts
2. types.ts ↔ query/ir.ts ↔ query/builder/types.ts
3. collection/index.ts → mutations.ts → transactions.ts → collection
4. query/live/collection-config-builder.ts ↔ collection-registry.ts
```

### Most Imported Files

| Dependents | File | Impact |
|------------|------|--------|
| 32 | `types.ts` | Core types - can't split |
| 27 | `query/ir.ts` | Query AST - shared |
| 21 | `collection/index.ts` | Needs refactor |
| 18 | `errors.ts` | Leaf node ✓ |
| 17 | `query/builder/types.ts` | Can centralize |

### Leaf Nodes (Already Tree-Shakable)

```
✓ SortedMap.ts
✓ deferred.ts
✓ errors.ts
✓ event-emitter.ts
✓ scheduler.ts
✓ utils/btree.ts
```

---

## Appendix B: Index Tree-Shaking

### Current State

Indexes are exported directly from the main entry point:

```typescript
// index.ts
export * from "./indexes/base-index.js"
export * from "./indexes/btree-index.js"
export * from "./indexes/lazy-index.js"
```

| File | Lines | Always Needed? |
|------|-------|----------------|
| `base-index.ts` | 214 | Yes (base class) |
| `btree-index.ts` | 353 | Only if using BTree indexes |
| `lazy-index.ts` | 251 | Only if using lazy indexes |
| `auto-index.ts` | 147 | Only if using auto indexes |
| `reverse-index.ts` | 120 | Only if using reverse indexes |
| **Total** | **1085** | |

### Solution

Most users don't use indexes explicitly - they're an advanced optimization. Move to subpath exports:

```typescript
// Only import if needed
import { BTreeIndex } from '@tanstack/db/indexes/btree'
import { LazyIndex } from '@tanstack/db/indexes/lazy'
```

Or use auto-registration like operators:

```typescript
// indexes/btree-index.ts
import { registerIndexType } from '../index-registry.js'

export class BTreeIndex extends BaseIndex { ... }

registerIndexType('btree', BTreeIndex)
```

**Estimated reduction:** ~800 lines for users not using indexes explicitly.

---

## Appendix C: db-ivm Operators

### Currently Bundled

| Operator | Always Needed? |
|----------|----------------|
| `filter` | Yes - core |
| `map` | Yes - core |
| `output` | Yes - core |
| `distinct` | Only for DISTINCT |
| `join` | Only for JOIN |
| `groupBy` | Only for GROUP BY |
| `orderByWithFractionalIndex` | Only for ORDER BY |

### Heavy Optional Operators

| Operator | Lines | Use Case |
|----------|-------|----------|
| `topKWithFractionalIndexBTree` | 307 | Large ordered collections |
| `topKWithFractionalIndex` | 481 | Paginated results |
| `groupBy` | 377 | GROUP BY queries |
| `join` | 374 | JOIN queries |

These should be lazy-loaded based on query features (Phase 3).

---

## Phase 4 Deep Dive: Tree-Shakable Query Clauses

### Why This Matters More Than Operators

The operator tree-shaking (Phases 1-2) handles ~500 lines of code. The clause implementations are **5x larger**:

| File | Lines | Always Needed? |
|------|-------|----------------|
| `builder/index.ts` | 874 | Only `from`, `where`, `select` for basic queries |
| `compiler/joins.ts` | 616 | Only if using `.join()` |
| `compiler/group-by.ts` | 442 | Only if using `.groupBy()` |
| `compiler/order-by.ts` | 245 | Only if using `.orderBy()` |
| `compiler/select.ts` | 265 | Always (but could be smaller) |
| **Total** | **2442** | |

A minimal query (`from` + `where` + basic `select`) bundles ~2400 lines it doesn't need.

### The Fundamental Problem

Method chaining requires all methods on the class:

```typescript
// Current: importing BaseQueryBuilder imports ALL methods
class BaseQueryBuilder<TContext> {
  from()     { /* 80 lines */ }   // ✅ Always needed
  where()    { /* 15 lines */ }   // ✅ Usually needed
  select()   { /* 30 lines */ }   // ✅ Usually needed
  join()     { /* 60 lines */ }   // ❌ Rarely needed
  groupBy()  { /* 20 lines */ }   // ❌ Rarely needed
  having()   { /* 15 lines */ }   // ❌ Rarely needed
  orderBy()  { /* 40 lines */ }   // ⚠️ Sometimes needed
  limit()    { /* 5 lines */ }    // ⚠️ Sometimes needed
  distinct() { /* 5 lines */ }    // ❌ Rarely needed
}
```

Plus the compiler statically imports ALL clause processors.

### Proposed: Functional Composition API

```typescript
// User imports only what they need
import { query, from, where, select } from '@tanstack/db/query'
import { eq } from '@tanstack/db'

// No join/groupBy/orderBy = that code not bundled
const q = query(
  from({ users: usersCollection }),
  where(({ users }) => eq(users.active, true)),
  select(({ users }) => ({ name: users.name }))
)

// Used with live queries
createLiveQueryCollection(() => q)
```

### Implementation Sketch

**1. Each clause is a standalone function returning a transformer:**

```typescript
// query/clauses/from.ts (~50 lines)
import { createRef, registerClause } from '../core.js'

export function from<TSource extends Source>(source: TSource): FromClause<TSource> {
  return {
    type: 'from',
    apply(ir: Partial<QueryIR>) {
      const [alias, ref] = createRef(source)
      return {
        ir: { ...ir, from: ref },
        aliases: [alias]
      }
    }
  }
}

// Auto-register compiler for this clause type
registerClause('from', compileFrom)

function compileFrom(ir: QueryIR, inputs: Record<string, Stream>, ...) {
  // FROM compilation logic
}
```

**2. The `query` function composes clauses:**

```typescript
// query/core.ts (~100 lines, always bundled)
export function query<TResult>(...clauses: Clause[]): CompiledQuery<TResult> {
  let ir: Partial<QueryIR> = {}
  let aliases: string[] = []

  for (const clause of clauses) {
    const result = clause.apply(ir, aliases)
    ir = result.ir
    if (result.aliases) aliases = result.aliases
  }

  return { ir: ir as QueryIR, _type: undefined as TResult }
}
```

**3. Clause compilers register themselves:**

```typescript
// query/clause-registry.ts
const clauseCompilers = new Map<string, ClauseCompiler>()

export function registerClause(type: string, compiler: ClauseCompiler) {
  clauseCompilers.set(type, compiler)
}

export function getClauseCompiler(type: string): ClauseCompiler {
  return clauseCompilers.get(type) ?? (() => {})
}
```

### Type Inference Strategy

The challenge: `where` needs to know about `users` from `from`.

**Best Solution: EdgeDB-style Single Callback Pattern**

EdgeDB's query builder solves this elegantly. The first argument establishes context, the callback receives typed refs:

```typescript
// EdgeDB pattern
e.select(e.Movie, (movie) => ({
  title: true,
  filter: e.op(movie.title, '=', 'Iron Man')
}))
```

**Adapted for TanStack DB:**

```typescript
import { query } from '@tanstack/db/query'
import { eq } from '@tanstack/db'

// First arg = sources, second arg = shape callback with typed refs
const q = query(
  { users: usersCollection },
  ({ users }) => ({
    filter: eq(users.active, true),
    select: { name: users.name },
    orderBy: users.createdAt,
    limit: 10
  })
)
```

**Why this works:**
1. First argument `{ users: usersCollection }` establishes the type context
2. TypeScript infers callback parameter type from first argument
3. Callback receives `{ users: RefProxy<User> }` - fully typed!
4. Single callback = single object = flat API (like EdgeDB's "no nesting" philosophy)

**With joins:**

```typescript
const q = query(
  { users: usersCollection },
  ({ users }) => ({
    join: {
      posts: {
        collection: postsCollection,
        on: eq(posts.authorId, users.id),
        type: 'left'
      }
    },
    filter: eq(users.active, true),
    select: {
      name: users.name,
      posts: { title: true }
    }
  })
)
```

**Tree-shakable:** The `query` function is tiny. Join/groupBy/orderBy logic only loads if the shape includes those keys.

**Alternative: Separate clauses with context threading**

If we want separate clause functions, use overloads:

```typescript
// Overloads thread context through
export function query<S extends Source>(
  from: FromClause<S>
): Query<ContextFromSource<S>>

export function query<S extends Source>(
  from: FromClause<S>,
  where: (refs: RefsFor<S>) => Expression<boolean>
): Query<ContextFromSource<S>>

export function query<S extends Source, R>(
  from: FromClause<S>,
  where: (refs: RefsFor<S>) => Expression<boolean>,
  select: (refs: RefsFor<S>) => R
): Query<R>
```

### Bundle Size Impact (Estimated)

| Query Type | Current | Functional | Reduction |
|------------|---------|------------|-----------|
| from + where | ~48kb | ~12kb | **75%** |
| from + where + select | ~48kb | ~14kb | **71%** |
| from + where + orderBy + limit | ~48kb | ~18kb | **63%** |
| With joins | ~48kb | ~28kb | **42%** |
| With groupBy + having | ~48kb | ~32kb | **33%** |
| Full query features | ~48kb | ~48kb | 0% |

### Migration Path

1. **v1.x**: Ship functional API alongside method chaining (both work)
2. **v2.0**: Make functional API the primary, method chaining deprecated
3. **v3.0**: Remove method chaining

### Open Questions

1. **Is the API change worth it?** Method chaining is familiar to SQL users
2. **Type inference complexity** - Can we make it as good as method chaining?
3. **createLiveQueryCollection integration** - How does it accept the new format?
4. **Backward compatibility** - Can we support both APIs indefinitely?

---

## Conclusion

Tree-shaking TanStack DB has two levels:

### Level 1: Operators (Phases 1-3) ✅ No API Changes

Auto-registering operators provide ~20-30% bundle reduction:
- Each operator bundles builder + evaluator + registration
- Evaluator becomes a registry lookup
- Bundlers eliminate unused operators

### Level 2: Clauses (Phase 4) ⚠️ Requires API Changes

Functional composition API provides additional ~40-50% reduction:
- Each clause is a standalone function
- Clause compilers register themselves
- Query built via `query(from(...), where(...), select(...))`

**Recommendation:**
1. Ship Phases 1-3 first (internal refactor, no breaking changes)
2. Evaluate Phase 4 based on user feedback on remaining bundle size
3. Phase 4 is a v2.0 consideration requiring community input on API preferences

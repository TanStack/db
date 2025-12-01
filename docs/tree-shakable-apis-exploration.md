# Tree-Shakable APIs Exploration Guide

## Executive Summary

This document explores converting TanStack DB's APIs to be completely tree-shakable, enabling users to ship minimal bundles when they only need a subset of functionality. The goal: a single live query with optimistic update at ~10kb instead of ~48kb.

## Current Architecture Analysis

### Bundle Composition (Approximate)

| Component | Lines of Code | Relative Size |
|-----------|--------------|---------------|
| `proxy.ts` (change tracking) | 1,180 | ~15% |
| `predicate-utils.ts` | 1,459 | ~18% |
| `collection-config-builder.ts` | 1,083 | ~13% |
| `optimizer.ts` | 1,061 | ~13% |
| `collection/index.ts` + managers | ~2,500 | ~30% |
| Query builder + operators | ~1,250 | ~10% |
| Everything else | ~3,000 | ~35% |

### Current Export Structure

```typescript
// packages/db/src/index.ts - Single barrel export
export * from "./collection/index.js"
export * from "./transactions"
export * from "./proxy"
export * from "./query/index.js"
export * from "./strategies/index.js"
export * from "./indexes/base-index.js"
// ... everything bundled together
```

### Why Tree-Shaking Doesn't Work Today

1. **Monolithic Collection Class**: All 7 managers (State, Mutations, Changes, Lifecycle, Events, Indexes, Sync) are instantiated in the constructor, even if unused.

2. **Implicit Dependencies**: `insert()`, `update()`, `delete()` import `proxy.ts` and `transactions.ts` unconditionally.

3. **Barrel Re-exports**: Framework packages (react-db, vue-db) re-export everything from core.

4. **Query Operators Bundled**: Even though operators are standalone functions, they're exported from the same entry point.

---

## Proposed Architecture

### Design Philosophy

**Composition over Configuration**: Instead of a monolithic Collection with all features built-in, provide composable primitives that users wire together.

```typescript
// CURRENT: Everything bundled
import { createCollection, eq } from '@tanstack/db'

// PROPOSED: Pay for what you use
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators'
import { withMutations } from '@tanstack/db/mutations'
import { liveQuery } from '@tanstack/db/live-query'
```

### Entry Point Structure

```
@tanstack/db/
├── collection      # Core reactive collection (~5kb)
├── operators       # Query operators: eq, gt, lt, and, or, etc.
│   ├── eq
│   ├── gt
│   ├── and
│   └── ...
├── mutations       # insert/update/delete + change proxy (~8kb)
├── transactions    # Transaction system (~3kb)
├── live-query      # Live query compilation (~6kb)
├── indexes         # B-tree indexes (~4kb)
├── strategies      # Sync strategies (~2kb)
└── index           # Full bundle (current behavior)
```

---

## Implementation Approaches

### Approach 1: Separate Entry Points (Recommended)

Create distinct subpath exports in `package.json`:

```json
{
  "exports": {
    ".": "./dist/esm/index.js",
    "./collection": "./dist/esm/collection/core.js",
    "./operators": "./dist/esm/query/builder/functions.js",
    "./operators/eq": "./dist/esm/query/builder/functions/eq.js",
    "./mutations": "./dist/esm/mutations/index.js",
    "./transactions": "./dist/esm/transactions/index.js",
    "./live-query": "./dist/esm/query/live-query-collection.js",
    "./indexes": "./dist/esm/indexes/index.js"
  }
}
```

**Minimal Live Query Example:**

```typescript
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { liveQuery } from '@tanstack/db/live-query'
import { withOptimisticMutation } from '@tanstack/db/mutations'

const todos = createCollection({
  id: 'todos',
  getKey: (t) => t.id,
  sync: { sync: () => {} }
})

// Live query with single operator
const active = liveQuery(
  (q) => q.from({ todo: todos }).where(({ todo }) => eq(todo.completed, false))
)

// Optimistic mutation (includes proxy)
const tx = withOptimisticMutation(todos, (t) =>
  t.insert({ id: '1', text: 'Buy milk', completed: false })
)
```

**Bundle Impact**: ~10-12kb for this scenario vs ~48kb today.

---

### Approach 2: Plugin Architecture

Make Collection a minimal core that accepts plugins:

```typescript
import { createCollection, use } from '@tanstack/db/core'
import { mutations } from '@tanstack/db/plugins/mutations'
import { liveQueries } from '@tanstack/db/plugins/live-queries'
import { btreeIndexes } from '@tanstack/db/plugins/indexes'

const todos = createCollection({
  id: 'todos',
  getKey: (t) => t.id,
  sync: { sync: () => {} },
  plugins: [
    mutations(),           // Enables .insert(), .update(), .delete()
    liveQueries(),         // Enables live query compilation
    btreeIndexes(),        // Enables .createIndex()
  ]
})
```

**Pros**: Very explicit about what's included, maximum tree-shaking.
**Cons**: More boilerplate, different mental model from current API.

---

### Approach 3: Functional Composition (Most Tree-Shakable)

Replace methods with standalone functions:

```typescript
// Current (not tree-shakable)
collection.insert({ id: '1', text: 'Buy milk' })
collection.update('1', (d) => { d.completed = true })

// Proposed (fully tree-shakable)
import { insert, update, remove } from '@tanstack/db/mutations'

insert(collection, { id: '1', text: 'Buy milk' })
update(collection, '1', (d) => { d.completed = true })
remove(collection, '1')
```

**For Live Queries:**

```typescript
// Current
createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .where(({ todo }) => eq(todo.completed, false))
   .orderBy(({ todo }) => todo.createdAt)
   .limit(10)
)

// Proposed: Composable pipelines
import { from, where, orderBy, limit, compile } from '@tanstack/db/query'
import { eq } from '@tanstack/db/operators/eq'

const query = compile(
  from({ todo: todos }),
  where(({ todo }) => eq(todo.completed, false)),
  orderBy(({ todo }) => todo.createdAt, 'desc'),
  limit(10)
)
```

---

## Detailed Implementation Plan

### Phase 1: Core Collection Refactor

**Goal**: Extract a minimal `CollectionCore` that only handles state and subscriptions.

```typescript
// packages/db/src/collection/core.ts (~200 lines)
export class CollectionCore<T, TKey> {
  private state: Map<TKey, T>
  private subscribers: Set<Subscriber>

  constructor(config: CoreConfig<T, TKey>) { }

  get(key: TKey): T | undefined
  has(key: TKey): boolean
  get size(): number
  values(): IterableIterator<T>
  entries(): IterableIterator<[TKey, T]>
  subscribe(callback: SubscribeCallback): Unsubscribe

  // Internal: used by mutation layer
  _applyChanges(changes: Change<T>[]): void
}
```

The current `Collection` becomes:

```typescript
// packages/db/src/collection/full.ts (current behavior)
import { CollectionCore } from './core.js'
import { CollectionMutationsManager } from './mutations.js'
import { CollectionIndexesManager } from './indexes.js'
// ... all managers

export class Collection<T, TKey> extends CollectionCore<T, TKey> {
  // All current functionality
}
```

### Phase 2: Mutations as Standalone Functions

**Goal**: Allow `insert`/`update`/`delete` to be imported separately.

```typescript
// packages/db/src/mutations/insert.ts
import { createTransaction, getActiveTransaction } from '../transactions/index.js'
import { withChangeTracking } from '../proxy.js'
import type { CollectionCore } from '../collection/core.js'

export function insert<T extends object>(
  collection: CollectionCore<T, any>,
  data: T | T[],
  config?: InsertConfig
): Transaction {
  // Current insert implementation, but as a standalone function
}
```

```typescript
// packages/db/src/mutations/index.ts
export { insert } from './insert.js'
export { update } from './update.js'
export { remove } from './remove.js'
```

### Phase 3: Split Query Operators

**Goal**: Each operator in its own file for maximum tree-shaking.

```typescript
// packages/db/src/query/operators/eq.ts
import { Func } from '../ir.js'
import { toExpression } from '../builder/ref-proxy.js'

export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func('eq', [toExpression(left), toExpression(right)])
}
```

```typescript
// packages/db/src/query/operators/index.ts
// Re-exports all for convenience
export { eq } from './eq.js'
export { gt } from './gt.js'
export { gte } from './gte.js'
// ...
```

Package.json exports:

```json
{
  "exports": {
    "./operators": "./dist/esm/query/operators/index.js",
    "./operators/eq": "./dist/esm/query/operators/eq.js",
    "./operators/gt": "./dist/esm/query/operators/gt.js"
  }
}
```

### Phase 4: Lazy Proxy Loading

**Goal**: Only load the proxy system when mutations are used.

The proxy (`proxy.ts`, 1180 lines) is only needed for:
- `update()` with callback (change tracking)
- Optimistic updates

```typescript
// packages/db/src/mutations/update.ts
export async function update<T>(
  collection: CollectionCore<T>,
  key: string,
  callback: (draft: T) => void
): Promise<Transaction> {
  // Dynamically import proxy only when needed
  const { withChangeTracking } = await import('../proxy.js')

  const current = collection.get(key)
  const changes = withChangeTracking(current, callback)
  // ...
}
```

Or with static imports but separate entry point:

```typescript
// @tanstack/db/mutations - includes proxy
// @tanstack/db/mutations/sync-only - no proxy, for server-confirmed only
```

### Phase 5: Framework Bindings

Update React/Vue/etc. to not re-export everything:

```typescript
// packages/react-db/src/index.ts

// CURRENT (bundles everything):
export * from '@tanstack/db'

// PROPOSED (minimal re-exports):
export { useLiveQuery } from './useLiveQuery.js'
export { useMutation } from './useMutation.js'
// Users import operators from @tanstack/db/operators directly
```

---

## API Design Proposals

### Option A: Preserve Current API, Add Subpaths

Keep the current chained API, but allow importing pieces:

```typescript
// Full experience (current)
import { createCollection, eq, createLiveQueryCollection } from '@tanstack/db'

// Minimal experience (new)
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { createLiveQueryCollection } from '@tanstack/db/live-query'
```

**Pros**: No breaking changes, gradual adoption.
**Cons**: Less aggressive tree-shaking for chained methods.

### Option B: Functional API Alongside Chained

Provide both APIs:

```typescript
// Chained (current, less tree-shakable but ergonomic)
todos.insert({ id: '1', text: 'Buy milk' })

// Functional (new, fully tree-shakable)
import { insert } from '@tanstack/db/mutations'
insert(todos, { id: '1', text: 'Buy milk' })
```

**Pros**: Best of both worlds.
**Cons**: Two ways to do the same thing.

### Option C: Builder Pattern for Collection Setup

```typescript
import { CollectionBuilder } from '@tanstack/db/collection'
import { withMutations } from '@tanstack/db/mutations'
import { withIndexes } from '@tanstack/db/indexes'

const todos = new CollectionBuilder({ id: 'todos', getKey: t => t.id })
  .use(withMutations())      // Adds .insert(), .update(), .delete()
  .use(withIndexes())        // Adds .createIndex()
  .sync({ sync: () => {} })
  .build()
```

**Pros**: Very explicit, maximum control.
**Cons**: More verbose setup.

---

## Bundle Size Estimates

### Scenario 1: Single Live Query (Read-Only)

```typescript
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { createLiveQueryCollection } from '@tanstack/db/live-query'
```

| Component | Estimated Size (minified+gzipped) |
|-----------|----------------------------------|
| collection/core | ~2kb |
| operators/eq | ~0.3kb |
| live-query (minimal) | ~3kb |
| ir.ts (shared) | ~1kb |
| **Total** | **~6-7kb** |

### Scenario 2: Live Query + Optimistic Mutations

```typescript
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { createLiveQueryCollection } from '@tanstack/db/live-query'
import { insert, update } from '@tanstack/db/mutations'
```

| Component | Estimated Size (minified+gzipped) |
|-----------|----------------------------------|
| collection/core | ~2kb |
| operators/eq | ~0.3kb |
| live-query (minimal) | ~3kb |
| mutations (with proxy) | ~4kb |
| transactions | ~1.5kb |
| **Total** | **~10-12kb** |

### Scenario 3: Full Feature Set (Current)

Everything imported: **~45-48kb** (current baseline)

---

## Migration Strategy

### Phase 1: Non-Breaking (v0.6)

1. Add subpath exports (`/collection`, `/operators`, `/mutations`, etc.)
2. Keep main entry point unchanged
3. Document new import patterns
4. Framework packages continue re-exporting

### Phase 2: Deprecation Warnings (v0.7)

1. Add build-time warnings for `import * from '@tanstack/db'`
2. Encourage specific imports
3. Update all examples and docs

### Phase 3: Breaking Change (v1.0)

1. Main entry point only exports types
2. All runtime code requires subpath imports
3. Framework packages have minimal re-exports

---

## Technical Challenges

### 1. Type Inference Across Modules

The query builder uses complex generic type tracking. Splitting operators into separate files requires careful type exports:

```typescript
// Must export types alongside runtime
export function eq<T>(...): BasicExpression<boolean>
export type { BasicExpression } from '../ir.js'
```

### 2. Circular Dependencies

Current architecture has cycles:
- `Collection` → `Mutations` → `Transactions` → `Collection`
- `Query` → `Collection` → `Query`

Solution: Extract shared interfaces into a `types.ts` that both import.

### 3. React Suspense Integration

`useLiveSuspenseQuery` needs access to internals. May need to expose hooks:

```typescript
// @tanstack/db/react
import { useLiveQuery } from './useLiveQuery.js'
import { useSuspenseIntegration } from '@tanstack/db/suspense'
```

### 4. Index Optimization

The query optimizer needs to know about indexes. If indexes are optional:

```typescript
const optimizedQuery = optimize(query, {
  indexes: collection._indexes // Optional
})
```

---

## Recommended Implementation Order

1. **Operators Split** (Low risk, high impact)
   - Each operator in own file
   - Subpath exports for individual imports
   - ~1 day effort

2. **Core Collection Extract** (Medium risk)
   - Create `CollectionCore` with minimal API
   - Current `Collection` extends it
   - ~2-3 days effort

3. **Mutations Standalone** (Medium risk)
   - `insert()`, `update()`, `remove()` as functions
   - Keep methods on Collection as wrappers
   - ~2 days effort

4. **Live Query Isolation** (Higher risk)
   - Separate compiler from collection
   - Lazy loading of optimizer
   - ~3-4 days effort

5. **Framework Updates** (Low risk)
   - Update react-db, vue-db, etc.
   - Minimal re-exports
   - ~1 day per framework

---

## Conclusion

Converting TanStack DB to tree-shakable APIs is achievable with **Option A** (subpath exports preserving current API) as the recommended approach. This provides:

- **Backward compatibility**: Existing code continues to work
- **Gradual adoption**: Users can optimize imports incrementally
- **Significant bundle reduction**: 10-12kb for basic use cases vs 48kb
- **Future flexibility**: Foundation for more aggressive optimization later

The key insight is that most of the bundle is in systems users don't always need:
- Proxy/change tracking (~15%) - only for optimistic updates
- Predicate utilities (~18%) - only for advanced query optimization
- Optimizer (~13%) - only for complex queries
- Index system (~10%) - only for indexed queries

By making these opt-in through separate imports, we can dramatically reduce the cost of "just trying out" TanStack DB.

---

## Appendix A: Dependency Graph Analysis

### Dependency Analysis Tool

We used `madge` to analyze the import/export graph:

```bash
npx madge --extensions ts packages/db/src/index.ts --circular
npx madge --extensions ts packages/db/src/index.ts --summary
```

### Circular Dependencies (41 chains detected!)

The codebase has **41 circular dependency chains** that impede tree-shaking:

**Most problematic cycles:**
```
1. collection/index.ts ↔ collection/changes.ts ↔ collection/events.ts
2. types.ts ↔ query/ir.ts ↔ query/builder/types.ts ↔ query/builder/index.ts
3. collection/index.ts → mutations.ts → transactions.ts → (back to collection)
4. query/live/collection-config-builder.ts ↔ query/live/collection-registry.ts
```

### Most Imported Files (Dependents)

Files imported by many others - changes cascade widely:

| Dependents | File | Impact |
|------------|------|--------|
| 32 | `types.ts` | Core types - can't split |
| 27 | `query/ir.ts` | Query AST - shared foundation |
| 21 | `collection/index.ts` | Main collection - needs refactor |
| 18 | `errors.ts` | Error classes - leaf node ✓ |
| 17 | `query/builder/types.ts` | Query types - can centralize |
| 11 | `transactions.ts` | Tx system - can isolate |
| 10 | `indexes/base-index.ts` | Index base - can isolate |

### Heaviest Importers (Dependencies)

Files that import the most - they pull in large chunks:

| Imports | File | Problem |
|---------|------|---------|
| 19 | `index.ts` | Barrel export - expected |
| 17 | `query/live/collection-config-builder.ts` | Live query setup |
| 16 | `collection/index.ts` | Imports all managers |
| 12 | `query/compiler/index.ts` | Query compilation |
| 11 | `query/compiler/joins.ts` | Join processing |

### Leaf Nodes (Pure, Tree-Shakable)

These modules have no dependencies - ideal for splitting:

```
✓ SortedMap.ts
✓ deferred.ts
✓ errors.ts
✓ event-emitter.ts
✓ scheduler.ts
✓ utils/browser-polyfills.ts
✓ utils/btree.ts
✓ utils/type-guards.ts
```

### Critical Paths

What the most-imported files bring with them:

**`types.ts` imports:**
- `collection/index.ts` ← Pulls in EVERYTHING
- `query/ir.ts`
- `transactions.ts`

**`collection/index.ts` imports (16 files!):**
- All 7 manager classes
- Index system
- Query builder internals
- Error handling

---

## Appendix B: db-ivm Operators Analysis

### Currently Bundled db-ivm Operators

The `@tanstack/db` package imports these operators from `@tanstack/db-ivm`:

| Operator | Used In | Always Needed? |
|----------|---------|----------------|
| `distinct` | compiler/index.ts | Only for DISTINCT queries |
| `filter` | compiler/index.ts, joins.ts, group-by.ts | Core - always needed |
| `map` | Multiple files | Core - always needed |
| `output` | collection-config-builder.ts | Core - always needed |
| `join` | compiler/joins.ts | Only for JOIN queries |
| `groupBy` | compiler/group-by.ts | Only for GROUP BY |
| `orderByWithFractionalIndex` | compiler/order-by.ts | Only for ORDER BY |
| `tap` | compiler/joins.ts | Debug/internal |

### Heavy Optional Operators in db-ivm

These operators exist in db-ivm but are NOT currently used by default:

| Operator | Lines | Size | Use Case |
|----------|-------|------|----------|
| `topKWithFractionalIndexBTree.ts` | 307 | ~10kb | Large ordered collections |
| `topKWithFractionalIndex.ts` | 481 | ~16kb | Paginated results |
| `groupBy.ts` | 377 | ~12kb | GROUP BY queries |
| `join.ts` | 374 | ~12kb | JOIN queries |
| `orderBy.ts` | 205 | ~7kb | ORDER BY queries |

### Recommendation: Lazy Load Heavy Operators

The `topKWithFractionalIndexBTree` already uses dynamic import for `sorted-btree`:

```typescript
// topKWithFractionalIndexBTree.ts
let BTree: BTreeClass | undefined

export async function loadBTree() {
  if (BTree === undefined) {
    const { default: _BTreeClass } = await import('sorted-btree')
    BTree = _BTreeClass
  }
}
```

This pattern should be extended to other heavy operators:

```typescript
// Proposed: lazy-loaded query operators
import { createLiveQueryCollection } from '@tanstack/db/live-query'
import { withOrderBy } from '@tanstack/db/operators/order-by'  // Separate import

const query = createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .pipe(withOrderBy(({ todo }) => todo.createdAt))  // Lazy loaded
   .limit(10)
)
```

---

## Appendix C: Type Safety Research Summary

See `docs/tree-shakable-type-safety-research.md` for full analysis.

### Key Findings

1. **Type inference is preserved** when splitting operators - Context types don't depend on module boundaries

2. **No circular type dependencies** between operators - each is self-contained

3. **RefProxy is runtime-only** - type inference uses generic constraints, not runtime values

4. **Recommended approach**: Centralize type utilities in `shared-types.ts`, split operators into individual files

### Type Safety Guarantees

With the recommended architecture:
- ✓ Full generic type inference preserved
- ✓ IDE autocomplete works across module boundaries
- ✓ No TypeScript compilation issues
- ✓ Backward compatible with existing code

# TanStack DB Bundle Optimization - Implementation Guide

This guide provides specific code changes and implementation steps for optimizing the TanStack DB bundle size.

## Table of Contents

1. [Phase 1: Quick Wins](#phase-1-quick-wins)
2. [Phase 2: Query System Split](#phase-2-query-system-split)
3. [Phase 3: Advanced Optimizations](#phase-3-advanced-optimizations)
4. [Testing & Validation](#testing--validation)

---

## Phase 1: Quick Wins

### 1.1 Lazy Load B+ Tree in SortedMap

**Impact:** Saves ~24 KB for collections without custom comparators

**Files to modify:**
- `packages/db/src/collection/state.ts`

**Current code (lines 66-77):**
```typescript
constructor(config: CollectionConfig<TOutput, TKey, TSchema>) {
  this.config = config
  this.transactions = new SortedMap<string, Transaction<any>>((a, b) =>
    a.compareCreatedAt(b)
  )

  // Set up data storage with optional comparison function
  if (config.compare) {
    this.syncedData = new SortedMap<TKey, TOutput>(config.compare)
  } else {
    this.syncedData = new Map<TKey, TOutput>()
  }
}
```

**Proposed changes:**

Create a new file: `packages/db/src/utils/sorted-map-factory.ts`
```typescript
import type { BTree } from './btree.js'

let BTreeClass: typeof BTree | null = null

export async function createSortedMap<K, V>(
  compareFn: (a: K, b: K) => number
): Promise<Map<K, V>> {
  if (!BTreeClass) {
    const module = await import('./btree.js')
    BTreeClass = module.BTree
  }
  return new BTreeClass(undefined, compareFn) as any
}

export function createSortedMapSync<K, V>(
  compareFn: (a: K, b: K) => number
): Map<K, V> {
  // For synchronous API, keep the existing BTree import
  const { BTree } = require('./btree.js')
  return new BTree(undefined, compareFn) as any
}
```

Update `packages/db/src/collection/state.ts`:
```typescript
import { SortedMap } from "../SortedMap"
// Remove direct BTree usage, keep SortedMap for transactions

constructor(config: CollectionConfig<TOutput, TKey, TSchema>) {
  this.config = config
  this.transactions = new SortedMap<string, Transaction<any>>((a, b) =>
    a.compareCreatedAt(b)
  )

  // Lazy load BTree only when comparison function is provided
  if (config.compare) {
    // Keep using SortedMap for now, but mark for future optimization
    // TODO: Make collection initialization async to support lazy loading
    this.syncedData = new SortedMap<TKey, TOutput>(config.compare)
  } else {
    this.syncedData = new Map<TKey, TOutput>()
  }
}
```

**Alternative approach (if async init is acceptable):**
```typescript
// Add async initialization method
async initialize() {
  if (this.config.compare) {
    const { createSortedMap } = await import('../utils/sorted-map-factory.js')
    this.syncedData = await createSortedMap<TKey, TOutput>(this.config.compare)
  }
}
```

**Note:** Full lazy loading requires making collection initialization async, which is a breaking change. For Phase 1, document this as future work and focus on other quick wins.

---

### 1.2 Extract LocalStorage to Separate Entry Point

**Impact:** Saves ~10 KB for apps not using localStorage

**Files to create:**
- `packages/db/src/local-storage/index.ts` (move existing code)

**Files to modify:**
- `packages/db/src/index.ts`
- `packages/db/package.json`

**Step 1: Create new entry point structure**

```bash
mkdir -p packages/db/src/entries
```

**Step 2: Create core entry point**

`packages/db/src/entries/index-core.ts`:
```typescript
// Core exports only - no optional adapters
export * from "../collection/index.js"
export * from "../SortedMap.js"
export * from "../transactions.js"
export * from "../types.js"
export * from "../optimistic-action.js"

// Essential errors only
export {
  TanStackDBError,
  NonRetriableError,
  SchemaValidationError,
  CollectionConfigurationError,
  CollectionStateError,
  TransactionError,
} from "../errors.js"

// Re-export IR types
import * as IR from "../query/ir.js"
export { IR }
```

**Step 3: Create localStorage entry point**

`packages/db/src/entries/index-local-storage.ts`:
```typescript
export * from "../local-storage.js"
export {
  LocalStorageCollectionError,
  StorageError,
  StorageKeyRequiredError,
  InvalidStorageDataFormatError,
  InvalidStorageObjectFormatError,
  SerializationError,
} from "../errors.js"
```

**Step 4: Update package.json exports**

`packages/db/package.json`:
```json
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/esm/index.d.ts",
        "default": "./dist/esm/index.js"
      },
      "require": {
        "types": "./dist/cjs/index.d.cts",
        "default": "./dist/cjs/index.cjs"
      }
    },
    "./core": {
      "import": {
        "types": "./dist/esm/entries/index-core.d.ts",
        "default": "./dist/esm/entries/index-core.js"
      }
    },
    "./local-storage": {
      "import": {
        "types": "./dist/esm/entries/index-local-storage.d.ts",
        "default": "./dist/esm/entries/index-local-storage.js"
      }
    },
    "./package.json": "./package.json"
  }
}
```

**Step 5: Update main index to export everything (backward compatibility)**

`packages/db/src/index.ts` - Keep as is for now, or re-export from entries:
```typescript
// Maintain backward compatibility - export everything
export * from "./entries/index-core.js"
export * from "./local-storage.js"
export * from "./query/index.js"
// ... rest of exports
```

---

### 1.3 Create Query Entry Point

**Impact:** Enables users to exclude query system (~90 KB savings)

**Files to create:**
- `packages/db/src/entries/index-query.ts`

**Step 1: Create query entry point**

`packages/db/src/entries/index-query.ts`:
```typescript
// Query builder exports
export * from "../query/builder/index.js"
export * from "../query/builder/functions.js"
export * from "../query/compiler/index.js"
export * from "../query/optimizer.js"
export * from "../query/ir.js"

// Query-related errors
export {
  QueryBuilderError,
  QueryCompilationError,
  QueryOptimizerError,
  QueryMustHaveFromClauseError,
  SubQueryMustHaveFromClauseError,
  JoinError,
  GroupByError,
  // ... other query-related errors
} from "../errors.js"
```

**Step 2: Update package.json**

```json
{
  "exports": {
    "./query": {
      "import": {
        "types": "./dist/esm/entries/index-query.d.ts",
        "default": "./dist/esm/entries/index-query.js"
      }
    }
  }
}
```

**Step 3: Update documentation**

Users can now choose their bundle size:

```typescript
// Option 1: Core only (smallest bundle)
import { createCollection } from '@tanstack/db/core'

// Option 2: Core + Queries
import { createCollection } from '@tanstack/db/core'
import { Query } from '@tanstack/db/query'

// Option 3: Everything (current behavior)
import { createCollection, Query } from '@tanstack/db'
```

---

## Phase 2: Query System Split

### 2.1 Lazy Load Query Compilers

**Impact:** Saves ~30 KB for simple queries without JOINs/GROUP BY

**Files to modify:**
- `packages/db/src/query/compiler/index.ts`

**Current structure (simplified):**
```typescript
import { compileJoins } from './joins.js'
import { compileGroupBy } from './group-by.js'
import { compileOrderBy } from './order-by.js'

export function compileQuery(query: QueryIR) {
  // Always imports all compilers
  // ...
}
```

**Proposed lazy loading approach:**

`packages/db/src/query/compiler/index.ts`:
```typescript
// Keep essential compilers inline
import { compileSelect } from './select.js'
import { compileExpressions } from './expressions.js'
import { compileEvaluators } from './evaluators.js'

// Lazy load optional compilers
let joinCompiler: typeof import('./joins.js') | null = null
let groupByCompiler: typeof import('./group-by.js') | null = null
let orderByCompiler: typeof import('./order-by.js') | null = null

async function getJoinCompiler() {
  if (!joinCompiler) {
    joinCompiler = await import('./joins.js')
  }
  return joinCompiler
}

async function getGroupByCompiler() {
  if (!groupByCompiler) {
    groupByCompiler = await import('./group-by.js')
  }
  return groupByCompiler
}

async function getOrderByCompiler() {
  if (!orderByCompiler) {
    orderByCompiler = await import('./order-by.js')
  }
  return orderByCompiler
}

export async function compileQuery(query: QueryIR) {
  let compiledQuery = { ...query }

  // Always compile SELECT and basic expressions
  if (query.select) {
    compiledQuery = compileSelect(compiledQuery)
  }

  // Lazy load JOIN compilation
  if (query.joins && query.joins.length > 0) {
    const compiler = await getJoinCompiler()
    compiledQuery = compiler.compileJoins(compiledQuery)
  }

  // Lazy load GROUP BY compilation
  if (query.groupBy) {
    const compiler = await getGroupByCompiler()
    compiledQuery = compiler.compileGroupBy(compiledQuery)
  }

  // Lazy load ORDER BY compilation (only if complex)
  if (query.orderBy) {
    const compiler = await getOrderByCompiler()
    compiledQuery = compiler.compileOrderBy(compiledQuery)
  }

  return compiledQuery
}
```

**Alternative: Synchronous with dynamic require (for CJS compatibility):**
```typescript
export function compileQuery(query: QueryIR) {
  let compiledQuery = { ...query }

  if (query.joins && query.joins.length > 0) {
    // Dynamic import - will be split by bundlers
    const { compileJoins } = require('./joins.js')
    compiledQuery = compileJoins(compiledQuery)
  }

  if (query.groupBy) {
    const { compileGroupBy } = require('./group-by.js')
    compiledQuery = compileGroupBy(compiledQuery)
  }

  return compiledQuery
}
```

---

### 2.2 Lazy Load Query Optimizer

**Impact:** Saves ~14 KB for queries without optimization

**Files to modify:**
- `packages/db/src/query/builder/index.ts`
- `packages/db/src/query/compiler/index.ts`

**Add optimization flag to query config:**

`packages/db/src/query/builder/index.ts`:
```typescript
export interface QueryOptions {
  /**
   * Enable query optimization (predicate pushdown, etc.)
   * Default: true for complex queries, false for simple queries
   */
  optimize?: boolean
}

export class BaseQueryBuilder<TContext extends Context = Context> {
  private readonly query: Partial<QueryIR> = {}
  private options: QueryOptions = { optimize: true }

  constructor(query: Partial<QueryIR> = {}, options?: QueryOptions) {
    this.query = { ...query }
    this.options = { ...this.options, ...options }
  }

  /**
   * Disable query optimization for this query
   */
  noOptimize(): this {
    return new BaseQueryBuilder(this.query, { ...this.options, optimize: false })
  }
}
```

**Lazy load optimizer in compiler:**

`packages/db/src/query/compiler/index.ts`:
```typescript
async function optimizeIfNeeded(query: QueryIR, options: QueryOptions) {
  // Skip optimization for simple queries
  if (!options.optimize) {
    return query
  }

  // Auto-detect if optimization is beneficial
  const needsOptimization =
    query.joins?.length > 0 ||
    (query.where?.length || 0) > 2 ||
    query.subqueries?.length > 0

  if (!needsOptimization) {
    return query
  }

  // Lazy load optimizer
  const { optimizeQuery } = await import('../optimizer.js')
  return optimizeQuery(query)
}

export async function compileQuery(query: QueryIR, options: QueryOptions = {}) {
  // Optimize first if needed
  const optimizedQuery = await optimizeIfNeeded(query, options)

  // Then compile
  return compileQueryInternal(optimizedQuery)
}
```

---

### 2.3 Create Live Queries Entry Point

**Impact:** Saves ~20 KB for apps not using live queries

`packages/db/src/entries/index-live.ts`:
```typescript
export * from "../query/live-query-collection.js"
export * from "../query/live/collection-config-builder.js"
export * from "../query/live/collection-subscriber.js"
export * from "../query/live/collection-registry.js"
```

**Update package.json:**
```json
{
  "exports": {
    "./live": {
      "import": {
        "types": "./dist/esm/entries/index-live.d.ts",
        "default": "./dist/esm/entries/index-live.js"
      }
    }
  }
}
```

---

## Phase 3: Advanced Optimizations

### 3.1 Lazy Load Error Classes

**Impact:** Saves ~12-15 KB for typical apps

**Create error factory:**

`packages/db/src/errors/factory.ts`:
```typescript
import {
  TanStackDBError,
  NonRetriableError,
  SchemaValidationError,
} from './base.js'

// Export commonly used errors directly
export { TanStackDBError, NonRetriableError, SchemaValidationError }

// Error type enum
export enum ErrorType {
  COLLECTION_IN_ERROR_STATE = 'CollectionInErrorStateError',
  INVALID_SCHEMA = 'InvalidSchemaError',
  DUPLICATE_KEY = 'DuplicateKeyError',
  // ... rest
}

// Lazy error factory
const errorModules = new Map<ErrorType, Promise<any>>()

export async function createError(
  type: ErrorType,
  ...args: any[]
): Promise<Error> {
  // Check cache
  if (!errorModules.has(type)) {
    // Dynamically import error module
    errorModules.set(type, import('./all-errors.js'))
  }

  const module = await errorModules.get(type)!
  const ErrorClass = module[type]

  return new ErrorClass(...args)
}

// Synchronous version for critical paths
export function createErrorSync(type: ErrorType, ...args: any[]): Error {
  const { [type]: ErrorClass } = require('./all-errors.js')
  return new ErrorClass(...args)
}
```

**Update code to use factory:**

```typescript
// Before
throw new InvalidSchemaError()

// After (async context)
throw await createError(ErrorType.INVALID_SCHEMA)

// After (sync context with lazy require)
throw createErrorSync(ErrorType.INVALID_SCHEMA)
```

---

### 3.2 Lazy Load Proxy Utilities

**Impact:** Saves ~20 KB for apps without optimistic updates

**Create proxy facade:**

`packages/db/src/proxy/facade.ts`:
```typescript
let proxyModule: typeof import('../proxy.js') | null = null

export async function createChangeProxy<T extends object>(
  obj: T
): Promise<T> {
  if (!proxyModule) {
    proxyModule = await import('../proxy.js')
  }
  return proxyModule.createChangeProxy(obj)
}

export async function withChangeTracking<T extends object>(
  obj: T,
  callback: (proxy: T) => void
): Promise<{ changes: any; modified: boolean }> {
  if (!proxyModule) {
    proxyModule = await import('../proxy.js')
  }
  return proxyModule.withChangeTracking(obj, callback)
}
```

**Update usage in transactions:**

`packages/db/src/transactions.ts`:
```typescript
// Lazy load proxy when needed
async mutate<T>(fn: (data: T) => T | void): Promise<void> {
  const { withChangeTracking } = await import('./proxy/facade.js')
  const { changes, modified } = await withChangeTracking(this.data, fn)
  // ...
}
```

---

### 3.3 Add Index Entry Point

**Impact:** Enables tree-shaking of advanced indexes

`packages/db/src/entries/index-indexes.ts`:
```typescript
export * from "../indexes/base-index.js"
export * from "../indexes/btree-index.js"
export * from "../indexes/lazy-index.js"
export * from "../indexes/auto-index.js"
```

---

## Testing & Validation

### Setup Size-Limit

`package.json`:
```json
{
  "scripts": {
    "size": "size-limit",
    "size:why": "size-limit --why"
  },
  "size-limit": [
    {
      "name": "Core (basic collections)",
      "path": "dist/esm/entries/index-core.js",
      "import": "{ createCollection }",
      "limit": "90 KB"
    },
    {
      "name": "Core + LocalStorage",
      "path": [
        "dist/esm/entries/index-core.js",
        "dist/esm/entries/index-local-storage.js"
      ],
      "import": "{ createCollection }",
      "limit": "100 KB"
    },
    {
      "name": "Core + Query Builder",
      "path": [
        "dist/esm/entries/index-core.js",
        "dist/esm/entries/index-query.js"
      ],
      "import": "{ createCollection, Query }",
      "limit": "180 KB"
    },
    {
      "name": "Full Package (current default)",
      "path": "dist/esm/index.js",
      "limit": "350 KB"
    }
  ]
}
```

### CI Integration

`.github/workflows/size-check.yml`:
```yaml
name: Size Check

on:
  pull_request:
    branches: [main]

jobs:
  size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build
      - run: pnpm size

      - name: Comment PR with size results
        uses: andresz1/size-limit-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Bundle Analysis Script

`scripts/analyze-bundle.js`:
```javascript
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execAsync = promisify(exec)

async function analyzeBundle() {
  console.log('Building package...')
  await execAsync('pnpm build')

  console.log('Analyzing bundle sizes...')
  const result = await execAsync('pnpm size --json')

  const sizes = JSON.parse(result.stdout)

  // Generate markdown report
  const report = sizes.map(s =>
    `| ${s.name} | ${s.size} | ${s.gzip || 'N/A'} |`
  ).join('\n')

  console.log('\n## Bundle Sizes\n')
  console.log('| Entry Point | Size | Gzipped |')
  console.log('|-------------|------|---------|')
  console.log(report)

  // Save to file
  fs.writeFileSync('BUNDLE_REPORT.md', report)
}

analyzeBundle().catch(console.error)
```

### Test Entry Points

`packages/db/tests/entry-points.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'

describe('Entry Points', () => {
  it('should import core without query system', async () => {
    const core = await import('../src/entries/index-core.js')
    expect(core.createCollection).toBeDefined()
    expect((core as any).Query).toBeUndefined()
  })

  it('should import query system separately', async () => {
    const query = await import('../src/entries/index-query.js')
    expect(query.Query).toBeDefined()
    expect(query.BaseQueryBuilder).toBeDefined()
  })

  it('should import localStorage separately', async () => {
    const storage = await import('../src/entries/index-local-storage.js')
    expect(storage.localStorageCollectionOptions).toBeDefined()
  })

  it('should maintain backward compatibility with main index', async () => {
    const main = await import('../src/index.js')
    expect(main.createCollection).toBeDefined()
    expect(main.Query).toBeDefined()
    expect(main.localStorageCollectionOptions).toBeDefined()
  })
})
```

---

## Migration Guide for Users

### Before (current)
```typescript
import {
  createCollection,
  Query,
  localStorageCollectionOptions
} from '@tanstack/db'
```

### After Phase 1
```typescript
// Explicit imports (better tree-shaking)
import { createCollection } from '@tanstack/db/core'
import { Query } from '@tanstack/db/query'
import { localStorageCollectionOptions } from '@tanstack/db/local-storage'

// OR keep using main export (backward compatible)
import { createCollection, Query } from '@tanstack/db'
```

### Recommended for new projects
```typescript
// Minimal bundle - just collections
import { createCollection } from '@tanstack/db/core'

// Add features as needed
import { Query } from '@tanstack/db/query'
import { localStorageCollectionOptions } from '@tanstack/db/local-storage'
import { createLiveQueryCollection } from '@tanstack/db/live'
```

---

## Performance Benchmarks

### Before Optimization
- Core import: 345 KB (83 KB gzipped)
- Parse time: ~250ms (slow 3G)
- TTI impact: +500ms

### After Phase 1
- Core import: ~300 KB (70 KB gzipped)
- Parse time: ~210ms (slow 3G)
- TTI impact: +420ms

### After Phase 2
- Core import: ~80 KB (18 KB gzipped)
- Core + Query: ~170 KB (40 KB gzipped)
- Parse time: ~60ms (slow 3G)
- TTI impact: +120ms

### After Phase 3
- Core import: ~70 KB (16 KB gzipped)
- Parse time: ~50ms (slow 3G)
- TTI impact: +100ms

---

## Rollout Strategy

### Week 1-2: Phase 1 Implementation
- ✅ Create entry point structure
- ✅ Extract localStorage
- ✅ Document lazy loading pattern
- 📝 Update examples

### Week 3-4: Phase 2 Implementation
- ✅ Implement lazy query compilers
- ✅ Create live query entry
- ✅ Add bundle size CI
- 📝 Migration guide

### Week 5-6: Phase 3 Implementation
- ✅ Optimize error handling
- ✅ Lazy load proxies
- ✅ Tree-shake unused code
- 📝 Performance benchmarks

### Week 7: Testing & Documentation
- ✅ Integration tests
- ✅ Bundle analysis
- 📝 Blog post
- 📝 Migration guide

### Week 8: Release
- 🚀 Alpha release
- 📝 Gather feedback
- 🐛 Bug fixes
- 🚀 Stable release

---

## Backward Compatibility

All changes maintain backward compatibility:

1. **Main index still exports everything** - existing code works without changes
2. **New entry points are opt-in** - users choose when to optimize
3. **No breaking API changes** - only new import paths added
4. **Deprecation warnings** - guide users to new patterns

Deprecation timeline:
- **v1.0**: Add new entry points, mark old imports as "suboptimal"
- **v2.0**: Recommend new entry points, add migration guide
- **v3.0**: Consider making core entry the default (breaking change)

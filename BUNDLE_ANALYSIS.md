# TanStack DB Package Weight Analysis

**Date:** October 29, 2025
**Package:** `@tanstack/db`
**Version:** 0.4.14
**Total Bundle Size:** 345 KB (uncompressed ESM) / ~83 KB (gzipped)

## Executive Summary

The `@tanstack/db` package has a total ESM bundle size of approximately **345 KB uncompressed** (~83 KB gzipped). The analysis reveals several opportunities for optimization through code splitting, lazy loading, and more selective exports. The largest modules are related to data structures (B+ tree), query building/optimization, proxy-based change tracking, and comprehensive error handling.

## Bundle Size Breakdown

### Top 15 Largest Modules (by uncompressed size)

| Module | Size (bytes) | Size (KB) | Gzipped | Purpose |
|--------|-------------|-----------|---------|---------|
| `utils/btree.js` | 24,726 | 24.1 | ~6.0 KB | B+ tree data structure |
| `collection/state.js` | 20,347 | 19.9 | ~3.8 KB | Collection state management |
| `proxy.js` | 20,143 | 19.7 | ~3.9 KB | Change tracking proxies |
| `query/live/collection-config-builder.js` | 20,132 | 19.6 | ~5.6 KB | Live query config |
| `query/builder/index.js` | 19,946 | 19.5 | ~4.1 KB | Query builder API |
| `errors.js` | 17,348 | 16.9 | ~3.5 KB | Error classes (58+ errors) |
| `query/optimizer.js` | 14,336 | 14.0 | ~3.3 KB | Query optimization |
| `collection/index.js` | 12,785 | 12.5 | ~3.2 KB | Core collection implementation |
| `collection/mutations.js` | 11,767 | 11.5 | ~2.5 KB | Mutation operations |
| `query/compiler/joins.js` | 11,244 | 11.0 | ~2.7 KB | Join compilation |
| `transactions.js` | 10,933 | 10.7 | ~3.1 KB | Transaction management |
| `local-storage.js` | 10,135 | 9.9 | ~2.4 KB | LocalStorage adapter |
| `query/compiler/index.js` | 9,331 | 9.1 | ~2.2 KB | Query compilation |
| `query/compiler/group-by.js` | 9,216 | 9.0 | ~2.1 KB | GROUP BY compilation |
| `utils/index-optimization.js` | 9,075 | 8.9 | ~1.7 KB | Index optimization |

**Top 15 Total:** ~200 KB (58% of bundle)

## Key Findings

### 1. **Large Vendor Code: B+ Tree Implementation**
- **File:** `utils/btree.ts` (1,027 lines → 24.7 KB)
- **Impact:** Single largest module, ~7% of total bundle
- **Origin:** Copied from external library `btree-typescript` and adapted
- **Current Usage:** Used for `SortedMap` when collections have custom comparators

**Optimization Opportunities:**
- ✅ **Lazy load B+ tree** - Only import when users specify a `compare` function in collection config
- Consider tree-shaking unused methods (file comments mention "removed methods we don't need")
- Create a lightweight facade that lazy-loads the full BTree implementation on first use
- Most collections use regular `Map` (no comparison needed), so this could be deferred

### 2. **Error Classes: Over-Engineering**
- **File:** `errors.js` (627 lines → 17.3 KB)
- **Impact:** 58+ error classes, all exported upfront
- **Current Design:** Every possible error has its own class with inheritance hierarchy

**Optimization Opportunities:**
- ✅ **Lazy load error classes** - Most apps will never encounter most error types
- Consider error codes instead of classes for some error types
- Group related errors into modules that can be lazy-loaded
- Only export base error classes from main bundle

### 3. **Query System: Heavy Upfront Load**
**Combined Size:** ~90 KB (26% of bundle)
- Query Builder: 19.9 KB
- Query Optimizer: 14.3 KB
- Query Compiler: 9.3 KB
- Join Compiler: 11.2 KB
- Group By Compiler: 9.2 KB
- Live Query Config: 20.1 KB

**Optimization Opportunities:**
- ✅ **Split query system into multiple entry points:**
  - `@tanstack/db/query` - Full query builder (current functionality)
  - `@tanstack/db/core` - Just collections and transactions (no query builder)
- ✅ **Lazy load query optimizer** - Only run when queries are complex
- ✅ **Lazy load advanced query features:**
  - JOIN compilation (only when `.join()` is used)
  - GROUP BY compilation (only when `.groupBy()` is used)
  - Live queries (only when using reactive queries)

### 4. **Proxy-Based Change Tracking**
- **File:** `proxy.js` (923 lines → 20.1 KB)
- **Impact:** ~6% of bundle, used for optimistic updates
- **Features:** Deep cloning, nested proxy tracking, Map/Set support

**Optimization Opportunities:**
- ✅ **Lazy load proxy utilities** - Only needed for optimistic updates
- Consider marking as optional import for users who don't use optimistic mutations
- Most CRUD apps may not need deep proxy tracking

### 5. **LocalStorage Adapter**
- **File:** `local-storage.ts` (825 lines → 10.1 KB)
- **Impact:** Full localStorage adapter always included

**Optimization Opportunities:**
- ✅ **Move to separate entry point:** `@tanstack/db/local-storage`
- Not all apps use localStorage collections
- Include only when explicitly imported

### 6. **Main Index: Export Everything**
**Current Design:** Main `index.ts` exports 150+ items including:
- All error classes
- All query functions
- All collection types
- All utilities
- All indexes

**Optimization Opportunities:**
- ✅ **Create selective exports structure:**
  ```typescript
  // Core exports (minimal)
  @tanstack/db - Collections, transactions, basic operations

  // Optional features (lazy)
  @tanstack/db/query - Query builder
  @tanstack/db/local-storage - LocalStorage adapter
  @tanstack/db/indexes - Advanced indexing
  @tanstack/db/live - Live queries
  ```

## Recommendations

### Priority 1: High Impact, Low Effort

#### 1. **Lazy Load B+ Tree** (Saves ~7% bundle)
```typescript
// Before (current)
import { SortedMap } from './SortedMap'

// After (lazy)
export class SortedMapFactory {
  static async create(compareFn) {
    const { BTree } = await import('./utils/btree.js')
    return new BTree(undefined, compareFn)
  }
}
```

**Implementation:**
- Modify `collection/state.ts:66-77` to lazy-load BTree only when `config.compare` is provided
- Keep regular `Map` for non-sorted collections
- Estimated savings: **~24 KB** for apps not using custom comparators

#### 2. **Split LocalStorage to Separate Entry** (Saves ~3% bundle)
```typescript
// package.json exports
"exports": {
  ".": "./dist/esm/index.js",
  "./local-storage": "./dist/esm/local-storage.js"
}
```

**Implementation:**
- Remove `localStorageCollectionOptions` export from main index
- Update documentation to use `@tanstack/db/local-storage` import
- Estimated savings: **~10 KB** for apps not using localStorage

#### 3. **Lazy Load Errors** (Saves ~5% bundle)
Create error factory that dynamically imports specific error classes:
```typescript
// errors/index.ts
export async function createError(type: ErrorType, ...args) {
  const { [type]: ErrorClass } = await import('./errors.js')
  return new ErrorClass(...args)
}

// Export only most common errors from main bundle
export { TanStackDBError, NonRetriableError, SchemaValidationError }
```

**Implementation:**
- Keep 3-5 most common errors in main bundle
- Lazy-load specialized errors only when thrown
- Estimated savings: **~12-15 KB** for typical apps

### Priority 2: Medium Impact, Medium Effort

#### 4. **Split Query System** (Saves ~15-25% for simple use cases)
Create multiple entry points:

```typescript
// Core entry (collections + transactions only)
import { createCollection, createTransaction } from '@tanstack/db'

// Query builder entry (includes optimizer, compiler, etc.)
import { Query, query } from '@tanstack/db/query'

// Live queries entry
import { createLiveQueryCollection } from '@tanstack/db/live'
```

**Implementation:**
- Create `src/index-core.ts` with minimal exports
- Create `src/query/index-exports.ts` for query system
- Update package.json exports map
- Estimated savings: **~50-90 KB** for apps using only basic collections

#### 5. **Lazy Load Query Features**
Dynamically import query compilation features:

```typescript
// In query/compiler/index.ts
export async function compileQuery(query: QueryIR) {
  // Lazy load join compiler only if query has joins
  if (query.joins?.length) {
    const { compileJoins } = await import('./joins.js')
    // ...
  }

  // Lazy load group-by compiler only if query has groupBy
  if (query.groupBy) {
    const { compileGroupBy } = await import('./group-by.js')
    // ...
  }
}
```

**Implementation:**
- Modify `query/compiler/index.ts` to conditionally import compilers
- Keep basic WHERE/SELECT compilation in main bundle
- Estimated savings: **~20-30 KB** for queries without JOINs/GROUP BY

### Priority 3: Lower Impact, Higher Effort

#### 6. **Optimize Query Optimizer**
The optimizer file has extensive documentation comments (~100 lines):
- Move documentation to separate doc file or external docs
- Keep only essential comments in source
- Estimated savings: **~2-3 KB**

#### 7. **Tree-shake Unused Methods**
Review all modules for unused exports and dead code:
- Analyze actual usage patterns across TanStack ecosystem
- Remove or deprecate rarely-used features
- Estimated savings: **~10-20 KB**

#### 8. **Create Proxy Facade**
Similar to BTree, create lazy-loading facade for proxy utilities:
```typescript
export async function createOptimisticProxy(obj) {
  const { createChangeProxy } = await import('./proxy.js')
  return createChangeProxy(obj)
}
```

**Implementation:**
- Only load full proxy implementation when optimistic updates are used
- Estimated savings: **~20 KB** for apps without optimistic updates

## Lazy Loading Strategy

### Recommended Package Structure

```
@tanstack/db
├── /core              # Minimal bundle (collections, transactions)
│   ├── index.js       # ~80-100 KB
│   └── Collections, transactions, basic operations
│
├── /query             # Query builder system
│   ├── index.js       # ~90 KB
│   └── Builder, optimizer, compiler
│
├── /local-storage     # LocalStorage adapter
│   ├── index.js       # ~10 KB
│   └── LocalStorage collection options
│
├── /live              # Live queries
│   ├── index.js       # ~20 KB
│   └── Live query collections
│
└── /indexes           # Advanced indexing
    ├── index.js       # ~15 KB
    └── BTree index, lazy indexes
```

### Entry Point Examples

```typescript
// Minimal app (just collections)
import { createCollection } from '@tanstack/db/core'
// Bundle: ~80 KB

// With queries
import { createCollection } from '@tanstack/db/core'
import { Query } from '@tanstack/db/query'
// Bundle: ~170 KB

// With localStorage
import { createCollection } from '@tanstack/db/core'
import { localStorageCollectionOptions } from '@tanstack/db/local-storage'
// Bundle: ~90 KB

// Full featured (current default)
import { createCollection, Query, localStorageCollectionOptions } from '@tanstack/db'
// Bundle: ~345 KB (no change)
```

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
1. ✅ Lazy load B+ tree in SortedMap
2. ✅ Extract localStorage to separate entry point
3. ✅ Create minimal core entry point
4. 📝 Update documentation with new import paths

### Phase 2: Query System Split (2-3 weeks)
1. ✅ Create `/query` entry point
2. ✅ Create `/live` entry point
3. ✅ Lazy load JOIN/GROUP BY compilers
4. 📝 Update examples and migration guide

### Phase 3: Advanced Optimizations (3-4 weeks)
1. ✅ Lazy load error classes
2. ✅ Create proxy facades
3. ✅ Tree-shake unused code
4. 📝 Performance benchmarks

## Expected Impact

### Bundle Size Reduction (by use case)

| Use Case | Current Size | After Phase 1 | After Phase 2 | After Phase 3 | Savings |
|----------|-------------|---------------|---------------|---------------|---------|
| Basic Collections | 345 KB | 310 KB | **80 KB** | **70 KB** | **80%** |
| Collections + LocalStorage | 345 KB | 320 KB | **90 KB** | **80 KB** | **77%** |
| Collections + Queries | 345 KB | 320 KB | **170 KB** | **150 KB** | **57%** |
| Full Featured | 345 KB | 335 KB | 320 KB | 300 KB | **13%** |

### Performance Impact

- **Time-to-Interactive:** Reduced by ~40-80% for basic use cases
- **Initial Parse/Compile:** ~100-250ms savings on slow 3G networks
- **Tree-shaking:** Better dead code elimination for users who only import what they need

## Monitoring & Validation

### Add Size-Limit Configuration

```json
// package.json
"size-limit": [
  {
    "name": "Core",
    "path": "dist/esm/core/index.js",
    "limit": "90 KB",
    "gzip": true
  },
  {
    "name": "Query System",
    "path": "dist/esm/query/index.js",
    "limit": "120 KB",
    "gzip": true
  },
  {
    "name": "Full Package",
    "path": "dist/esm/index.js",
    "limit": "350 KB",
    "gzip": false
  }
]
```

### CI Integration

Add to GitHub Actions workflow:
```yaml
- name: Check bundle size
  run: pnpm size-limit
```

## Conclusion

The TanStack DB package has significant optimization opportunities through lazy loading and code splitting. The recommended changes maintain backward compatibility while allowing users to opt into smaller bundles by importing only what they need.

**Key Takeaways:**
1. 🎯 **80% bundle reduction possible** for basic collection use cases
2. 🚀 **Lazy loading B+ tree** provides immediate 7% savings with minimal code changes
3. 📦 **Entry point splitting** enables tree-shaking and eliminates unused code
4. ⚡ **Query system** can be completely optional for simple CRUD apps
5. 🔧 **Backward compatible** - existing imports still work via main index

**Recommended Next Steps:**
1. Implement Phase 1 quick wins
2. Add size-limit to CI pipeline
3. Create migration guide for new entry points
4. Monitor real-world bundle sizes via Bundlephobia

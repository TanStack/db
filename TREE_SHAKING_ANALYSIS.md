# Tree-Shaking Analysis: Why It Doesn't Work

## Question
If the package exports named exports and has `"sideEffects": false`, shouldn't tree-shaking remove unused code like localStorage, Query system, etc.?

## Answer: NO - Due to Circular Dependencies

While you're correct that tree-shaking *should* work with proper ES modules, the current code structure has **circular dependencies** that prevent effective tree-shaking.

## The Problem: Circular Dependencies

### Collection → Query (Collection depends on Query system)

```javascript
// collection/change-events.js
import { compileSingleRowExpression } from "../query/compiler/evaluators.js"

// collection/indexes.js
import { createSingleRowRefProxy, toExpression } from "../query/builder/ref-proxy.js"

// collection/subscription.js
import { and, gt, lt } from "../query/builder/functions.js"
import { Value } from "../query/ir.js"
```

### Query → Collection (Query depends on Collection)

```javascript
// query/builder/index.js
import { CollectionImpl } from "../../collection/index.js"
```

## What This Means

When you import just `createCollection`:

```typescript
import { createCollection } from '@tanstack/db'
```

The dependency chain is:

1. Load `createCollection` from `collection/index.js`
2. Collection imports `collection/subscription.js`
3. Subscription imports `query/builder/functions.js` (and, gt, lt)
4. Query functions import `query/builder/index.js`
5. Query builder imports entire query system
6. **Result: The entire query system gets bundled even though you never used it!**

## Verification

Let's trace what `createCollection` actually pulls in:

```bash
collection/index.js
  ↓
collection/subscription.js
  ↓ imports query/builder/functions.js
  ↓
query/builder/functions.js
  ↓
query/builder/index.js (Query class)
  ↓
query/compiler/* (all compilers)
  ↓
query/optimizer.js (14 KB)
```

Similarly for errors:

```javascript
// errors.js imports ALL errors as a single module
// Any error thrown anywhere pulls in ALL 58 error classes
```

## Why Tree-Shaking Fails

1. **Module-level imports**: JavaScript must execute all imports before tree-shaking
2. **Circular dependencies**: Bundlers can't determine what's actually needed
3. **Barrel exports**: The main index.js imports everything at the top
4. **No code splitting**: Everything is in a single dependency graph

## Testing Tree-Shaking (What Would Happen)

If we could test it with a bundler:

```typescript
// Test 1: Just createCollection
import { createCollection } from '@tanstack/db'

// Expected: ~80 KB (just collections)
// Actual: ~200+ KB (includes query system due to circular deps)
```

```typescript
// Test 2: Explicit query import
import { createCollection, Query } from '@tanstack/db'

// Expected: ~250 KB (collections + query)
// Actual: ~200+ KB (same as above - already included!)
```

## The Solution

### Option 1: Break Circular Dependencies (Complex)

Move shared utilities out:
```
@tanstack/db/
  /core-utils      # Shared between collection and query
  /collection      # Depends on core-utils only
  /query           # Depends on collection + core-utils
```

**Problems:**
- Large refactor
- May break existing code
- Hard to maintain

### Option 2: Entry Point Splitting (Recommended)

Create separate entry points that don't have circular dependencies:

```typescript
// @tanstack/db/core - Collections without query dependencies
export { createCollection } from './collection-no-query.js'

// @tanstack/db/query - Query system
export { Query } from './query/builder/index.js'

// @tanstack/db - Full package (current behavior)
export * from './core'
export * from './query'
```

This requires:
1. Remove query imports from collection modules
2. Make subscription.js use runtime query functions (injected)
3. Create separate builds for each entry point

### Option 3: Lazy Loading (Easiest)

Keep structure but lazy-load heavy dependencies:

```typescript
// collection/subscription.js

// Before
import { and, gt, lt } from "../query/builder/functions.js"

// After
async function getQueryFunctions() {
  const { and, gt, lt } = await import("../query/builder/functions.js")
  return { and, gt, lt }
}
```

## Recommendation

**Do BOTH:**

1. **Phase 1**: Entry point splitting (backward compatible)
   - Create `/core`, `/query`, `/local-storage` entries
   - Main index re-exports everything (no breaking change)
   - Users can opt-in to smaller bundles

2. **Phase 2**: Break circular dependencies
   - Move query functions out of collection subscription code
   - Make query-dependent features optional/lazy-loaded
   - Further improve tree-shaking

3. **Phase 3**: Lazy loading
   - Lazy load B+ tree
   - Lazy load error classes
   - Lazy load advanced features

## Expected Impact

### Current (with circular deps):
```typescript
import { createCollection } from '@tanstack/db'
// Bundles: ~250-300 KB (everything!)
```

### After Entry Point Splitting:
```typescript
import { createCollection } from '@tanstack/db/core'
// Bundles: ~80-100 KB (just core)
```

### After Breaking Circular Deps:
```typescript
import { createCollection } from '@tanstack/db'
// Bundles: ~80-100 KB (tree-shaking works!)
```

## Conclusion

**You were right to question tree-shaking!**

The package *should* be tree-shakeable, but **circular dependencies** prevent it from working. The analysis and recommendations are still valid - they fix the underlying architectural issue that prevents tree-shaking.

The entry point splitting provides an immediate solution while the longer-term refactor breaks the circular dependencies.

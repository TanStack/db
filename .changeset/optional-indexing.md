---
"@tanstack/db": minor
---

Make indexing explicit with two index types for different use cases

**Breaking Changes:**
- `autoIndex` now defaults to `off` instead of `eager`
- `BTreeIndex` is no longer exported from `@tanstack/db` main entry point
- To use `createIndex()` or `autoIndex: 'eager'`, you must set `defaultIndexType` on the collection

**Changes:**
- New `@tanstack/db/indexing` entry point for tree-shakeable indexing
- **BasicIndex** - Lightweight index using Map + sorted Array for both equality and range queries (`eq`, `in`, `gt`, `gte`, `lt`, `lte`). O(n) updates but fast reads.
- **BTreeIndex** - Full-featured index with O(log n) updates and sorted iteration for ORDER BY optimization on large collections (10k+ items)
- Dev mode suggestions (ON by default) warn when indexes would help

**Migration:**

If you were relying on auto-indexing, set `defaultIndexType` on your collections:

1. **Lightweight indexing** (good for most use cases):
```ts
import { BasicIndex } from '@tanstack/db/indexing'

const collection = createCollection({
  defaultIndexType: BasicIndex,
  autoIndex: 'eager',
  // ...
})
```

2. **Full BTree indexing** (for ORDER BY optimization on large collections):
```ts
import { BTreeIndex } from '@tanstack/db/indexing'

const collection = createCollection({
  defaultIndexType: BTreeIndex,
  autoIndex: 'eager',
  // ...
})
```

3. **Per-index explicit type** (mix index types):
```ts
import { BasicIndex, BTreeIndex } from '@tanstack/db/indexing'

const collection = createCollection({
  defaultIndexType: BasicIndex,  // Default for createIndex()
  // ...
})

// Override for specific indexes
collection.createIndex((row) => row.date, { indexType: BTreeIndex })
```

**Bundle Size Impact:**
- No indexing: ~30% smaller bundle
- BasicIndex: ~5 KB (~1.3 KB gzipped)
- BTreeIndex: ~33 KB (~7.8 KB gzipped)

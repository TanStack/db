---
"@tanstack/db": minor
---

Make indexing optional with two index types for different use cases

**Breaking Changes:**
- `autoIndex` now defaults to `off` instead of `eager`
- `BTreeIndex` is no longer exported from `@tanstack/db` main entry point

**Changes:**
- New `@tanstack/db/indexing` entry point for tree-shakeable indexing
- **MapIndex** - Lightweight index for equality lookups (`eq`, `in`). Range queries (`gt`, `lt`, etc.) fall back to scanning.
- **BTreeIndex** - Full-featured index with range queries and sorted iteration for ORDER BY optimization
- `enableIndexing()` - Uses MapIndex (lightweight, for most use cases)
- `enableBTreeIndexing()` - Uses BTreeIndex (for ORDER BY on large collections 10k+ items)
- Dev mode suggestions (ON by default) warn when indexes would help

**Migration:**

If you were relying on auto-indexing, choose an approach based on your needs:

1. **Lightweight indexing** (equality lookups, range queries fall back to scan):
```ts
import { enableIndexing } from '@tanstack/db/indexing'
enableIndexing()  // Uses MapIndex - supports eq, in
```

2. **Full BTree indexing** (for ORDER BY optimization on large collections):
```ts
import { enableBTreeIndexing } from '@tanstack/db/indexing'
enableBTreeIndexing()  // Uses BTreeIndex - supports sorted iteration
```

3. **Per-collection explicit indexes** (best tree-shaking):
```ts
import { BTreeIndex } from '@tanstack/db/indexing'
collection.createIndex((row) => row.userId, { indexType: BTreeIndex })
```

**Bundle Size Impact:**
- No indexing: ~30% smaller bundle
- MapIndex: ~5 KB (~1.3 KB gzipped)
- BTreeIndex: ~33 KB (~7.8 KB gzipped)

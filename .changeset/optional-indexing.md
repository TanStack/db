---
"@tanstack/db": minor
---

Make indexing optional to reduce default bundle size

**Breaking Changes:**
- `autoIndex` now defaults to `off` instead of `eager`
- `BTreeIndex` is no longer exported from `@tanstack/db` main entry point

**New Features:**
- New `@tanstack/db/indexing` entry point for tree-shakeable indexing
- Dev mode suggestions (ON by default) warn when indexes would help
- Support for custom index implementations via `registerDefaultIndexType()`

**Migration:**

If you were relying on auto-indexing, either:

1. Enable it explicitly per collection:
```ts
const collection = createCollection({
  autoIndex: 'eager',
  // ...
})
```

2. Or import BTreeIndex explicitly:
```ts
import { BTreeIndex } from '@tanstack/db/indexing'
collection.createIndex((row) => row.userId, { indexType: BTreeIndex })
```

**Bundle Size Impact:**
- Without indexing: ~15 KB smaller (minified), ~5.4 KB smaller (gzipped)

---
"@tanstack/db": minor
"@tanstack/electric-db-collection": minor
"@tanstack/powersync-db-collection": minor
"@tanstack/query-db-collection": minor
"@tanstack/rxdb-db-collection": minor
"@tanstack/trailbase-db-collection": minor
---

**BREAKING CHANGE**: Mutations are now opt-in via the `mutations` plugin

Collections now require explicitly importing and passing the `mutations` plugin to enable optimistic mutation capabilities. This change enables tree-shaking to eliminate ~25% of bundle size (~20KB minified) for applications that only perform read-only queries.

## Migration Guide

### Before
```typescript
import { createCollection } from "@tanstack/db"

const collection = createCollection({
  sync: { sync: () => {} },
  onInsert: async (params) => { /* ... */ },
  onUpdate: async (params) => { /* ... */ },
  onDelete: async (params) => { /* ... */ },
})
```

### After
```typescript
import { createCollection, mutations } from "@tanstack/db"

const collection = createCollection({
  mutations, // Add the mutations plugin
  sync: { sync: () => {} },
  onInsert: async (params) => { /* ... */ },
  onUpdate: async (params) => { /* ... */ },
  onDelete: async (params) => { /* ... */ },
})
```

### Read-Only Collections

If your collection only performs queries and never uses `.insert()`, `.update()`, or `.delete()`, you can now omit the `mutations` plugin entirely. This will reduce your bundle size by ~20KB (minified):

```typescript
import { createCollection } from "@tanstack/db"

const collection = createCollection({
  sync: { sync: () => {} },
  // No mutations plugin = smaller bundle
})
```

## Benefits

- **Smaller bundles**: 25% reduction for read-only collections (~58.5KB vs ~78.3KB minified)
- **Type safety**: TypeScript enforces that `onInsert`, `onUpdate`, and `onDelete` handlers require the `mutations` plugin
- **Runtime safety**: Attempting to call mutation methods without the plugin throws `MutationsNotEnabledError` with a clear message

## Affected Packages

All adapter packages have been updated to use the mutations plugin:
- `@tanstack/electric-db-collection`
- `@tanstack/powersync-db-collection`
- `@tanstack/query-db-collection`
- `@tanstack/rxdb-db-collection`
- `@tanstack/trailbase-db-collection`

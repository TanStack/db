---
"@tanstack/query-db-collection": patch
---

fix: ensure ctx.meta.loadSubsetOptions type-safety works automatically

The module augmentation for ctx.meta.loadSubsetOptions is now guaranteed to load automatically when importing from @tanstack/query-db-collection. Previously, users needed to explicitly import QueryCollectionMeta or use @ts-ignore to pass ctx.meta?.loadSubsetOptions to parseLoadSubsetOptions.

Additionally, QueryCollectionMeta is now an interface (instead of a type alias), enabling users to safely extend meta with custom properties via declaration merging:

```typescript
declare module "@tanstack/query-db-collection" {
  interface QueryCollectionMeta {
    myCustomProperty: string
  }
}
```

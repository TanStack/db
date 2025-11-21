---
id: QueryCollectionMeta
title: QueryCollectionMeta
---

# Type Alias: QueryCollectionMeta

```ts
type QueryCollectionMeta = Record<string, unknown> & object;
```

Defined in: [packages/query-db-collection/src/query.ts:50](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/query.ts#L50)

Base type for Query Collection meta properties.
Users can extend this type when augmenting the @tanstack/query-core module
to add their own custom properties while preserving loadSubsetOptions.

## Type Declaration

### loadSubsetOptions

```ts
loadSubsetOptions: LoadSubsetOptions;
```

## Example

```typescript
declare module "@tanstack/query-core" {
  interface Register {
    queryMeta: QueryCollectionMeta & {
      myCustomProperty: string
    }
  }
}
```

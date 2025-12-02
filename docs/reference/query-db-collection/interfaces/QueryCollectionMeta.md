---
id: QueryCollectionMeta
title: QueryCollectionMeta
---

# Interface: QueryCollectionMeta

Defined in: [packages/query-db-collection/src/global.ts:30](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/global.ts#L30)

Base interface for Query Collection meta properties.
Users can extend this interface to add their own custom properties while
preserving loadSubsetOptions.

## Example

```typescript
declare module "@tanstack/query-db-collection" {
  interface QueryCollectionMeta {
    myCustomProperty: string
    userId?: number
  }
}
```

## Extends

- `Record`\<`string`, `unknown`\>

## Indexable

```ts
[key: string]: unknown
```

## Properties

### loadSubsetOptions

```ts
loadSubsetOptions: LoadSubsetOptions;
```

Defined in: [packages/query-db-collection/src/global.ts:31](https://github.com/TanStack/db/blob/main/packages/query-db-collection/src/global.ts#L31)

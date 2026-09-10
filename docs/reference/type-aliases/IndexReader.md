---
id: IndexReader
title: IndexReader
---

# Type Alias: IndexReader\<TKey\>

```ts
type IndexReader<TKey> = Pick<IndexInterface<TKey>, 
  | "lookup"
  | "rangeQuery"
  | "take"
  | "takeFromStart"
  | "keyCount"
  | "supports"
  | "supportsRangeOptimization"
| "canOptimizeRangeFor">;
```

Defined in: [packages/db/src/indexes/base-index.ts:42](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L42)

The read-side surface consumers use on a resolved (possibly reversed) index.

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

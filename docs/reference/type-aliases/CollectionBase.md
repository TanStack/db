---
id: CollectionBase
title: CollectionBase
---

```ts
type CollectionBase<TKey, TOutput> = Pick<SortedMap<TKey, TOutput>, 
  | "size"
  | "get"
  | "has"
  | "keys"
  | "values"
  | "entries"
| typeof Symbol.iterator>;
```

Defined in: [packages/db/src/collection/index.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L52)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

### TOutput

`TOutput`

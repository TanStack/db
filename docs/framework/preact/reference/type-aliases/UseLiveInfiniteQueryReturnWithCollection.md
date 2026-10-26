---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = UseLiveQueryResult<TResult, TKey, TResult[], Collection<TResult, TKey, TUtils> & NonSingleResult> & InfiniteQueryPagination<TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:56](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L56)

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

---
id: UseLiveInfiniteQueryReturnWithCollection
title: UseLiveInfiniteQueryReturnWithCollection
---

```ts
type UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils> = UseLiveQueryResult<TResult, TKey, TResult[], Collection<TResult, TKey, TUtils> & NonSingleResult> & InfiniteQueryPagination<TResult>;
```

Defined in: [useLiveInfiniteQuery.ts:55](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L55)

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\>

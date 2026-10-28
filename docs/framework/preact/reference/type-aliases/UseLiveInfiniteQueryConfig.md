---
id: UseLiveInfiniteQueryConfig
title: UseLiveInfiniteQueryConfig
---

```ts
type UseLiveInfiniteQueryConfig<_TContext> = object;
```

Defined in: [useLiveInfiniteQuery.ts:27](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L27)

## Type Parameters

### _TContext

`_TContext` *extends* `Context`

## Properties

### initialPageParam?

```ts
optional initialPageParam: number;
```

Defined in: [useLiveInfiniteQuery.ts:35](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L35)

First result-page label, not a server cursor or remote offset.

***

### pageSize?

```ts
optional pageSize: number;
```

Defined in: [useLiveInfiniteQuery.ts:33](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L33)

***

### queryKey?

```ts
optional queryKey: LiveQueryKey;
```

Defined in: [useLiveInfiniteQuery.ts:32](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveInfiniteQuery.ts#L32)

Explicit identity for a query whose IR cannot derive one, such as a query
with functional variants. Structured queries should omit it.
